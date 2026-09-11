import { useSyncExternalStore } from 'react';

// Progressive web app wiring: install prompt capture, install state, online state,
// and shell worker registration. Everything here is optional; the app runs
// unchanged in a browser that offers none of it.

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

/** Call once before rendering so an early beforeinstallprompt is not missed. */
export function setupPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event as InstallPromptEvent; notify(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; notify(); });
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').catch(() => { /* The app works without the offline shell. */ }); });
  }
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt; if (!event) return 'unavailable';
  await event.prompt(); const { outcome } = await event.userChoice;
  if (outcome === 'accepted') deferredPrompt = null;
  notify(); return outcome;
}

export function isInstalled(): boolean { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches; }

/** True while the browser holds an install prompt this app may show. */
export function useInstallAvailable(): boolean { return useSyncExternalStore(subscribe, () => deferredPrompt !== null, () => false); }

const subscribeOnline = (fn: () => void) => { window.addEventListener('online', fn); window.addEventListener('offline', fn); return () => { window.removeEventListener('online', fn); window.removeEventListener('offline', fn); }; };
export function useOnline(): boolean { return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true); }
