// One shape for every provider's model list.
//
// GET /models means something slightly different at every vendor: OpenAI, Groq, Hugging Face and
// the gateways return `data: [{ id }]` with different extras, Cohere returns `models: [{ name }]`,
// Google prefixes every id with `models/`, and only some of them say what a model costs. The
// browser wants one thing from all of them — an id to send, a label to show, and whether the
// provider itself calls the model free — so that is what this module reduces each payload to.
// Fields that are not known are omitted rather than guessed, so `{ id }` stays `{ id }`.

const zero = value => value === 0 || value === '0' || value === '0.0' || Number(value) === 0;

/** Whether a catalogue entry is free at the provider, by the provider's own signals only. */
export function entryIsFree(provider, entry) {
  const id = String(entry.id ?? entry.name ?? '');
  if (provider === 'openrouter') {
    const p = entry.pricing;
    if (p && typeof p === 'object' && 'prompt' in p && 'completion' in p) return zero(p.prompt) && zero(p.completion);
    return /:free$/i.test(id);
  }
  if (provider === 'xkiro') {
    const p = entry.pricing;
    return entry.access_tier === 'free' && Boolean(p) && typeof p === 'object' && zero(p.input) && zero(p.output);
  }
  if (provider === 'aihubmix') return /-free$/i.test(id);
  return false;
}

/**
 * The provider's payload reduced to `[{ id, label?, free? }]`, bounded and typed.
 *
 * `label` appears only when the provider gave one that differs from the id, and `free` only when
 * true, so a plain `{ id }` list round-trips unchanged. Ids and labels are capped because both
 * become request fields and screen text. Order is preserved: it is the provider's, and a stable
 * dropdown between loads is worth more than any sort this module could impose.
 */
export function normalizeModelList(provider, payload, limit = 2000) {
  const entries = provider === 'cohere' ? payload?.models : payload?.data;
  if (!Array.isArray(entries)) return null;
  const out = [];
  const seen = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    let id = provider === 'cohere' ? entry.name : entry.id;
    if (typeof id !== 'string') continue;
    id = id.trim();
    if (provider === 'google') id = id.replace(/^models\//, '');
    if (!id || id.length > 200 || seen.has(id)) continue;
    // Cohere lists embedding and rerank models beside chat ones and says which is which.
    if (provider === 'cohere' && Array.isArray(entry.endpoints) && !entry.endpoints.includes('chat')) continue;
    seen.add(id);
    const item = { id };
    const label = [entry.name, entry.display_name, entry.displayName].find(v => typeof v === 'string' && v.trim());
    if (label && label.trim() !== id) item.label = label.trim().slice(0, 80);
    if (entryIsFree(provider, entry)) item.free = true;
    out.push(item);
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Where a provider lists its models, relative to the chat base the proxy already resolved.
 * Cohere's v2 base has no /models; the v1 one does. Anthropic and Google both list at /models
 * off their respective bases. Everything else is the OpenAI shape.
 */
export function modelsUrl(provider, base) {
  if (provider === 'cohere') return 'https://api.cohere.com/v1/models';
  return `${base}/models`;
}
