import type { Provider } from './providers';

// Models a visitor needs their own key for, and what each costs on platform credits.
//
// This file used to hold the free models too, hardcoded, and mirrored a list in
// server/freetier.mjs that a test compared it against. Both lists were wrong in the same way, so
// the test passed and the free tier 404'd: the ids named models the gateway does not serve. A
// second copy of somebody else's catalogue cannot be kept true by comparing it to a third copy.
//
// So free models are no longer named here at all. /api/providers reports what this deployment
// actually funds — discovered live from the gateway — and the UI renders that list and nothing
// else. What remains below is the key-only half, where a hardcoded seed is harmless: the visitor
// brings the key, Discover reads their provider's live list, and the model field accepts anything
// typed. Nothing here can promise a free model the server will refuse to pay for, because nothing
// here claims to be free.

export type Tier = 'free' | 'pro';
export type InferenceMode = 'free' | 'credits' | 'byok';
export interface CatalogModel { id: string; provider: Provider; label: string; tier: Tier; weight: number; note: string; }

/** Credits charged per 1,000 tokens by model class. A BYOK run is never charged. */
export const CREDIT_WEIGHTS = { fast: 0.5, standard: 3, reasoning: 15 } as const;
export const DEFAULT_MONTHLY_POOL = 100_000;
/** Mirrors FREE_CREDIT_MONTHLY_POOL in server/freetier.mjs; the server's number wins once it answers. */
export const DEFAULT_FREE_POOL = 400;

export const catalog: CatalogModel[] = [
  // Deep reasoning: needs your own key, or platform credits on a deployment that grants them.
  { id: 'deepseek/deepseek-r1', provider: 'openrouter', label: 'DeepSeek R1', tier: 'pro', weight: CREDIT_WEIGHTS.reasoning, note: 'Deliberate reasoning; slow and thorough.' },
  { id: 'anthropic/claude-3.5-sonnet', provider: 'openrouter', label: 'Claude 3.5 Sonnet', tier: 'pro', weight: CREDIT_WEIGHTS.reasoning, note: 'Strong writing and analysis.' },
  { id: 'anthropic/claude-3.5-haiku', provider: 'openrouter', label: 'Claude 3.5 Haiku', tier: 'pro', weight: CREDIT_WEIGHTS.standard, note: 'Quick and careful.' },
  { id: 'openai/gpt-4o', provider: 'openrouter', label: 'GPT-4o', tier: 'pro', weight: CREDIT_WEIGHTS.reasoning, note: 'General purpose flagship.' },
  // Direct on the vendor's own API, billed to the visitor's account with that vendor. The same
  // families are reachable through OpenRouter above; these exist so a key you already hold works
  // without opening an account somewhere new. Model names move faster than a deploy, so these
  // are seeds — Discover reads the live list and the model field accepts anything typed.
  { id: 'gpt-4o', provider: 'openai', label: 'GPT-4o (direct)', tier: 'pro', weight: CREDIT_WEIGHTS.reasoning, note: 'On your own OpenAI key.' },
  { id: 'claude-sonnet-4-5', provider: 'anthropic', label: 'Claude Sonnet (direct)', tier: 'pro', weight: CREDIT_WEIGHTS.reasoning, note: 'On your own Anthropic key.' },
  { id: 'gemini-2.5-pro', provider: 'google', label: 'Gemini 2.5 Pro (direct)', tier: 'pro', weight: CREDIT_WEIGHTS.reasoning, note: 'On your own Google AI Studio key.' },
  { id: 'gemini-2.5-flash', provider: 'google', label: 'Gemini 2.5 Flash (direct)', tier: 'pro', weight: CREDIT_WEIGHTS.standard, note: 'Quick and cheap on your own Google key.' },
];

const bare = (id: string) => id.replace(/^groq\//, '').toLowerCase();
export function findModel(id: string): CatalogModel | undefined { return catalog.find(m => bare(m.id) === bare(id)); }
/**
 * Credit weight per 1K tokens; catalog first, then a conservative guess from the model name.
 *
 * One id can appear more than once — a gateway may offer cheaply what another provider bills
 * for, which is how DeepSeek R1 reached this catalog twice — so this takes the HIGHEST weight
 * of the matching entries. Picking the first match instead would let a cheap listing silently
 * under-charge the platform credit pool for the expensive route. The free tier never consults
 * this: it meters at its own flat FREE_WEIGHT on the server.
 */
export function weightFor(model: string): number {
  const hits = catalog.filter(m => bare(m.id) === bare(model));
  if (hits.length) return Math.max(...hits.map(m => m.weight));
  const id = bare(model);
  if (/(^|[/:-])(r1|o1|o3|o4)(?![0-9a-z])|opus|reason|think/.test(id)) return CREDIT_WEIGHTS.reasoning;
  if (/:free|instant|mini|haiku|flash|nano|(^|[/-])(1|3|7|8)b(?![0-9])/.test(id)) return CREDIT_WEIGHTS.fast;
  return CREDIT_WEIGHTS.standard;
}
export function tierFor(model: string): Tier { return findModel(model)?.tier ?? (weightFor(model) === CREDIT_WEIGHTS.fast ? 'free' : 'pro'); }
/** Credits for a completed request. Two-decimal precision; nothing for BYOK or the scripted preview. */
export function creditsFor(model: string, tokens: number, mode: InferenceMode | 'demo'): number {
  if ((mode !== 'credits' && mode !== 'free') || !(tokens > 0)) return 0;
  return Math.ceil((tokens * weightFor(model)) / 10) / 100;
}
/** Rough token estimate for counters before a provider reports usage. */
export function estimateTokens(text: string): number { return text ? Math.ceil(text.length / 4) : 0; }
