// The zero-config tier: what a visitor with no API key is allowed to run on this deployment's
// own provider keys. Everything here is a hard server-side boundary. The browser may ask for a
// free model, but only this module decides whether the request is funded, and at what price.
//
// Three gates, all enforced in the proxy before a single upstream byte is sent:
//   1. the requested model is on FREE_MODELS (an exact allowlist, never a prefix match),
//   2. the deployment actually holds the provider key for it,
//   3. the workspace still has free credits this month, and the caller is under the IP burst cap.
//
// The gateway half of the pool is discovered rather than declared: server/discovery.mjs reads
// GET {base}/models and hands back the ids the gateway itself reports as free at zero cost. The
// browser is told the resulting list by /api/providers and renders exactly that, so there is one
// source of truth and nothing for a UI catalogue to drift away from.

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
 * xKiro is a unified gateway: one OpenAI-compatible endpoint fronting many model families. Its
 * catalogue is the gateway's to define and moves faster than this file ever could, so this file
 * no longer tries to name any of it. server/discovery.mjs asks.
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

/**
 * The gateway ids discovered as free, as reported by server/discovery.mjs.
 *
 * Module state rather than a parameter on every call because the funding decision in the proxy is
 * synchronous and must stay that way: it runs before a single upstream byte is sent, on a path
 * where an await would be one more place for a request to hang. Discovery writes here; everything
 * else reads. Every exported function below still accepts the list explicitly so tests never have
 * to reason about the order they ran in.
 */
let discoveredXkiro = [];
let discoveredCheaperInference = [];

/** Publish the operator-approved managed model list without exposing its credential. */
export function setCheaperInferenceCatalog(models) {
  const ids = (Array.isArray(models) ? models : []).map(model => typeof model === 'string' ? model : model?.id).filter(id => typeof id === 'string' && id.trim() && id.length <= 200).map(id => id.trim());
  discoveredCheaperInference = [...new Set(ids)];
}
export const cheaperInferenceCatalog = () => [...discoveredCheaperInference];

/** Models the operator explicitly approved for the managed hosted route. */
export function cheaperInferencePool(env = process.env, discovered = discoveredCheaperInference) {
  if (env.CHEAPER_INFERENCE_ENABLED !== 'true' || !env.CHEAPER_INFERENCE_API_KEY) return [];
  const configured = (env.CHEAPER_INFERENCE_ALLOWED_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!configured.length) return [];
  const live = new Set((Array.isArray(discovered) ? discovered : []).map(id => String(id).toLowerCase()));
  return configured.filter(id => live.has(id.toLowerCase()));
}

export function setXkiroCatalog(ids) {
  const clean = (Array.isArray(ids) ? ids : [])
    .filter(id => typeof id === 'string' && id.trim() && id.length <= 200)
    .map(id => id.trim());
  discoveredXkiro = [...new Set(clean)];
}
export const xkiroCatalog = () => [...discoveredXkiro];

/**
 * The xKiro ids this deployment offers free.
 *
 * XKIRO_FREE_MODELS used to replace the pool wholesale, which meant a typo in a dashboard field
 * could point the free tier at a model nobody had checked the price of. It is now an intersection:
 * an operator can narrow what the gateway offers, never widen it or invent an id. Narrowing is the
 * real use — "fund only these two of the forty" — and inventing was only ever a way to get billed.
 *
 * Before discovery has answered there is nothing to intersect with, so a configured list is taken
 * as given; that window is one HTTP request wide at boot, and /api/providers waits for it.
 */
export function xkiroPool(env = process.env, discovered = discoveredXkiro) {
  const configured = (env.XKIRO_FREE_MODELS || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!configured.length) return [...discovered];
  if (!discovered.length) return configured;
  const live = new Set(discovered.map(id => id.toLowerCase()));
  return configured.filter(id => live.has(id.toLowerCase()));
}

/**
 * OmniRoute, self-hosted. Where the deployment's install lives is the operator's to say, so it is
 * configured exactly like XKIRO_BASE_URL: an HTTPS origin, no credentials or query, validated and
 * defaulted rather than trusted blind — a typo should surface as a clear message in Settings, not
 * as a puzzling network error. Unlike xKiro there is no public default to fall back to, so an
 * unset variable resolves to '' and the provider simply does not resolve until it is configured.
 */
export const OMNIROUTE_DEFAULT_BASE = '';
export function omnirouteBase(env = process.env) {
  const configured = (env.OMNIROUTE_BASE_URL || '').trim().replace(/\/+$/, '');
  if (!configured) return OMNIROUTE_DEFAULT_BASE;
  try {
    const url = new URL(configured);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) return OMNIROUTE_DEFAULT_BASE;
    return configured;
  } catch { return OMNIROUTE_DEFAULT_BASE; }
}

/**
 * The OmniRoute ids this deployment offers free.
 *
 * Deliberately a plain allowlist, without the discovered-catalogue intersection XKIRO_FREE_MODELS
 * was corrected into. That intersection exists because the xKiro gateway publishes a price and a
 * tier per id, so the server can check the operator's list against what the gateway actually gives
 * away. OmniRoute's /v1/models is the plain OpenAI shape — no pricing block, no access_tier — and
 * whether a run costs anything depends on which providers the operator connected to their own
 * install, which is knowledge only they have. There is nothing upstream to check a claimed id
 * against, so the operator naming it is the whole decision, and the list is taken verbatim.
 */
export function omniRoutePool(env = process.env) {
  return [...new Set((env.OMNIROUTE_FREE_MODELS || '').split(',').map(s => s.trim()).filter(id => id && id.length <= 200))];
}

/**
 * The owner key: one credential the operator sets so the free tier does not need a key per
 * provider before it can serve anybody.
 *
 * Named twice because two audiences name it differently — SETTINGS_OWNER_API_KEY is the generic
 * dashboard setting, OPENROUTER_OWNER_KEY is what an operator who thinks of this as \"my gateway
 * account\" will look for — and both mean the same thing here. Sanitised through the same header
 * rule as every other credential, because a key pasted into a dashboard field carries a trailing
 * newline more often than not. The browser never sees either name or value: the request is funded
 * server-side exactly like every other free-tier request.
 */
const HEADER_SAFE = /^[\x20-\x7e]*$/;
const cleanCredential = value => typeof value === 'string' && HEADER_SAFE.test(value.trim()) ? value.trim() : '';

export function ownerKey(env = process.env) {
  return cleanCredential(env.SETTINGS_OWNER_API_KEY) || cleanCredential(env.OPENROUTER_OWNER_KEY) || '';
}
export function ownerKeyName(env = process.env) {
  if (cleanCredential(env.SETTINGS_OWNER_API_KEY)) return 'SETTINGS_OWNER_API_KEY';
  return cleanCredential(env.OPENROUTER_OWNER_KEY) ? 'OPENROUTER_OWNER_KEY' : '';
}

/**
 * The credential that funds one free-pool entry, and the variable it came from.
 *
 * The entry's own provider key always wins, so configuring OPENROUTER_API_KEY still overrides the
 * owner key rather than being shadowed by it. The owner key then stands in for the OpenRouter
 * pool only, and deliberately not for the others: it is one credential for one endpoint, and
 * sending an OpenRouter-shaped key to Groq's host or the Hugging Face router would trade a funded
 * free tier for a guaranteed 401. Those pools keep needing their own provider key.
 */
export function freeKey(entry, env = process.env) {
  const own = entry ? cleanCredential(env[entry.envKey]) : '';
  if (own) return { key: own, source: entry.envKey };
  if (!entry || entry.provider !== 'openrouter') return { key: '', source: '' };
  const owner = ownerKey(env);
  return owner ? { key: owner, source: ownerKeyName(env) } : { key: '', source: '' };
}

/**
 * The environment variable that holds each provider's key on this deployment. One map, used by
 * the free tier (which key funds an entry), the paid tier (which key funds a plan model), the
 * credits branch of the proxy, and the admin dashboard (which key is being entered). The
 * dashboard lays its stored keys over the process environment under these same names, so nothing
 * downstream needs to know whether a key came from Render's dashboard or Hey Buddy's.
 */
export const PROVIDER_KEY_VARS = {
  openrouter: 'OPENROUTER_API_KEY',
  groq: 'GROQ_API_KEY',
  openai: 'OPENAI_API_KEY',
  anthropic: 'ANTHROPIC_API_KEY',
  google: 'GOOGLE_API_KEY',
  cohere: 'COHERE_API_KEY',
  xkiro: 'XKIRO_API_KEY',
  aihubmix: 'AIHUBMIX_API_KEY',
  huggingface: 'HF_TOKEN',
  'cheaper-inference': 'CHEAPER_INFERENCE_API_KEY',
  omniroute: 'OMNIROUTE_API_KEY',
  custom: 'CUSTOM_API_KEY',
};

/**
 * The model tiers the operator drew up in the admin dashboard.
 *
 * `free` entries join the zero-config pool — funded from the deployment's own key for that
 * provider, no visitor key needed — and `paid` entries form the plan tier, which a visitor reaches
 * with the deployment's access token (a subscription's credential) and which is likewise funded
 * from the deployment's keys. In `auto` mode the free list is added to the pool this file
 * discovers on its own; in `manual` mode it replaces that pool, so what is free is exactly what
 * the operator said and nothing the gateway happened to label. Module state for the same reason
 * `discoveredXkiro` is: the funding decision is synchronous. server/settings.mjs writes here.
 */
let adminTiers = { mode: 'auto', free: [], paid: [] };
const cleanEntry = m => m && typeof m.id === 'string' && m.id.trim() && m.id.length <= 200 && Object.hasOwn(PROVIDER_KEY_VARS, m.provider)
  ? { id: m.id.trim(), provider: m.provider, envKey: PROVIDER_KEY_VARS[m.provider], ...(typeof m.label === 'string' && m.label.trim() ? { label: m.label.trim().slice(0, 80) } : {}) }
  : null;
export function setAdminTiers(tiers) {
  const source = tiers && typeof tiers === 'object' ? tiers : {};
  const list = value => (Array.isArray(value) ? value : []).map(cleanEntry).filter(Boolean);
  adminTiers = { mode: source.mode === 'manual' ? 'manual' : 'auto', free: list(source.free), paid: list(source.paid) };
}
export const adminTierConfig = () => ({ mode: adminTiers.mode, free: adminTiers.free.map(m => ({ ...m })), paid: adminTiers.paid.map(m => ({ ...m })) });

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
 *
 * It applies only to the static Groq and OpenRouter entries below. A discovered gateway id needs
 * no name guard and must not get one: it is on the list because the gateway reported zero input
 * and output pricing, which is a fact about the bill, where this regex is a guess about the name.
 * The guess was also wrong — `openai/gpt-5.3-codex-spark` is free on the gateway at $0/$0 and
 * `gpt-[45]` matched it, so the tier refused to serve a model that costs nothing.
 */
export const FRONTIER = /claude|opus|sonnet|gpt-[45]|(^|[/_.-])o[134](?![0-9a-z])|(^|[/_.-])r1(?![0-9a-z])|grok|gemini-[0-9.]*-(pro|ultra)|reason|thinking/i;
export const isFrontier = id => typeof id === 'string' && FRONTIER.test(id);

/**
 * Hugging Face serverless pool, reached through the Inference Providers router.
 *
 * A deployment holding HF_TOKEN can fund a handful of small instruct models from that token's
 * monthly inference credit — a cheap way to widen the zero-config tier. Like every static entry
 * these pass the FRONTIER guard: `deepseek-ai/DeepSeek-R1:auto` is deliberately excluded, both
 * because a reasoning chain is exactly what this tier must not fund by default and because
 * `:auto` is a router directive, not a price — the operator can name a concrete cheap id in
 * XKIRO-style narrowing instead of letting the router pick an expensive provider for them.
 */
export const HF_POOL = [
  'Qwen/Qwen2.5-7B-Instruct',
  'meta-llama/Llama-3.1-8B-Instruct',
];

/**
 * Groq and OpenRouter free entries, which are still declared here.
 *
 * Neither provider publishes a machine-readable "this is free" flag the way the gateway does —
 * Groq's catalogue says nothing about price at all — so there is nothing to discover and these
 * stay an allowlist. They are short, they are cheap-by-construction, and the FRONTIER guard
 * covers them. A deployment holding neither key never sees them at all.
 */
const STATIC_FREE = [
  { id: 'groq/llama-3.3-70b-versatile', provider: 'groq', envKey: 'GROQ_API_KEY' },
  { id: 'groq/llama-3.1-8b-instant', provider: 'groq', envKey: 'GROQ_API_KEY' },
  { id: 'openrouter/auto', provider: 'openrouter', envKey: 'OPENROUTER_API_KEY', pool: OPENROUTER_FREE_POOL },
  ...OPENROUTER_FREE_POOL.map(id => ({ id, provider: 'openrouter', envKey: 'OPENROUTER_API_KEY' })),
];

/**
 * Exact model ids a visitor may run without a key, with the provider that funds each.
 *
 * Two halves with two different guarantees. The static entries are guarded by name, because a
 * name is all we know about them. The gateway entries are guarded by the gateway's own reported
 * price, which is a stronger claim than any pattern — so they are taken as discovered, and
 * FREE_TIER_ALLOW_FRONTIER no longer has anything to unlock among them.
 */
export function freeModels(env = process.env, discovered = discoveredXkiro, tiers = adminTiers) {
  // The operator's own free list, first: an entry they wrote is theirs to fund, so it carries no
  // FRONTIER guard — the dashboard warns about the cost instead of refusing. In manual mode it is
  // the whole pool.
  const chosen = tiers.free.map(m => ({ ...m }));
  if (tiers.mode === 'manual') return chosen;
  const guarded = env.FREE_TIER_ALLOW_FRONTIER === 'true' ? STATIC_FREE : STATIC_FREE.filter(m => !isFrontier(m.id));
  // HF serverless joins only when the deployment holds a token: without one these ids would
  // advertise as free and answer 503, which is the exact "warming up" lie the status message
  // exists to avoid.
  const hf = HF_POOL.some(id => isFrontier(id)) ? [] : (env.HF_TOKEN ? HF_POOL.map(id => ({ id, provider: 'huggingface', envKey: 'HF_TOKEN' })) : []);
  const automatic = [
    ...guarded,
    ...hf,
    ...xkiroPool(env, discovered).map(id => ({ id, provider: 'xkiro', envKey: 'XKIRO_API_KEY' })),
    ...cheaperInferencePool(env).map(id => ({ id, provider: 'cheaper-inference', envKey: 'CHEAPER_INFERENCE_API_KEY' })),
  ];
  // A model the operator also moved to the paid tier leaves the free pool, whatever the gateway
  // says about it: "paid here" is the operator's decision to make.
  const paid = new Set(tiers.paid.map(m => m.id.toLowerCase()));
  const seen = new Set(chosen.map(m => m.id.toLowerCase()));
  const out = [...chosen];
  for (const entry of automatic) {
    const key = entry.id.toLowerCase();
    if (seen.has(key) || paid.has(key)) continue;
    seen.add(key); out.push(entry);
  }
  return out;
}

/**
 * The plan tier: models a subscriber runs on the deployment's keys, unlocked by the access token.
 * Only entries whose provider key actually resolves are published — a paid model nobody can fund
 * would be a locked door with nothing behind it.
 */
export function paidModels(env = process.env, tiers = adminTiers) {
  return tiers.paid.filter(m => Boolean(freeKey(m, env).key));
}
export function paidModel(id, env = process.env, tiers = adminTiers) {
  if (typeof id !== 'string') return undefined;
  const wanted = id.trim().toLowerCase();
  return paidModels(env, tiers).find(m => m.id.toLowerCase() === wanted);
}
export function paidTierStatus(env = process.env, tiers = adminTiers) {
  const models = paidModels(env, tiers);
  return {
    // Reachable only when there is a token for a subscriber to hold; without one the tier is
    // configured but not yet open, and the browser says so rather than selling it.
    enabled: models.length > 0 && Boolean(cleanCredential(env.SERVER_CREDIT_ACCESS_TOKEN)),
    configured: tiers.paid.length > 0,
    models: models.map(m => m.id),
    providers: Object.fromEntries(models.map(m => [m.id, m.provider])),
    labels: Object.fromEntries(models.filter(m => m.label).map(m => [m.id, m.label])),
  };
}

/** The static half on its own, for callers that only need the shape (tests, documentation). */
export const FREE_MODELS = freeModels({}, []);

/** The free entry for a model id, or undefined. Exact match only — no normalisation, no prefixes. */
export function freeModel(id, env = process.env, discovered = discoveredXkiro) {
  if (typeof id !== 'string') return undefined;
  const wanted = id.trim().toLowerCase();
  return freeModels(env, discovered).find(m => m.id.toLowerCase() === wanted);
}

/** Free models this deployment can actually fund, i.e. the ones whose provider key is set. */
export function fundedModels(env = process.env, discovered = discoveredXkiro) {
  if (env.FREE_TIER_DISABLED === 'true') return [];
  // A pool counts as funded when a credential resolves for it, which is its own provider key or,
  // for the OpenRouter pool, the owner key standing in for it.
  return freeModels(env, discovered).filter(m => Boolean(freeKey(m, env).key));
}

/**
 * What the browser is told at load time, so the dropdown can mark models live or locked and
 * the first message never fails with a surprise. Provider keys themselves are never included.
 */
export function freeTierStatus(env = process.env, discovered = discoveredXkiro) {
  const funded = fundedModels(env, discovered);
  return {
    enabled: funded.length > 0,
    models: funded.map(m => m.id),
    // Which provider funds each id. The browser used to infer this from the id prefix, which
    // sent every non-Groq free model to the OpenRouter endpoint the moment a visitor added
    // their own key. The server already knows; saying so costs one field.
    providers: Object.fromEntries(funded.map(m => [m.id, m.provider])),
    // Labels the operator gave dashboard-chosen entries, so the dropdown can name them.
    labels: Object.fromEntries(funded.filter(m => m.label).map(m => [m.id, m.label])),
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
  // HF router ids are passed through exactly as documented — `Qwen/Qwen2.5-7B-Instruct` is the
  // org/model form the router's OpenAI surface expects, and its routing policies (:fastest,
  // :cheapest) are legal suffixes a deployment may name deliberately.
  if (entry.provider === 'huggingface') return { model: entry.id };
  if (entry.provider === 'cheaper-inference') return { model: entry.id };
  // OmniRoute names its own ids — `auto`, `auto/coding`, concrete `oc/…` entries — and the
  // gateway is the authority on what any of them resolves to. Nothing is stripped or rewritten.
  if (entry.provider === 'omniroute') return { model: entry.id };
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
  // `env` may be a getter, so a cap changed in the admin dashboard applies to the next request
  // rather than to the next restart.
  const current = () => burstLimit(typeof env === 'function' ? env() : env);
  return function take(ip) {
    const limit = current();
    const at = now();
    for (const [key, value] of windows) if (at - value.start > 3_600_000) windows.delete(key);
    const window = windows.get(ip) ?? { start: at, count: 0 };
    window.count++;
    windows.set(ip, window);
    return { ok: window.count <= limit, limit, remaining: Math.max(0, limit - window.count) };
  };
}
