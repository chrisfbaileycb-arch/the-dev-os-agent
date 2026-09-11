import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const template = new URL('./service-worker.js', import.meta.url);
const STATIC_SHELL = ['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-192.png', 'icons/maskable-512.png'];

/**
 * Build the service worker source from the template and the emitted bundle.
 * The version hashes the shell list and the template, so any change to either
 * produces a new cache name and the old shell is purged on activation.
 */
export function buildShellWorker(bundleFiles) {
  const hashed = bundleFiles.filter((name) => /\.(js|css)$/.test(name)).sort();
  const shell = [...STATIC_SHELL, ...hashed];
  const source = readFileSync(template, 'utf8');
  const version = createHash('sha256').update(source).update(shell.join('\n')).digest('hex').slice(0, 12);
  return { version, shell, source: source.replace('__VERSION__', version).replace('__SHELL__', JSON.stringify(shell)) };
}
