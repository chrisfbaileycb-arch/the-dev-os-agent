import { findModel } from './catalog';
import type { GatewayModel } from './deployment';

// The discover-driven model picker's pure logic, kept out of the component so it can be tested
// without a provider. Three questions live here: which discovered ids are chat models worth
// offering, what a human should read for each, and which one a fresh discovery should land on.

export interface ModelChoice {
  id: string;
  label: string;
  /** Free at the provider itself, by the provider's own signal. */
  free?: boolean;
  /** Verified operational model (direct Gemini/Claude, OpenAI flagship, local loaded endpoint) */
  verified?: boolean;
  /** Model picker section: 'ready' (Ready to Run) or 'extended' (Extended Catalog) */
  section?: 'ready' | 'extended';
}

/**
 * Whether a discovered id is a chat/generative model at all.
 *
 * `/v1/models` lists everything a provider serves, and plenty of it is not something you can
 * hold a conversation with: embeddings, rerankers, speech-to-text, moderation classifiers. They
 * would render as broken choices, so they are filtered before the dropdown ever sees them. The
 * match is on name shapes, which is imperfect and errs toward keeping a model: an unusual id
 * survives the filter and simply fails on send if it really wasn't chat, while wrongly hiding
 * a working model is a choice the visitor cannot recover from.
 */
const NON_CHAT = /embed|rerank|whisper|tts|orpheus|playai|moderation|guard|clip\b|dall[-_]?e|image[-_ ]?gen|stable[-_ ]?diffusion|sdxl|imagen|lyria|veo|aqa\b|imagine|flux|sora|dream[-_ ]?machine|eleven/i;
export function isChatModel(id: string): boolean {
  return id.trim().length > 0 && id.length <= 300 && !NON_CHAT.test(id);
}

/**
 * Differentiates verified operational models (direct Gemini/Claude BYOK providers,
 * OpenAI flagships, or loaded local endpoints like Ollama) from raw unverified catalog listings.
 */
export function isVerifiedOperational(provider?: string, modelId?: string): boolean {
  if (!modelId || typeof modelId !== 'string') return false;
  const id = modelId.toLowerCase().trim();
  const prov = String(provider || '').toLowerCase().trim();

  if (prov === 'ollama') return isChatModel(id);
  const lane = ['openai', 'anthropic', 'google', 'groq', 'xai'];
  if (lane.includes(prov)) return isChatModel(id);
  return false;
}

/** What a human reads for a discovered id: the gateway's own label first, then any catalog label, then the id itself. */
export function labelFor(id: string, gateway: Pick<GatewayModel, 'id' | 'label'>[]): string {
  return gateway.find(m => m.id === id)?.label ?? findModel(id)?.label ?? id;
}

/** A discovered entry as /api/models now reports it: the provider's own label and free flag ride along when given. */
export interface DiscoveredEntry {
  id: string;
  label?: string;
  free?: boolean;
  verified?: boolean;
  section?: 'ready' | 'extended';
}

/** A discovered list reduced to offerable chat models with readable labels. Accepts plain ids or labelled entries. */
export function modelChoices(
  discovered: (string | DiscoveredEntry)[],
  gateway: Pick<GatewayModel, 'id' | 'label'>[] = [],
  provider?: string
): ModelChoice[] {
  return discovered
    .map(entry => typeof entry === 'string' ? { id: entry } : entry)
    .filter(entry => isChatModel(entry.id))
    .map(entry => {
      const item: ModelChoice = {
        id: entry.id,
        label: entry.label?.trim() || labelFor(entry.id, gateway),
        ...(entry.free ? { free: true } : {}),
      };
      if (entry.verified !== undefined) {
        item.verified = entry.verified;
      } else if (provider !== undefined) {
        item.verified = isVerifiedOperational(provider, entry.id);
      }
      if (entry.section !== undefined) {
        item.section = entry.section;
      } else if (item.verified !== undefined) {
        item.section = item.verified ? 'ready' : 'extended';
      }
      return item;
    });
}

/** Partitions a list of model choices into Ready to Run and Extended Catalog sections. */
export function partitionChoices<T extends ModelChoice>(choices: T[], provider?: string): { ready: T[]; extended: T[] } {
  const ready: T[] = [];
  const extended: T[] = [];
  for (const choice of choices) {
    const verified = choice.verified ?? (choice.section !== undefined ? choice.section === 'ready' : (provider ? isVerifiedOperational(provider, choice.id) : false));
    if (verified) {
      ready.push(choice);
    } else {
      extended.push(choice);
    }
  }
  return { ready, extended };
}

/**
 * Narrow a list by what the visitor typed. Every word must appear somewhere in the id or the
 * label, in any order and any case, so "claude sonnet" and "sonnet claude" find the same rows.
 */
export function filterChoices<T extends ModelChoice>(choices: T[], query: string): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return choices;
  return choices.filter(c => { const hay = `${c.id} ${c.label}`.toLowerCase(); return words.every(w => hay.includes(w)); });
}

/**
 * The id a fresh discovery should default to.
 *
 * The current model wins whenever the provider still serves it — a re-discover that moved the
 * selection elsewhere would be surprising. After that: a model the deployment funds for free is
 * the recommended pick (it works for a visitor with no key), and failing that, the first entry
 * of the discovered list. An empty list defaults to nothing rather than to a guess.
 */
export function defaultModel(current: string | undefined, discovered: string[], freeModels: string[]): string | undefined {
  if (current && discovered.includes(current)) return current;
  const freePick = discovered.find(id => freeModels.includes(id));
  return freePick ?? discovered[0];
}

/**
 * Capability tiers, for sorting a model list the way a person reads it: the strongest general and
 * coding models first, the fast lightweight ones after, experiments and old releases last.
 *
 *   0 flagship      large or frontier models — Command R+/A, Qwen 2.5 Coder, Mistral Large,
 *                   Claude Sonnet/Opus, GPT-4o/4.1/5, Gemini Pro, Grok 4, 70B+ open weights
 *   1 standard      anything not recognised; kept above the lightweight tier because an unknown
 *                   id is at least as likely to be a capable model as a small one
 *   2 lightweight   Ministral, Llama 3.2, Flash, Haiku, Mini, Nano, small parameter counts
 *   3 experimental  previews, experimental and dated snapshots, and retired families
 *
 * Read from the id and label only. The order of the checks matters: "gemini-2.5-flash-preview"
 * is an experiment before it is a Flash, and "gpt-4o-mini" is lightweight before it is a GPT-4o.
 */
export type CapabilityTier = 0 | 1 | 2 | 3;
export const TIER_LABELS: Record<CapabilityTier, string> = { 0: 'Flagship', 1: 'Standard', 2: 'Fast', 3: 'Experimental' };

const EXPERIMENTAL = /(?:^|[-_/:.\s])(?:preview|exp|experimental|beta|alpha|test|legacy|deprecated|nightly)(?:$|[-_/:.\s\d])|gpt-3\.5|claude-(?:2|instant)|llama-?2|text-davinci|babbage|(?:^|[-_])0[0-9]{3}(?:$|[-_])/i;
const LIGHTWEIGHT = /(?:^|[-_/.:\s])mini(?!max)|nano|flash|haiku|instant|lite|tiny|small|ministral|llama-?3\.2|gemma|phi-?\d|grok-[\d.]+-fast|code-fast|(?:^|[^0-9.])(?:0\.5|1|1\.5|2|3|4|7|8|9|11|12|13|14)b(?![a-z0-9])/i;
const FLAGSHIP = /command-?r-?\+|command-?r-?plus|command-a|qwen-?2\.5-coder|qwen2\.5-coder|qwen-?3|mistral-large|codestral|claude-(?:3\.5-sonnet|3-opus|sonnet|opus)|sonnet|opus|gpt-4o|gpt-4\.1|gpt-5|gpt-oss-120b|(?:^|[/-])o[134](?:$|[-_])|gemini-[\d.]+-pro|grok-[34]|deepseek-(?:r1|v3|chat|coder)|kimi-k2|glm-?[45]|llama-?3\.[13]-(?:70|405)b|llama-?4|(?:^|[^0-9])(?:32|34|70|72|90|110|120|123|235|405|480)b(?![a-z0-9])|(?:^|[-_/])(?:large|pro|plus|max|ultra)(?:$|[-_/:])/i;

export function capabilityTier(id: string, label = ''): CapabilityTier {
  const hay = `${id} ${label}`;
  if (EXPERIMENTAL.test(hay)) return 3;
  if (LIGHTWEIGHT.test(hay)) return 2;
  if (FLAGSHIP.test(hay)) return 0;
  return 1;
}

/**
 * A list sorted by capability tier, keeping each provider's own order within a tier (the stable
 * sort does that) — so the list reads flagships first without reshuffling what a provider
 * deliberately put at the top of its own catalogue.
 */
export function rankChoices<T extends { id: string; label: string }>(choices: T[]): T[] {
  return choices.map((choice, index) => ({ choice, index, tier: capabilityTier(choice.id, choice.label) }))
    .sort((a, b) => a.tier - b.tier || a.index - b.index)
    .map(x => x.choice);
}

/**
 * The model a new key lands on once its live list is known: the provider's flagship when the key
 * reaches it, otherwise the strongest-ranked model it does reach.
 */
export function preferredModel(ids: { id: string; label: string }[], flagship?: string): string | undefined {
  if (flagship && ids.some(m => m.id === flagship)) return flagship;
  return rankChoices(ids)[0]?.id;
}
