import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTH_KEY, checkPasscode, grant, isGranted, revoke } from '../src/lib/betaGate';
import { deriveBetaHash } from '../src/lib/betaHash.mjs';

describe('private beta gate', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('accepts exactly the configured passcode, and nothing when none is configured', async () => {
    const hash = await deriveBetaHash('open sesame');
    expect(await checkPasscode('open sesame', hash)).toBe(true);
    expect(await checkPasscode(' open sesame ', hash)).toBe(true);
    expect(await checkPasscode('open sesam', hash)).toBe(false);
    expect(await checkPasscode('open sesame', '')).toBe(false);
    expect(await checkPasscode('', hash)).toBe(false);
  });

  it('hashes rather than storing the passcode', async () => {
    const hash = await deriveBetaHash('open sesame');
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain('sesame');
  });

  it('records a grant under signal_forge_auth and clears it on lock', () => {
    const store = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
    expect(isGranted()).toBe(false);
    grant(); expect(store.get(AUTH_KEY)).toBe('granted'); expect(isGranted()).toBe(true);
    revoke(); expect(isGranted()).toBe(false);
  });
});
