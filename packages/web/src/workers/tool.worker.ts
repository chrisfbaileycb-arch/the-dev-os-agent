import { isSandboxRequest, SANDBOX_CHANNEL, type SandboxReply } from '../lib/sandboxProtocol';
import { executeSandboxTool } from '../lib/toolExecutor';
const scope = self as unknown as { onmessage: ((event: MessageEvent<unknown>) => void) | null; postMessage: (message: SandboxReply) => void; close: () => void };
let accepted = false;
scope.onmessage = event => {
  if (accepted || !isSandboxRequest(event.data)) return;
  accepted = true;
  const request = event.data; const started = performance.now();
  const envelope = { channel: SANDBOX_CHANNEL, version: 1 as const, id: request.id, nonce: request.nonce } as const;
  scope.postMessage({ ...envelope, type: 'started' });
  const signal = AbortSignal.timeout(180_000);
  void executeSandboxTool(request, signal).then(result => scope.postMessage({ ...envelope, type: 'result', result, durationMs: performance.now() - started })).catch(error => scope.postMessage({ ...envelope, type: 'error', message: error instanceof Error ? error.message : 'Sandbox action failed.', durationMs: performance.now() - started })).finally(() => scope.close());
};
