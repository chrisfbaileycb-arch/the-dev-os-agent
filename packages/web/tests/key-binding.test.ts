import { describe, expect, it } from 'vitest';
import { defaultConnection, emptyKeyring, requestConnection } from '../src/lib/providers';

describe('outbound key binding', () => {
  it('sends the key saved for the provider the request goes to, never another provider\'s', () => {
    const keys = { ...emptyKeyring(), anthropic: 'sk-ant-right', openrouter: 'sk-or-wrong' };
    // The connection still carries an OpenRouter key from before the visitor picked a Claude model.
    const c = { ...defaultConnection('anthropic'), token: 'sk-or-wrong', inference: 'byok' as const };
    expect(requestConnection(c, keys).token).toBe('sk-ant-right');
  });
  it('free and plan requests carry no visitor key', () => {
    const keys = { ...emptyKeyring(), anthropic: 'sk-ant-right' };
    expect(requestConnection({ ...defaultConnection('anthropic'), inference: 'free', token: 'x' }, keys).token).toBe('');
    expect(requestConnection({ ...defaultConnection('anthropic'), inference: 'credits', token: 'x' }, keys).token).toBe('');
  });
  it('a byok request never carries the plan token', () => {
    expect(requestConnection({ ...defaultConnection('groq'), inference: 'byok', serverAccessToken: 'plan' }).serverAccessToken).toBe('');
  });
});
