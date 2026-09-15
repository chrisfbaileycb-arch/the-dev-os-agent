import { describe, expect, it } from 'vitest';
import { DEFAULT_SPLIT_PERCENT, MAX_PANE_PERCENT, MIN_PANE_PERCENT, clampSplit, normalizeStoredSplit } from '../src/lib/split';
import { badgeFor, type Reach } from '../src/lib/availability';
import { emptyKeyring } from '../src/lib/providers';
import { findModel } from '../src/lib/catalog';
import type { FreeTier } from '../src/lib/store';

// The workspace split has one canonical ratio and two bounds, and both rules have to hold no
// matter which side asked: the drag handle writes ratios continuously, storage hands back whatever
// a previous build saved, and the Preview tab resets. A regression here shows up as a full-width
// pane — the layout this replaced — so it is worth pinning without a browser.

const freeTier = (models: string[]): FreeTier => ({ enabled: models.length > 0, models, providers: {}, monthlyCredits: 400, perHour: 0 });
const reach = (models: string[]): Reach => ({ free: freeTier(models), keys: emptyKeyring(), credits: false });

describe('workspace split bounds', () => {
  it('keeps a dragged ratio inside the range both panes stay usable in', () => {
    expect(clampSplit(50)).toBe(50);
    expect(clampSplit(0)).toBe(MIN_PANE_PERCENT);
    expect(clampSplit(100)).toBe(MAX_PANE_PERCENT);
    expect(clampSplit(-20)).toBe(MIN_PANE_PERCENT);
    expect(clampSplit(140)).toBe(MAX_PANE_PERCENT);
  });

  it('falls back to the canonical split rather than to a number it cannot use', () => {
    expect(clampSplit(Number.NaN)).toBe(DEFAULT_SPLIT_PERCENT);
    expect(clampSplit(Number.POSITIVE_INFINITY)).toBe(DEFAULT_SPLIT_PERCENT);
  });

  it('reads back a stored ratio, but never the full-width extremes the old presets saved', () => {
    // 0 and 100 were "Full Preview" and "Chat Only". They are still in returning visitors'
    // localStorage, and honouring them would reopen the app in exactly the state that was removed.
    expect(normalizeStoredSplit('30')).toBe(30);
    expect(normalizeStoredSplit('0')).toBe(DEFAULT_SPLIT_PERCENT);
    expect(normalizeStoredSplit('100')).toBe(DEFAULT_SPLIT_PERCENT);
    expect(normalizeStoredSplit('abc')).toBe(DEFAULT_SPLIT_PERCENT);
    expect(normalizeStoredSplit(null)).toBe(DEFAULT_SPLIT_PERCENT);
    expect(normalizeStoredSplit(undefined)).toBe(DEFAULT_SPLIT_PERCENT);
    expect(normalizeStoredSplit('10')).toBe(MIN_PANE_PERCENT);
    expect(normalizeStoredSplit('95')).toBe(MAX_PANE_PERCENT);
  });
});

describe('payment badge', () => {
  it('marks a deployment-funded model as included and everything else as BYOK', () => {
    const model = findModel('gpt-4o');
    expect(model).toBeDefined();
    expect(badgeFor(model!, reach([]))).toBe('byok');
    expect(badgeFor(model!, reach(['gpt-4o']))).toBe('included');
    // A funded list that is switched off is not funding: the badge must not promise it.
    const off: Reach = { ...reach(['gpt-4o']), free: { ...freeTier(['gpt-4o']), enabled: false } };
    expect(badgeFor(model!, off)).toBe('byok');
  });

  it('matches funded ids without caring how they were typed', () => {
    const model = findModel('meta-llama/Llama-3.1-8B-Instruct');
    expect(model).toBeDefined();
    expect(badgeFor(model!, reach(['meta-llama/llama-3.1-8b-instruct']))).toBe('included');
  });
});
