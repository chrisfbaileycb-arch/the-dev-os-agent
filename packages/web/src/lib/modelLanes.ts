import type { InferenceMode } from './catalog';
import type { Provider } from './providers';

// Three groups in the model menu.
//
//   us          Shield chat providers the operator connects, and that a visitor may bring a key for.
//   experiment  OpenRouter and Hugging Face. Your key. Not the free tier. Not Shield.
//   own         A model running on this machine, plus any other bring-your-own-key provider.
//
// The US list mirrors backendProviders() in server/providerRegistry.mjs.

export type Lane = 'us' | 'own' | 'experiment';

export const US_LANE_PROVIDERS: readonly Provider[] = ['openai', 'anthropic', 'google', 'groq', 'xai'];
export const EXPERIMENT_LANE_PROVIDERS: readonly Provider[] = ['openrouter', 'huggingface'];
export const EXPERIMENT_SUBTITLE = 'Your key. May route outside the US. Not the free tier.';

export const isUsProvider = (provider: Provider | string | undefined): boolean =>
  US_LANE_PROVIDERS.includes(provider as Provider);

export const isExperimentProvider = (provider: Provider | string | undefined): boolean =>
  EXPERIMENT_LANE_PROVIDERS.includes(provider as Provider);

export const providersInLane = (all: readonly Provider[], lane: Lane): Provider[] =>
  all.filter(id => {
    if (lane === 'us') return isUsProvider(id);
    if (lane === 'experiment') return isExperimentProvider(id);
    return !isUsProvider(id) && !isExperimentProvider(id);
  });

/**
 * The lane the current connection belongs to. A server-funded run is always in the US lane.
 * A key run follows its provider. OpenRouter and Hugging Face are the experiment group.
 */
export function laneOf(provider: Provider | undefined, inference: InferenceMode): Lane {
  if (inference === 'free' || inference === 'credits') return 'us';
  if (isExperimentProvider(provider)) return 'experiment';
  return isUsProvider(provider) ? 'us' : 'own';
}

export const LANE_LABEL: Record<Lane, string> = { us: 'Models', own: 'On this machine', experiment: 'Experiment' };
