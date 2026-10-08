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

describe('labelled entries and filtering', () => {
  it('keeps a provider label and free flag when an entry carries them', async () => {
    const { modelChoices, filterChoices } = await import('../src/lib/modelChoices');
    const choices = modelChoices([{ id: 'x/y:free', label: 'Why', free: true }, 'plain-id', { id: 'text-embedding-3' }]);
    expect(choices).toEqual([{ id: 'x/y:free', label: 'Why', free: true }, { id: 'plain-id', label: 'plain-id' }]);
    expect(filterChoices(choices, 'WHY').map(c => c.id)).toEqual(['x/y:free']);
    expect(filterChoices(choices, 'plain id').map(c => c.id)).toEqual(['plain-id']);
    expect(filterChoices(choices, '')).toHaveLength(2);
  });
});

describe('model verification and section grouping', () => {
  it('differentiates verified operational models from unverified catalog entries', async () => {
    const { isVerifiedOperational } = await import('../src/lib/modelChoices');

    // Gemini models on Google BYOK
    expect(isVerifiedOperational('google', 'gemini-2.5-pro')).toBe(true);
    expect(isVerifiedOperational('google', 'gemini-2.5-flash')).toBe(true);
    expect(isVerifiedOperational('google', 'gemini-1.5-pro')).toBe(true);
    expect(isVerifiedOperational('google', 'gemini-3-flash-preview')).toBe(true);

    // Claude models on Anthropic BYOK
    expect(isVerifiedOperational('anthropic', 'claude-3-5-sonnet-20241022')).toBe(true);
    expect(isVerifiedOperational('anthropic', 'claude-sonnet-4-5')).toBe(true);
    expect(isVerifiedOperational('anthropic', 'claude-3-5-haiku-20241022')).toBe(true);

    // OpenAI flagships
    expect(isVerifiedOperational('openai', 'gpt-4o')).toBe(true);
    expect(isVerifiedOperational('openai', 'gpt-4o-mini')).toBe(true);
    expect(isVerifiedOperational('openai', 'o1')).toBe(true);
    expect(isVerifiedOperational('openai', 'o3-mini')).toBe(true);

    // Ollama local endpoints
    expect(isVerifiedOperational('ollama', 'llama3.2')).toBe(true);
    expect(isVerifiedOperational('ollama', 'qwen2.5-coder:7b')).toBe(true);

    // OpenRouter / gateways without verified flagship status
    expect(isVerifiedOperational('openrouter', 'community/custom-model')).toBe(false);
    expect(isVerifiedOperational('huggingface', 'meta-llama/Llama-3.1-8B-Instruct')).toBe(false);
  });

  it('assigns section and partitions choices into ready and extended sections', async () => {
    const { modelChoices, partitionChoices } = await import('../src/lib/modelChoices');

    const googleChoices = modelChoices(
      ['gemini-2.5-flash', 'gemini-2.5-pro', 'some-random-preview-model'],
      [],
      'google'
    );

    expect(googleChoices[0].verified).toBe(true);
    expect(googleChoices[0].section).toBe('ready');
    expect(googleChoices[1].verified).toBe(true);
    expect(googleChoices[1].section).toBe('ready');
    expect(googleChoices[2].verified).toBe(false);
    expect(googleChoices[2].section).toBe('extended');

    const partitioned = partitionChoices(googleChoices);
    expect(partitioned.ready.map(m => m.id)).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro']);
    expect(partitioned.extended.map(m => m.id)).toEqual(['some-random-preview-model']);
  });
});
