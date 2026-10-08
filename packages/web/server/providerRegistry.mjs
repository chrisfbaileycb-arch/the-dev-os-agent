// The provider registry: one record per place a prompt can be sent, and the single source of truth
// for what "Shield" (US-hosted inference only) allows.
//
// Why a registry and not a list of names: "US-based" is a claim about a company and where it
// serves from, and a customer's lawyer will ask for the evidence. Each record carries the company,
// its headquarters country, what kind of route it is, and what is known about retention and when
// that was last checked. Shield reads this file; nothing else decides what is Shield-eligible.
//
// Honesty rules for editing it:
//   - `hq` is where the company is headquartered. Use 'unknown' rather than a guess.
//   - `retention` is 'unverified' until someone has read the vendor's current terms for the exact
//     product being routed to. Never fill it from memory. When it is checked, set `verifiedOn`
//     (YYYY-MM-DD) and `source` (the page that was read). Standard API access is generally NOT
//     zero-retention; that usually needs a specific agreement or a cloud route such as Vertex.
//   - `integrated: false` means the proxy cannot route to it yet. It is listed so the decision
//     about it is already made when the integration lands.
//
// kind:
//   direct  the company serves its own models from its own API
//   cloud   a hyperscaler platform serving first- and third-party models in regions you choose
//   host    a US inference host serving other labs' open-weight models
//   relay   routes to other companies' endpoints, wherever they are; a relay can never be Shield
//   local   runs on the visitor's own machine; nothing leaves it
//   custom  an endpoint the visitor typed in; unknowable, so never Shield

/** @typedef {{ id: string, name: string, hq: string, kind: 'direct'|'cloud'|'host'|'relay'|'local'|'custom', integrated: boolean, retention: 'unverified'|'verified', verifiedOn: string|null, source: string|null, note?: string }} ProviderRecord */

const unchecked = { retention: 'unverified', verifiedOn: null, source: null };

/** @type {ProviderRecord[]} */
export const REGISTRY = [
  // --- US companies serving their own models ---
  { id: 'anthropic', name: 'Anthropic', hq: 'US', kind: 'direct', integrated: true, ...unchecked },
  { id: 'openai', name: 'OpenAI', hq: 'US', kind: 'direct', integrated: true, ...unchecked },
  { id: 'google', name: 'Google (Gemini API / Vertex AI)', hq: 'US', kind: 'direct', integrated: true, ...unchecked,
    note: 'The free AI Studio tier may use prompts for training. Only a paid Gemini API key or Vertex AI should back Shield.' },
  { id: 'xai', name: 'xAI (Grok)', hq: 'US', kind: 'direct', integrated: true, ...unchecked },
  { id: 'meta', name: 'Meta Muse (Model API)', hq: 'US', kind: 'direct', integrated: true, ...unchecked,
    note: 'OpenAI-compatible at api.meta.ai/v1, keys from dev.meta.ai. Public preview for US developers at the time of writing; terms and retention not yet read.' },

  // --- US cloud platforms ---
  { id: 'azure', name: 'Microsoft Azure OpenAI / AI Foundry', hq: 'US', kind: 'cloud', integrated: false, ...unchecked,
    note: 'Microsoft Copilot is a product, not a developer API; this is the developer route. Pin a US region.' },
  { id: 'bedrock', name: 'Amazon Bedrock', hq: 'US', kind: 'cloud', integrated: false, ...unchecked,
    note: 'Pin a US region; GovCloud is a separate partition with its own terms. Not a key slot.' },
  { id: 'github', name: 'GitHub Models', hq: 'US', kind: 'host', integrated: true, ...unchecked,
    note: 'GitHub is a Microsoft company; rate-limited for prototyping.' },

  // --- US inference hosts for open-weight models ---
  { id: 'groq', name: 'Groq', hq: 'US', kind: 'host', integrated: true, ...unchecked },
  { id: 'nvidia', name: 'NVIDIA NIM', hq: 'US', kind: 'host', integrated: true, ...unchecked,
    note: 'integrate.api.nvidia.com. A key lists only the models that account can call.' },
  { id: 'cerebras', name: 'Cerebras', hq: 'US', kind: 'host', integrated: true, ...unchecked },

  // --- On the visitor's machine ---
  { id: 'ollama', name: 'Local model (Ollama / LM Studio)', hq: 'n/a', kind: 'local', integrated: true, ...unchecked,
    note: 'Runs on the visitor\'s own machine. Allowed alongside Shield, but the app still syncs sessions to the server unless server storage is turned off.' },

  // --- Never Shield: relays, non-US companies, or unknowable destinations ---
  { id: 'openrouter', name: 'OpenRouter', hq: 'US', kind: 'relay', integrated: true, ...unchecked,
    note: 'US company, but it routes to many upstream hosts, including non-US ones.' },
  { id: 'huggingface', name: 'Hugging Face', hq: 'US', kind: 'relay', integrated: true, ...unchecked,
    note: 'Inference Providers routes to third-party hosts.' },
  { id: 'cohere', name: 'Cohere', hq: 'CA', kind: 'direct', integrated: true, ...unchecked },
  { id: 'venice', name: 'Venice', hq: 'unknown', kind: 'direct', integrated: true, ...unchecked },
  { id: 'vercel', name: 'Vercel AI Gateway', hq: 'US', kind: 'relay', integrated: true, ...unchecked,
    note: 'US company, but a gateway to many upstream providers, so it can never be Shield or backend.' },
  { id: 'xkiro', name: 'xKiro gateway', hq: 'unknown', kind: 'relay', integrated: true, ...unchecked },
  { id: 'aihubmix', name: 'AIHubMix', hq: 'unknown', kind: 'relay', integrated: true, ...unchecked },
  { id: 'cheaper-inference', name: 'CheaperInference', hq: 'unknown', kind: 'relay', integrated: true, ...unchecked },
  { id: 'omniroute', name: 'OmniRoute (self-hosted route)', hq: 'unknown', kind: 'relay', integrated: true, ...unchecked },
  { id: 'custom', name: 'Custom endpoint', hq: 'unknown', kind: 'custom', integrated: true, ...unchecked },
];

const byId = new Map(REGISTRY.map(r => [r.id, r]));

export const providerRecord = id => byId.get(String(id ?? '').toLowerCase());

/** A US company serving from its own API, a US cloud, or a US inference host. Relays, other countries and unknowns are out. */
export const isShieldEligible = record =>
  Boolean(record) && record.hq === 'US' && ['direct', 'cloud', 'host'].includes(record.kind);

/** Provider ids Shield allows (and the proxy can reach today unless `onlyIntegrated` is false). */
export function shieldProviders({ onlyIntegrated = true } = {}) {
  return REGISTRY.filter(r => isShieldEligible(r) && (!onlyIntegrated || r.integrated)).map(r => r.id);
}

/** Whether Shield permits routing to this provider. Unknown ids are refused, never assumed. */
export const allowedUnderShield = id => isShieldEligible(providerRecord(id));

// Keys the operator connects on the backend, and the same keys a visitor may bring.
// Identical on purpose. Hugging Face is a relay, so it is not Shield-eligible, but the operator
// asked for it on this list anyway.
export const KEY_LANE_IDS = ['openai', 'anthropic', 'google', 'huggingface', 'groq', 'nvidia', 'xai'];

const BACKEND_IDS = KEY_LANE_IDS;

let laneEnforced = true;
/**
 * Test seam, in the spirit of resetKeyRotation(): the funding mechanics (key rotation, metering,
 * burst caps, the funding order) are provider-agnostic, and their tests use whichever provider made
 * a convenient fixture. They switch the lane off for their own process; tests/backend-lane.test.mjs
 * runs with it on. Nothing in the app calls this.
 */
export function setBackendLaneEnforcedForTests(on) { laneEnforced = Boolean(on); }

/** Whether the lane is being enforced (always, outside the funding-mechanics tests). */
export const isBackendLaneEnforced = () => laneEnforced;

/** Whether the operator's backend may hold a key for, and fund requests to, this provider. */
export const isBackendProvider = id => !laneEnforced || BACKEND_IDS.includes(String(id ?? '').toLowerCase());

/** Backend provider ids. With `onlyIntegrated` (the default) only the ones the proxy can route to today. */
export function backendProviders({ onlyIntegrated = true } = {}) {
  return REGISTRY.filter(r => isBackendProvider(r.id) && (!onlyIntegrated || r.integrated)).map(r => r.id);
}
