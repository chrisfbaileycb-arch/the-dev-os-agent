import type { Connection } from './types';
export type Provider = 'openrouter' | 'groq' | 'cohere' | 'custom';
export const providers: Record<Provider, { name: string; tier: string; endpoint: string; models: string[] }> = {
  openrouter: { name: '🌐 OpenRouter Universal', tier: 'Universal', endpoint: 'https://openrouter.ai/api/v1', models: ['openrouter/auto', 'deepseek/deepseek-r1'] },
  groq: { name: '⚡ Groq Ultra-Fast', tier: 'Ultra-fast', endpoint: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  cohere: { name: 'Cohere', tier: 'Enterprise', endpoint: 'https://api.cohere.com/v2', models: ['command-a-03-2025', 'command-r-plus-08-2024'] },
  custom: { name: 'Custom / Ollama bridge', tier: 'Custom', endpoint: '', models: [] },
};
const profiles = new Map<Provider, Connection>();
export function defaultConnection(provider: Provider = 'openrouter'): Connection { return { mode: 'remote', provider, endpoint: providers[provider].endpoint, model: providers[provider].models[0] || '', token: '', maxTokens: 1024, saveKey: false }; }
export function loadConnection(provider: Provider): Connection {
  if (profiles.has(provider)) return { ...profiles.get(provider)! };
  const base = defaultConnection(provider);
  try {
    const stored = JSON.parse(localStorage.getItem(`ft-provider-${provider}`) || '{}');
    return { ...base, endpoint: provider === 'custom' && typeof stored.endpoint === 'string' ? stored.endpoint : base.endpoint, model: typeof stored.model === 'string' ? stored.model : base.model, maxTokens: [512,1024,2048,4096].includes(stored.maxTokens) ? stored.maxTokens : 1024, token: stored.saveKey === true && typeof stored.token === 'string' ? stored.token : '', saveKey: stored.saveKey === true };
  } catch { return base; }
}
export function initialProvider(): Connection {
  try { const p = localStorage.getItem('ft-active-provider') as Provider; if (Object.hasOwn(providers, p)) return loadConnection(p); } catch { /* storage unavailable */ }
  return { ...defaultConnection(), mode: 'demo' };
}
export function switchProvider(current: Connection, provider: Provider): Connection { profiles.set(current.provider || 'custom', { ...current }); return { ...loadConnection(provider), mode: 'remote' }; }
export function persistConnection(c: Connection): void {
  const provider = c.provider || 'custom';
  localStorage.setItem(`ft-provider-${provider}`, JSON.stringify({ endpoint: c.endpoint, model: c.model, maxTokens: c.maxTokens, saveKey: Boolean(c.saveKey), ...(c.saveKey ? { token: c.token } : {}) }));
  localStorage.setItem('ft-active-provider', provider); profiles.set(provider, { ...c });
}
export function forgetKeys(): void {
  const active = localStorage.getItem('ft-active-provider');
  for (const provider of Object.keys(providers) as Provider[]) { const c = loadConnection(provider); c.token = ''; c.saveKey = false; c.serverAccessToken = ''; profiles.set(provider, c); persistConnection(c); }
  if (active) localStorage.setItem('ft-active-provider', active); else localStorage.removeItem('ft-active-provider');
}
export function clearProviderStorage(): void { profiles.clear(); for (const p of Object.keys(providers)) localStorage.removeItem(`ft-provider-${p}`); localStorage.removeItem('ft-active-provider'); }
