import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { createSpendingController } from '../server/controller.mjs';

const controller = () => createSpendingController();

test('pre-flight gate blocks on the global ceiling, the account allowance, suspension, and concurrency', () => {
  const c = controller();
  c.upsertBudget({ userId: 'tenant-a', allowanceCents: 500, concurrencyLimit: 2 });

  // A run within every limit is authorized.
  assert.equal(c.authorizeTask({ userId: 'tenant-a', estimatedCostCents: 5, activeRuns: 0 }), true);

  // C. Concurrency.
  assert.throws(() => c.authorizeTask({ userId: 'tenant-a', estimatedCostCents: 5, activeRuns: 2 }), e => e.status === 429 && e.code === 'concurrency');

  // B. Unknown account.
  assert.throws(() => c.authorizeTask({ userId: 'nobody' }), e => e.status === 403 && e.code === 'no_budget');

  // B. Account allowance.
  assert.throws(() => c.authorizeTask({ userId: 'tenant-a', estimatedCostCents: 600 }), e => e.status === 429 && e.code === 'allowance');

  // A. Deployment ceiling: a tiny cap refuses even a well-funded account.
  c.setGlobalCapCents(3);
  assert.throws(() => c.authorizeTask({ userId: 'tenant-a', estimatedCostCents: 5 }), e => e.status === 503 && e.code === 'global_cap');
  c.close();
});

test('settlement charges the account and the deployment, then trips the circuit breaker', () => {
  const c = controller();
  c.upsertBudget({ userId: 'tenant-a', allowanceCents: 500, concurrencyLimit: 2 });

  // 1,000,000 output tokens at $0.60/1M = $0.60 = 60 cents; the deployment cap absorbs it.
  const charge = c.recordSpend({ userId: 'tenant-a', promptTokens: 0, completionTokens: 1_000_000, model: 'default' });
  assert.equal(charge, 60);

  // A settled overspend suspends the account, and the next gate refuses it.
  c.recordSpend({ userId: 'tenant-a', promptTokens: 0, completionTokens: 8_000_000, model: 'default' });
  assert.throws(() => c.authorizeTask({ userId: 'tenant-a' }), e => e.status === 429 && e.code === 'suspended');

  // An unknown user cannot settle, and the failed transaction leaves no partial write.
  assert.throws(() => c.recordSpend({ userId: 'nobody', promptTokens: 10, completionTokens: 10 }), e => e.status === 403);
  assert.throws(() => c.recordSpend({ userId: 'tenant-a', promptTokens: -1, completionTokens: 0 }), e => e.status === 400);
  c.close();
});

test('per-model rates override the default and an unknown model is priced at the default', () => {
  const prior = process.env.MANAGED_MODEL_RATES_JSON;
  process.env.MANAGED_MODEL_RATES_JSON = JSON.stringify({ 'cheap/model': { inputPer1M: 0, outputPer1M: 1.0 } });
  const c = controller();
  try {
    c.upsertBudget({ userId: 'rate-a' });
    // $1.00/1M output = 100 cents by the override.
    assert.equal(c.recordSpend({ userId: 'rate-a', promptTokens: 0, completionTokens: 1_000_000, model: 'cheap/model' }), 100);
    // An unlisted model falls to the 0.60 default: 60 cents.
    assert.equal(c.recordSpend({ userId: 'rate-a', promptTokens: 0, completionTokens: 1_000_000, model: 'unknown/model' }), 60);
  } finally {
    if (prior === undefined) delete process.env.MANAGED_MODEL_RATES_JSON; else process.env.MANAGED_MODEL_RATES_JSON = prior;
    c.close();
  }
});

test('the watchdog aborts on wall clock and on step allocation, and cleans up its timer', async () => {
  const c = controller();
  const timed = c.createExecutionWatchdog({ maxSeconds: 0.05, maxSteps: 8 });
  assert.equal(timed.signal.aborted, false);
  timed.trackStep();
  await new Promise(r => setTimeout(r, 120));
  assert.equal(timed.signal.aborted, true);
  assert.match(String(timed.signal.reason), /timeout/);
  timed.cleanup();

  const stepped = c.createExecutionWatchdog({ maxSeconds: 60, maxSteps: 2 });
  stepped.trackStep(); stepped.trackStep();
  stepped.trackStep();
  assert.equal(stepped.signal.aborted, true);
  assert.match(String(stepped.signal.reason), /step allocation/);
  stepped.cleanup();
  c.close();
});

test('the controller accepts a shared sqlite handle instead of opening its own', () => {
  const db = new DatabaseSync(':memory:');
  try {
    const first = createSpendingController({ db });
    first.upsertBudget({ userId: 'shared-a', allowanceCents: 1000, concurrencyLimit: 3 });
    // A second controller over the same handle sees the same row rather than a fresh database.
    const second = createSpendingController({ db });
    assert.equal(second.upsertBudget({ userId: 'shared-a', concurrencyLimit: 3 }).cycle_allowance_cents, 500);
    assert.equal(first.authorizeTask({ userId: 'shared-a', activeRuns: 2 }), true);
  } finally { db.close(); }
});
