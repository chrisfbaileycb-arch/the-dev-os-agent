import type { Provider } from './providers';

// Provider pipes: which model providers appear in the dock's model picker, and where the local one
// lives.
//
// A pipe switched off hides that provider's group from the picker without touching its saved key,
// so turning OpenRouter off for a week and back on loses nothing. Keys themselves stay in the BYOK
// keyring (lib/providers.ts); this file holds only the switches and the Ollama address, neither of
// which is a secret.
//
// Ollama is the one provider called straight from the browser. The hosted proxy cannot reach a
// visitor's own machine, so the only way a local model works is for the page to call it — which
// is why the address is restricted to this machine's loopback on Ollama's default port, the one
// place the page's Content-Security-Policy allows (see server/csp.mjs).

/** The pipes the Connectors hub offers switches for, in display order. */
export const PIPE_PROVIDERS: Provider[] = ['openrouter', 'xai', 'venice', 'google', 'ollama'];

export interface PipeSettings { disabled: Provider[]; ollamaEnabled: boolean; ollamaUrl: string; }

export const OLLAMA_DEFAULT_URL = 'http://localhost:11434/v1';
const KEY = 'hb-provider-pipes';

export const defaultPipes = (): PipeSettings => ({ disabled: [], ollamaEnabled: false, ollamaUrl: OLLAMA_DEFAULT_URL });

export function loadPipes(): PipeSettings {
  const base = defaultPipes();
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<PipeSettings>;
    return {
      disabled: Array.isArray(stored.disabled) ? stored.disabled.filter((p): p is Provider => typeof p === 'string') : base.disabled,
      ollamaEnabled: stored.ollamaEnabled === true,
      ollamaUrl: typeof stored.ollamaUrl === 'string' && !localEndpointError(stored.ollamaUrl) ? stored.ollamaUrl : base.ollamaUrl,
    };
  } catch { return base; }
}

export function savePipes(pipes: PipeSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(pipes)); } catch { /* storage unavailable; the switches hold for this session */ }
}
export function clearPipes(): void { try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }

/** Whether a provider's group shows in the model picker. Ollama is off until switched on. */
export function pipeEnabled(provider: Provider, pipes: PipeSettings): boolean {
  if (provider === 'ollama') return pipes.ollamaEnabled;
  return !pipes.disabled.includes(provider);
}

/**
 * Why a local model address will not work, or '' if it will.
 *
 * Loopback only, port 11434 only, no credentials or query. Anything else is either blocked by the
 * page's CSP (and would fail with an opaque network error) or is not "this machine" at all.
 */
export function localEndpointError(value: string): string {
  let url: URL;
  try { url = new URL(value.trim()); } catch { return 'Enter the Ollama address, for example http://localhost:11434/v1.'; }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return 'Use an http:// address.';
  if (url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') return 'Only this machine (localhost or 127.0.0.1) can be used for a local model.';
  if ((url.port || (url.protocol === 'https:' ? '443' : '80')) !== '11434') return 'Use Ollama’s default port, 11434 — it is the only local port this app is allowed to reach.';
  if (url.username || url.password || url.search || url.hash) return 'The address cannot carry credentials, a query, or a fragment.';
  return '';
}

/** The address with a trailing slash trimmed and `/v1` added if it was left off. */
export function normalizeLocalEndpoint(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '');
  return /\/v1$/.test(trimmed) ? trimmed : `${trimmed}/v1`;
}
