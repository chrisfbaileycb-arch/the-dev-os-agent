import { DatabaseSync } from 'node:sqlite';

// Customer-facing spending controller for a multi-tenant deployment.
//
// STATUS: implemented and unit-tested, but NOT wired into the request path. Nothing in
// server/index.mjs imports this module. It exists as a staged building block toward the
// per-account quotas, global cap, and concurrency limits described in
// docs/agent-libraries-and-execution-next-steps.md, alongside the nanos budget in
// server/budget.mjs (which is wired and gates the managed free tier today).
//
// Before this can guard live traffic it must run on the deployment's real datastore. Production
// uses Postgres (render.yaml sets DATABASE_URL); this module is written against node:sqlite
// (`DatabaseSync`, `BEGIN IMMEDIATE`), so wiring it as-is would leave the tenant guard inert on
// the very topology it is meant to protect. The fix is a Postgres-backed adapter with the same
// surface, not a direct call from proxy.mjs.
//
// The managed free tier already meters its own spend in server/budget.mjs (nanos, per-attempt
// reservations). This controller is the customer side: an allowance per account, a deployment-wide
// ceiling, a concurrency gate, an execution watchdog, and settlement that will not let one tenant's
// run drain the platform. It shares the deployment's SQLite handle (node:sqlite, no native build)
// so verification runs with `node --test` and no extra dependency.

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS customer_budgets (
    user_id TEXT PRIMARY KEY,
    cycle_allowance_cents INTEGER NOT NULL DEFAULT 500,  -- e.g. $5.00
    spent_cents INTEGER NOT NULL DEFAULT 0,
    is_suspended INTEGER NOT NULL DEFAULT 0,
    concurrency_limit INTEGER NOT NULL DEFAULT 2
  );
  CREATE TABLE IF NOT EXISTS system_guards (
    key TEXT PRIMARY KEY,
    value_cents INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO system_guards (key, value_cents) VALUES ('global_daily_cap_cents', 5000); -- $50.00
  INSERT OR IGNORE INTO system_guards (key, value_cents) VALUES ('global_today_spent_cents', 0);
`;

export class SpendingError extends Error {
  /** @param {number} status HTTP status the API should answer with. @param {string} code stable, machine-readable reason. */
  constructor(status, code, message) {
    super(message);
    this.name = 'SpendingError';
    this.status = status;
    this.code = code;
  }
}

/**
 * @param {object} opts
 * @param {import('node:sqlite').DatabaseSync} [opts.db] A shared deployment handle. Opened from
 *   DATABASE_PATH (or :memory:) when omitted, so the controller can run on its own.
 * @param {string} [opts.file] Path when opening its own handle.
 */
export function createSpendingController({ db, file = process.env.DATABASE_PATH || ':memory:' } = {}) {
  // This module speaks node:sqlite only. On Postgres (the production datastore) it must not be
  // handed a pg pool and quietly no-op; refuse loudly until a Postgres adapter exists. A shared
  // node:sqlite handle is fine; an unrecognised object is not.
  if (db !== undefined && !(db instanceof DatabaseSync)) throw new Error('createSpendingController is node:sqlite only; a Postgres-backed adapter is required before this can guard live traffic.');
  // A shared handle owns its own migration ordering; apply ours alone only when we opened it.
  const handle = db ?? new DatabaseSync(file);
  handle.exec(SCHEMA);

  const guards = {
    read: handle.prepare('SELECT value_cents FROM system_guards WHERE key = ?'),
    add: handle.prepare("UPDATE system_guards SET value_cents = value_cents + ? WHERE key = 'global_today_spent_cents'"),
  };
  const queries = {
    globalCap: guards.read,
    customer: handle.prepare('SELECT * FROM customer_budgets WHERE user_id = ?'),
    addGlobal: guards.add,
    addCustomer: handle.prepare('UPDATE customer_budgets SET spent_cents = spent_cents + ? WHERE user_id = ?'),
    suspend: handle.prepare('UPDATE customer_budgets SET is_suspended = 1 WHERE user_id = ? AND spent_cents >= cycle_allowance_cents'),
    upsertCustomer: handle.prepare(`INSERT INTO customer_budgets (user_id, cycle_allowance_cents, concurrency_limit)
      VALUES (?, ?, ?) ON CONFLICT (user_id) DO UPDATE SET cycle_allowance_cents = excluded.cycle_allowance_cents, concurrency_limit = excluded.concurrency_limit`),
    setGlobalCap: handle.prepare("UPDATE system_guards SET value_cents = ? WHERE key = 'global_daily_cap_cents'"),
  };

  /**
   * 1. Synchronous pre-flight gate. Call before an LLM call or worker step starts.
   * Throws a SpendingError (503/403/429) when the platform, the account, or concurrency says no.
   */
  function authorizeTask({ userId, estimatedCostCents = 5, activeRuns = 0 } = {}) {
    if (typeof userId !== 'string' || !userId) throw new SpendingError(400, 'invalid_user', 'A user id is required to authorize a task.');
    if (!Number.isInteger(estimatedCostCents) || estimatedCostCents < 0) throw new SpendingError(400, 'invalid_estimate', 'The estimated cost must be a non-negative whole number of cents.');
    if (!Number.isInteger(activeRuns) || activeRuns < 0) throw new SpendingError(400, 'invalid_concurrency', 'The active run count must be a non-negative whole number.');

    const globalCap = queries.globalCap.get('global_daily_cap_cents')?.value_cents ?? 0;
    const globalSpent = queries.globalCap.get('global_today_spent_cents')?.value_cents ?? 0;
    // A. Deployment-wide ceiling.
    if (globalSpent + estimatedCostCents > globalCap) throw new SpendingError(503, 'global_cap', 'Global infrastructure spending limit reached. Tasks paused for platform safety.');

    // B. Customer allowance.
    const customer = queries.customer.get(userId);
    if (!customer) throw new SpendingError(403, 'no_budget', 'No budget allocation found for this user account.');
    if (customer.is_suspended) throw new SpendingError(429, 'suspended', 'Account compute allowance exhausted. Upgrade tier or provide a personal BYOK key.');
    if (customer.spent_cents + estimatedCostCents > customer.cycle_allowance_cents) throw new SpendingError(429, 'allowance', 'Account compute allowance exhausted. Upgrade tier or provide a personal BYOK key.');

    // C. Concurrency.
    if (activeRuns >= customer.concurrency_limit) throw new SpendingError(429, 'concurrency', `Max concurrent agent executions (${customer.concurrency_limit}) reached.`);
    return true;
  }

  /**
   * 2. Per-run wall-clock and step watchdog. An over-budget run aborts its own signal, so the
   * caller's fetch and worker loop stop instead of being silently trimmed.
   */
  function createExecutionWatchdog({ maxSeconds = 45, maxSteps = 8 } = {}) {
    const controller = new AbortController();
    const startTime = Date.now();
    let currentStep = 0;
    const timeout = setTimeout(() => controller.abort(new Error(`Execution timeout: exceeded maximum duration of ${maxSeconds}s.`)), maxSeconds * 1000);
    timeout.unref?.();
    return {
      signal: controller.signal,
      trackStep: () => {
        currentStep++;
        if (currentStep > maxSteps) controller.abort(new Error(`Execution guardrail: exceeded maximum step allocation (${maxSteps} steps).`));
        return currentStep;
      },
      cleanup: () => clearTimeout(timeout),
      getElapsedSeconds: () => (Date.now() - startTime) / 1000,
      get steps() { return currentStep; },
    };
  }

  // USD per 1M tokens. Overridable per deployment through MANAGED_MODEL_RATES_JSON so a price
  // change is a config edit, not a redeploy, and an unknown model is priced conservatively (default).
  function rates() {
    let configured = {};
    try { configured = JSON.parse(process.env.MANAGED_MODEL_RATES_JSON || '{}'); } catch { configured = {}; }
    if (!configured || typeof configured !== 'object' || Array.isArray(configured)) configured = {};
    return { ...configured, default: { inputPer1M: 0.15, outputPer1M: 0.60, ...(configured.default ?? {}) } };
  }

  /**
   * 3. Settlement and circuit breaker. One transaction moves the deployment ceiling, the account's
   * spend, and the suspension flag together. The ledger is the source of truth, so both counters
   * are gated; a settled run that crossed the line suspends the account.
   * @returns {number} the cents charged for this call.
   */
  function recordSpend({ userId, promptTokens, completionTokens, model } = {}) {
    if (typeof userId !== 'string' || !userId) throw new SpendingError(400, 'invalid_user', 'A user id is required to record spend.');
    if (![promptTokens, completionTokens].every(v => Number.isFinite(v) && v >= 0)) throw new SpendingError(400, 'invalid_tokens', 'Token counts must be non-negative numbers.');
    const rate = rates()[model] || rates().default;
    const totalCostCents = Math.max(1, Math.ceil(((promptTokens / 1_000_000) * rate.inputPer1M + (completionTokens / 1_000_000) * rate.outputPer1M) * 100));

    handle.exec('BEGIN IMMEDIATE');
    try {
      const customer = queries.customer.get(userId);
      if (!customer) { handle.exec('ROLLBACK'); throw new SpendingError(403, 'no_budget', 'No budget allocation found for this user account.'); }
      queries.addGlobal.run(totalCostCents);
      queries.addCustomer.run(totalCostCents, userId);
      queries.suspend.run(userId);
      handle.exec('COMMIT');
    } catch (error) { try { handle.exec('ROLLBACK'); } catch { /* already rolled back */ } throw error; }
    return totalCostCents;
  }

  /** Provision or adjust an account. Not part of the request path; the admin dashboard owns it. */
  function upsertBudget({ userId, allowanceCents = 500, concurrencyLimit = 2 }) {
    queries.upsertCustomer.run(userId, allowanceCents, concurrencyLimit);
    return queries.customer.get(userId);
  }

  function setGlobalCapCents(cents) { queries.setGlobalCap.run(cents); }

  return { authorizeTask, createExecutionWatchdog, recordSpend, upsertBudget, setGlobalCapCents, close: () => handle.close() };
}
