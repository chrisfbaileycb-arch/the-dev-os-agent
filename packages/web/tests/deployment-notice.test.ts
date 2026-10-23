import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FREE_TIER_NOT_OFFERED, FREE_TIER_WARMING, deploymentNotice, freeLaneBlock, offlineDeployment, type Deployment } from '../src/lib/deployment';

// A server that answered /api/providers. `free.enabled` is what the server computed from its funded models.
const answered = (enabled: boolean): Deployment => ({ ...offlineDeployment, reachable: true, free: { ...offlineDeployment.free, enabled, models: enabled ? ['vendor/model'] : [] } });

describe('the notice shown after /api/providers answers', () => {
  it('says nothing when the deployment answered but funds no free models', () => {
    // A paid deployment that does not offer a free tier used to open every session with
    // "Public free tier warming up". Nothing is warming up, and the visitor cannot change it.
    expect(deploymentNotice(answered(false))).toBe('');
  });
  it('says nothing when the free tier is funded', () => {
    expect(deploymentNotice(answered(true))).toBe('');
  });
  it('still tells the visitor when the deployment could not be reached', () => {
    expect(deploymentNotice(offlineDeployment)).toMatch(/Could not reach this deployment/);
  });
});

describe('why a keyless send on the free lane is blocked', () => {
  it('lets the send through when the deployment funds free models', () => {
    expect(freeLaneBlock(answered(true))).toBeNull();
  });
  it('states plainly that no free models are available, instead of promising a warm-up', () => {
    const message = freeLaneBlock(answered(false));
    expect(message).toBe(FREE_TIER_NOT_OFFERED);
    expect(message).not.toMatch(/warming up/i);
    // The two ways forward the visitor actually has.
    expect(message).toMatch(/own key/);
    expect(message).toMatch(/plan access token/);
  });
  it('keeps the warming-up wording for a deployment that did not answer, which genuinely is waking', () => {
    expect(freeLaneBlock(offlineDeployment)).toBe(FREE_TIER_WARMING);
  });
});

describe('App wiring', () => {
  // App is too large to mount in a unit test, so pin the one thing that regressed: the load effect
  // and the send preflight go through the helpers rather than announcing the warming-up wording.
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
  it('does not announce the warming-up wording on load or from the free-lane preflight', () => {
    expect(app).toContain('setNotice(deploymentNotice(d))');
    expect(app).toContain('freeLaneBlock(deployment)');
    expect(app).not.toMatch(/setNotice\(FREE_TIER_WARMING\)/);
    expect(app).not.toMatch(/if \(!deployment\.free\.enabled\) return FREE_TIER_WARMING/);
  });
  it('keeps the warming-up wording for a failed server-funded request, which is the server\'s own message', () => {
    expect(app).toMatch(/isFreeTierWarming\(e\.code\)\) return FREE_TIER_WARMING/);
  });
});
