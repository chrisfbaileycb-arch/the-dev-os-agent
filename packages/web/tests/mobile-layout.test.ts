import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NARROW_VIEWPORT_QUERY, isNarrowViewport } from '../src/lib/viewport';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

afterEach(() => { vi.unstubAllGlobals(); });

describe('isNarrowViewport', () => {
  it('is true on a phone-sized viewport and false on a desktop one', () => {
    vi.stubGlobal('window', { matchMedia: (query: string) => ({ matches: query === NARROW_VIEWPORT_QUERY }) });
    expect(isNarrowViewport()).toBe(true);
    vi.stubGlobal('window', { matchMedia: () => ({ matches: false }) });
    expect(isNarrowViewport()).toBe(false);
  });
  it('is false where there is no window or no matchMedia, so those environments behave as before', () => {
    vi.stubGlobal('window', undefined);
    expect(isNarrowViewport()).toBe(false);
    vi.stubGlobal('window', {});
    expect(isNarrowViewport()).toBe(false);
  });
  it('uses the same breakpoint at which the stylesheet stacks the workspace', () => {
    const width = /\(max-width: (\d+)px\)/.exec(NARROW_VIEWPORT_QUERY)![1];
    expect(css).toMatch(new RegExp(`@media \\(max-width: ${width}px\\) \\{ \\.workspace, \\.workspace\\.with-preview \\{ grid-template-columns: minmax\\(0, 1fr\\)`));
  });
});

describe('phone layout', () => {
  it('opens the output panel by default only where it fits beside the chat', () => {
    // Open on a phone, the empty panel took half the screen and left the chat a ~90px sliver.
    expect(app).toMatch(/useState\(\(\) => !isNarrowViewport\(\)\)/);
  });
  it('keeps hidden file inputs 1px wide despite the generic input rule', () => {
    // `input:not([type=checkbox])` is (0,1,1) and beats `.sr-only` (0,1,0); without this override a
    // hidden file input is as wide as its container and makes the page scroll sideways on a phone.
    expect(css).toMatch(/input\.sr-only\[type\]\s*\{[^}]*width:\s*1px[^}]*padding:\s*0[^}]*border:\s*0/);
  });
});
