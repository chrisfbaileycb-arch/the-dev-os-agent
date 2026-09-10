import type { Knowledge, Run } from './types';
const DB = 'freetoken-web-v1';
async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore('runs', { keyPath: 'id' }); request.result.createObjectStore('knowledge', { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Browser storage is unavailable. Your workspace may not persist.'));
    request.onblocked = () => reject(new Error('Close other FreeToken tabs to unlock workspace storage.'));
  });
}
async function transaction<T>(store: 'runs' | 'knowledge', mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode); const request = action(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Could not save the workspace. Browser storage may be full or disabled.')); };
  });
}
export const storage = {
  runs: () => transaction<Run[]>('runs', 'readonly', s => s.getAll()),
  knowledge: () => transaction<Knowledge[]>('knowledge', 'readonly', s => s.getAll()),
  saveRun: (run: Run) => transaction('runs', 'readwrite', s => s.put(run)),
  saveKnowledge: (doc: Knowledge) => transaction('knowledge', 'readwrite', s => s.put(doc)),
  removeKnowledge: (id: string) => transaction('knowledge', 'readwrite', s => s.delete(id)),
  clearRuns: () => transaction('runs', 'readwrite', s => s.clear()),
  clearKnowledge: () => transaction('knowledge', 'readwrite', s => s.clear()),
};
export function exportRun(run: Run): string {
  return `# FreeToken Web — ${run.workflow}\n\nMode: ${run.mode === 'demo' ? 'SCRIPTED DEMO — not AI-generated' : 'Hosted inference'}\nModel: ${run.model}\nStatus: ${run.status}\nStarted: ${run.startedAt}\n\n## Goal\n${run.goal}\n\n${run.steps.map(s => `## ${s.agent}: ${s.title}\nStatus: ${s.status}\n\n${s.output ?? s.error ?? 'No output.'}`).join('\n\n')}\n\n---\nReported tokens: ${run.tokens} (0 may mean usage was not reported)\nProvider requests: ${run.calls}\nRetrieved notes: ${run.contextTitles.join(', ') || 'none'}\n`;
}
