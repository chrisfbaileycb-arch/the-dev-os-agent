/**
 * The width at which styles.css stacks the workspace into a single column. The two must move
 * together: a viewport this narrow cannot hold the chat and the output panel side by side.
 */
export const NARROW_VIEWPORT_QUERY = '(max-width: 900px)';

/** Whether this viewport is phone-sized. False wherever matchMedia is unavailable, so nothing changes there. */
export function isNarrowViewport(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(NARROW_VIEWPORT_QUERY).matches;
}
