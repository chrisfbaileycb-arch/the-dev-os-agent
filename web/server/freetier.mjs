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

// What the gateway offers, which is not the same as what this deployment funds: deepseek-r1 is
// a reasoning model, so FRONTIER drops it from the funded pool and it is reachable on a key
// instead. A deployment whose xKiro plan covers it sets FREE_TIER_ALLOW_FRONTIER=true and this
// list is then taken as written.
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

/**
 * Frontier models, which this deployment never funds from its own key.
 *
 * The zero-config tier exists so a stranger can type one sentence and get an answer. It is paid
 * for out of the operator's pocket, at a flat rate, by anyone who finds the URL — so what it
 * offers has to be cheap per token and bounded in output. A reasoning or flagship model is
 * neither: an extended chain of thought can cost fifty times a short chat completion for the
 * same visible answer, and the credit ledger here meters both at FREE_WEIGHT. One afternoon of
 * traffic on those models drains a month of allowance.
 *
 * So they stay behind a key the visitor brings. That is not a downgrade of the product — the
 * models are all still in the dropdown and all still one paste away — it is the difference
 * between the operator paying for a stranger's reasoning run and the stranger paying for it.
 *
 * This matches on the id, not on a curated list, because the ids come from gateways whose
 * catalogues change without asking us. A pattern still covers a model added tomorrow.
 */
export const FRONTIER = /claude|opus|sonnet|gpt-[45]|(^|[/_.-])o[134](?![0-9a-z])|(^|[/_.-])r1(?![0-9a-z])|grok|gemini-[0-9.]*-(pro|ultra)|reason|thinking/i;
export const isFrontier = id => typeof id === 'string' && FRONTIER.test(id);

/**
 * Exact model ids a visitor may run without a key, with the provider that funds each.
 *
 * Frontier ids are dropped, including from an operator's own XKIRO_FREE_MODELS: pasting a
 * gateway's full catalogue into that variable is the likeliest way to open the pool by
 * accident, and the cost of that mistake lands on the operator, not on whoever made it. An
 * operator who does mean it sets FREE_TIER_ALLOW_FRONTIER=true and gets the list they asked for.
 */
export function freeModels(env = process.env) {
  const all = [
    { id: 'groq/llama-3.3-70b-versatile', provider: 'groq', envKey: 'GROQ_API_KEY' },
    { id: 'groq/llama-3.1-8b-instant', provider: 'groq', envKey: 'GROQ_API_KEY' },
    { id: 'openrouter/auto', provider: 'openrouter', envKey: 'OPENROUTER_API_KEY', pool: OPENROUTER_FREE_POOL },
    ...OPENROUTER_FREE_POOL.map(id => ({ id, provider: 'openrouter', envKey: 'OPENROUTER_API_KEY' })),
    ...xkiroPool(env).map(id => ({ id, provider: 'xkiro', envKey: 'XKIRO_API_KEY' })),
  ];
  return env.FREE_TIER_ALLOW_FRONTIER === 'true' ? all : all.filter(m => !isFrontier(m.id));
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
    // Which provider funds each id. The browser used to infer this from the id prefix, which
    // sent every non-Groq free model to the OpenRouter endpoint the moment a visitor added
    // their own key. The server already knows; saying so costs one field.
    providers: Object.fromEntries(funded.map(m => [m.id, m.provider])),
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
