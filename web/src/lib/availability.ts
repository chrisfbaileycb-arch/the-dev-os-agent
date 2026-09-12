import { catalog, type CatalogModel, type InferenceMode } from './catalog';
import { providers, type Keyring, type Provider } from './providers';
import type { FreeTier } from './store';

// What this visitor can actually run, right now.
//
// The model list used to be the compiled catalog, rendered whole: every model this build has
// ever heard of, most of them unreachable, sorted by vendor. That is a specification, not a
// menu. A person opening a model picker is asking "what can I use?", and answering with sixteen
// cards of which four work makes them read every one to find out.
//
// So availability is computed rather than assumed, from three sources that each mean something
// different:
//
//   free     the server said it funds this exact id. Authoritative — only the deployment knows
//            which provider keys it holds, and /api/providers is where it says so.
//   key      this visitor holds a key for that model's provider, so their own account pays.
//   credits  an administrator token unlocks the deployment's whole pool.
//
// Everything else is still real, still selectable by typing its id, and still listed behind an
// explicit "show everything" — hidden by default, never removed. A model that is unreachable
// today becomes reachable the moment a key is pasted, and a picker that had silently dropped it
// would look broken at exactly that moment.

export type Reason = 'free' | 'key' | 'credits';
export interface Reachable { model: CatalogModel; reason: Reason; }

export interface AvailabilityInput {
  free: FreeTier;
  keys: Keyring;
  inference: InferenceMode;
  /** The active connection's key, which may not be saved to the keyring yet. */
  token?: string;
  provider?: Provider;
}

/** Providers this visitor can pay for: anything with a key on the ring, plus the one in hand. */
export function keyedProviders(p: AvailabilityInput): Set<Provider> {
  const held = new Set<Provider>();
  for (const id of Object.keys(providers) as Provider[]) if (p.keys[id]?.trim()) held.add(id);
  if (p.token?.trim() && p.provider) held.add(p.provider);
  return held;
}

/** Whether the server funds this exact id. Case-insensitive, because ids arrive from many hands. */
export const fundedHere = (id: string, free: FreeTier): boolean =>
  free.enabled && free.models.some(m => m.toLowerCase() === id.trim().toLowerCase());

/**
 * Why a model is reachable, or undefined if it is not.
 *
 * Free wins over key: when the deployment already pays for a model, spending the visitor's key
 * on it would be charging them for something that is free to them.
 */
export function reasonFor(model: CatalogModel, p: AvailabilityInput): Reason | undefined {
  if (fundedHere(model.id, p.free)) return 'free';
  if (p.inference === 'credits') return 'credits';
  return keyedProviders(p).has(model.provider) ? 'key' : undefined;
}

/**
 * Everything runnable now, in one list.
 *
 * Server-funded models the compiled catalog has never heard of are included — a gateway adds a
 * model, or the operator sets their own pool, and the picker should offer what the deployment
 * actually funds rather than what someone typed into a file months ago.
 */
export function reachableModels(p: AvailabilityInput): Reachable[] {
  const seen = new Set<string>();
  const out: Reachable[] = [];
  for (const model of catalog) {
    const reason = reasonFor(model, p);
    if (!reason) continue;
    seen.add(model.id.toLowerCase());
    out.push({ model, reason });
  }
  for (const id of p.free.enabled ? p.free.models : []) {
    if (seen.has(id.toLowerCase())) continue;
    seen.add(id.toLowerCase());
    out.push({ model: { id, provider: 'custom', label: id, tier: 'free', weight: 0.5, zeroConfig: true, note: 'Offered by this deployment.' }, reason: 'free' });
  }
  // Free first, then the visitor's own key, then credits; stable within each group.
  const order: Record<Reason, number> = { free: 0, key: 1, credits: 2 };
  return out.map((r, i) => ({ r, i })).sort((a, b) => order[a.r.reason] - order[b.r.reason] || a.i - b.i).map(x => x.r);
}

/** The rest of the catalog: real, selectable, and out of the way until asked for. */
export function unreachableModels(p: AvailabilityInput): CatalogModel[] {
  return catalog.filter(m => !reasonFor(m, p));
}

/** The group heading a reachable model sits under, and the one-line reason beneath it. */
export const GROUPS: Record<Reason, { label: string; note: string }> = {
  free: { label: 'Free here', note: 'This deployment pays for these. No key needed.' },
  key: { label: 'On your key', note: 'Billed by your provider. No credits are drawn.' },
  credits: { label: 'On platform credits', note: 'Drawn from this deployment’s allowance.' },
};

/** Why the list is empty, said plainly. An empty picker with no explanation reads as broken. */
export function emptyReason(p: AvailabilityInput): string {
  if (!p.free.enabled && !keyedProviders(p).size) return 'This deployment funds no models and you have not added a key yet. Add one below and its models appear here.';
  if (!keyedProviders(p).size) return 'No models are funded here right now. Add your own key below and its models appear here.';
  return 'No models match. Add a key for the provider you want, or type its model ID below.';
}
