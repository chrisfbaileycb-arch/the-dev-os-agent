// A public page cannot quietly call 127.0.0.1. The Test button asks the browser for
// local-network access by actually requesting the address the visitor typed. If the
// browser refuses, we say so. A native app is not required and is not offered.

export function ollamaOriginsValue(pageOrigin: string): string {
  try { return new URL(pageOrigin).origin; } catch { return pageOrigin; }
}

export interface LocalProbe { ok: boolean; refused: boolean; message: string; origins: string; }

export async function testLocalEndpoint(url: string, pageOrigin: string, fetchImpl: typeof fetch = fetch): Promise<LocalProbe> {
  const origins = ollamaOriginsValue(pageOrigin);
  let target: URL;
  try { target = new URL(url); } catch {
    return { ok: false, refused: false, origins, message: 'Enter the local server address first. Ollama is usually http://127.0.0.1:11434/v1.' };
  }
  if (target.protocol !== 'http:' && target.protocol !== 'https:') {
    return { ok: false, refused: false, origins, message: 'The local address has to be http or https.' };
  }
  const probe = new URL(target.href.replace(/\/+$/, ''));
  if (!probe.pathname.endsWith('/models')) probe.pathname = `${probe.pathname.replace(/\/+$/, '')}/models`;
  try {
    const response = await fetchImpl(probe.toString(), { method: 'GET' });
    if (response.ok) return { ok: true, refused: false, origins, message: `Reached the local server. If a later call is blocked, set OLLAMA_ORIGINS=${origins} and restart Ollama.` };
    return { ok: false, refused: false, origins, message: `The local server answered HTTP ${response.status}. Set OLLAMA_ORIGINS=${origins} if the model list stays empty, then restart Ollama.` };
  } catch {
    return {
      ok: false,
      refused: true,
      origins,
      message: `The browser refused the local-network request, or nothing is listening. Set OLLAMA_ORIGINS=${origins} in the environment Ollama starts with, restart Ollama, and press Test again. A native app is not required.`,
    };
  }
}
