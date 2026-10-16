import { randomUUID } from 'node:crypto';

// Customer-facing spending controller for the operator-funded lane.
//
// The nanos meter in server/budget.mjs caps one deployment-wide dollar amount per UTC day. This
// controller is the account side: a per-account allowance, a separate deployment-wide cents ceiling
// that resets daily, and an in-process concurrency gate. It runs on the same storage adapter the
// rest of the server uses (`controller*` methods on db.mjs / pgdb.mjs), so it works on both SQLite
// and Postgres. It never sees a BYOK request — a visitor's own key is out of the operator's spend.
//
// Two counters, two resets:
//   - Global spend is keyed by UTC day, so the ceiling starts over each day.
//   - Account spend carries its billing cycle (the UTC month), so a new month starts the
//     allowance over. A stale cycle resets the row on the next check.
//
// If the storage adapter does not expose the controller methods (e.g. a diskless SQLite host), the
// controller reports `enabled: false` and the caller does not gate on it. That keeps the funded
// lane from being blocked by a guard that cannot persist its own state.

export class SpendingError extends Error {
  /** @param {number} status HTTP status the API should answer with. @param {string} code stable, machine-readable reason. */
  constructor(status, code, message) {
    super(message);
    this.name = 'SpendingError';
    this.status = status;
    this.code = code;
  }
}

export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);
export const utcCycle = (now = new Date()) => now.toISOString().slice(0, 7);
export const globalCapCents = (env = process.env) => {
  const value = Number(env.CONTROLLER_GLOBAL_DAILY_CAP_CENTS ?? 5000);
  return Number.isInteger(value) && value >= 0 && value <= 100_000_000 ? value : 5000;
};
export const defaultAllowanceCents = (env = process.env) => {
  const value = Number(env.CONTROLLER_DEFAULT_ALLOWANCE_CENTS ?? 500);
  return Number.isInteger(value) && value >= 0 && value <= 100_000_000 ? value : 500;
};

/** USD-per-1M-token rates, same override the old inline version read. An unknown model is priced
 *  at the conservative default rather than guessed from its name. */
export function controllerRates(env = process.env) {
  let configured = {};
  try { configured = JSON.parse(env.MANAGED_MODEL_RATES_JSON || '{}'); } catch { configured = {}; }
  if (!configured || typeof configured !== 'object' || Array.isArray(configured)) configured = {};
  return { ...configured, default: { inputPer1M: 0.15, outputPer1M: 0.60, ...(configured.default ?? {}) } };
}
export function centsFor({ promptTokens = 0, completionTokens = 0, model, env = process.env } = {}) {
  const rate = controllerRates(env)[model] || controllerRates(env).default;
  return Math.max(1, Math.ceil(((promptTokens / 1_000_000) * rate.inputPer1M + (completionTokens / 1_000_000) * rate.outputPer1M) * 100));
}

/** The adapter methods this controller needs. Any missing means the guard cannot run here. */
const REQUIRED = ['controllerGlobalSpent', 'controllerTryReserve', 'controllerSettle', 'controllerCustomer', 'controllerUpsertCustomer', 'controllerAddCustomerSpend', 'controllerSuspendIfOver'];

/**
 * @param {object} opts
 * @param {object} [opts.db] A storage adapter exposing the `controller*` methods (db.mjs or pgdb.mjs).
 * @param {object} [opts.env] Environment for the cap and default allowance.
 * @param {() => Date} [opts.now]
 */
export function createSpendingController({ db, env = process.env, now = () => new Date() } = {}) {
  const enabled = Boolean(db) && REQUIRED.every(method => typeof db[method] === 'function');
  // In-process only: the funded lane runs one process; concurrency is advisory across instances.
  const active = new Map();
  let cap = globalCapCents(env);

  if (!enabled) return { enabled: false, reserve: async () => null, settle: async () => {}, acquire: () => () => {}, upsertBudget: async () => null, setGlobalCapCents: () => {}, get globalCapCents() { return cap; }, close: () => {} };

  /** Load a customer row, resetting the cycle counters when the stored cycle is stale. */
  async function account(userId) {
    const row = await db.controllerCustomer(userId);
    const cycle = utcCycle(now());
    if (!row) return db.controllerUpsertCustomer({ userId, cycle, allowanceCents: defaultAllowanceCents(env), concurrencyLimit: 2 });
    if (row.cycle !== cycle) return db.controllerUpsertCustomer({ userId, cycle, allowanceCents: Number(row.allowance_cents) || defaultAllowanceCents(env), concurrencyLimit: Number(row.concurrency_limit) || 2 });
    return row;
  }

  return {
    enabled: true,

    /**
     * Pre-flight gate and reservation in one step. Throws a SpendingError (503/429/403) when the
     * deployment ceiling, the account allowance, or concurrency says no. Returns a reservation id
     * to settle.
     */
    async reserve({ userId, cents = 5 } = {}) {
      if (typeof userId !== 'string' || !userId) throw new SpendingError(400, 'invalid_user', 'A user id is required to authorize a task.');
      if (!Number.isInteger(cents) || cents < 0) throw new SpendingError(400, 'invalid_estimate', 'The estimated cost must be a non-negative whole number of cents.');
      const day = utcDay(now());
      const current = await account(userId);
      if (current.is_suspended) throw new SpendingError(429, 'suspended', 'Account compute allowance exhausted. Upgrade tier or provide a personal BYOK key.');
      if (Number(current.spent_cents) + cents > Number(current.allowance_cents)) throw new SpendingError(429, 'allowance', 'Account compute allowance exhausted. Upgrade tier or provide a personal BYOK key.');
      const id = randomUUID();
      const accepted = await db.controllerTryReserve({ id, day, cents, limit: cap });
      if (!accepted) throw new SpendingError(503, 'global_cap', 'Global infrastructure spending limit reached. Tasks paused for platform safety.');
      return id;
    },

    /** Settle a reservation to its actual cost; suspends the account if it crossed the line. */
    async settle({ userId, reservationId, reservationCents = 0, promptTokens = 0, completionTokens = 0, model, over = false } = {}) {
      if (!reservationId) return;
      const actual = centsFor({ promptTokens, completionTokens, model, env });
      await db.controllerSettle(reservationId, actual, over || actual > reservationCents);
      await db.controllerAddCustomerSpend(userId, actual);
      await db.controllerSuspendIfOver(userId);
    },

    /** Concurrency gate. Returns a release function; call it in a finally block. */
    acquire(userId) {
      const count = active.get(userId) ?? 0;
      if (count >= 2) throw new SpendingError(429, 'concurrency', 'Max concurrent agent executions (2) reached.');
      active.set(userId, count + 1);
      let released = false;
      return () => { if (released) return; released = true; const next = (active.get(userId) ?? 1) - 1; if (next <= 0) active.delete(userId); else active.set(userId, next); };
    },

    /** Provision or adjust an account. Not part of the request path; the admin dashboard owns it. */
    async upsertBudget({ userId, allowanceCents = defaultAllowanceCents(env), concurrencyLimit = 2 }) {
      return db.controllerUpsertCustomer({ userId, cycle: utcCycle(now()), allowanceCents, concurrencyLimit });
    },

    setGlobalCapCents(cents) { if (Number.isInteger(cents) && cents >= 0) cap = cents; },
    get globalCapCents() { return cap; },
    close: () => {},
  };
}
