import { describe, expect, it } from 'vitest';
import { modelForStage, stageFamily, stageModelsFor } from '../src/lib/stageModels';

describe('stageFamily', () => {
  it('maps workflow stage types onto the three complementary families', () => {
    expect(stageFamily('planning')).toBe('plan');
    expect(stageFamily('design')).toBe('build');
    expect(stageFamily('research')).toBe('build');
    expect(stageFamily('review')).toBe('verify');
    expect(stageFamily('synthesis')).toBe('verify');
  });

  it('sends unknown stage types to the connection model unchanged', () => {
    expect(stageFamily('custom-stage')).toBe('single');
  });
});

describe('stageModelsFor', () => {
  const CANDIDATES = [
    'google/gemini-2.5-pro',            // pro → plan
    'qwen/qwen-2.5-coder-32b-instruct', // coder → build
    'google/gemini-2.5-flash',          // flash → verify
    'mistralai/mistral-large-2512',     // large → plan
  ];

  it('spreads funded candidates across the three families', () => {
    const models = stageModelsFor({ model: 'vendor/some-other-model' }, CANDIDATES);
    expect(models.plan).toBe('google/gemini-2.5-pro');
    expect(models.build).toBe('qwen/qwen-2.5-coder-32b-instruct');
    expect(models.verify).toBe('google/gemini-2.5-flash');
  });

  it('keeps the connection model when a family has no funded candidate', () => {
    const models = stageModelsFor({ model: 'vendor/one-model' }, ['google/gemini-2.5-flash']);
    expect(models.plan).toBe('vendor/one-model');
    expect(models.build).toBe('vendor/one-model');
    expect(models.verify).toBe('google/gemini-2.5-flash');
  });

  it('collapses to one-model behaviour when the candidate list is empty', () => {
    const models = stageModelsFor({ model: 'vendor/one-model' }, []);
    expect(models).toEqual({ plan: 'vendor/one-model', build: 'vendor/one-model', verify: 'vendor/one-model' });
  });

  it('prefers a candidate different from the connection model so the run is actually complementary', () => {
    // Two plan-family candidates; the connection itself runs one of them.
    const models = stageModelsFor({ model: 'google/gemini-2.5-pro' }, ['google/gemini-2.5-pro', 'mistralai/mistral-large-2512']);
    expect(models.plan).toBe('mistralai/mistral-large-2512');
  });

  it('falls back to the connection model when it is the only member of a family', () => {
    const models = stageModelsFor({ model: 'google/gemini-2.5-pro' }, ['google/gemini-2.5-pro']);
    expect(models.plan).toBe('google/gemini-2.5-pro');
  });

  it('classifies ids by what their names say they are for, not by their vendor', () => {
    const models = stageModelsFor({ model: 'x/other' }, [
      'thudm/glm-4-code',            // code → build
      'zhipu/glm-4-flash',           // flash → verify
      'deepseek-ai/deepseek-r1',     // r1 → plan
    ]);
    expect(models.plan).toBe('deepseek-ai/deepseek-r1');
    expect(models.build).toBe('thudm/glm-4-code');
    expect(models.verify).toBe('zhipu/glm-4-flash');
  });
});

describe('modelForStage', () => {
  const models = { plan: 'plan-model', build: 'build-model', verify: 'verify-model' };

  it('resolves each stage type to its family pick', () => {
    expect(modelForStage(models, 'planning', 'fallback')).toBe('plan-model');
    expect(modelForStage(models, 'research', 'fallback')).toBe('build-model');
    expect(modelForStage(models, 'review', 'fallback')).toBe('verify-model');
  });

  it('rides synthesis with the low-latency verify family (verify and write together)', () => {
    expect(modelForStage(models, 'synthesis', 'fallback')).toBe('verify-model');
  });

  it('keeps the connection model for a stage outside all families', () => {
    expect(modelForStage(models, 'custom', 'fallback')).toBe('fallback');
  });
});
