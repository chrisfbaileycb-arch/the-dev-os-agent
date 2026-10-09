import { useSyncExternalStore } from 'react';

// Progressive web app wiring: install prompt capture, install state, online state,
// and shell worker registration. Everything here is optional; the app runs
// unchanged in a browser that offers none of it.

type InstallPromptEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> };
let deferredPrompt: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach(fn => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

let updateWaiting = false;
const updateListeners = new Set<() => void>();
const notifyUpdate = () => updateListeners.forEach(fn => fn());

/** Ask the browser to keep this origin's storage. Best-effort; a refusal changes nothing. */
export function requestPersistentStorage(): void {
  const persist = navigator.storage?.persist;
  if (persist) void persist.call(navigator.storage).catch(() => { /* the app still works if the browser declines */ });
}

function watchUpdates(reg: ServiceWorkerRegistration): void {
  const track = (worker: ServiceWorker | null) => {
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) { updateWaiting = true; notifyUpdate(); }
    });
  };
  if (reg.waiting && navigator.serviceWorker.controller) { updateWaiting = true; notifyUpdate(); }
  reg.addEventListener('updatefound', () => track(reg.installing));
}

/** Call once before rendering so an early beforeinstallprompt is not missed. */
export function setupPwa(): void {
  if (typeof window === 'undefined') return;
  window.addEventListener('beforeinstallprompt', event => { event.preventDefault(); deferredPrompt = event as InstallPromptEvent; notify(); });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; notify(); requestPersistentStorage(); });
  if (isInstalled()) requestPersistentStorage();
  if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('./sw.js').then(watchUpdates).catch(() => { /* The app works without the offline shell. */ }); });
  }
}

export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const event = deferredPrompt; if (!event) return 'unavailable';
  await event.prompt(); const { outcome } = await event.userChoice;
  if (outcome === 'accepted') { deferredPrompt = null; requestPersistentStorage(); }
  notify(); return outcome;
}

export function isInstalled(): boolean { return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(display-mode: standalone)').matches; }

/** True while the browser holds an install prompt this app may show. */
export function useInstallAvailable(): boolean { return useSyncExternalStore(subscribe, () => deferredPrompt !== null, () => false); }

/** True once, when a new shell worker is waiting. Applying it is the visitor's choice. */
export function useUpdateReady(): boolean { return useSyncExternalStore(fn => { updateListeners.add(fn); return () => { updateListeners.delete(fn); }; }, () => updateWaiting, () => false); }

/** Activate the waiting worker and reload once. Further checks do not nag. */
export function applyUpdate(): void {
  let reloaded = false;
  navigator.serviceWorker?.addEventListener('controllerchange', () => { if (reloaded) return; reloaded = true; location.reload(); });
  void navigator.serviceWorker?.getRegistration().then(reg => reg?.waiting?.postMessage('skip-waiting'));
  updateWaiting = false;
  notifyUpdate();
}

const subscribeOnline = (fn: () => void) => { window.addEventListener('online', fn); window.addEventListener('offline', fn); return () => { window.removeEventListener('online', fn); window.removeEventListener('offline', fn); }; };
export function useOnline(): boolean { return useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true); }
