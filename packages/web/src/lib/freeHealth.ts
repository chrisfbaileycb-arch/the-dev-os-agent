import { workspaceId } from './store';

/**
 * Which funded free model actually answers right now.
 *
 * The tier used to default to the first model in the list without asking whether it worked, and
 * on the live deployment the first two answered 503 while the third was fine, so new visitors
 * landed on a dead model. This sends a one-token request to each candidate in turn and returns the
 * first that starts streaming. At most `limit` are tried; if none answers, null.
 */
export async function firstHealthyFree(models: string[], providerFor: (id: string) => string | undefined, signal: AbortSignal, limit = 4, fetcher: typeof fetch = fetch): Promise<string | null> {
  for (const id of models.slice(0, limit)) {
    if (signal.aborted) return null;
    const probe = new AbortController();
    const onAbort = () => probe.abort();
    signal.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => probe.abort(), 15_000);
    try {
      const response = await fetcher('/api/chat', {
        method: 'POST', credentials: 'same-origin', signal: probe.signal,
        headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId() },
        body: JSON.stringify({ provider: providerFor(id) ?? 'xkiro', model: id, inference: 'free', max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }),
      });
      probe.abort();
      if (response.ok) return id;
    } catch { /* unreachable or timed out: try the next one */ }
    finally { clearTimeout(timer); signal.removeEventListener('abort', onAbort); }
  }
  return null;
}
