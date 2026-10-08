import { deriveBetaHash } from './betaHash.mjs';

// The private-beta gate's logic. What this is, stated plainly because it is easy to overestimate:
// a front-end curtain. It keeps the workspace from mounting until a passcode is entered, and it
// never ships the passcode itself (only a salted PBKDF2 hash, see vite.config.ts). It does not
// protect the server: /api answers anyone who calls it directly, and a visitor who sets the
// localStorage flag by hand walks straight past. Real access control belongs on the server.

export const AUTH_KEY = 'signal_forge_auth';
export const GRANTED = 'granted';

/** The hash this build was configured with; '' means no passcode was set, so nobody gets in. */
export const configuredHash = (): string => __BETA_ACCESS_HASH__;
export const usingDevFallback = (): boolean => __BETA_DEV_FALLBACK__;

export function isGranted(): boolean {
  try { return localStorage.getItem(AUTH_KEY) === GRANTED; } catch { return false; }
}
export function grant(): void { try { localStorage.setItem(AUTH_KEY, GRANTED); } catch { /* storage unavailable: access holds for this tab */ } }
export function revoke(): void { try { localStorage.removeItem(AUTH_KEY); } catch { /* storage unavailable */ } }

/** Whether `input` is the passcode this build was configured with. Constant-shape comparison of two hex digests. */
export async function checkPasscode(input: string, expected = configuredHash()): Promise<boolean> {
  if (!expected || !input.trim()) return false;
  const actual = await deriveBetaHash(input);
  if (actual.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < actual.length; i++) diff |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
