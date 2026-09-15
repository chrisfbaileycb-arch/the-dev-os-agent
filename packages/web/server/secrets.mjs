import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

// Encryption at rest for the provider keys the operator enters in the admin dashboard.
//
// A key pasted into a dashboard field lands in the workspace database, and that database is a
// Postgres instance or a SQLite file that outlives any one process — the one place a secret
// would sit in the clear if it were written as typed. So it is sealed with AES-256-GCM under a
// key derived from a secret the environment already holds, and the database only ever sees the
// ciphertext. The format is versioned so it can change later without orphaning what is stored.
//
// The derivation deliberately accepts several candidate secrets on the way back out: an operator
// who added SESSION_SECRET after their keys were sealed under ADMIN_TOKEN should not find every
// key unreadable. Whichever secret opens a value is the right one; the dashboard reseals under
// the current first choice on the next save.

const VERSION = 'v1';

/** A 32-byte key from a passphrase-like secret. Not a password KDF: the input is already high-entropy. */
function deriveKey(secret) {
  return createHash('sha256').update(`hey-buddy-settings:${secret}`).digest();
}

export function encrypt(plain, secret) {
  if (typeof secret !== 'string' || !secret) throw new Error('An encryption secret is required.');
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', deriveKey(secret), iv);
  const body = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
}

/** The plaintext, or null when the value is not one of ours or the secret does not open it. */
export function decrypt(sealed, secret) {
  if (typeof sealed !== 'string' || typeof secret !== 'string' || !secret) return null;
  const [version, iv, tag, body] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || !body) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', deriveKey(secret), Buffer.from(iv, 'base64'));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
  } catch { return null; }
}

/** Try each candidate secret in order; the first that opens the value wins. */
export function decryptAny(sealed, secrets) {
  for (const secret of secrets) {
    const plain = decrypt(sealed, secret);
    if (plain !== null) return plain;
  }
  return null;
}

/** Whether a stored value is sealed at all, as opposed to a plain setting. */
export const isSealed = value => typeof value === 'string' && value.startsWith(`${VERSION}:`);
