import { describe, expect, it } from 'vitest';
import { defaultModel, isChatModel, labelFor, modelChoices } from '../src/lib/modelChoices';

describe('isChatModel', () => {
  it('keeps ordinary chat model ids', () => {
    expect(isChatModel('mistralai/mistral-large-2512')).toBe(true);
    expect(isChatModel('openai/gpt-5.3-codex-spark')).toBe(true);
    expect(isChatModel('claude-sonnet-4-5')).toBe(true);
  });
  it('filters embeddings, speech, moderation, and image models', () => {
    expect(isChatModel('text-embedding-3-small')).toBe(false);
    expect(isChatModel('mistralai/mistral-embed')).toBe(false);
    expect(isChatModel('whisper-1')).toBe(false);
    expect(isChatModel('tts-1-hd')).toBe(false);
    expect(isChatModel('omni-moderation-latest')).toBe(false);
    expect(isChatModel('dall-e-3')).toBe(false);
  });
  it('errs toward keeping an unknown id rather than hiding a working model', () => {
    expect(isChatModel('some-unknown-model-v2')).toBe(true);
  });
});

describe('labelFor', () => {
  it('prefers the gateway label, then the catalog label, then the raw id', () => {
    const gateway = [{ id: 'mistralai/mistral-large-2512', label: 'Mistral Large 3' }];
    expect(labelFor('mistralai/mistral-large-2512', gateway)).toBe('Mistral Large 3');
    expect(labelFor('openai/gpt-4o', gateway)).toBe('GPT-4o'); // compiled catalog label
    expect(labelFor('unknown/model-id', gateway)).toBe('unknown/model-id');
  });
});

describe('modelChoices', () => {
  it('filters and labels a discovered list', () => {
    const discovered = ['mistralai/mistral-large-2512', 'text-embedding-3-small', 'weird/tiny-model'];
    const gateway = [{ id: 'mistralai/mistral-large-2512', label: 'Mistral Large 3' }];
    expect(modelChoices(discovered, gateway)).toEqual([
      { id: 'mistralai/mistral-large-2512', label: 'Mistral Large 3' },
      { id: 'weird/tiny-model', label: 'weird/tiny-model' },
    ]);
  });
});

describe('defaultModel', () => {
  const discovered = ['a/big-model', 'b/free-model', 'c/other-model'];
  const freeModels = ['b/free-model'];

  it('keeps the current model when the provider still serves it', () => {
    expect(defaultModel('c/other-model', discovered, freeModels)).toBe('c/other-model');
  });
  it('prefers a free-tier funded model when the current one is gone', () => {
    expect(defaultModel('z/gone-model', discovered, freeModels)).toBe('b/free-model');
  });
  it('falls back to the first discovered model when nothing is free', () => {
    expect(defaultModel(undefined, discovered, [])).toBe('a/big-model');
  });
  it('defaults to nothing when discovery found nothing', () => {
    expect(defaultModel('anything', [], [])).toBeUndefined();
  });
});
