import { describe, expect, it } from 'vitest';
import { isFresh, keyFingerprint } from '../src/lib/discovered';
import { defaultConnection, providers } from '../src/lib/providers';

describe('model lists', () => {
  it('a cached list belongs to the key that read it', () => {
    const entry = { models: [{ id: 'm', label: 'm' }], at: Date.now(), key: keyFingerprint('sk-account-one') };
    expect(isFresh(entry, Date.now(), keyFingerprint('sk-account-one'))).toBe(true);
    expect(isFresh(entry, Date.now(), keyFingerprint('sk-account-two'))).toBe(false);
    expect(keyFingerprint('sk-account-one')).not.toContain('sk-');
  });
  it('new connections allow a complete app in one reply, and Anthropic seeds are current', () => {
    expect(defaultConnection('anthropic').maxTokens).toBe(16384);
    expect(providers.anthropic.models).toContain('claude-sonnet-5-5');
    expect(providers.anthropic.models.some(m => /4-8|3-5|3\.5/.test(m))).toBe(false);
  });
});
