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

import { setXkiroCatalog, xkiroBase } from './freetier.mjs';

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

/** Drop everything discovered. Tests only — production has no reason to forget a good catalogue. */
export function resetCatalog() {
  cache = { models: [], at: 0, nextAt: 0, ok: false, error: null };
  inflight = null;
  setXkiroCatalog([]);
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
