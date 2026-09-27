import { findSecrets } from './secrets';
import type { Knowledge, MemoryEntry, MemoryKind } from './types';

export function words(s: string): string[] { return s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? []; }
// Bounded lexical retrieval, not an embedding model or a claim of semantic RAG.
export function retrieve(query: string, docs: Knowledge[], limit = 3): Knowledge[] {
  const tokens = [...new Set(words(query))];
  return docs.map(doc => { const all = words(`${doc.title} ${doc.title} ${doc.content}`); const counts = new Map<string, number>(); for (const w of all) counts.set(w, (counts.get(w) ?? 0) + 1); return { doc, score: tokens.reduce((s, w) => s + Math.log(1 + (counts.get(w) ?? 0)), 0) / Math.sqrt(1 + all.length / 1000) }; }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.doc);
}
export class PromptCache {
  private entries = new Map<string, string>();
  constructor(private limit = 24) {}
  get(key: string): string | undefined { const value = this.entries.get(key); if (value !== undefined) { this.entries.delete(key); this.entries.set(key, value); } return value; }
  set(key: string, value: string): void { this.entries.delete(key); this.entries.set(key, value); while (this.entries.size > this.limit) this.entries.delete(this.entries.keys().next().value!); }
  clear(): void { this.entries.clear(); }
}

// ---------------------------------------------------------------------------------------------
// Persistent memory: the pure half.
//
// The shape follows the small agent-memory designs (Hermes, Pi) rather than a transcript dump:
// memories are short, typed facts, and a prompt gets the few that match what is being asked, not
// the whole ledger. Everything here is pure so it runs unchanged in the swarm worker; the
// IndexedDB half lives in lib/memoryStore.ts.
//
// Three rules hold the design together:
//   1. Targeted lookup. `selectMemories` scores every entry against the current input and returns
//      at most a handful, inside a character budget. A memory that matches nothing is not sent.
//   2. Nothing secret is ever written. `prepareMemory` runs the shared scanner and refuses the
//      entry outright — a memory with the key cut out is still a memory that held one.
//   3. Bounded size. `pruneMemories` names the stalest entries once the store passes its cap, so
//      years of use cannot turn every lookup into a scan of thousands of rows.
// ---------------------------------------------------------------------------------------------

export const MEMORY_CAP = 300;
export const MEMORY_TEXT_LIMIT = 600;
const STOP = new Set(['the', 'and', 'for', 'with', 'that', 'this', 'from', 'you', 'your', 'are', 'was', 'use', 'can', 'not', 'but', 'have', 'has', 'all', 'any', 'into', 'out', 'about', 'when', 'what', 'will', 'would', 'should', 'please', 'remember', 'always', 'never']);

/** The distinctive words of a memory, used as tags and as the lookup's second signal. */
export function tagsFor(text: string, limit = 8): string[] {
  const counts = new Map<string, number>();
  for (const w of words(text)) if (w.length > 2 && !STOP.has(w)) counts.set(w, (counts.get(w) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([w]) => w);
}

export class MemoryRejected extends Error {
  constructor(message: string) { super(message); this.name = 'MemoryRejected'; }
}

/**
 * A new memory, ready to store — or a {@link MemoryRejected} if it holds anything secret.
 *
 * `known` is every credential this visitor holds, matched exactly; the pattern scanner covers the
 * rest. Rejection rather than redaction is deliberate: the entry is the person's own words, and
 * silently rewriting them into something they did not say is worse than asking them to rephrase.
 */
export function prepareMemory(kind: MemoryKind, text: string, known: string[] = [], now = new Date()): MemoryEntry {
  const clean = text.replace(/\s+/g, ' ').trim().slice(0, MEMORY_TEXT_LIMIT);
  if (clean.length < 3) throw new MemoryRejected('A memory needs a few words to be useful.');
  const secrets = findSecrets(clean, known);
  if (secrets.length) throw new MemoryRejected(`Not saved: that looks like it contains a ${secrets[0].kind.toLowerCase()}. Memories are stored unencrypted in this browser, so keys and passwords are never written to them.`);
  return { id: crypto.randomUUID(), kind, text: clean, tags: tagsFor(clean), createdAt: now.toISOString(), hits: 0 };
}

/**
 * "remember that I use pnpm", "remember: tabs not spaces" → the preference to save, or null.
 *
 * Only an explicit request counts. Inferring preferences from ordinary conversation is how a
 * memory system fills up with things nobody asked it to keep.
 */
export function rememberRequest(input: string): string | null {
  const m = input.match(/^\s*(?:please\s+)?(?:remember|note)(?:\s+that|\s*:)\s+([\s\S]{3,})$/i);
  return m ? m[1].trim().replace(/[.!]+$/, '') : null;
}

/** One line about a failure, for the next attempt to learn from. The error text is the useful half. */
export function failureText(input: { model: string; error: string; request: string }): string {
  const request = input.request.replace(/\s+/g, ' ').slice(0, 160);
  return `Request "${request}" on ${input.model || 'the selected model'} failed: ${input.error.replace(/\s+/g, ' ').slice(0, 300)}`;
}

/** One line about something built here: what was asked for and which files came back. */
export function projectText(input: { request: string; files: string[] }): string {
  const files = input.files.slice(0, 8).join(', ') + (input.files.length > 8 ? ` and ${input.files.length - 8} more` : '');
  return `Built for "${input.request.replace(/\s+/g, ' ').slice(0, 200)}": ${files}`;
}

const KIND_WEIGHT: Record<MemoryKind, number> = { preference: 1.4, failure: 1.15, project: 1 };

/**
 * How relevant one memory is to this input. Zero means "do not send it".
 *
 * Word overlap with the text, plus overlap with the tags, weighted by kind — a stated preference
 * outranks an old project note on the same words — and nudged by how often the memory has been
 * used before. There is no floor from recency alone: an old memory that matches still counts, a
 * fresh one that does not match is still irrelevant.
 */
export function scoreMemory(query: string, entry: MemoryEntry): number {
  const q = new Set(words(query).filter(w => !STOP.has(w)));
  if (!q.size) return 0;
  const body = new Set(words(entry.text));
  let overlap = 0;
  for (const w of q) { if (body.has(w)) overlap += 1; if (entry.tags.includes(w)) overlap += 0.5; }
  if (!overlap) return 0;
  return (overlap / Math.sqrt(q.size)) * KIND_WEIGHT[entry.kind] * (1 + Math.log1p(entry.hits) * 0.15);
}

/** The few memories worth sending with this input, most relevant first, inside a character budget. */
export function selectMemories(query: string, entries: MemoryEntry[], { limit = 4, budget = 1500 } = {}): MemoryEntry[] {
  const ranked = entries.map(entry => ({ entry, score: scoreMemory(query, entry) })).filter(x => x.score > 0).sort((a, b) => b.score - a.score);
  const picked: MemoryEntry[] = []; let used = 0;
  for (const { entry } of ranked) {
    if (picked.length >= limit) break;
    if (used + entry.text.length > budget) continue;
    picked.push(entry); used += entry.text.length;
  }
  return picked;
}

/** The block a prompt carries. Labelled as reference data, like every other supplied context. */
export function formatMemories(entries: MemoryEntry[]): string {
  if (!entries.length) return '';
  return entries.map(e => `[memory: ${e.kind}] ${e.text}`).join('\n');
}

/** Ids to delete once the store is over its cap: least used first, then oldest. */
export function pruneMemories(entries: MemoryEntry[], cap = MEMORY_CAP): string[] {
  if (entries.length <= cap) return [];
  const stale = [...entries].sort((a, b) => a.hits - b.hits || (a.usedAt ?? a.createdAt).localeCompare(b.usedAt ?? b.createdAt));
  return stale.slice(0, entries.length - cap).map(e => e.id);
}
