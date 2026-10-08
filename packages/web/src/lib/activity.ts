// "Is it writing, or is it just sitting there?"
//
// A spinner that turns forever cannot answer that: it spins just as happily while a provider has
// stalled. The hourglass in the UI therefore turns only while the reply is actually growing, and
// when no new text has arrived for STALL_AFTER_MS it stops and says how long it has been quiet.
// A model that is thinking before it writes looks the same as a stalled one from here, which is why
// the wording says "no new output" and does not claim to know which it is.

/** Quiet this long and the hourglass stops turning. Short enough to notice, long enough that the gaps between streamed chunks never trip it. */
export const STALL_AFTER_MS = 6000;

export const isStalled = (lastChangeAt: number, now: number): boolean => now - lastChangeAt >= STALL_AFTER_MS;

/** Whole seconds since the last new output, never negative. */
export const quietSeconds = (lastChangeAt: number, now: number): number => Math.max(0, Math.floor((now - lastChangeAt) / 1000));

/** The one-line status next to the hourglass. */
export function writingLabel(opts: { chars: number; code: boolean; stalled: boolean; quiet: number }): string {
  if (opts.stalled) return `No new output for ${opts.quiet}s — the model may be thinking, or the provider is slow`;
  if (opts.chars === 0) return 'Working…';
  return `${opts.code ? 'Writing code' : 'Writing'} · ${opts.chars.toLocaleString()} characters`;
}
