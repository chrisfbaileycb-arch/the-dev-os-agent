import { executeRun } from '../lib/orchestrator';
import type { WorkerMessage, WorkerEvent } from '../lib/types';
let controller: AbortController | null = null;
const send = (event: WorkerEvent) => self.postMessage(event);
self.onmessage = async (event: MessageEvent<WorkerMessage>) => {
  if (event.data.type === 'cancel') { controller?.abort(new DOMException('Stopped by user', 'AbortError')); return; }
  if (controller) { send({ type: 'error', message: 'A workflow is already running.' }); return; }
  controller = new AbortController();
  try { const run = await executeRun(event.data, controller.signal, run => send({ type: 'update', run })); send({ type: 'done', run }); }
  catch (error) { send({ type: 'error', message: error instanceof Error ? error.message : 'The workflow could not start.' }); }
  finally { controller = null; }
};
