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
const HEADER_SAFE = /^[\x20-\x7e]*$/;

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

export async function openSettings({ db, env = process.env, log = console.error } = {}) {
  const has = method => Boolean(db && typeof db[method] === 'function');
  // A database without a settings table (an older adapter, or none at all) degrades to an empty
  // overlay: the environment keeps working and the dashboard reports that it cannot persist.
  const persistent = has('getSetting') && has('setSetting') && has('deleteSetting') && has('allSettings');
  let rows = new Map();
  let overlayCache = {};
  let unreadable = new Set();
  let tiers = cleanTiers(null);

  async function reload() {
    rows = new Map();
    if (persistent) {
      try { for (const row of await db.allSettings()) rows.set(row.key, row.value); }
      catch (error) { log(`[settings] could not read stored settings: ${error?.message || error}`); }
    }
    rebuild();
  }

  function rebuild() {
    const secrets = sealingSecrets(env);
    const next = {};
    unreadable = new Set();
    for (const [key, stored] of rows) {
      let name = null;
      if (key.startsWith(KEY_PREFIX)) name = PROVIDER_KEY_VARS[key.slice(KEY_PREFIX.length)];
      else if (key.startsWith(TUNABLE_PREFIX)) name = key.slice(TUNABLE_PREFIX.length);
      if (!name) continue;
      if (isSealed(stored)) {
        const plain = decryptAny(stored, secrets);
        if (plain === null) { unreadable.add(name); continue; }
        next[name] = plain;
      } else next[name] = stored;
    }
    overlayCache = next;
    tiers = cleanTiers(safeJson(rows.get(TIERS_KEY)));
    setAdminTiers(tiers);
  }

  async function write(key, value, sealed) {
    if (!persistent) throw new Error('This deployment has no settings storage; set the value in the environment instead.');
    if (value === null) { await db.deleteSetting(key); rows.delete(key); }
    else {
      let stored = value;
      if (sealed) {
        const [secret] = sealingSecrets(env);
        if (!secret) throw new Error('Set ADMIN_TOKEN (or SETTINGS_SECRET) so stored keys can be encrypted.');
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
      const text = cleanTunable('SERVER_CREDIT_ACCESS_TOKEN', value); // same shape rule: header-safe text
      await write(KEY_PREFIX + provider, text, true);
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
     * What the dashboard shows for each provider: where the effective key comes from and a hint
     * of which key it is. The key itself never leaves the server.
     */
    keyStatus(base = env) {
      const effective = { ...base, ...overlayCache };
      return Object.entries(PROVIDER_KEY_VARS).map(([provider, name]) => {
        const stored = rows.has(KEY_PREFIX + provider);
        const value = typeof effective[name] === 'string' ? effective[name].trim() : '';
        const source = stored && overlayCache[name] ? 'dashboard' : value ? 'environment' : 'none';
        return { provider, name: PROVIDER_META[provider]?.name ?? provider, env: name, console: PROVIDER_META[provider]?.console ?? null, source, hint: value ? hint(value) : '', unreadable: unreadable.has(name) };
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
