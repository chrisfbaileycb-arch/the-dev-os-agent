import type { Provider } from './providers';

// The model catalog: what a visitor sees in the dock dropdown before typing anything.
//
// Two tiers, three ways to pay:
//   zero-config  a free model this deployment funds from its own Groq or OpenRouter key. No
//                account, no key, nothing to configure. Metered against a free credit pool.
//   platform     the deployment's keys unlocked by an administrator access token.
//   BYOK         the visitor's own key, billed by their provider, never metered here.
//
// The zeroConfig ids below must match FREE_MODELS in server/freetier.mjs exactly. The server is
// the authority: it refuses to fund anything not on its own list, and tests/freetier.test.mjs
// fails the build if the two lists drift, so the dropdown can never promise what the server
// will not pay for.

export type Tier = 'free' | 'pro';
export type InferenceMode = 'free' | 'credits' | 'byok';
export interface CatalogModel { id: string; provider: Provider; label: string; tier: Tier; weight: number; note: string; zeroConfig?: boolean; }

/** Credits charged per 1,000 tokens by model class. A BYOK run is never charged. */
export const CREDIT_WEIGHTS = { fast: 0.5, standard: 3, reasoning: 15 } as const;
export const DEFAULT_MONTHLY_POOL = 100_000;
/** Mirrors FREE_CREDIT_MONTHLY_POOL in server/freetier.mjs; the server's number wins once it answers. */
export const DEFAULT_FREE_POOL = 400;

export const catalog: CatalogModel[] = [
  // Zero-config: streams with no key on a deployment that has provider keys configured.
  { id: 'groq/llama-3.3-70b-versatile', provider: 'groq', label: 'Llama 3.3 70B Versatile', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'Fast and capable. The default for a visitor with no key.' },
  { id: 'groq/llama-3.1-8b-instant', provider: 'groq', label: 'Llama 3.1 8B Instant', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'Quickest replies; good for short questions.' },
  { id: 'openrouter/auto', provider: 'openrouter', label: 'Auto (free pool)', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'Best free community model available right now: Llama 3.2, Mistral Nemo, or Qwen 2.5.' },
  { id: 'meta-llama/llama-3.2-3b-instruct:free', provider: 'openrouter', label: 'Llama 3.2 3B (free)', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'OpenRouter free pool; availability varies by day.' },
  { id: 'mistralai/mistral-nemo:free', provider: 'openrouter', label: 'Mistral Nemo (free)', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'OpenRouter free pool; availability varies by day.' },
  { id: 'qwen/qwen-2.5-72b-instruct:free', provider: 'openrouter', label: 'Qwen 2.5 72B (free)', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'OpenRouter free pool; availability varies by day.' },
  // xKiro gateway seed. These mirror XKIRO_DEFAULT_POOL in server/freetier.mjs minus the ids
  // its FRONTIER guard refuses to fund — DeepSeek R1 is in the gateway's pool and is listed
  // below as a key-only model for that reason. A deployment that sets XKIRO_FREE_MODELS gets
  // those ids instead, and the dropdown picks them up from /api/providers without an entry here.
  { id: 'deepseek/deepseek-chat', provider: 'xkiro', label: 'DeepSeek Chat', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'General chat through the xKiro gateway.' },
  { id: 'z-ai/glm-5.2', provider: 'xkiro', label: 'GLM 5.2', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'Strong all-rounder through the xKiro gateway.' },
  { id: 'z-ai/glm-5.3-flash', provider: 'xkiro', label: 'GLM 5.3 Flash', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'Quickest of the GLM line; good for short questions.' },
  { id: 'qwen/qwen-2.5-72b-instruct', provider: 'xkiro', label: 'Qwen 2.5 72B', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'Broad general knowledge; strong at structured output.' },
  { id: 'moonshotai/kimi-k2.7-code', provider: 'xkiro', label: 'Kimi K2.7 Code', tier: 'free', weight: CREDIT_WEIGHTS.fast, zeroConfig: true, note: 'Tuned for code and long context.' },
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

/** Model ids a visitor can run with no key at all, in dropdown order. */
export const zeroConfigModels = catalog.filter(m => m.zeroConfig);
export const DEFAULT_FREE_MODEL = 'groq/llama-3.3-70b-versatile';
export const isZeroConfig = (id: string): boolean => zeroConfigModels.some(m => m.id.toLowerCase() === id.trim().toLowerCase());

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
