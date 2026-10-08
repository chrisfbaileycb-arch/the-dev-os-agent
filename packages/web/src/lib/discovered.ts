import type { Provider } from './providers';
import type { ModelChoice } from './modelChoices';

// What each connected key reaches, as read live from its provider.
//
// The dropdown used to offer a compiled seed list for every vendor — three OpenAI ids, three
// Anthropic ids — and the only way to see what a key actually served was a Discover button in
// Settings whose result never reached the dock. Now a key, saved or freshly typed, triggers one
// /api/models call for its provider, and the dropdown lists exactly what came back, by name. The
// result is cached in this browser for an hour so a reload does not re-ask ten providers at once;
// the key itself is never stored here, only the public list it unlocked.

export interface DiscoveredCatalog { models: ModelChoice[]; at: number; error?: string; /** Fingerprint of the key that read this list. */ key?: string; }

/**
 * A short fingerprint of a key, so a cached list is tied to the key that read it. Swapping to a
 * different account's key used to keep showing the old account's models for up to an hour.
 * Not reversible, and never the key itself.
 */
export function keyFingerprint(key: string | undefined): string {
  const k = (key ?? '').trim(); if (!k) return '';
  let h = 0x811c9dc5; for (let i = 0; i < k.length; i++) { h ^= k.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36) + ':' + k.length;
}
export type Discovered = Partial<Record<Provider, DiscoveredCatalog>>;

export const DISCOVERY_TTL_MS = 3_600_000;
const STORAGE_KEY = 'hb-discovered-v1';

export function loadDiscovered(now = Date.now()): Discovered {
  try {
    const raw = JSON.parse(sessionStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY) || '{}') as Record<string, Partial<DiscoveredCatalog>>;
    const out: Discovered = {};
    for (const [provider, entry] of Object.entries(raw)) {
      if (!entry || !Array.isArray(entry.models) || typeof entry.at !== 'number' || now - entry.at > DISCOVERY_TTL_MS) continue;
      const models = entry.models.filter((m): m is ModelChoice => Boolean(m) && typeof m.id === 'string' && typeof m.label === 'string').slice(0, 2000);
      if (models.length) out[provider as Provider] = { models, at: entry.at, ...(typeof entry.key === 'string' ? { key: entry.key } : {}) };
    }
    return out;
  } catch { return {}; }
}

export function saveDiscovered(discovered: Discovered): void {
  try {
    const clean = Object.fromEntries(Object.entries(discovered).filter(([, v]) => v && !v.error && v.models.length).map(([k, v]) => [k, { models: v!.models, at: v!.at, ...(v!.key ? { key: v!.key } : {}) }]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch { /* storage unavailable */ }
}

export function clearDiscovered(): void { try { localStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ } }

/** Whether a provider's list is fresh enough to skip asking again. */
export const isFresh = (entry: DiscoveredCatalog | undefined, now = Date.now(), key?: string): boolean => Boolean(entry && !entry.error && now - entry.at < DISCOVERY_TTL_MS && (key === undefined || (entry.key ?? '') === key));
