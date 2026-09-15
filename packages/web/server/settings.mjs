import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { decryptAny, encrypt, isSealed } from './secrets.mjs';
import { PROVIDER_KEY_VARS, setAdminTiers } from './freetier.mjs';

// Dashboard-managed deployment settings: provider keys, free-tier knobs, and the model tiers.
//
// Until now every one of these was an environment variable, which meant "add a key" was a trip to
// the hosting dashboard and a restart, and "which models are free" was whatever the code and the
// gateway between them decided. This module lets the operator do both from inside the app: keys
// and knobs are stored in the workspace database (keys sealed, see secrets.mjs) and laid over the
// process environment, so everything downstream — funding decisions, discovery, the free-tier
// status the browser reads — keeps reading `env` exactly as before and simply sees the dashboard
// value first. A dashboard value wins over an environment variable for the same name; deleting it
// in the dashboard falls back to the environment again.
//
// The overlay is held in memory and refreshed on every write, so the proxy's per-request lookup
// is a spread and not a database round-trip. One process, one cache: this app runs as a single
// Node service, and a second instance would need a shared cache or a poll, neither of which is
// worth building for a deployment that does not exist yet.

export { PROVIDER_KEY_VARS };

/** Human names for the dashboard, and where each provider's key is entered by hand. */
export const PROVIDER_META = {
  openrouter: { name: 'OpenRouter', console: 'https://openrouter.ai/keys' },
  groq: { name: 'Groq', console: 'https://console.groq.com/keys' },
  openai: { name: 'OpenAI', console: 'https://platform.openai.com/api-keys' },
  anthropic: { name: 'Anthropic', console: 'https://console.anthropic.com/settings/keys' },
  google: { name: 'Google Gemini', console: 'https://aistudio.google.com/apikey' },
  cohere: { name: 'Cohere', console: 'https://dashboard.cohere.com/api-keys' },
  xkiro: { name: 'xKiro', console: 'https://xkiro.com' },
  aihubmix: { name: 'AIHubMix', console: 'https://aihubmix.com' },
  huggingface: { name: 'Hugging Face', console: 'https://huggingface.co/settings/tokens' },
  'cheaper-inference': { name: 'Managed inference', console: 'https://cheaperinference.com' },
  // OmniRoute is self-hosted, so there is no vendor console page to link to; the operator's own
  // dashboard is wherever they installed it, which only they know.
  omniroute: { name: 'OmniRoute', console: null },
  custom: { name: 'Custom endpoint', console: null },
};

/**
 * Settings that are not keys but still belong on the dashboard. Each is validated by kind so a
 * typo in a number field cannot set the burst cap to NaN and quietly open the tier.
 */
export const TUNABLES = {
  FREE_CREDIT_MONTHLY_POOL: { kind: 'number', min: 0, max: 10_000_000, label: 'Free credits per workspace per month' },
  FREE_MAX_PER_HOUR: { kind: 'number', min: 1, max: 100_000, label: 'Free requests per hour from one network' },
  FREE_MAX_OUTPUT_TOKENS: { kind: 'number', min: 64, max: 4096, label: 'Output cap on a free reply' },
  FREE_TIER_DISABLED: { kind: 'boolean', label: 'Free tier switched off' },
  FREE_TIER_ALLOW_FRONTIER: { kind: 'boolean', label: 'Allow frontier ids in the automatic free pool' },
  CREDIT_MONTHLY_POOL: { kind: 'number', min: 0, max: 100_000_000, label: 'Paid-plan credits per workspace per month' },
  SERVER_CREDIT_ACCESS_TOKEN: { kind: 'secret', label: 'Paid-plan access token' },
  SETTINGS_OWNER_API_KEY: { kind: 'secret', label: 'Owner key (funds the OpenRouter free pool)' },
};

const KEY_PREFIX = 'key:';
const TUNABLE_PREFIX = 'tunable:';
const TIERS_KEY = 'tiers';
const ADMIN_KEY = 'admin-token';
const SEAL_KEY = 'settings-seal';
const HEADER_SAFE = /^[\x20-\x7e]*$/;

/**
 * The admin password, stored as a scrypt hash so the database never holds something usable.
 *
 * The reason this exists: the dashboard used to be reachable only by setting ADMIN_TOKEN in the
 * hosting environment, which means that on a managed platform the person who owns the app has to
 * find the Render/Fly/Heroku dashboard and edit an environment variable before they can enter a
 * single provider key. On a goal of "let me put my OpenRouter key in", that is a wall, and it is
 * the wall the user hit: "there is no user admin page for me to enter the backend API keys".
 *
 * So the token is now set *from the page*, once, on a deployment that has no token yet, and the
 * environment variable becomes an override for operators who prefer it (and for automation). The
 * stored form is scrypt(token, salt) with the salt alongside, because a plaintext admin password
 * in a settings row is a worse secret than the provider keys this dashboard is protecting.
 */
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
export function hashAdminToken(token, salt = randomBytes(16).toString('hex')) {
  const hash = scryptSync(token, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }).toString('hex');
  return `scrypt$${salt}$${hash}`;
}
export function verifyAdminToken(token, stored) {
  if (typeof token !== 'string' || typeof stored !== 'string') return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash || !/^[0-9a-f]+$/.test(hash)) return false;
  let candidate;
  try { candidate = scryptSync(token, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }); }
  catch { return false; }
  const expected = Buffer.from(hash, 'hex');
  return expected.length === candidate.length && timingSafeEqual(expected, candidate);
}

/** The secrets that may seal or open stored keys, most preferred first. */
export function sealingSecrets(env = process.env) {
  return [env.SETTINGS_SECRET, env.SESSION_SECRET, env.ADMIN_TOKEN].filter(v => typeof v === 'string' && v.length >= 8);
}

/** Validate one tier entry from the dashboard; null drops it. */
function cleanTierEntry(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' ? raw.id.trim() : '';
  const provider = typeof raw.provider === 'string' ? raw.provider.trim() : '';
  if (!id || id.length > 200 || !Object.hasOwn(PROVIDER_KEY_VARS, provider)) return null;
  const label = typeof raw.label === 'string' && raw.label.trim() ? raw.label.trim().slice(0, 80) : undefined;
  return label ? { id, provider, label } : { id, provider };
}

/** The tier configuration as stored, or the empty automatic default. */
export function cleanTiers(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const list = value => (Array.isArray(value) ? value : []).map(cleanTierEntry).filter(Boolean).slice(0, 500);
  const free = list(source.free);
  const freeIds = new Set(free.map(m => m.id.toLowerCase()));
  // A model cannot be both free and paid; free wins, because the alternative charges for it.
  const paid = list(source.paid).filter(m => !freeIds.has(m.id.toLowerCase()));
  return { mode: source.mode === 'manual' ? 'manual' : 'auto', free, paid };
}

/** Validate a tunable value; throws with a message a person can act on. */
export function cleanTunable(name, value) {
  const spec = TUNABLES[name];
  if (!spec) throw new Error(`Unknown setting: ${String(name).slice(0, 40)}`);
  if (value === '' || value === null || value === undefined) return null;
  if (spec.kind === 'boolean') {
    if (value === true || value === 'true') return 'true';
    if (value === false || value === 'false') return 'false';
    throw new Error(`${name} must be true or false.`);
  }
  if (spec.kind === 'number') {
    const n = Number(value);
    if (!Number.isFinite(n) || n < spec.min || n > spec.max) throw new Error(`${name} must be a number between ${spec.min} and ${spec.max}.`);
    return String(Math.floor(n));
  }
  const text = String(value).trim();
  if (text.length > 8192 || !HEADER_SAFE.test(text)) throw new Error(`${name} contains a character that cannot go in a request header.`);
  return text;
}

/** The last four characters, which is enough to tell two keys apart and not enough to use one. */
export const hint = value => typeof value === 'string' && value.length >= 8 ? `…${value.slice(-4)}` : '';

/**
 * A dashboard key field may hold several keys, one per line.
 *
 * The free tier is funded from the operator's own accounts, so the thing that actually bounds how
 * much a deployment can give away is how many accounts it has. One field per provider that
 * accepts a stack of keys is the difference between "one Groq account's daily cap" and "as many as
 * the operator is willing to add", and it needs no extra UI beyond a textarea: the free router
 * cycles the pool, so a key that is rate-limited rolls over to the next instead of failing.
 *
 * Splitting on newlines (and commas, because people paste comma-separated lists) is deliberately
 * conservative: anything with a stray space inside is kept as typed, since header validation will
 * reject it later with a message naming the variable.
 */
export function keyPool(value) {
  if (typeof value !== 'string') return [];
  return [...new Set(value.split(/[\r\n,]+/).map(k => k.trim()).filter(Boolean))];
}
/** The single key everything downstream reads, so nothing outside the router needs to know. */
export const firstKey = value => keyPool(value)[0] ?? (typeof value === 'string' ? value.trim() : '');

export async function openSettings({ db, env = process.env, log = console.error } = {}) {
  const has = method => Boolean(db && typeof db[method] === 'function');
  // A database without a settings table (an older adapter, or none at all) degrades to an empty
  // overlay: the environment keeps working and the dashboard reports that it cannot persist.
  const persistent = has('getSetting') && has('setSetting') && has('deleteSetting') && has('allSettings');
  let rows = new Map();
  let overlayCache = {};
  let unreadable = new Set();
  let tiers = cleanTiers(null);
  let adminHash = '';
  let generatedSecret = '';

  async function reload() {
    rows = new Map();
    if (persistent) {
      try { for (const row of await db.allSettings()) rows.set(row.key, row.value); }
      catch (error) { log(`[settings] could not read stored settings: ${error?.message || error}`); }
    }
    rebuild();
  }

  /**
   * Every secret that may open a stored key: the operator's own first, then one generated here.
   *
   * The generated last resort is what makes first-run setup finish. Without it, a deployment with
   * no SETTINGS_SECRET, no SESSION_SECRET and no ADMIN_TOKEN can open the dashboard and set a
   * password, and then every key it saves fails with "set ADMIN_TOKEN so stored keys can be
   * encrypted" — the same dead end the setup path was introduced to remove. So a random secret is
   * minted once, stored beside the values it protects, and added to the end of the candidate list.
   * It is weaker than an operator-supplied secret (it lives where the ciphertext lives, so a
   * database leak exposes both) and that tradeoff is stated in the dashboard rather than hidden.
   */
  function secrets() {
    return [...sealingSecrets(env), generatedSecret].filter(v => typeof v === 'string' && v.length >= 8);
  }

  function rebuild() {
    const candidates = secrets();
    const next = {};
    unreadable = new Set();
    for (const [key, stored] of rows) {
      let name = null;
      if (key.startsWith(KEY_PREFIX)) name = PROVIDER_KEY_VARS[key.slice(KEY_PREFIX.length)];
      else if (key.startsWith(TUNABLE_PREFIX)) name = key.slice(TUNABLE_PREFIX.length);
      if (!name) continue;
      if (isSealed(stored)) {
        const plain = decryptAny(stored, candidates);
        if (plain === null) { unreadable.add(name); continue; }
        // A key cell may hold a pool of keys, one per line, so a deployment can spread free-tier
        // traffic across several accounts. Downstream code reads one key from `name`, so the first
        // is published there and the whole pool under `name + '_POOL'` for the router that cycles.
        next[name] = firstKey(plain);
        const pool = keyPool(plain);
        if (pool.length > 1) next[`${name}_POOL`] = pool;
      } else next[name] = stored;
    }
    overlayCache = next;
    tiers = cleanTiers(safeJson(rows.get(TIERS_KEY)));
    setAdminTiers(tiers);
    adminHash = rows.get(ADMIN_KEY) ?? '';
    generatedSecret = rows.get(SEAL_KEY) ?? '';
  }

  async function write(key, value, sealed) {
    if (!persistent) throw new Error('This deployment has no settings storage; set the value in the environment instead.');
    if (value === null) { await db.deleteSetting(key); rows.delete(key); }
    else {
      let stored = value;
      if (sealed) {
        // The operator's secret when there is one, otherwise a generated one minted on first use
        // and kept in the same table. See `secrets()` for why the weaker option exists at all.
        if (!sealingSecrets(env).length && !generatedSecret) {
          generatedSecret = randomBytes(32).toString('hex');
          await db.setSetting(SEAL_KEY, generatedSecret); rows.set(SEAL_KEY, generatedSecret);
        }
        const [secret] = secrets();
        if (!secret) throw new Error('No secret is available to encrypt stored keys with.');
        stored = encrypt(value, secret);
      }
      await db.setSetting(key, stored);
      rows.set(key, stored);
    }
    rebuild();
  }

  await reload();

  return {
    persistent,
    /** Dashboard values by environment-variable name. Never logged, never sent to a browser. */
    overlay: () => ({ ...overlayCache }),
    /** The environment as the rest of the server should read it: dashboard first, process second. */
    env: (base = env) => ({ ...base, ...overlayCache }),
    tiers: () => ({ mode: tiers.mode, free: tiers.free.map(m => ({ ...m })), paid: tiers.paid.map(m => ({ ...m })) }),
    /** Names whose stored value no secret currently opens; the dashboard asks for them again. */
    unreadable: () => [...unreadable],
    async setKey(provider, value) {
      if (!Object.hasOwn(PROVIDER_KEY_VARS, provider)) throw new Error('Unknown provider.');
      // A field may hold a pool (see keyPool), so the header-safe rule is applied per key rather
      // than to the whole block: one pasted key with a stray newline should name itself, not
      // reject the other four alongside it.
      const keys = keyPool(value);
      const bad = keys.filter(k => !HEADER_SAFE.test(k));
      if (bad.length) throw new Error(`Key ${keys.indexOf(bad[0]) + 1} contains a character that cannot go in a request header.`);
      await write(KEY_PREFIX + provider, keys.join('\n'), true);
    },
    async deleteKey(provider) {
      if (!Object.hasOwn(PROVIDER_KEY_VARS, provider)) throw new Error('Unknown provider.');
      await write(KEY_PREFIX + provider, null, true);
    },
    async setTunable(name, value) {
      const clean = cleanTunable(name, value);
      await write(TUNABLE_PREFIX + name, clean, TUNABLES[name].kind === 'secret');
    },
    async setTiers(raw) {
      const clean = cleanTiers(raw);
      await write(TIERS_KEY, JSON.stringify(clean), false);
      return this.tiers();
    },
    /**
     * Whether a dashboard password has been set from the page (not from the environment). The
     * environment variable is checked by admin.mjs, which owns that precedence rule.
     */
    adminConfigured: () => Boolean(adminHash),
    /**
     * What the session cookie is signed with when the password lives here rather than in the
     * environment: the stored scrypt hash. It is unique per password, never leaves the server, and
     * cannot be guessed from the source, which is what makes the cookie unforgeable. See
     * `sessionEnv()` in admin.mjs. Empty when no password is stored, never the raw password.
     */
    adminSessionSecret: () => adminHash,
    /** Set (or replace) the dashboard password. Stored as a scrypt hash, never in the clear. */
    async setAdminToken(token) {
      const text = String(token ?? '').trim();
      if (text.length < 12) throw new Error('Choose a dashboard password of at least 12 characters.');
      if (!HEADER_SAFE.test(text)) throw new Error('The password contains a character that cannot go in a request header.');
      await write(ADMIN_KEY, hashAdminToken(text), false);
    },
    /** Check a password typed at the sign-in form against the stored hash. */
    checkAdminToken: token => verifyAdminToken(token, adminHash),
    /**
     * What the dashboard shows for each provider: where the effective key comes from and a hint
     * of which key it is. The key itself never leaves the server.
     */
    keyStatus(base = env) {
      const effective = { ...base, ...overlayCache };
      return Object.entries(PROVIDER_KEY_VARS).map(([provider, name]) => {
        const stored = rows.has(KEY_PREFIX + provider);
        const pool = Array.isArray(effective[`${name}_POOL`]) ? effective[`${name}_POOL`] : [];
        const value = typeof effective[name] === 'string' ? effective[name].trim() : '';
        const source = stored && overlayCache[name] ? 'dashboard' : value ? 'environment' : 'none';
        // A pool of one reads as a plain key; more than one says how many, so an operator can see
        // the rotation depth they configured without the values ever leaving the server.
        const count = pool.length || (value ? 1 : 0);
        const shape = count > 1 ? `${count} keys` : value ? hint(value) : '';
        return { provider, name: PROVIDER_META[provider]?.name ?? provider, env: name, console: PROVIDER_META[provider]?.console ?? null, source, hint: shape, count, unreadable: unreadable.has(name) };
      });
    },
    tunableStatus(base = env) {
      const effective = { ...base, ...overlayCache };
      return Object.entries(TUNABLES).map(([name, spec]) => {
        const stored = rows.has(TUNABLE_PREFIX + name);
        const value = typeof effective[name] === 'string' ? effective[name] : '';
        const source = stored && name in overlayCache ? 'dashboard' : value ? 'environment' : 'none';
        return { name, kind: spec.kind, label: spec.label, source, value: spec.kind === 'secret' ? (value ? hint(value) : '') : value, unreadable: unreadable.has(name) };
      });
    },
    reload,
  };
}

function safeJson(text) { try { return text ? JSON.parse(text) : null; } catch { return null; } }
