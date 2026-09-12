import { providers, type Provider, type Keyring } from './providers';
import type { FreeTier } from './store';

// Which models this visitor can pay for right now, and how to say so when the answer is none.
//
// One rule, read by both surfaces that need it — the dock's model dropdown and the model hub in
// Settings. They used to answer the question separately, from `Boolean(connection.token)`, and got
// it wrong in the same way: a key belongs to a provider, not to the session, so a key pasted for
// Anthropic while the connection pointed at the gateway unlocked nothing until you switched
// provider and saved. The key was right there in the form and the model still read "needs a key".
//
// Two things follow from keeping the rule here rather than in a component:
//
//   The keyring is one owner's. `App` holds it, so typing in a key field unlocks that vendor on
//   the next render, in both places, before anything is saved.
//   An empty list explains itself. A picker with nothing in it and no sentence underneath reads as
//   broken rather than as unconfigured, and those need different responses from the person seeing it.
//
// Deliberately absent: any rule about the free tier outranking a visitor's own key. Which budget
// pays is the visitor's decision, made in Settings and respected verbatim by `inferenceFor()`.
// This module answers only "can this be paid for at all", never "who should pay".

export interface Reach {
  /** What the deployment funds, as reported by /api/providers. */
  free: FreeTier;
  /** One saved key per provider. */
  keys: Keyring;
  /** The active connection's key, which may not have reached the keyring yet. */
  token?: string;
  provider?: Provider;
  /** Whether an administrator token is present, which opens the deployment's whole pool. */
  credits: boolean;
}

/**
 * Providers this visitor can pay for: anything holding a key on the ring, plus the key in hand.
 *
 * The key in hand matters because it is the common case — someone is pasting a key at this moment
 * and wants to see it take effect. Waiting for a save would make the form feel like it had
 * ignored them.
 */
export function keyedProviders(r: Reach): Set<Provider> {
  const held = new Set<Provider>();
  for (const id of Object.keys(providers) as Provider[]) if (r.keys[id]?.trim()) held.add(id);
  if (r.token?.trim() && r.provider) held.add(r.provider);
  return held;
}

/** Whether this visitor holds a key for any provider at all. */
export const hasAnyKey = (r: Reach): boolean => keyedProviders(r).size > 0;

/** Whether a key-only model from this provider can be paid for right now. */
export const canPayFor = (provider: Provider, r: Reach): boolean =>
  r.credits || keyedProviders(r).has(provider);

/** Whether the deployment funds this exact id. Case-insensitive: ids arrive from many hands. */
export const fundedHere = (id: string, free: FreeTier): boolean =>
  free.enabled && free.models.some(m => m.toLowerCase() === id.trim().toLowerCase());

/**
 * Why there is nothing to offer, said plainly and specifically.
 *
 * "Nothing is funded here and you have no key" and "you have a key but not for this" are the same
 * empty list and completely different problems, so they get different sentences. The generic
 * version sent people to check a provider status page when the answer was a missing field.
 */
export function emptyReason(r: Reach): string {
  const keyed = keyedProviders(r);
  if (!r.free.enabled && !keyed.size) return 'This deployment funds no models and you have not added a key yet. Add one in Settings and its models appear here.';
  if (!keyed.size) return 'No models are funded here right now. Add your own key in Settings and its models appear here.';
  return 'No models match. Add a key for the provider you want, or type its model ID in Settings.';
}
