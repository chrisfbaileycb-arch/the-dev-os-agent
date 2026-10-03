import { createHash, timingSafeEqual } from 'node:crypto';

// All subscription limits are resolved on the server. Credits are product units, not dollars
// or a promise of a fixed number of tokens. Expensive model classes consume more of them.
export const PLANS = [
  { id: 'starter', name: 'Starter', price: '$25', cadence: 'per month', credits: 1000, maxOutputTokens: 8192 },
  { id: 'premium', name: 'Builder', price: '$50', cadence: 'per month', credits: 2500, maxOutputTokens: 16384 },
  { id: 'pro', name: 'Studio', price: '$100', cadence: 'per month', credits: 6000, maxOutputTokens: 32768 },
];
const bounded = (value, fallback, min, max) => value === undefined || value === '' || !Number.isFinite(Number(value))
  ? fallback : Math.min(max, Math.max(min, Math.floor(Number(value))));
export function freeOutputTokens(env = process.env) {
  return Number(env.FREE_MAX_OUTPUT_TOKENS) === 1024 ? 8192 : bounded(env.FREE_MAX_OUTPUT_TOKENS, 8192, 64, 65536);
}
export function planLimits(id, env = process.env) {
  const plan = PLANS.find(p => p.id === id) ?? PLANS[0];
  const prefix = `PLAN_${plan.id.toUpperCase()}`;
  const { credits: _defaultCredits, ...metadata } = plan;
  return { ...metadata,
    monthlyCredits: bounded(env[`${prefix}_CREDITS`], plan.credits, 0, 100_000_000),
    maxOutputTokens: bounded(env[`${prefix}_MAX_OUTPUT_TOKENS`], plan.maxOutputTokens, 64, 65536),
  };
}
const tokens = value => String(value || '').split(',').map(t => t.trim()).filter(t => t.length >= 16 && t.length <= 8192);
const same = (a, b) => typeof b === 'string' && a.length > 0 && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** A token's identity stays the same on upgrade. Revoking it removes access on the next request. */
export function planAccess(supplied, env = process.env) {
  if (typeof supplied !== 'string' || !supplied.trim() || supplied.length > 8192) return null;
  const token = supplied.trim();
  // Highest tier wins if the operator temporarily has a token in both lists during an upgrade.
  for (const plan of [...PLANS].reverse()) {
    if (tokens(env[`PLAN_${plan.id.toUpperCase()}_ACCESS_TOKENS`]).some(t => same(token, t)))
      return { workspace: 'plan:' + createHash('sha256').update(token).digest('hex').slice(0, 24), ...planLimits(plan.id, env) };
  }
  if (tokens(env.PLAN_ACCESS_TOKENS).some(t => same(token, t)))
    return { workspace: 'plan:' + createHash('sha256').update(token).digest('hex').slice(0, 24), ...planLimits('starter', env) };
  if (same(token, env.SERVER_CREDIT_ACCESS_TOKEN)) return { workspace: 'plan:operator', ...planLimits('starter', env) };
  return null;
}
export const planHolder = (token, env = process.env) => planAccess(token, env)?.workspace ?? null;
export const hasPlanAccess = (env = process.env) => PLANS.some(p => tokens(env[`PLAN_${p.id.toUpperCase()}_ACCESS_TOKENS`]).length) || tokens(env.PLAN_ACCESS_TOKENS).length > 0 || Boolean(env.SERVER_CREDIT_ACCESS_TOKEN?.trim());

/** Same credit classes as the client; measured input and output have separate rates. */
export function planRates(model) {
  const id = String(model).toLowerCase();
  const weight = /(^|[/:-])(r1|o1|o3|o4)(?![0-9a-z])|opus|reason|think|gpt-[45](?!.*(?:mini|nano))|sonnet|gemini.*pro|grok(?!.*(?:mini|fast))/.test(id) ? 15
    : /:free|instant|mini|haiku|flash|nano|(^|[/-])(1|3|7|8)b(?![0-9])/.test(id) ? 0.5 : 3;
  return { input: weight / 2, output: weight * 2.5 };
}
export function planCredits(model, usage) {
  const rate = planRates(model);
  return Math.ceil((Math.max(0, usage.input || 0) * rate.input + Math.max(0, usage.output || 0) * rate.output) / 10) / 100;
}
