// Live model discovery: what the xKiro gateway actually serves, and which of it is free.
//
// This replaces a list of model ids that was typed into this repo by hand, and every one of them
// was wrong. Three (`deepseek/deepseek-chat`, `deepseek/deepseek-r1`, `qwen/qwen-2.5-72b-instruct`)
// did not exist on the gateway at all; the other three existed but were `paid` or `premium`. So
// /api/providers advertised a five-model free tier, the dropdown showed it as ready, and the
// first message came back `404 Model "deepseek/deepseek-chat" does not exist.` — reported to the
// visitor as a tier that was warming up, which it never was. It was simply not real.
//
// A hand-kept mirror of somebody else's catalogue drifts by default; the only question is when.
// And there was never a need for one, because the gateway publishes the answer: GET /v1/models
// returns `access_tier` and `pricing` per model. Discovering that is strictly better than
// guessing it, and it cannot be stale by more than the cache TTL.
//
// Three properties this module is built to hold:
//
//   Honest.   A model reaches the free pool only because the gateway said `access_tier: "free"`
//             with zero input and output pricing. Nothing is inferred from the model's name.
//   Cheap.    One request per TTL, single-flight, so a hundred simultaneous page loads produce
//             one call and not a hundred.
//   Durable.  A gateway that is briefly unreachable must not empty the free tier. The last good
//             catalogue keeps serving, and only the retry clock shortens.

import { setOpenRouterCatalog, setXkiroCatalog, xkiroBase } from './freetier.mjs';

/**
 * How this deployment identifies itself upstream. Node's HTTP client sends no User-Agent at all,
 * and a request carrying none is the shape a bot filter in front of an API is likeliest to
 * refuse — which surfaces as a 403 that looks like a rejected key and is not one.
 */
export const USER_AGENT = 'HeyBuddy/1.0 (+https://github.com/chrisfbaileycb-arch/the-dev-os-agent)';

/** How long a good catalogue is trusted. Model tiers move on the order of weeks, not seconds. */
export const CATALOG_TTL_MS = 3_600_000;
/**
 * How long to wait before retrying after a failure. Deliberately far shorter than the TTL: a
 * transient blip should not strand the free tier on a stale catalogue for an hour, but a gateway
 * that is properly down should not be hammered once per page load either.
 */
export const CATALOG_RETRY_MS = 60_000;
/** A catalogue is a few tens of kilobytes. Anything approaching this is not one. */
export const CATALOG_MAX_BYTES = 4_000_000;
/** Bounded so a gateway that starts returning thousands of ids cannot become a memory problem. */
export const CATALOG_MAX_MODELS = 1000;

/**
 * Is this entry free, as the gateway itself reports it?
 *
 * Both halves are required. `access_tier` is the gateway's own label and is the primary signal,
 * but the pricing block is the thing that actually costs money, and a catalogue that ever
 * disagrees with itself must fall on the safe side — the operator's card is what funds this.
 */
export function isFreeModel(model) {
  if (!model || typeof model !== 'object') return false;
  if (typeof model.id !== 'string' || !model.id.trim() || model.id.length > 200) return false;
  if (model.access_tier !== 'free') return false;
  const pricing = model.pricing;
  if (!pricing || typeof pricing !== 'object') return false;
  return Number(pricing.input) === 0 && Number(pricing.output) === 0;
}

/**
 * The gateway's payload reduced to what this app shows and decides with.
 *
 * Filtered rather than trusted: ids become model names in outbound requests and labels become
 * text in the UI, so both are bounded and typed here, and an entry that does not survive that is
 * dropped instead of repaired. Order is preserved so the dropdown is stable between loads.
 */
export function normalizeCatalog(payload) {
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const seen = new Set();
  const models = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
    const id = entry.id.trim();
    if (!id || id.length > 200 || seen.has(id)) continue;
    seen.add(id);
    const label = typeof entry.display_name === 'string' && entry.display_name.trim() ? entry.display_name.trim().slice(0, 80) : id;
    models.push({
      id,
      label,
      tier: typeof entry.access_tier === 'string' ? entry.access_tier.slice(0, 20) : 'unknown',
      free: isFreeModel(entry),
      context: Number.isFinite(entry.context_length) ? entry.context_length : null,
      vision: entry.capabilities?.vision === true,
      reasoning: entry.capabilities?.reasoning === true,
    });
    if (models.length >= CATALOG_MAX_MODELS) break;
  }
  return models;
}

/** Free ids only, in catalogue order — the list the free tier is actually built from. */
export const freeIds = models => models.filter(m => m.free).map(m => m.id);

/**
 * One catalogue fetch. The key is sent when the deployment holds one, because a gateway may show
 * a plan-specific catalogue to an authenticated caller — but it is not required: the public
 * catalogue is enough to learn which models are free, so discovery works before a key is set and
 * a first deploy is never blocked on one.
 */
export async function fetchCatalog(env = process.env, { fetchImpl = fetch, timeoutMs = 10_000 } = {}) {
  const url = `${xkiroBase(env)}/models`;
  const key = typeof env.XKIRO_API_KEY === 'string' ? env.XKIRO_API_KEY.trim() : '';
  const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT };
  // Only a header-safe key is attached; a pasted newline would otherwise throw ERR_INVALID_CHAR
  // while the request is being built, which reads as an unreachable host.
  if (key && /^[\x20-\x7e]*$/.test(key)) headers.Authorization = `Bearer ${key}`;
  const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
  const text = await response.text();
  if (text.length > CATALOG_MAX_BYTES) throw new Error('catalogue response is too large');
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error('catalogue response is not JSON'); }
  const models = normalizeCatalog(payload);
  if (!models.length) throw new Error('catalogue contained no usable models');
  return models;
}

let cache = { models: [], at: 0, nextAt: 0, ok: false, error: null };
let inflight = null;

/**
 * OpenRouter's own catalogue, asked the same way the gateway's is.
 *
 * The OpenRouter free pool used to be three ids written into freetier.mjs by hand. That is the
 * same mistake the gateway list was: OpenRouter adds and retires `:free` ids continuously, so a
 * hand-kept list is wrong within weeks — and it was also the *reason* the pool looked so small.
 * The user-visible complaint was "if I'm an OpenRouter key I should have access to all OpenRouter
 * models in that chat window", and the answer is that OpenRouter publishes the whole price list at
 * GET /models, so there is nothing to guess: every entry whose prompt and completion pricing are
 * both zero is a model this deployment can fund at no cost.
 *
 * This is a separate cache from the gateway's because the two have nothing to do with each other —
 * different host, different key, different failure mode. A gateway outage must not empty the
 * OpenRouter pool and vice versa.
 */
let orCache = { models: [], at: 0, nextAt: 0, ok: false, error: null };
let orInflight = null;

/** Drop everything discovered. Tests only — production has no reason to forget a good catalogue. */
export function resetCatalog() {
  cache = { models: [], at: 0, nextAt: 0, ok: false, error: null };
  inflight = null;
  setXkiroCatalog([]);
  orCache = { models: [], at: 0, nextAt: 0, ok: false, error: null };
  orInflight = null;
  setOpenRouterCatalog([]);
}

/** The discovered catalogue as it stands, without triggering a fetch. */
export const catalogModels = () => cache.models;

/**
 * What the operator needs to see on /api/providers to know whether discovery is working. `error`
 * is present only while the last attempt failed, and names the cause rather than hiding it: this
 * is the field that turns "the free tier is empty" from a mystery into a sentence.
 */
export function catalogStatus() {
  return {
    discovered: cache.ok,
    count: cache.models.length,
    free: cache.models.filter(m => m.free).length,
    at: cache.at ? new Date(cache.at).toISOString() : null,
    error: cache.error,
  };
}

/**
 * The catalogue, fetched if the cache is cold or expired.
 *
 * Single-flight: concurrent callers share one request. A failure keeps the previous catalogue and
 * only shortens the retry clock, so the free tier degrades to "slightly stale" rather than to
 * "empty" when the gateway hiccups — the difference between a visitor seeing an older model list
 * and a visitor seeing a product that looks broken.
 */
export async function ensureCatalog(env = process.env, options = {}) {
  const now = options.now ?? Date.now();
  const ttl = Number(options.ttlMs ?? CATALOG_TTL_MS);
  const retry = Number(options.retryMs ?? CATALOG_RETRY_MS);
  if (cache.nextAt && now < cache.nextAt) return cache;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const models = await fetchCatalog(env, options);
      cache = { models, at: now, nextAt: now + ttl, ok: true, error: null };
      setXkiroCatalog(freeIds(models));
    } catch (error) {
      const detail = error?.message || 'discovery failed';
      // The models already discovered stay exactly as they were; only the clock and the error move.
      cache = { ...cache, nextAt: now + retry, error: detail };
      (options.log ?? console.error)(`[discovery] xKiro catalogue unavailable: ${detail}`);
    } finally {
      inflight = null;
    }
    return cache;
  })();
  return inflight;
}

/** The public OpenRouter catalogue endpoint. No key needed to read prices. */
export const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';

/**
 * The zero-cost ids in an OpenRouter catalogue, by OpenRouter's own published pricing.
 *
 * Two shapes have to be accepted because the endpoint has carried both: a `pricing` block of
 * per-token strings, and the older per-1K numbers. Anything that is not unambiguously zero is
 * excluded — an id whose price cannot be read is not free, it is unknown, and funding an unknown
 * price is how an operator gets a bill. `:free` in the id is accepted only as a *corroborating*
 * signal alongside a missing pricing block, never on its own, because the suffix is a naming
 * convention rather than a contract.
 */
export function freeOpenRouterIds(payload) {
  const entries = Array.isArray(payload?.data) ? payload.data : [];
  const isZero = value => value === 0 || value === '0' || value === '0.0' || value === '0.000000' || (value !== '' && value !== null && value !== undefined && Number(value) === 0);
  const ids = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') continue;
    const id = entry.id.trim();
    if (!id || id.length > 200) continue;
    const pricing = entry.pricing;
    const hasBoth = pricing && typeof pricing === 'object' && ('prompt' in pricing || 'input' in pricing) && ('completion' in pricing || 'output' in pricing);
    const priced = hasBoth && isZero(pricing.prompt ?? pricing.input) && isZero(pricing.completion ?? pricing.output);
    // A `:free` id with no readable pricing is still taken, because OpenRouter's own suffix is the
    // provider stating the price in the name; a priced id must have said zero in the pricing block.
    const suffixed = !hasBoth && /:free$/i.test(id);
    if (priced || suffixed) ids.push(id);
  }
  return ids;
}

/**
 * Read OpenRouter's catalogue and publish its zero-cost ids to the free tier.
 *
 * Same discipline as the gateway path — single-flight, TTL, keep the last good answer on failure —
 * with one difference: this needs a key to be *funded* but not to be *read*, and the key is sent
 * when present because an account's catalogue can be wider than the anonymous one. A deployment
 * holding only OPENROUTER_OWNER_KEY still discovers, because that credential can fund the pool.
 */
export async function ensureOpenRouterCatalog(env = process.env, options = {}) {
  const now = options.now ?? Date.now();
  const ttl = Number(options.ttlMs ?? CATALOG_TTL_MS);
  const retry = Number(options.retryMs ?? CATALOG_RETRY_MS);
  if (orCache.nextAt && now < orCache.nextAt) return orCache;
  if (orInflight) return orInflight;
  orInflight = (async () => {
    const fetchImpl = options.fetchImpl ?? fetch;
    try {
      const key = [env.OPENROUTER_API_KEY, env.OPENROUTER_OWNER_KEY, env.SETTINGS_OWNER_API_KEY].map(k => typeof k === 'string' ? k.trim() : '').find(k => k && /^[\x20-\x7e]*$/.test(k)) ?? '';
      const headers = { Accept: 'application/json', 'User-Agent': USER_AGENT, ...(key ? { Authorization: `Bearer ${key}` } : {}) };
      const response = await fetchImpl(OPENROUTER_MODELS_URL, { headers, signal: AbortSignal.timeout(Number(options.timeoutMs ?? 10_000)) });
      if (!response.ok) throw new Error(`${OPENROUTER_MODELS_URL} answered HTTP ${response.status}`);
      const payload = await response.json();
      const ids = freeOpenRouterIds(payload);
      orCache = { models: ids, at: now, nextAt: now + ttl, ok: true, error: null };
      setOpenRouterCatalog(ids);
    } catch (error) {
      const detail = error?.message || 'discovery failed';
      orCache = { ...orCache, nextAt: now + retry, error: detail };
      (options.log ?? console.error)(`[discovery] OpenRouter catalogue unavailable: ${detail}`);
    } finally {
      orInflight = null;
    }
    return orCache;
  })();
  return orInflight;
}

/** The OpenRouter free ids as discovered, for /api/providers and the operator's diagnostics. */
export const openRouterFreeIds = () => [...orCache.models];
export function openRouterCatalogStatus() {
  return { discovered: orCache.ok, count: orCache.models.length, at: orCache.at ? new Date(orCache.at).toISOString() : null, error: orCache.error };
}

/**
 * Dynamic model categorization based on model id and name patterns.
 * Replaces hard-coded limits with functional clusters detected from model metadata.
 */
export function categorizeModels(rawModelList) {
  return rawModelList.map(model => {
    const id = (model.id || '').toLowerCase();
    const name = (model.name || model.label || '').toLowerCase();
    const isFree = id.includes(':free') || model.pricing?.prompt === '0' || model.free === true;

    // Detect capabilities dynamically
    const isCoding = id.includes('code') || id.includes('coder') || id.includes('dev') || 
                     name.includes('code') || id.includes('qwen-2.5-coder') || id.includes('codestral');
                     
    const isMultimedia = id.includes('vl') || id.includes('vision') || id.includes('image') || 
                         id.includes('omni') || id.includes('audio') || id.includes('speech');

    const isReasoning = id.includes('r1') || id.includes('reasoner') || id.includes('thinking') || 
                        id.includes('qwq') || id.includes('deepseek-r1');

    return {
      ...model,
      isFree,
      category: isCoding ? 'coding' 
              : isMultimedia ? 'multimedia' 
              : isReasoning ? 'agent_reasoning' 
              : 'general_chat'
    };
  });
}

/**
 * Client filtering helper: Returns all models matching the task without arbitrary limits.
 * If no category or 'all' is selected, returns the full list.
 */
export function getAvailableModelsByCategory(allModels, selectedCategory) {
  if (!selectedCategory || selectedCategory === 'all') {
    return allModels;
  }
  return allModels.filter(m => m.category === selectedCategory);
}
