import { DEFAULT_FREE_MODEL, isZeroConfig } from './catalog';
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
  // A unified gateway fronting many model families through one OpenAI-compatible endpoint.
  // Its catalogue is the gateway's to define, so these ids are a seed: Discover reads the real
  // list from /v1/models, and /api/providers reports which of them this deployment funds.
  xkiro: { name: 'xKiro', tier: 'Gateway', endpoint: 'https://api.xkiro.com/v1', models: ['deepseek/deepseek-chat', 'deepseek/deepseek-r1', 'z-ai/glm-5.2', 'z-ai/glm-5.3-flash', 'qwen/qwen-2.5-72b-instruct', 'moonshotai/kimi-k2.7-code'] },
  custom: { name: 'Custom endpoint', tier: 'Custom', endpoint: '', models: [] },
};
const profiles = new Map<Provider, Connection>();
const MODES: InferenceMode[] = ['free', 'credits', 'byok'];
export function defaultConnection(provider: Provider = 'openrouter'): Connection { return { mode: 'remote', provider, inference: 'byok', endpoint: providers[provider].endpoint, model: providers[provider].models[0] || '', token: '', maxTokens: 1024, saveKey: false }; }

/**
 * How a given model gets paid for.
 *
 * A zero-config model routes through the free tier so a visitor's key is never spent on
 * something the deployment already covers — but only if the deployment actually funds *that*
 * model. A free model this host cannot fund is still perfectly runnable on the visitor's own
 * key, and routing it through the free tier would strip that key and fail the request.
 *
 * `funded` is the list from /api/providers, and where it is known it decides — not the compiled
 * catalog. A deployment can fund a model this build has never heard of, and billing the
 * visitor's key for something the host is already paying for is the worse of the two mistakes.
 * Omit it before the answer arrives, when assuming the free tier covers a free model is the
 * right guess and keeps a returning free-tier visitor on the free tier across a reload.
 */
export function inferenceFor(model: string, current?: InferenceMode, funded?: string[]): InferenceMode {
  const id = model.trim().toLowerCase();
  if (funded ? funded.some(f => f.toLowerCase() === id) : isZeroConfig(model)) return 'free';
  return current && current !== 'free' ? current : 'byok';
}

/** The connection a first-time visitor gets: a free model, streaming, with nothing to set up. */
export function zeroConfigConnection(): Connection {
  return { ...defaultConnection('groq'), mode: 'remote', model: DEFAULT_FREE_MODEL, inference: 'free' };
}
export function loadConnection(provider: Provider): Connection {
  if (profiles.has(provider)) return { ...profiles.get(provider)! };
  const base = defaultConnection(provider);
  try {
    const stored = JSON.parse(localStorage.getItem(`ft-provider-${provider}`) || '{}');
    const model = typeof stored.model === 'string' ? stored.model : base.model;
    const inference = MODES.includes(stored.inference) ? stored.inference as InferenceMode : 'byok';
    return { ...base, endpoint: provider === 'custom' && typeof stored.endpoint === 'string' ? stored.endpoint : base.endpoint, model, maxTokens: [512,1024,2048,4096].includes(stored.maxTokens) ? stored.maxTokens : 1024, inference: inferenceFor(model, inference), token: stored.saveKey === true && typeof stored.token === 'string' ? stored.token : '', saveKey: stored.saveKey === true };
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
