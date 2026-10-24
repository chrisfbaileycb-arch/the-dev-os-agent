import { afterEach, expect, it, vi } from 'vitest';
import { availableServiceWorker, applyUpdate } from '../src/pwa';
afterEach(() => vi.unstubAllGlobals());

it('treats a throwing service worker getter as unavailable in an opaque preview', () => {
  vi.stubGlobal('navigator', { get serviceWorker() { throw new DOMException('Sandboxed context', 'SecurityError'); } });
  expect(availableServiceWorker()).toBeUndefined();
  expect(() => applyUpdate()).not.toThrow();
});

it('retains the native worker container on a supported origin', () => {
  const container = { controller: null };
  vi.stubGlobal('navigator', { serviceWorker: container });
  expect(availableServiceWorker()).toBe(container);
});
