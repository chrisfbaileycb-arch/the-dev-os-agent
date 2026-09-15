import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react';

/**
 * A pointer-based divider that works with mouse, pen, and touch input. Width is reported as the
 * share of the two panes only; callers clamp it to their product's preferred range.
 */
export function usePaneResize(onResize: (percent: number) => void, min = 20, max = 80) {
  const dragging = useRef(false);
  const cleanup = () => {
    if (!dragging.current) return;
    dragging.current = false;
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', stop);
    window.removeEventListener('pointercancel', stop);
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
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };
  useEffect(() => cleanup, []);
  return { onPointerDown: start, 'aria-label': 'Resize chat and preview panels', role: 'separator' as const, tabIndex: 0 };
}
