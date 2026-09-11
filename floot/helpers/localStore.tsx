import type { Note, Run } from "./runTypes";

// Browser-local persistence, as in the original FreeToken Web: notes and run history
// stay on the visitor's device in IndexedDB. Nothing here touches the server.

const DB_NAME = "freetoken-web-v1";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") { reject(new Error("Browser storage is unavailable. Your workspace may not persist.")); return; }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("runs", { keyPath: "id" });
      request.result.createObjectStore("knowledge", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Browser storage is unavailable. Your workspace may not persist."));
    request.onblocked = () => reject(new Error("Close other Hey Buddy tabs to unlock workspace storage."));
  });
}

async function transaction<T>(store: "runs" | "knowledge", mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = action(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error("Could not save the workspace. Browser storage may be full or disabled.")); };
  });
}

async function runs(): Promise<Run[]> {
  const all = await transaction<Run[]>("runs", "readonly", (s) => s.getAll());
  // A run left as "running" by a closed tab can never finish: mark it interrupted.
  const fixed = all.map((r) => r.status === "running"
    ? { ...r, status: "interrupted" as const, steps: r.steps.map((s) => (s.status === "pending" || s.status === "running" ? { ...s, status: "cancelled" as const } : s)) }
    : r);
  await Promise.all(fixed.filter((r) => r.status === "interrupted" && all.find((a) => a.id === r.id)?.status === "running").map(saveRun));
  return fixed.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

async function notes(): Promise<Note[]> {
  const all = await transaction<Note[]>("knowledge", "readonly", (s) => s.getAll());
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function saveRun(run: Run): Promise<Run> {
  await transaction("runs", "readwrite", (s) => s.put(run));
  return run;
}

async function saveNote(input: { id: string; title: string; content: string }): Promise<Note> {
  const existing = await notes();
  if (!existing.some((n) => n.id === input.id) && existing.length >= 100) throw new Error("Workspace limit: 100 notes. Remove an old note first.");
  const note: Note = { id: input.id, title: input.title.trim().slice(0, 120), content: input.content.slice(0, 50_000), createdAt: existing.find((n) => n.id === input.id)?.createdAt ?? new Date().toISOString() };
  if (!note.title) throw new Error("Give your note a title.");
  if (!note.content.trim()) throw new Error("Add some content to the note.");
  await transaction("knowledge", "readwrite", (s) => s.put(note));
  return note;
}

async function removeNote(id: string): Promise<{ deleted: boolean }> {
  await transaction("knowledge", "readwrite", (s) => s.delete(id));
  return { deleted: true };
}

async function clearAll(): Promise<{ runsDeleted: number; notesDeleted: number }> {
  const [r, n] = await Promise.all([runs(), notes()]);
  await transaction("runs", "readwrite", (s) => s.clear());
  await transaction("knowledge", "readwrite", (s) => s.clear());
  return { runsDeleted: r.length, notesDeleted: n.length };
}

export const localStore = { runs, notes, saveRun, saveNote, removeNote, clearAll };
