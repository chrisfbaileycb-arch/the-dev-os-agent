// Client for POST /api/engine. The server streams our own events, not the provider's raw SSE.

export interface EngineEvent {
  type: string;
  text?: string;
  name?: string;
  detail?: string;
  id?: string;
  message?: string;
}

export async function readEngineStream(response: Response, onEvent: (event: EngineEvent) => void): Promise<void> {
  if (!response.ok || !response.body) {
    let message = `Execution engine failed (HTTP ${response.status}).`;
    try {
      const body = await response.json() as { error?: { message?: string } };
      if (body?.error?.message) message = body.error.message;
    } catch { /* the status is the message */ }
    throw new Error(message);
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() ?? '';
    for (const chunk of chunks) {
      const data = chunk.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      if (!data) continue;
      onEvent(JSON.parse(data) as EngineEvent);
    }
  }
}
