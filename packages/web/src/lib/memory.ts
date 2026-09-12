import type { Knowledge } from './types';
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
