import { randomUUID } from 'node:crypto';

// USD accounting is independent of the browser's editable token/credit ledger.
// Pending/uncertain attempts retain their full reservation across process restarts.
export const NANOS_PER_USD = 1_000_000_000;
export const utcDay = (now = new Date()) => now.toISOString().slice(0, 10);
export function dailyBudgetNanos(env = process.env) {
  const value = Number(env.DAILY_SERVER_BUDGET_USD ?? 0);
  return Number.isFinite(value) && value > 0 && value <= 10_000 ? Math.floor(value * NANOS_PER_USD) : 0;
}
export class BudgetError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}
const unavailable = () => new BudgetError('free_tier_unavailable', 'Public free tier warming up — enter your own key in Settings or try again shortly.');
const exhausted = () => new BudgetError('free_tier_exhausted', 'Managed allowance is exhausted. Use your own key in Settings or wait for the UTC daily reset.');

/** Operator-reviewed upper bounds, never browser prices or guesses from a model name. */
export function managedRate(env, provider, model) {
  let entries;
  try { entries = JSON.parse(env.MANAGED_MODEL_COST_BOUNDS_JSON || '[]'); } catch { throw unavailable(); }
  if (!Array.isArray(entries) || entries.length > 200) throw unavailable();
  const matched = entries.filter(e => e?.provider === provider && typeof e.model === 'string' && e.model.toLowerCase() === model.toLowerCase());
  if (matched.length !== 1) throw unavailable();
  const rate = matched[0];
  for (const key of ['inputUsdPerMillion', 'outputUsdPerMillion', 'requestUsd']) {
    if (typeof rate[key] !== 'number' || !Number.isFinite(rate[key]) || rate[key] < 0 || rate[key] > 10_000) throw unavailable();
  }
  if (!Number.isInteger(rate.maxInputTokens) || rate.maxInputTokens < 1 || rate.maxInputTokens > 10_000_000 || rate.outputIncludesReasoning !== true) throw unavailable();
  return rate;
}
export function costNanos(rate, input, output) {
  const value = Math.ceil((rate.inputUsdPerMillion * input + rate.outputUsdPerMillion * output) * 1000 + rate.requestUsd * NANOS_PER_USD);
  if (!Number.isSafeInteger(value) || value < 0) throw unavailable();
  // Even a zero-priced route has to reserve a row and pass the shared daily gate.
  return Math.max(1, value);
}
export function createDailyBudget({ db, storage, env = process.env, now = () => new Date() }) {
  const current = () => typeof env === 'function' ? env() : env;
  return {
    async reserve(provider, model, messages, maxOutput) {
      const configuration = current(); const limit = dailyBudgetNanos(configuration);
      if (!limit) throw exhausted();
      if (!storage?.durable || !db?.reserveDailyBudget || !db?.settleDailyBudget) throw unavailable();
      const rate = managedRate(configuration, provider, model);
      // Multimodal/context-dependent prices need a dedicated bound; do not price images as text.
      if (messages.some(m => typeof m.content !== 'string')) throw unavailable();
      const promptBound = Buffer.byteLength(JSON.stringify(messages), 'utf8') + messages.length * 1024;
      if (promptBound > rate.maxInputTokens) throw unavailable();
      // Reserve the entire reviewed input-token ceiling, plus capped generation and request fees.
      // A byte/token estimate alone cannot guarantee a cap for arbitrary tokenizers.
      const amount = costNanos(rate, rate.maxInputTokens, maxOutput);
      const reservation = { id: randomUUID(), day: utcDay(now()), amount, rate, maxOutput };
      let accepted;
      try { accepted = await db.reserveDailyBudget({ id: reservation.id, day: reservation.day, nanos: amount, limit }); } catch { throw unavailable(); }
      if (!accepted) throw exhausted();
      return reservation;
    },
    async settle(reservation, usage) {
      // Missing/partial/error/disconnected streams are never refunded from a character estimate.
      if (!usage) return;
      if (![usage.input, usage.output].every(v => Number.isSafeInteger(v) && v >= 0)) return;
      const violated = usage.input > reservation.rate.maxInputTokens || usage.output > reservation.maxOutput;
      const actual = costNanos(reservation.rate, usage.input, usage.output);
      await db.settleDailyBudget(reservation.id, actual, violated || actual > reservation.amount);
    },
  };
}
