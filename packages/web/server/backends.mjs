// Availability is independent of Shield eligibility and permission to spend owner money.
export const US_BACKEND_IDS = ['openai', 'anthropic', 'google', 'groq', 'xai'];
export const HF_BACKEND_ID = 'huggingface-backend';
export const HF_ROUTER_BASE = 'https://router.huggingface.co/v1';
export const sameBackendGroup = (requested, routed) => (requested === HF_BACKEND_ID) === (routed === HF_BACKEND_ID);

export function backendEnabled(id, env = process.env) {
  if (US_BACKEND_IDS.includes(id)) return env.US_BACKEND_ENABLED !== 'false';
  if (id === HF_BACKEND_ID) return env.HF_BACKEND_ENABLED === 'true';
  return true;
}

/** Only the fixed HF router or official dedicated HF endpoints; never a visitor URL. */
export function hfBackendBase(value = '') {
  if (!String(value).trim()) return HF_ROUTER_BASE;
  let url; try { url = new URL(String(value).trim()); } catch { throw new Error('Use an HTTPS Hugging Face inference endpoint URL.'); }
  const official = url.hostname === 'router.huggingface.co' || /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.endpoints\.huggingface\.cloud$/.test(url.hostname);
  if (!official || url.protocol !== 'https:' || url.port || url.username || url.password || url.search || url.hash || !['', '/', '/v1', '/v1/'].includes(url.pathname)) throw new Error('Use router.huggingface.co/v1 or an official endpoints.huggingface.cloud URL ending in /v1.');
  return url.origin + '/v1';
}

export function hfEndpointModels(value = '') {
  const ids = String(value).split(',').map(id => id.trim()).filter(Boolean);
  if (ids.length > 100 || ids.some(id => id.length > 200 || /[\x00-\x1f]/.test(id))) throw new Error('Use at most 100 model IDs, each at most 200 characters, separated by commas.');
  return [...new Set(ids)];
}

export function backendStatus(env = process.env) {
  let base; try { base = hfBackendBase(env.HF_BACKEND_BASE_URL); } catch { base = null; }
  let models; try { models = hfEndpointModels(env.HF_BACKEND_MODELS); } catch { models = []; }
  return { us: backendEnabled('openai', env), huggingface: backendEnabled(HF_BACKEND_ID, env), hfMode: base === HF_ROUTER_BASE ? 'router' : 'endpoint', hfConfigured: Boolean(base && (base === HF_ROUTER_BASE || models.length)), hfModels: base === HF_ROUTER_BASE ? [] : models };
}
