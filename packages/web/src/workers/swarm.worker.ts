import { executeRun } from '../lib/orchestrator';
import type { Run, WorkerMessage, WorkerEvent } from '../lib/types';

// The headless multi-agent engine. It runs the Ruflo-derived task graph off the main thread and
// talks to the page only through three events — an updated run, a finished run, or one plain error
// sentence — so none of the scheduling, agent bookkeeping, or JSON plumbing ever reaches the UI.
// It never logs to the console: whatever the person needs to know arrives in a `run`.

let controller: AbortController | null = null;
/** The pending approval gate, resolved by an `approve` message and rejected by `cancel`. */
let release: { resolve: () => void; reject: (reason: unknown) => void } | null = null;
const send = (event: WorkerEvent) => self.postMessage(event);
const toolReplies = new Map<string, { resolve: (value: string) => void; reject: (reason: unknown) => void }>();
function requestTool(runId: string, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted(); const id = crypto.randomUUID();
    const abort = () => { toolReplies.delete(id); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    toolReplies.set(id, { resolve: value => { signal.removeEventListener('abort', abort); resolve(value); }, reject: reason => { signal.removeEventListener('abort', abort); reject(reason); } });
    send({ type: 'tool_request', id, runId, tool: name, args });
  });
}

function waitForApproval(signal: AbortSignal): (run: Run) => Promise<void> {
  return () => new Promise<void>((resolve, reject) => {
    if (signal.aborted) { reject(signal.reason); return; }
    const onAbort = () => { release = null; reject(signal.reason); };
    signal.addEventListener('abort', onAbort, { once: true });
    release = {
      resolve: () => { signal.removeEventListener('abort', onAbort); release = null; resolve(); },
      reject: reason => { signal.removeEventListener('abort', onAbort); release = null; reject(reason); },
    };
  });
}

self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  if (event.data.type === 'cancel') { controller?.abort(new DOMException('Stopped by user', 'AbortError')); return; }
  if (event.data.type === 'approve') { release?.resolve(); return; }
  if (event.data.type === 'tool_result') {
    const reply = toolReplies.get(event.data.id); toolReplies.delete(event.data.id);
    if (event.data.error) reply?.reject(new Error(event.data.error)); else reply?.resolve(event.data.output);
    return;
  }
  if (controller) { send({ type: 'error', message: 'A plan is already running.' }); return; }
  controller = new AbortController();
  try {
    const runId = event.data.runId;
    const run = await executeRun(event.data, controller.signal, run => send({ type: 'update', run }), undefined, waitForApproval(controller.signal), (name, args, signal) => requestTool(runId, name, args, signal));
    send({ type: 'done', run });
  } catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : 'The plan could not start.' }); }
  finally { controller = null; release = null; toolReplies.clear(); }
};
