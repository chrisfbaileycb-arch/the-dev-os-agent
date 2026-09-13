import { findModel } from './catalog';
import type { GatewayModel } from './deployment';

// The discover-driven model picker's pure logic, kept out of the component so it can be tested
// without a provider. Three questions live here: which discovered ids are chat models worth
// offering, what a human should read for each, and which one a fresh discovery should land on.

export interface ModelChoice { id: string; label: string; }

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
const NON_CHAT = /embed|rerank|whisper|tts|moderation|guard|clip\b|dall[-_]?e|image[-_ ]?gen|stable[-_ ]?diffusion|sdxl/i;
export function isChatModel(id: string): boolean {
  return id.trim().length > 0 && id.length <= 300 && !NON_CHAT.test(id);
}

/** What a human reads for a discovered id: the gateway's own label first, then any catalog label, then the id itself. */
export function labelFor(id: string, gateway: Pick<GatewayModel, 'id' | 'label'>[]): string {
  return gateway.find(m => m.id === id)?.label ?? findModel(id)?.label ?? id;
}

/** A discovered list reduced to offerable chat models with readable labels. */
export function modelChoices(discovered: string[], gateway: Pick<GatewayModel, 'id' | 'label'>[] = []): ModelChoice[] {
  return discovered.filter(isChatModel).map(id => ({ id, label: labelFor(id, gateway) }));
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
