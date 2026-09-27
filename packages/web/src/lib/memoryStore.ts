import { prepareMemory, pruneMemories } from './memory';
import { storage } from './store';
import type { MemoryEntry, MemoryKind } from './types';

// The IndexedDB half of persistent memory. Local to this browser only: memories are never pushed
// to the server copy of the workspace, and "Clear everything" removes them with the rest.

export const loadMemories = (): Promise<MemoryEntry[]> => storage.memory().catch(() => []);

/**
 * Write one memory, after the secret check, and prune the store if it is over its cap. Resolves
 * to the full list as it now stands so the caller's state can be replaced in one step. Throws
 * `MemoryRejected` for anything the scanner refused.
 */
export async function saveMemory(kind: MemoryKind, text: string, current: MemoryEntry[], known: string[] = []): Promise<MemoryEntry[]> {
  const entry = prepareMemory(kind, text, known);
  // The same fact twice is one memory, refreshed, not two.
  const duplicate = current.find(m => m.kind === kind && m.text.toLowerCase() === entry.text.toLowerCase());
  if (duplicate) {
    const refreshed = { ...duplicate, usedAt: entry.createdAt };
    await storage.saveMemory(refreshed);
    return current.map(m => m.id === duplicate.id ? refreshed : m);
  }
  await storage.saveMemory(entry);
  let next = [entry, ...current];
  const drop = pruneMemories(next);
  if (drop.length) { await Promise.all(drop.map(id => storage.removeMemory(id))); next = next.filter(m => !drop.includes(m.id)); }
  return next;
}

export async function removeMemory(id: string, current: MemoryEntry[]): Promise<MemoryEntry[]> {
  await storage.removeMemory(id);
  return current.filter(m => m.id !== id);
}

/** Record that these memories were sent with a prompt, so the lookup favours them next time. */
export async function touchMemories(used: MemoryEntry[], current: MemoryEntry[]): Promise<MemoryEntry[]> {
  if (!used.length) return current;
  const at = new Date().toISOString();
  const ids = new Set(used.map(m => m.id));
  const next = current.map(m => ids.has(m.id) ? { ...m, hits: m.hits + 1, usedAt: at } : m);
  await Promise.all(next.filter(m => ids.has(m.id)).map(m => storage.saveMemory(m)));
  return next;
}
