import type { Project } from '../project';
import type { BuildRequest, BuildResponse } from '../../workers/build.worker';

// The main thread's handle on the build worker: one worker kept alive across builds (esbuild's
// wasm instance is expensive to spin up, cheap to reuse), requests matched to replies by id so a
// build superseded by a newer one — the visitor kept typing — can be ignored rather than raced.

export interface BuildResult { ok: boolean; html: string; errors: string[] }

let worker: Worker | null = null;
const pending = new Map<string, (r: BuildResponse) => void>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('../../workers/build.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (event: MessageEvent<BuildResponse>) => { pending.get(event.data.id)?.(event.data); pending.delete(event.data.id); };
  return worker;
}

const BUILD_TIMEOUT_MS = 30_000;

export function buildProject(project: Project, signal?: AbortSignal): Promise<BuildResult> {
  const id = crypto.randomUUID();
  const w = ensureWorker();
  const request: BuildRequest = { id, files: project.files, entry: project.entry, dependencies: project.dependencies, kind: project.kind };
  return new Promise<BuildResult>((resolvePromise, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The build took too long (over 30s) — a package or import may be stuck.')); }, BUILD_TIMEOUT_MS);
    const onAbort = () => { pending.delete(id); clearTimeout(timer); reject(new DOMException('Build cancelled', 'AbortError')); };
    signal?.addEventListener('abort', onAbort, { once: true });
    pending.set(id, response => {
      clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
      resolvePromise(response.ok ? { ok: true, html: response.html, errors: [] } : { ok: false, html: '', errors: response.errors });
    });
    w.postMessage(request);
  });
}

/** Release the worker between sessions, or when the preview panel closes for a while. */
export function disposeBuildWorker(): void { worker?.terminate(); worker = null; pending.clear(); }
