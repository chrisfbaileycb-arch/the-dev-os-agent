import { describe, expect, it } from 'vitest';
import { capabilityTier, preferredModel, rankChoices } from '../src/lib/modelChoices';

const c = (id: string, label = id) => ({ id, label });

describe('capabilityTier', () => {
  it.each([
    'command-r-plus-08-2024', 'command-a-03-2025', 'Qwen/Qwen2.5-Coder-32B-Instruct', 'mistral-large-latest',
    'anthropic/claude-3.5-sonnet', 'gpt-4o', 'gemini-2.5-pro', 'grok-4', 'deepseek/deepseek-r1', 'groq/llama-3.3-70b-versatile', 'openai/gpt-oss-120b',
  ])('%s is a flagship', id => expect(capabilityTier(id)).toBe(0));
  it.each([
    'ministral-8b-latest', 'meta-llama/llama-3.2-3b-instruct:free', 'gemini-2.5-flash', 'claude-haiku-4-5', 'gpt-4o-mini', 'o3-mini', 'Qwen/Qwen2.5-7B-Instruct', 'groq/llama-3.1-8b-instant', 'grok-code-fast-1',
  ])('%s is lightweight', id => expect(capabilityTier(id)).toBe(2));
  it.each(['gemini-3-flash-preview-free', 'gemini-2.0-flash-exp', 'gpt-3.5-turbo', 'k2.6-code-preview-free'])('%s is experimental', id => expect(capabilityTier(id)).toBe(3));
  it('leaves an unknown id in the standard tier', () => expect(capabilityTier('acme/house-model')).toBe(1));
  it('does not mistake MiniMax for a mini model', () => expect(capabilityTier('coding-minimax-m2.7-free')).not.toBe(2));
});

describe('rankChoices', () => {
  it('puts flagships first, lightweight after, experiments last, keeping order within a tier', () => {
    const ranked = rankChoices([c('gemini-2.0-flash-exp'), c('llama-3.2-3b'), c('mistral-large'), c('acme/model'), c('ministral-8b'), c('command-r-plus')]);
    expect(ranked.map(m => m.id)).toEqual(['mistral-large', 'command-r-plus', 'acme/model', 'llama-3.2-3b', 'ministral-8b', 'gemini-2.0-flash-exp']);
  });
});

describe('preferredModel', () => {
  it('lands on the flagship when the key reaches it, else the strongest reached', () => {
    expect(preferredModel([c('grok-3-mini'), c('grok-4')], 'grok-4')).toBe('grok-4');
    expect(preferredModel([c('llama-3.2-3b'), c('qwen2.5-coder:32b')], 'missing')).toBe('qwen2.5-coder:32b');
    expect(preferredModel([], 'x')).toBeUndefined();
  });
});

describe('capabilityTier word boundaries', () => {
  it('reads "gemini" as a name, not as "mini"', () => expect(capabilityTier('gemini-2.5-pro')).toBe(0));
});
