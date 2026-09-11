// The zero-config tier: what a visitor with no API key is allowed to run on this deployment's
// own provider keys. Everything here is a hard server-side boundary. The browser may ask for a
// free model, but only this module decides whether the request is funded, and at what price.
//
// Three gates, all enforced in the proxy before a single upstream byte is sent:
//   1. the requested model is on FREE_MODELS (an exact allowlist, never a prefix match),
//   2. the deployment actually holds the provider key for it,
//   3. the workspace still has free credits this month, and the caller is under the IP burst cap.
//
// The catalog in src/lib/catalog.ts mirrors these ids for the model dropdown. tests/freetier
// asserts the two lists stay identical, so a model can never appear in the UI as free while the
// server refuses to fund it.

/** Credits per 1,000 tokens. Mirrors CREDIT_WEIGHTS.fast in src/lib/catalog.ts. */
export const FREE_WEIGHT = 0.5;

/**
 * OpenRouter's free community pool. `openrouter/auto` is presented to visitors as one
 * "best available free model" entry, but it is never forwarded to OpenRouter's paid auto
 * router: the proxy substitutes the first id below and passes the rest as fallbacks, so a
 * free-tier request can only ever land on a zero-cost model.
 */
export const OPENROUTER_FREE_POOL = [
  'meta-llama/llama-3.2-3b-instruct:free',
  'mistralai/mistral-nemo:free',
  'qwen/qwen-2.5-72b-instruct:free',
];

/**
 * xKiro is a unified gateway: one OpenAI-compatible endpoint fronting many model families
 * (DeepSeek, GLM, Qwen, Kimi and others). Its catalogue moves faster than this file can, and
 * the exact ids are the gateway's to define, so the default list below is only a seed —
 * XKIRO_FREE_MODELS overrides it wholesale, and /api/models reads the real list from the
 * gateway. A model id that turns out to be wrong is therefore a dashboard fix, not a deploy.
 */
export const XKIRO_DEFAULT_BASE = 'https://api.xkiro.com/v1';

/**
 * The gateway's base URL. Operator-set, like OLLAMA_BRIDGE_URL, so it is trusted the way the
 * deployment's own configuration is — but still checked, because a typo here would otherwise
 * surface as a puzzling network error rather than a clear one. HTTPS only; anything malformed
 * falls back to the default rather than taking the service down.
 */
export function xkiroBase(env = process.env) {
  const configured = (env.XKIRO_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!configured) return XKIRO_DEFAULT_BASE;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return XKIRO_DEFAULT_BASE;
    return configured;
  } catch { return XKIRO_DEFAULT_BASE; }
}

const XKIRO_DEFAULT_POOL = [
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1',
  'z-ai/glm-5.2',
  'z-ai/glm-5.3-flash',
  'qwen/qwen-2.5-72b-instruct',
  'moonshotai/kimi-k2.7-code',
];

/** The xKiro ids this deployment offers free, from XKIRO_FREE_MODELS or the seed above. */
export function xkiroPool(env = process.env) {
  const configured = (env.XKIRO_FREE_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  return configured.length ? configured : XKIRO_DEFAULT_POOL;
}

/** Exact model ids a visitor may run without a key, with the provider that funds each. */
export function freeModels(env = process.env) {
  return [
    { id: 'groq/llama-3.3-70b-versatile', provider: 'groq', envKey: 'GROQ_API_KEY' },
    { id: 'groq/llama-3.1-8b-instant', provider: 'groq', envKey: 'GROQ_API_KEY' },
    { id: 'openrouter/auto', provider: 'openrouter', envKey: 'OPENROUTER_API_KEY', pool: OPENROUTER_FREE_POOL },
    ...OPENROUTER_FREE_POOL.map(id => ({ id, provider: 'openrouter', envKey: 'OPENROUTER_API_KEY' })),
    ...xkiroPool(env).map(id => ({ id, provider: 'xkiro', envKey: 'XKIRO_API_KEY' })),
  ];
}

/** The static list, for callers that only need the shape (tests, the catalog parity check). */
export const FREE_MODELS = freeModels({});

/** The free entry for a model id, or undefined. Exact match only — no normalisation, no prefixes. */
export function freeModel(id, env = process.env) {
  if (typeof id !== 'string') return undefined;
  const wanted = id.trim().toLowerCase();
  return freeModels(env).find(m => m.id.toLowerCase() === wanted);
}

/** Free models this deployment can actually fund, i.e. the ones whose provider key is set. */
export function fundedModels(env = process.env) {
  if (env.FREE_TIER_DISABLED === 'true') return [];
  return freeModels(env).filter(m => Boolean(env[m.envKey]));
}

/**
 * What the browser is told at load time, so the dropdown can mark models live or locked and
 * the first message never fails with a surprise. Provider keys themselves are never included.
 */
export function freeTierStatus(env = process.env) {
  const funded = fundedModels(env);
  return {
    enabled: funded.length > 0,
    models: funded.map(m => m.id),
    monthlyCredits: monthlyPool(env),
    perHour: burstLimit(env),
    weight: FREE_WEIGHT,
  };
}

export const monthlyPool = (env = process.env) => Math.max(0, Number(env.FREE_CREDIT_MONTHLY_POOL ?? 400) || 0);
export const burstLimit = (env = process.env) => Math.max(1, Number(env.FREE_MAX_PER_HOUR ?? 40) || 40);

/** Credits for a completed free-tier request, rounded up to two decimals like the client ledger. */
export const creditsForTokens = tokens => Math.ceil((Math.max(0, tokens) * FREE_WEIGHT) / 10) / 100;

/**
 * Rewrite a free-tier request for the upstream provider. Groq wants the bare model name;
 * OpenRouter gets a concrete free id plus the rest of the pool as fallbacks so a momentarily
 * unavailable free model degrades to another free model instead of to a paid one.
 */
export function routeFreeRequest(entry) {
  if (entry.provider === 'groq') return { model: entry.id.replace(/^groq\//, '') };
  if (entry.pool) return { model: entry.pool[0], models: [...entry.pool] };
  // xKiro and the OpenRouter :free ids are passed through exactly as the gateway names them.
  return { model: entry.id };
}

/**
 * Per-IP burst limiter for unauthenticated traffic. The workspace id is minted by the browser
 * and can be rotated at will, so the monthly credit pool alone cannot bound total spend; this
 * caps how fast one network address can consume the deployment's keys. It is a speed bump, not
 * an identity check — a deployment expecting real abuse should sit behind a CDN or add auth.
 */
export function createBurstLimiter(env = process.env, now = () => Date.now()) {
  const windows = new Map();
  const limit = burstLimit(env);
  return function take(ip) {
    const at = now();
    for (const [key, value] of windows) if (at - value.start > 3_600_000) windows.delete(key);
    const window = windows.get(ip) ?? { start: at, count: 0 };
    window.count++;
    windows.set(ip, window);
    return { ok: window.count <= limit, limit, remaining: Math.max(0, limit - window.count) };
  };
}
