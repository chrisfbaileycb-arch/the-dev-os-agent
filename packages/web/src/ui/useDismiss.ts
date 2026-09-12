import { useEffect } from 'react';

/**
 * Close an open dialog on Escape.
 *
 * Every overlay here is `role="dialog" aria-modal="true"`, and a modal dialog is expected to
 * dismiss on Escape — keyboard users reach for it before they reach for the close button, and
 * on a phone the backdrop is often too narrow to tap reliably. Only the topmost listener acts,
 * because each dialog only subscribes while it is open.
 */
export function useDismiss(open: boolean, close: () => void): void {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, close]);
}
