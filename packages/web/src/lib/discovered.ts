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

export interface DiscoveredCatalog { models: ModelChoice[]; at: number; error?: string; }
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
      if (models.length) out[provider as Provider] = { models, at: entry.at };
    }
    return out;
  } catch { return {}; }
}

export function saveDiscovered(discovered: Discovered): void {
  try {
    const clean = Object.fromEntries(Object.entries(discovered).filter(([, v]) => v && !v.error && v.models.length).map(([k, v]) => [k, { models: v!.models, at: v!.at }]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(clean));
  } catch { /* storage unavailable */ }
}

export function clearDiscovered(): void { try { localStorage.removeItem(STORAGE_KEY); sessionStorage.removeItem(STORAGE_KEY); } catch { /* storage unavailable */ } }

/** Whether a provider's list is fresh enough to skip asking again. */
export const isFresh = (entry: DiscoveredCatalog | undefined, now = Date.now()): boolean => Boolean(entry && !entry.error && now - entry.at < DISCOVERY_TTL_MS);
