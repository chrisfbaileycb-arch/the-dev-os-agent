import type { InferenceMode } from './catalog';
import type { Provider } from './providers';

// The two model dropdowns on the dock.
//
//   us   Models from the US providers this deployment can fund itself: Anthropic, OpenAI, Google,
//        xAI, Groq and Cerebras (Meta, Azure and Bedrock join when the proxy can route to them). Free and plan models live
//        here, and a visitor's own key for one of these vendors unlocks its group here too.
//   own  Everything else — OpenRouter, GitHub Models, Cohere, Venice, Hugging Face, xKiro, AIHubMix
//        and a local model. The deployment never pays for these. They run on a key
//        the visitor types into the dropdown, which is kept in this browser only.
//
// The US list mirrors `backendProviders()` in server/providerRegistry.mjs, which is what the admin
// dashboard and the server's funding decisions are limited to. The server cannot be imported here,
// so tests/model-lanes.test.ts asserts the two lists agree.

export type Lane = 'us' | 'own';

export const US_LANE_PROVIDERS: readonly Provider[] = ['anthropic', 'openai', 'google', 'xai', 'groq', 'cerebras'];

export const isUsProvider = (provider: Provider | string | undefined): boolean =>
  US_LANE_PROVIDERS.includes(provider as Provider);

export const providersInLane = (all: readonly Provider[], lane: Lane): Provider[] =>
  all.filter(id => isUsProvider(id) === (lane === 'us'));

/**
 * The lane the current connection belongs to. A server-funded run (free tier or plan) is always in
 * the US lane, since the server funds nothing else; a run on the visitor's own key is in the lane of
 * the provider that key belongs to.
 */
export function laneOf(provider: Provider | undefined, inference: InferenceMode): Lane {
  if (inference === 'free' || inference === 'credits') return 'us';
  return isUsProvider(provider) ? 'us' : 'own';
}

export const LANE_LABEL: Record<Lane, string> = { us: 'US models', own: 'Other providers' };
