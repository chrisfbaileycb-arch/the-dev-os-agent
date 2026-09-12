import type { InferenceMode } from './catalog';
import type { Connection } from './types';
export type Provider = 'openrouter' | 'groq' | 'openai' | 'anthropic' | 'google' | 'cohere' | 'xkiro' | 'custom';

// Every provider the proxy will forward to, with a seed of model ids for the dropdown.
//
// The seeds are a starting point, not a catalogue: model names change faster than a deploy, so
// Discover reads the live list from the provider and the model field accepts anything typed.
//
// `endpoint` is what the browser displays and sends, but the server does not take it on trust —
// resolveTarget maps every named provider to a fixed base URL of its own and only a `custom`
// provider is allowed to steer the destination, and then only to an approved origin.
export const providers: Record<Provider, { name: string; tier: string; endpoint: string; models: string[] }> = {
  openrouter: { name: 'OpenRouter', tier: 'Universal', endpoint: 'https://openrouter.ai/api/v1', models: ['meta-llama/llama-3.2-3b-instruct:free', 'mistralai/mistral-nemo:free', 'qwen/qwen-2.5-72b-instruct:free', 'deepseek/deepseek-r1', 'anthropic/claude-3.5-sonnet', 'anthropic/claude-3.5-haiku', 'openai/gpt-4o'] },
  groq: { name: 'Groq', tier: 'Ultra-fast', endpoint: 'https://api.groq.com/openai/v1', models: ['groq/llama-3.3-70b-versatile', 'groq/llama-3.1-8b-instant'] },
  openai: { name: 'OpenAI', tier: 'Frontier', endpoint: 'https://api.openai.com/v1', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'] },
  // Anthropic speaks its own /v1/messages protocol rather than the OpenAI one. The proxy
  // translates in both directions; from here it is just another provider with a key.
  anthropic: { name: 'Anthropic', tier: 'Frontier', endpoint: 'https://api.anthropic.com/v1', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-haiku-4-5'] },
  // Google publishes an OpenAI-compatible surface for Gemini, so it needs no translation.
  google: { name: 'Google Gemini', tier: 'Frontier', endpoint: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-pro', 'gemini-2.5-flash'] },
  cohere: { name: 'Cohere', tier: 'Enterprise', endpoint: 'https://api.cohere.com/v2', models: ['command-a-03-2025', 'command-r-plus-08-2024'] },
  // A unified gateway fronting many model families through one OpenAI-compatible endpoint. No
  // seed ids: this is the one provider whose catalogue the server discovers for us, so the model
  // list comes from /api/providers and the six ids that used to sit here — three of which the
  // gateway had never heard of — are gone.
  xkiro: { name: 'xKiro', tier: 'Gateway', endpoint: 'https://api.xkiro.com/v1', models: [] },
  custom: { name: 'Custom endpoint', tier: 'Custom', endpoint: '', models: [] },
};
const profiles = new Map<Provider, Connection>();
const MODES: InferenceMode[] = ['free', 'credits', 'byok'];
export function defaultConnection(provider: Provider = 'openrouter'): Connection { return { mode: 'remote', provider, inference: 'byok', endpoint: providers[provider].endpoint, model: providers[provider].models[0] || '', token: '', maxTokens: 1024, saveKey: false }; }

/**
 * How a given model gets paid for, when the app has to decide for itself.
 *
 * This used to return 'free' for any funded model unconditionally, which meant it overrode the
 * visitor. Choose "Bring your own key", pick a model the deployment happens to fund, and your key
 * was silently stripped and the request rerouted through the host's account — the opposite of what
 * you asked for, with no way to say otherwise. The reasoning behind it was that spending someone's
 * key on something the host already pays for is the worse mistake. It is not: quietly ignoring an
 * explicit instruction is, and a developer testing their own key against a specific provider has a
 * perfectly good reason for the choice. Their key, their call.
 *
 * So a deliberate 'byok' or 'credits' is now returned untouched, and this function only decides
 * what was never decided — no mode yet, or a 'free' mode whose model has stopped being funded and
 * would otherwise send a request the server will refuse.
 *
 * `funded` is the list from /api/providers. Undefined means it has not answered yet, in which case
 * whatever the connection already had is kept: flipping a returning free-tier visitor to BYOK for
 * one frame would ask them for a key they never needed.
 */
export function inferenceFor(model: string, current?: InferenceMode, funded?: string[]): InferenceMode {
  if (current === 'byok' || current === 'credits') return current;
  if (!Array.isArray(funded)) return current ?? 'byok';
  const id = model.trim().toLowerCase();
  return funded.some(f => f.toLowerCase() === id) ? 'free' : 'byok';
}

/**
 * The connection a first-time visitor gets: the free tier, streaming, with nothing to set up.
 *
 * No model id. There is no longer a hardcoded free model to name, and naming one was how a fresh
 * visitor ended up pointed at `groq/llama-3.3-70b-versatile` on a deployment that funds only the
 * gateway — a first message that failed before it was sent. App.tsx fills this in from the funded
 * list the moment /api/providers answers, which is before the dock is usable.
 */
export function zeroConfigConnection(): Connection {
  return { ...defaultConnection('xkiro'), mode: 'remote', model: '', inference: 'free' };
}
export function loadConnection(provider: Provider): Connection {
  if (profiles.has(provider)) return { ...profiles.get(provider)! };
  const base = defaultConnection(provider);
  try {
    const stored = JSON.parse(localStorage.getItem(`ft-provider-${provider}`) || '{}');
    const model = typeof stored.model === 'string' ? stored.model : base.model;
    const inference = MODES.includes(stored.inference) ? stored.inference as InferenceMode : 'byok';
    // The funded list is unknown here, so the stored mode is kept as saved rather than re-derived.
    return { ...base, endpoint: provider === 'custom' && typeof stored.endpoint === 'string' ? stored.endpoint : base.endpoint, model, maxTokens: [512,1024,2048,4096].includes(stored.maxTokens) ? stored.maxTokens : 1024, inference, token: stored.saveKey === true && typeof stored.token === 'string' ? stored.token : '', saveKey: stored.saveKey === true };
  } catch { return base; }
}
/**
 * The connection the app opens with. A returning visitor gets whatever they last saved; a new
 * one gets the zero-config free tier, already on a live model, so the very first message
 * streams without a trip through Settings.
 */
export function initialProvider(): Connection {
  try { const p = localStorage.getItem('ft-active-provider') as Provider; if (Object.hasOwn(providers, p)) return loadConnection(p); } catch { /* storage unavailable */ }
  return zeroConfigConnection();
}
export function switchProvider(current: Connection, provider: Provider): Connection { profiles.set(current.provider || 'custom', { ...current }); return { ...loadConnection(provider), mode: 'remote' }; }
export function persistConnection(c: Connection): void {
  const provider = c.provider || 'custom';
  localStorage.setItem(`ft-provider-${provider}`, JSON.stringify({ endpoint: c.endpoint, model: c.model, maxTokens: c.maxTokens, inference: MODES.includes(c.inference as InferenceMode) ? c.inference : 'byok', saveKey: Boolean(c.saveKey), ...(c.saveKey ? { token: c.token } : {}) }));
  localStorage.setItem('ft-active-provider', provider); profiles.set(provider, { ...c });
}
export function forgetKeys(): void {
  const active = localStorage.getItem('ft-active-provider');
  for (const provider of Object.keys(providers) as Provider[]) { const c = loadConnection(provider); c.token = ''; c.saveKey = false; c.serverAccessToken = ''; profiles.set(provider, c); persistConnection(c); }
  if (active) localStorage.setItem('ft-active-provider', active); else localStorage.removeItem('ft-active-provider');
}
/**
 * The keyring: one saved key per provider, which is what a visitor with accounts at several of
 * them actually has. Keys were always stored per provider — switching provider has always
 * restored the key you last saved for it — but only the active one could be typed, so setting
 * up three meant switching three times and remembering to save in between.
 *
 * Reading returns a key for every provider, '' where none is saved, so a form can bind directly
 * to it. Nothing here reaches the network or the server: a key is attached to a request only
 * when that provider is the one running it.
 */
export type Keyring = Record<Provider, string>;
export const emptyKeyring = (): Keyring => Object.fromEntries((Object.keys(providers) as Provider[]).map(id => [id, ''])) as Keyring;

export function loadKeyring(): Keyring {
  const ring = emptyKeyring();
  for (const id of Object.keys(providers) as Provider[]) {
    const saved = loadConnection(id);
    if (saved.saveKey && saved.token) ring[id] = saved.token;
  }
  return ring;
}

/**
 * Write the keyring back, one stored profile per provider. A key that has been cleared clears
 * `saveKey` with it, so "delete this key" leaves nothing behind rather than an empty string
 * under a flag that says a key is remembered.
 */
export function saveKeyring(ring: Partial<Keyring>): void {
  for (const [id, key] of Object.entries(ring) as [Provider, string][]) {
    if (!Object.hasOwn(providers, id)) continue;
    const value = key.trim();
    const saved = { ...loadConnection(id), token: value, saveKey: value.length > 0 };
    profiles.set(id, saved);
    try { localStorage.setItem(`ft-provider-${id}`, JSON.stringify({ endpoint: saved.endpoint, model: saved.model, maxTokens: saved.maxTokens, inference: saved.inference ?? 'byok', saveKey: saved.saveKey, ...(saved.saveKey ? { token: value } : {}) })); } catch { /* storage unavailable */ }
  }
}

export function clearProviderStorage(): void { profiles.clear(); for (const p of Object.keys(providers)) localStorage.removeItem(`ft-provider-${p}`); localStorage.removeItem('ft-active-provider'); }
