// The one definition of how a private-beta passcode becomes the hash the bundle carries. Plain
// JavaScript over WebCrypto so the same function runs in vite.config.ts (Node, at build time), in
// the browser gate, and in the tests — three copies of a KDF is how they drift apart.

/** Fixed, public salt: it only makes precomputed tables useless, it is not a secret. */
export const BETA_SALT = 'signal-forge-os/private-beta/v1';
export const BETA_ITERATIONS = 210_000;
/** Used by `vite dev` only, when VITE_BETA_ACCESS_KEY is unset. Never used by a production build. */
export const BETA_DEV_PASSCODE = 'signal-forge-dev';

/** PBKDF2-SHA256 of the passcode, hex encoded. */
export async function deriveBetaHash(passcode) {
  const enc = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey('raw', enc.encode(String(passcode).trim()), 'PBKDF2', false, ['deriveBits']);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc.encode(BETA_SALT), iterations: BETA_ITERATIONS }, key, 256);
  return [...new Uint8Array(bits)].map(b => b.toString(16).padStart(2, '0')).join('');
}
