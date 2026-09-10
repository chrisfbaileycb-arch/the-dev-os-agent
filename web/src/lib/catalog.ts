import type { Provider } from './providers';

// The model catalog: what a new user sees before typing anything. Two tiers, two ways to pay.
// Free tier models run on the provider's free allowance; you still need a key (free Groq or
// OpenRouter account) or platform credits. Pro tier models draw credits at a higher weight.

export type Tier = 'free' | 'pro';
export type InferenceMode = 'credits' | 'byok';
export interface CatalogModel { id: string; provider: Provider; label: string; tier: Tier; weight: number; note: string; }

/** Credits charged per 1,000 tokens by model class. A BYOK run is never charged. */
export const CREDIT_WEIGHTS = { fast: 0.5, standard: 3, reasoning: 15 } as const;
export const DEFAULT_MONTHLY_POOL = 100_000;

export const catalog: CatalogModel[] = [
  { id: 'groq/llama-3.3-70b-versatile', provider: 'groq', label: 'Llama 3.3 70B Versatile', tier: 'free', weight: CREDIT_WEIGHTS.fast, note: 'Fast, capable default on Groq.' },
  { id: 'groq/llama-3.1-8b-instant', provider: 'groq', label: 'Llama 3.1 8B Instant', tier: 'free', weight: CREDIT_WEIGHTS.fast, note: 'Quickest replies; good for short questions.' },
  { id: 'meta-llama/llama-3.2-3b-instruct:free', provider: 'openrouter', label: 'Llama 3.2 3B (free)', tier: 'free', weight: CREDIT_WEIGHTS.fast, note: 'OpenRouter free pool; availability varies by day.' },
  { id: 'mistralai/mistral-nemo:free', provider: 'openrouter', label: 'Mistral Nemo (free)', tier: 'free', weight: CREDIT_WEIGHTS.fast, note: 'OpenRouter free pool; availability varies by day.' },
  { id: 'qwen/qwen-2.5-72b-instruct:free', provider: 'openrouter', label: 'Qwen 2.5 72B (free)', tier: 'free', weight: CREDIT_WEIGHTS.fast, note: 'OpenRouter free pool; availability varies by day.' },
  { id: 'deepseek/deepseek-r1', provider: 'openrouter', label: 'DeepSeek R1', tier: 'pro', weight: CREDIT_WEIGHTS.reasoning, note: 'Deliberate reasoning; slow and thorough.' },
  { id: 'anthropic/claude-3.5-sonnet', provider: 'openrouter', label: 'Claude 3.5 Sonnet', tier: 'pro', weight: CREDIT_WEIGHTS.reasoning, note: 'Strong writing and analysis.' },
  { id: 'anthropic/claude-3.5-haiku', provider: 'openrouter', label: 'Claude 3.5 Haiku', tier: 'pro', weight: CREDIT_WEIGHTS.standard, note: 'Quick and careful.' },
  { id: 'openai/gpt-4o', provider: 'openrouter', label: 'GPT-4o', tier: 'pro', weight: CREDIT_WEIGHTS.reasoning, note: 'General purpose flagship.' },
];

const bare = (id: string) => id.replace(/^groq\//, '').toLowerCase();
export function findModel(id: string): CatalogModel | undefined { return catalog.find(m => bare(m.id) === bare(id)); }
/** Credit weight per 1K tokens; catalog first, then a conservative guess from the model name. */
export function weightFor(model: string): number {
  const hit = findModel(model); if (hit) return hit.weight;
  const id = bare(model);
  if (/(^|[/:-])(r1|o1|o3|o4)(?![0-9a-z])|opus|reason|think/.test(id)) return CREDIT_WEIGHTS.reasoning;
  if (/:free|instant|mini|haiku|flash|nano|(^|[/-])(1|3|7|8)b(?![0-9])/.test(id)) return CREDIT_WEIGHTS.fast;
  return CREDIT_WEIGHTS.standard;
}
export function tierFor(model: string): Tier { return findModel(model)?.tier ?? (weightFor(model) === CREDIT_WEIGHTS.fast ? 'free' : 'pro'); }
/** Credits for a completed request. Two-decimal precision; nothing for BYOK or the scripted preview. */
export function creditsFor(model: string, tokens: number, mode: InferenceMode | 'demo'): number {
  if (mode !== 'credits' || !(tokens > 0)) return 0;
  return Math.ceil((tokens * weightFor(model)) / 10) / 100;
}
/** Rough token estimate for counters before a provider reports usage. */
export function estimateTokens(text: string): number { return text ? Math.ceil(text.length / 4) : 0; }
