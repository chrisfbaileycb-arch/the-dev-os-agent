import type { InferenceMode } from './catalog';
import type { Provider } from './providers';

// The two model dropdowns on the dock.
//
//   us   The seven providers the operator connects, and that a visitor may bring a key for:
//        OpenAI, Anthropic, Google, Hugging Face, Groq, NVIDIA, and xAI.
//        Free and plan models live here too.
//   own  A model running on this machine. Nothing else is a key slot.
//
// The US list mirrors backendProviders() in server/providerRegistry.mjs. tests/model-lanes.test.ts
// asserts the two lists agree.

export type Lane = 'us' | 'own';

export const US_LANE_PROVIDERS: readonly Provider[] = ['openai', 'anthropic', 'google', 'huggingface', 'groq', 'nvidia', 'xai'];

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

export const LANE_LABEL: Record<Lane, string> = { us: 'Models', own: 'On this machine' };
