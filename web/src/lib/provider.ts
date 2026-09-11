import { workspaceId } from './store';
import type { Completion, Connection } from './types';
export class ProviderError extends Error { constructor(message: string, public retryable = false, public status?: number, public code?: string) { super(message); } }
export function validateEndpoint(value: string): string {
  let url: URL; try { url = new URL(value); } catch { throw new Error('Enter a valid API base URL.'); }
  if (url.username || url.password || url.search || url.hash) throw new Error('Use a URL without credentials, queries, or fragments.');
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Use an HTTP or HTTPS API URL.');
  return url.toString().replace(/\/+$/, '');
}
export function validateConnection(c: Connection): void {
  if (c.mode === 'demo') return;
  // A zero-config run is routed entirely by the server from its own allowlist, so the browser
  // has no endpoint to validate and never supplies one.
  if (c.inference !== 'free' && (!c.provider || c.provider === 'custom')) validateEndpoint(c.endpoint);
  if (!c.model.trim() || c.model.length > 200) throw new Error('Choose a model from your provider.');
  if (!Number.isInteger(c.maxTokens) || c.maxTokens < 64 || c.maxTokens > 4096) throw new Error('Output limit must be between 64 and 4096 tokens.');
}
export async function* sseEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<{ event: string; data: string }> {
  const reader = body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let event = ''; let lines: string[] = []; let bytes = 0; let ended = false;
  try {
    while (!ended) {
      const { value, done } = await reader.read(); ended = done;
      if (value) { bytes += value.byteLength; if (bytes > 4_000_000) throw new ProviderError('Provider stream exceeded the safety limit.'); }
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      let index;
      while ((index = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, index).replace(/\r$/, ''); buffer = buffer.slice(index + 1);
        if (!line) { if (lines.length) yield { event, data: lines.join('\n') }; event = ''; lines = []; }
        else if (line.startsWith('data:')) lines.push(line.slice(5).replace(/^ /, ''));
        else if (line.startsWith('event:')) event = line.slice(6).trim();
      }
    }
    if (buffer.startsWith('data:')) lines.push(buffer.slice(5).trimStart());
    if (lines.length) yield { event, data: lines.join('\n') };
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
const requestBody = (c: Connection) => ({ provider: c.provider || 'custom', apiKey: c.token, baseUrl: c.endpoint, ...(c.serverAccessToken ? { serverAccessToken: c.serverAccessToken } : {}) });
/** The workspace header is how the server meters a zero-config run against its free credit pool. */
const apiHeaders = () => ({ 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId() });
async function checkResponse(response: Response): Promise<void> {
  if (response.ok) return;
  let message = response.status === 401 || response.status === 403 ? 'Invalid API key or insufficient permissions.' : response.status === 429 ? 'Rate limit reached. Wait and retry.' : `Provider request failed (HTTP ${response.status}).`;
  let code: string | undefined;
  try {
    const data = await response.json();
    if (typeof data?.error?.message === 'string') message = data.error.message.slice(0, 400);
    if (typeof data?.error?.code === 'string') code = data.error.code;
  } catch { /* no JSON error body */ }
  throw new ProviderError(message, response.status === 429 || response.status >= 500, response.status, code);
}
export async function complete(c: Connection, system: string, prompt: string, signal: AbortSignal, onDelta?: (text: string) => void, images: string[] = []): Promise<Completion> {
  const userContent = images.length ? [{ type: 'text', text: prompt }, ...images.map(url => ({ type: 'image_url', image_url: { url } }))] : prompt;
  validateConnection(c); signal.throwIfAborted(); const timeout = AbortSignal.timeout(125_000);
  try {
    const response = await fetch('/api/chat', { method: 'POST', credentials: 'same-origin', redirect: 'error', signal: AbortSignal.any([signal, timeout]), headers: apiHeaders(), body: JSON.stringify({ ...requestBody(c), model: c.model, messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }], max_tokens: c.maxTokens }) });
    await checkResponse(response);
    if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream')) throw new ProviderError('Expected a streaming SSE response from /api/chat.');
    let text = ''; let tokens = 0; let finished = false;
    for await (const event of sseEvents(response.body)) {
      signal.throwIfAborted();
      if (event.data === '[DONE]') { finished = true; break; }
      let data; try { data = JSON.parse(event.data); } catch { throw new ProviderError('Malformed provider stream.'); }
      if (event.event === 'error' || data.error) throw new ProviderError('Provider reported a streaming error. Check your model, key, and quota.');
      // Three stream shapes reach here, and they are normalized in this one place rather than
      // rewritten by the proxy mid-flight: OpenAI-compatible (OpenRouter, Groq, OpenAI, Gemini,
      // xKiro, custom), native Cohere v2, and native Anthropic. Anthropic also never sends
      // [DONE] — message_stop is its terminator — so completion is detected per shape.
      const delta = data.choices?.[0]?.delta?.content
        ?? (data.type === 'content-delta' ? data.delta?.message?.content?.text : undefined)
        ?? (data.type === 'content_block_delta' ? data.delta?.text : undefined);
      if (typeof delta === 'string') { text += delta; onDelta?.(text); }
      if (Number.isFinite(data.usage?.total_tokens)) tokens = data.usage.total_tokens;
      if (data.type === 'message-end') { const usage = data.delta?.usage?.tokens; if (usage) tokens = (usage.input_tokens || 0) + (usage.output_tokens || 0); finished = true; }
      // Anthropic reports the prompt on message_start and the completion on message_delta, so
      // the total is only whole once both have arrived.
      if (data.type === 'message_start' && Number.isFinite(data.message?.usage?.input_tokens)) tokens = data.message.usage.input_tokens;
      if (data.type === 'message_delta' && Number.isFinite(data.usage?.output_tokens)) tokens += data.usage.output_tokens;
      if (data.type === 'message_stop') finished = true;
      if (data.choices?.[0]?.finish_reason) finished = true;
    }
    if (!finished) throw new ProviderError('Provider stream ended before completion. Retry the run.');
    if (!text.trim()) throw new ProviderError('The model returned no text. Try a different model or increase the output limit.');
    return { text, tokens: Math.max(0, tokens) };
  } catch (e) {
    if (signal.aborted) throw signal.reason;
    if (timeout.aborted) throw new ProviderError('Provider request timed out.', true);
    if (e instanceof ProviderError) throw e;
    throw new ProviderError('Cannot reach /api/chat. Deploy the included server, then check the provider connection.');
  }
}
export async function listModels(c: Connection, signal: AbortSignal): Promise<string[]> {
  const response = await fetch('/api/models', { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(20_000)]), headers: apiHeaders(), body: JSON.stringify(requestBody(c)) });
  await checkResponse(response); const body = await response.json();
  if (!Array.isArray(body.data)) throw new ProviderError('Unsupported model catalog. You can still type a model ID.');
  return body.data.map((m: { id?: unknown }) => m?.id).filter((id: unknown): id is string => typeof id === 'string' && id.length <= 200).slice(0, 2000);
}
