import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEMES, applyTheme, isThemeChoice, loadTheme, saveTheme } from '../src/lib/theme';

// The palette module owns one decision — which of the four surfaces is on — and the tests below are
// about the two ways that decision can go wrong: a stored value the build no longer knows, and a
// write that is not actually reflected on the document.
//
// These run in the node environment with a stub in place of the DOM, the same way the storage tests
// do: the module's contract is "write this attribute, drop it for system, and never throw", and a
// fake document is enough to hold it to all three without a headless browser.

afterEach(() => vi.unstubAllGlobals());

/** A document that records attribute writes and can carry a theme-color meta, like a browser's. */
function fakeDocument(meta: { content: string } | null = null) {
  const attrs = new Map<string, string>();
  const documentElement = {
    setAttribute: (k: string, v: string) => attrs.set(k, v),
    removeAttribute: (k: string) => attrs.delete(k),
    getAttribute: (k: string) => attrs.get(k) ?? null,
    hasAttribute: (k: string) => attrs.has(k),
  };
  const node = { setAttribute: (k: string, v: string) => { if (k === 'content' && meta) meta.content = v; } };
  return { documentElement, querySelector: (selector: string) => (meta && selector === 'meta[name="theme-color"]' ? node : null) } as unknown as Document;
}

/**
 * The module is browser-only — it writes to `document` and `localStorage` — so the runner's missing
 * DOM is supplied here rather than guarded against in the source. `saveTheme` in particular paints
 * without being handed a document, so the stub has to be global.
 */
function stubDom(meta: { content: string } | null = null) {
  const doc = fakeDocument(meta);
  vi.stubGlobal('document', doc);
  return doc;
}

/** A mutable stand-in for localStorage, as used by the browser-key storage tests. */
function fakeStorage() {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => values.set(k, v), removeItem: (k: string) => values.delete(k), clear: () => values.clear() });
  return values;
}

describe('the palette list', () => {
  it('offers the four surfaces the visitor was promised, each with a distinct id', () => {
    expect(THEMES.map(t => t.id)).toEqual(['sand', 'pastel', 'light', 'dark']);
    expect(new Set(THEMES.map(t => t.id)).size).toBe(4);
  });

  it('gives every palette three swatch colours and a description', () => {
    for (const theme of THEMES) {
      expect(theme.swatch).toHaveLength(3);
      expect(theme.swatch.every(c => /^#[0-9a-f]{6}$/i.test(c))).toBe(true);
      expect(theme.label.length).toBeGreaterThan(0);
      expect(theme.blurb.length).toBeGreaterThan(0);
    }
  });

  it('refuses a value it does not know rather than storing and ignoring it', () => {
    expect(isThemeChoice('sand')).toBe(true);
    expect(isThemeChoice('system')).toBe(true);
    // A palette name from a future build, or a stale one, must not be treated as valid.
    expect(isThemeChoice('midnight')).toBe(false);
    expect(isThemeChoice('')).toBe(false);
    expect(isThemeChoice(null)).toBe(false);
    expect(saveTheme('midnight' as never)).toBe(false);
  });
});

describe('applying a choice', () => {
  it('writes the palette as an attribute, and removes it for "system"', () => {
    const doc = stubDom();
    applyTheme('sand', doc);
    expect(doc.documentElement.getAttribute('data-theme')).toBe('sand');
    applyTheme('dark', doc);
    expect(doc.documentElement.getAttribute('data-theme')).toBe('dark');
    // "system" is the absence of a choice: the stylesheet's media query decides, so the attribute
    // must come off rather than being set to a fifth value.
    applyTheme('system', doc);
    expect(doc.documentElement.hasAttribute('data-theme')).toBe(false);
  });

  it('keeps the browser chrome in step with the surface', () => {
    const meta = { content: '' };
    stubDom(meta);
    applyTheme('sand');
    expect(meta.content).toBe('#fbf5e9');
    applyTheme('dark');
    expect(meta.content).toBe('#161a2b');
    // With no meta tag present this must not throw — a host page may not have one.
    expect(() => applyTheme('pastel', fakeDocument())).not.toThrow();
  });
});

describe('stored choice', () => {
  it('round-trips through storage and falls back to system', () => {
    const values = fakeStorage();
    stubDom();
    expect(loadTheme()).toBe('system');
    expect(saveTheme('pastel')).toBe(true);
    expect(values.get('hb-theme')).toBe('pastel');
    expect(loadTheme()).toBe('pastel');
    // Something else wrote a value this build does not know; the visitor gets the default.
    values.set('hb-theme', 'chartreuse');
    expect(loadTheme()).toBe('system');
  });

  it('still applies a valid choice when storage throws', () => {
    vi.stubGlobal('localStorage', { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } });
    const doc = stubDom();
    expect(loadTheme()).toBe('system');
    // A refused write must not report failure for a choice that was applied to this tab.
    expect(saveTheme('sand')).toBe(true);
    expect(doc.documentElement.getAttribute('data-theme')).toBe('sand');
  });
});