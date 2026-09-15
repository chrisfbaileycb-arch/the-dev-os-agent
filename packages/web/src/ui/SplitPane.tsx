import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_SPLIT_PERCENT, MAX_PANE_PERCENT, MIN_PANE_PERCENT } from '../lib/split';

/**
 * The divider between the chat and the preview.
 *
 * Pointer events rather than mouse events, so a drag works with a mouse, a pen, or a thumb; the
 * width is reported as the share of the two panes only, and the caller clamps it. `onDragChange`
 * exists for one reason: the panes animate their widths, and an animation that fights every
 * pointermove sample is the difference between a smooth drag and a rubber band, so the workspace
 * turns its transition off for exactly as long as a drag lasts.
 *
 * The separator is focusable and answers the arrow keys, because a divider only a mouse can move
 * is a divider half the people using it cannot move at all.
 */
export interface PaneResizeOptions {
  /** Narrowest the left pane may become, as a percentage. */
  min?: number;
  /** Widest the left pane may become, as a percentage. */
  max?: number;
  /** Called when a drag starts and stops, so the caller can suppress layout transitions. */
  onDragChange?: (dragging: boolean) => void;
}

const KEYBOARD_STEP = 2;

export function usePaneResize(onResize: (percent: number) => void, options: PaneResizeOptions = {}) {
  const { min = MIN_PANE_PERCENT, max = MAX_PANE_PERCENT, onDragChange } = options;
  const dragging = useRef(false);
  // Kept in a ref so the listeners registered on the first pointerdown always call the latest
  // callback, rather than the one captured when the drag began.
  const notify = useRef(onDragChange);
  notify.current = onDragChange;

  const cleanup = () => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
    notify.current?.(false);
  };
  const move = (event: PointerEvent) => {
    if (!dragging.current) return;
    const divider = document.querySelector('[data-pane-divider]');
    const canvas = divider?.previousElementSibling;
    const preview = divider?.nextElementSibling;
    if (!(canvas instanceof HTMLElement) || !(preview instanceof HTMLElement)) return;
    const left = canvas.getBoundingClientRect();
    const right = preview.getBoundingClientRect();
    const available = left.width + right.width;
    if (available <= 0) return;
    onResize(Math.max(min, Math.min(max, ((event.clientX - left.left) / available) * 100)));
  };
  const stop = () => cleanup();
  const start = (event: ReactPointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    dragging.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    notify.current?.(true);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
  const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    const step = event.key === 'ArrowLeft' ? -KEYBOARD_STEP : event.key === 'ArrowRight' ? KEYBOARD_STEP : 0;
    // Home is the escape hatch back to the canonical layout, matching the Preview tab.
    if (!step && event.key !== 'Home') return;
    event.preventDefault();
    if (event.key === 'Home') { onResize(DEFAULT_SPLIT_PERCENT); return; }
    const divider = document.querySelector('[data-pane-divider]');
    const canvas = divider?.previousElementSibling;
    const preview = divider?.nextElementSibling;
    if (!(canvas instanceof HTMLElement) || !(preview instanceof HTMLElement)) return;
    const available = canvas.getBoundingClientRect().width + preview.getBoundingClientRect().width;
    if (available <= 0) return;
    const current = (canvas.getBoundingClientRect().width / available) * 100;
    onResize(Math.max(min, Math.min(max, current + step)));
  };
  useEffect(() => cleanup, []);
  return { onPointerDown: start, onKeyDown, 'aria-label': 'Resize chat and preview panels', role: 'separator' as const, tabIndex: 0 };
}
