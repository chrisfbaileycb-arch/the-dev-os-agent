import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSpendingController, centsFor, utcCycle, utcDay } from '../server/controller.mjs';

// The controller now runs on a storage adapter's `controller*` methods, not a raw sqlite handle.
// These tests build a minimal in-memory adapter so the gate, the two reset boundaries, and the
// concurrency release are exercised without the whole server.
function adapter() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE controller_global (day TEXT PRIMARY KEY, charged_cents INTEGER NOT NULL DEFAULT 0, blocked INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE controller_attempts (id TEXT PRIMARY KEY, day TEXT NOT NULL, charged_cents INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE controller_customers (user_id TEXT PRIMARY KEY, cycle TEXT NOT NULL, allowance_cents INTEGER NOT NULL DEFAULT 500, spent_cents INTEGER NOT NULL DEFAULT 0, is_suspended INTEGER NOT NULL DEFAULT 0, concurrency_limit INTEGER NOT NULL DEFAULT 2);
  `);
  return {
    controllerGlobalSpent: (day) => Number(db.prepare('SELECT charged_cents FROM controller_global WHERE day=?').get(day)?.charged_cents ?? 0),
    controllerTryReserve({ id, day, cents, limit }) {
      db.prepare('INSERT OR IGNORE INTO controller_global (day) VALUES (?)').run(day);
      const ok = db.prepare('UPDATE controller_global SET charged_cents=charged_cents+? WHERE day=? AND blocked=0 AND charged_cents<=?').run(cents, day, limit - cents).changes === 1;
      if (ok) db.prepare('INSERT INTO controller_attempts (id,day,charged_cents) VALUES (?,?,?)').run(id, day, cents);
      return ok;
    },
    controllerSettle(id, actual, blocked = false) {
      const row = db.prepare('SELECT day,charged_cents FROM controller_attempts WHERE id=? AND settled=0').get(id);
      if (row) {
        db.prepare('UPDATE controller_global SET charged_cents=charged_cents+?,blocked=MAX(blocked,?) WHERE day=?').run(actual - row.charged_cents, blocked ? 1 : 0, row.day);
        db.prepare('UPDATE controller_attempts SET charged_cents=?,settled=1 WHERE id=?').run(actual, id);
      }
    },
    controllerCustomer: (userId) => db.prepare('SELECT * FROM controller_customers WHERE user_id=?').get(userId) ?? null,
    controllerUpsertCustomer({ userId, cycle, allowanceCents, concurrencyLimit }) {
      db.prepare(`INSERT INTO controller_customers (user_id, cycle, allowance_cents, concurrency_limit) VALUES (?,?,?,?) ON CONFLICT (user_id) DO UPDATE SET spent_cents = CASE WHEN controller_customers.cycle <> excluded.cycle THEN 0 ELSE controller_customers.spent_cents END, is_suspended = CASE WHEN controller_customers.cycle <> excluded.cycle THEN 0 ELSE controller_customers.is_suspended END, cycle=excluded.cycle, allowance_cents=excluded.allowance_cents, concurrency_limit=excluded.concurrency_limit`).run(userId, cycle, allowanceCents, concurrencyLimit);
      return db.prepare('SELECT * FROM controller_customers WHERE user_id=?').get(userId);
    },
    controllerAddCustomerSpend: (userId, cents) => db.prepare('UPDATE controller_customers SET spent_cents=spent_cents+? WHERE user_id=?').run(cents, userId),
    controllerSuspendIfOver: (userId) => db.prepare('UPDATE controller_customers SET is_suspended=1 WHERE user_id=? AND spent_cents>=allowance_cents').run(userId),
    close: () => db.close(),
  };
}
const controller = (opts = {}) => createSpendingController({ db: adapter(), env: { CONTROLLER_GLOBAL_DAILY_CAP_CENTS: '5000', ...(opts.env ?? {}) }, ...opts });

test('an adapter without the controller methods yields a disabled no-op controller', async () => {
  const off = createSpendingController({ db: { usedThisMonth: () => 0 } });
  assert.equal(off.enabled, false);
  assert.equal(await off.reserve({ userId: 'a' }), null);
  assert.equal(off.acquire('a')(), undefined);
});

test('reserve refuses once the deployment daily ceiling is spent', async () => {
  const c = controller({ env: { CONTROLLER_GLOBAL_DAILY_CAP_CENTS: '5' } });
  await c.upsertBudget({ userId: 'tenant-a', allowanceCents: 500, concurrencyLimit: 2 });
  // 80,000 output tokens at $0.60/1M settles to 5 cents, exactly filling the 5-cent cap.
  const first = await c.reserve({ userId: 'tenant-a', cents: 5 });
  await c.settle({ userId: 'tenant-a', reservationId: first, reservationCents: 5, promptTokens: 0, completionTokens: 80_000 });
  await assert.rejects(c.reserve({ userId: 'tenant-a', cents: 5 }), e => e.status === 503 && e.code === 'global_cap');
  c.close();
});

test('settlement charges the account and suspends it once over the allowance', async () => {
  const c = controller();
  await c.upsertBudget({ userId: 'tenant-a', allowanceCents: 50, concurrencyLimit: 2 });
  const r = await c.reserve({ userId: 'tenant-a', cents: 5 });
  // 1,000,000 output tokens at $0.60/1M = 60 cents, which crosses the 50-cent allowance.
  await c.settle({ userId: 'tenant-a', reservationId: r, reservationCents: 5, promptTokens: 0, completionTokens: 1_000_000, model: 'default' });
  await assert.rejects(c.reserve({ userId: 'tenant-a', cents: 5 }), e => e.status === 429 && e.code === 'suspended');
  c.close();
});

test('the account allowance resets when the billing cycle rolls over', async () => {
  let clock = new Date('2026-10-15T00:00:00Z');
  const db = adapter();
  const c = createSpendingController({ db, env: { CONTROLLER_GLOBAL_DAILY_CAP_CENTS: '100000' }, now: () => clock });
  await c.upsertBudget({ userId: 'tenant-a', allowanceCents: 10, concurrencyLimit: 2 });
  const r = await c.reserve({ userId: 'tenant-a', cents: 5 });
  await c.settle({ userId: 'tenant-a', reservationId: r, reservationCents: 5, promptTokens: 0, completionTokens: 8_000_000 });
  await assert.rejects(c.reserve({ userId: 'tenant-a', cents: 5 }), e => e.code === 'suspended');
  // A new month clears the spend and the suspension.
  clock = new Date('2026-11-01T00:00:00Z');
  const fresh = await c.reserve({ userId: 'tenant-a', cents: 5 });
  assert.ok(fresh);
  c.close();
});

test('the deployment ceiling is per UTC day and starts over the next day', async () => {
  let clock = new Date('2026-10-15T00:00:00Z');
  const db = adapter();
  const c = createSpendingController({ db, env: { CONTROLLER_GLOBAL_DAILY_CAP_CENTS: '5' }, now: () => clock });
  await c.upsertBudget({ userId: 'tenant-a', allowanceCents: 100000, concurrencyLimit: 2 });
  // A 5-cent reservation exactly fills the 5-cent cap; the next is refused.
  const r = await c.reserve({ userId: 'tenant-a', cents: 5 });
  await c.settle({ userId: 'tenant-a', reservationId: r, reservationCents: 5, promptTokens: 0, completionTokens: 0 });
  await assert.rejects(c.reserve({ userId: 'tenant-a', cents: 5 }), e => e.code === 'global_cap');
  // The next UTC day is a fresh ceiling.
  clock = new Date('2026-10-16T00:00:00Z');
  assert.ok(await c.reserve({ userId: 'tenant-a', cents: 5 }));
  c.close();
});

test('concurrency is capped and released on every path', async () => {
  const c = controller();
  await c.upsertBudget({ userId: 'tenant-a', allowanceCents: 500, concurrencyLimit: 2 });
  const release1 = c.acquire('tenant-a');
  const release2 = c.acquire('tenant-a');
  assert.throws(() => c.acquire('tenant-a'), e => e.status === 429 && e.code === 'concurrency');
  release1(); release1(); // idempotent
  const release3 = c.acquire('tenant-a');
  release2(); release3();
  assert.equal(c.acquire('tenant-a')(), undefined);
  c.close();
});

test('pricing uses per-model rates, defaults an unknown model, and validates its inputs', () => {
  const env = { MANAGED_MODEL_RATES_JSON: JSON.stringify({ 'cheap/model': { inputPer1M: 0, outputPer1M: 1.0 } }) };
  assert.equal(centsFor({ completionTokens: 1_000_000, model: 'cheap/model', env }), 100);
  assert.equal(centsFor({ completionTokens: 1_000_000, model: 'unknown/model', env }), 60);
  // A zero-cost call still reserves at least one cent so it cannot slip past the ceiling.
  assert.equal(centsFor({ promptTokens: 0, completionTokens: 0, model: 'cheap/model', env }), 1);
  assert.equal(utcDay(new Date('2026-10-15T23:59:59Z')), '2026-10-15');
  assert.equal(utcCycle(new Date('2026-10-15T23:59:59Z')), '2026-10');
});

test('reserve rejects malformed input before touching storage', async () => {
  const c = controller();
  await assert.rejects(c.reserve({}), e => e.status === 400 && e.code === 'invalid_user');
  await assert.rejects(c.reserve({ userId: 'a', cents: -1 }), e => e.status === 400 && e.code === 'invalid_estimate');
  c.close();
});
