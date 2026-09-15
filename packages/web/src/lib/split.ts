// The workspace split: the conversation on the left, the live preview on the right.
//
// The panel used to offer four preset ratios, and the two extremes collapsed a side entirely —
// so "Preview Focus" and "Full Preview" pushed the preview to a full-width takeover, which is not
// a preview at all. There is now one canonical layout, half and half, and a divider the visitor can
// drag between the bounds below when they want a specific balance. Nothing this module returns can
// produce a full-width pane, which is why the clamp lives here rather than in the component: the
// App holds the state, the divider writes to it, and both read the same rule.

/** The narrowest either pane may become. Below this the preview is unusable and chat unreadable. */
export const MIN_PANE_PERCENT = 20;
export const MAX_PANE_PERCENT = 100 - MIN_PANE_PERCENT;
/** The canonical layout, and the ratio every reset returns to: chat and preview take half each. */
export const DEFAULT_SPLIT_PERCENT = 50;

/** Force a ratio into the range both panes stay usable in. A non-number falls back to the default. */
export function clampSplit(percent: number): number {
  if (!Number.isFinite(percent)) return DEFAULT_SPLIT_PERCENT;
  return Math.min(MAX_PANE_PERCENT, Math.max(MIN_PANE_PERCENT, percent));
}

/**
 * A ratio recovered from storage, normalised rather than trusted.
 *
 * The previous build persisted 0 and 100 for its "Full Preview" and "Chat Only" presets, and a
 * returning visitor still has one of those in localStorage. Reading it verbatim would reopen the
 * app in exactly the full-width state this module exists to prevent, so a stored extreme is read
 * as the canonical split rather than clamped to the edge — a 20% chat pane is a different layout,
 * not the one they asked for, and what they asked for no longer exists.
 */
export function normalizeStoredSplit(raw: unknown): number {
  const value = typeof raw === 'string' ? Number(raw) : typeof raw === 'number' ? raw : Number.NaN;
  if (!Number.isFinite(value)) return DEFAULT_SPLIT_PERCENT;
  if (value <= 0 || value >= 100) return DEFAULT_SPLIT_PERCENT;
  return clampSplit(value);
}
