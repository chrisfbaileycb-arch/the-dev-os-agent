import { describe, expect, it } from 'vitest';
// @ts-expect-error the server registry is plain .mjs with no declaration file; only the two functions below are used.
import { backendProviders, isBackendProvider } from '../server/providerRegistry.mjs';
import { EXPERIMENT_LANE_PROVIDERS, US_LANE_PROVIDERS, isExperimentProvider, isUsProvider, laneOf, providersInLane } from '../src/lib/modelLanes';
import { providers, type Provider } from '../src/lib/providers';

describe('model lanes', () => {
  it('the browser\'s US list is exactly what the server\'s backend lane can route to', () => {
    expect([...US_LANE_PROVIDERS].sort()).toEqual((backendProviders() as string[]).sort());
    for (const id of US_LANE_PROVIDERS) expect(isBackendProvider(id)).toBe(true);
  });

  it('every provider the browser can talk to is in exactly one lane', () => {
    const all = Object.keys(providers) as Provider[];
    const us = providersInLane(all, 'us');
    const experiment = providersInLane(all, 'experiment');
    const own = providersInLane(all, 'own');
    expect([...us, ...experiment, ...own].sort()).toEqual([...all].sort());
    expect(us.sort()).toEqual([...US_LANE_PROVIDERS].sort());
    expect(experiment.sort()).toEqual([...EXPERIMENT_LANE_PROVIDERS].sort());
    for (const id of ['github', 'vercel', 'ollama', 'cohere', 'venice', 'xkiro', 'aihubmix', 'custom', 'cerebras', 'meta', 'nvidia'] as Provider[]) {
      expect(isUsProvider(id), id).toBe(false);
      expect(isExperimentProvider(id), id).toBe(false);
      expect(own).toContain(id);
    }
    expect(isExperimentProvider('openrouter')).toBe(true);
    expect(isExperimentProvider('huggingface')).toBe(true);
    expect(own).not.toContain('openrouter');
    expect(own).not.toContain('huggingface');
  });

  it('a server-funded run is always US; a key run follows its provider', () => {
    expect(laneOf('cheaper-inference', 'free')).toBe('us');
    expect(laneOf('groq', 'credits')).toBe('us');
    expect(laneOf('anthropic', 'byok')).toBe('us');
    expect(laneOf('openrouter', 'byok')).toBe('experiment');
    expect(laneOf('huggingface', 'byok')).toBe('experiment');
    expect(laneOf('ollama', 'byok')).toBe('own');
    expect(laneOf(undefined, 'byok')).toBe('own');
  });
});
