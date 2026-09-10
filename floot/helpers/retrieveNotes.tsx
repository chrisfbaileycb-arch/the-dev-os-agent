import type { Note } from "./runTypes";

function words(s: string): string[] {
  return s.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) ?? [];
}

// Bounded lexical retrieval, not an embedding model or a claim of semantic RAG.
export function retrieveNotes(query: string, docs: Note[], limit = 3): Note[] {
  const tokens = [...new Set(words(query))];
  if (!tokens.length) return [];
  return docs
    .map((doc) => {
      const all = words(`${doc.title} ${doc.title} ${doc.content}`);
      const counts = new Map<string, number>();
      for (const w of all) counts.set(w, (counts.get(w) ?? 0) + 1);
      const score = tokens.reduce((s, w) => s + Math.log(1 + (counts.get(w) ?? 0)), 0);
      return { doc, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((entry) => entry.doc);
}
