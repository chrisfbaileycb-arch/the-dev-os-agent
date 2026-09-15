// Server-only Cheaper Inference transport. The API credential and operator-selected endpoint
// never cross the browser boundary.
export const CHEAPER_INFERENCE_DEFAULT_BASE = 'https://api.cheaperinference.com/v1';

export function cheaperInferenceBase(env = process.env) {
  const configured = typeof env.CHEAPER_INFERENCE_BASE_URL === 'string' ? env.CHEAPER_INFERENCE_BASE_URL.trim().replace(/\/+$/, '') : '';
  const candidate = configured || CHEAPER_INFERENCE_DEFAULT_BASE;
  try {
    const url = new URL(candidate);
    if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash) return candidate;
  } catch { /* use the safe hosted default */ }
  return CHEAPER_INFERENCE_DEFAULT_BASE;
}

export function cheaperInferenceKey(env = process.env) {
  const key = typeof env.CHEAPER_INFERENCE_API_KEY === 'string' ? env.CHEAPER_INFERENCE_API_KEY.trim() : '';
  return /^[\x20-\x7e]*$/.test(key) ? key : '';
}

export function cheaperInferenceEnabled(env = process.env) {
  return env.CHEAPER_INFERENCE_ENABLED === 'true' && Boolean(cheaperInferenceKey(env));
}

const csv = value => typeof value === 'string'
  ? [...new Set(value.split(',').map(item => item.trim()).filter(item => item && item.length <= 200))]
  : [];

export function cheaperInferenceConfig(env = process.env) {
  const timeout = Number(env.CHEAPER_INFERENCE_REQUEST_TIMEOUT_MS);
  const retries = Number(env.CHEAPER_INFERENCE_MAX_RETRIES);
  const cost = Number(env.CHEAPER_INFERENCE_MAX_COST_PER_REQUEST);
  return {
    enabled: cheaperInferenceEnabled(env),
    base: cheaperInferenceBase(env),
    allowedModels: csv(env.CHEAPER_INFERENCE_ALLOWED_MODELS),
    explorationModels: csv(env.CHEAPER_INFERENCE_EXPLORATION_MODELS),
    buildModels: csv(env.CHEAPER_INFERENCE_BUILD_MODELS),
    verificationModels: csv(env.CHEAPER_INFERENCE_VERIFICATION_MODELS),
    requestTimeoutMs: Number.isFinite(timeout) ? Math.min(300_000, Math.max(1_000, timeout)) : 125_000,
    maxRetries: Number.isFinite(retries) ? Math.min(3, Math.max(0, Math.floor(retries))) : 1,
    maxCostPerRequest: Number.isFinite(cost) && cost >= 0 ? cost : null,
  };
}

export function normalizeCheaperInferenceModel(model) {
  if (!model || typeof model !== 'object' || typeof model.id !== 'string') return null;
  const id = model.id.trim();
  if (!id || id.length > 200) return null;
  const capabilities = model.capabilities && typeof model.capabilities === 'object' ? model.capabilities : {};
  return {
    id,
    label: typeof model.name === 'string' && model.name.trim() ? model.name.trim().slice(0, 80) : id,
    provider: 'cheaper-inference',
    context: Number.isFinite(model.context_length) ? model.context_length : null,
    vision: capabilities.vision === true,
    reasoning: capabilities.reasoning === true,
    structuredOutput: capabilities.structured_output === true || capabilities.json === true,
    toolUse: capabilities.tool_calling === true || capabilities.tools === true,
    costClass: 'operator-funded',
    privacyClass: 'approved-hosted',
    availability: 'unknown',
  };
}

export function approvedCheaperModels(models, env = process.env) {
  const allowed = new Set(cheaperInferenceConfig(env).allowedModels.map(id => id.toLowerCase()));
  return models.filter(model => model && (allowed.size === 0 || allowed.has(model.id.toLowerCase())));
}

export async function discoverCheaperInference(env = process.env, fetchImpl = fetch) {
  if (!cheaperInferenceEnabled(env)) return [];
  const response = await fetchImpl(`${cheaperInferenceBase(env)}/models`, {
    headers: { Accept: 'application/json', Authorization: `Bearer ${cheaperInferenceKey(env)}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`Cheaper Inference answered HTTP ${response.status}`);
  const body = await response.json();
  return approvedCheaperModels((Array.isArray(body.data) ? body.data : []).map(normalizeCheaperInferenceModel).filter(Boolean), env);
}

/** First-class provider adapter used by the managed server route. */
export class CheaperInferenceProvider {
  constructor(env = process.env, fetchImpl = fetch) {
    this.env = env;
    this.fetch = fetchImpl;
    this.id = 'cheaper-inference';
    this.capabilities = { streaming: true, structuredOutput: true, toolCalling: true, vision: true, cancellation: true };
  }
  async discover(signal) {
    return discoverCheaperInference(this.env, (url, init) => this.fetch(url, { ...init, signal: signal ?? init?.signal }));
  }
  async complete({ model, messages, maxTokens = 4096, signal }) {
    if (!cheaperInferenceEnabled(this.env)) throw new Error('Cheaper Inference is not configured on this deployment.');
    return this.fetch(`${cheaperInferenceBase(this.env)}/chat/completions`, {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', Authorization: `Bearer ${cheaperInferenceKey(this.env)}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, stream: true }),
      signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(cheaperInferenceConfig(this.env).requestTimeoutMs)]),
    });
  }
  classifyError(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/401|403|credential|API key|configured/i.test(message)) return { kind: 'authentication', retryable: false };
    if (/429|rate limit/i.test(message)) return { kind: 'rate-limited', retryable: true };
    if (/timeout|abort/i.test(message)) return { kind: 'timeout', retryable: true };
    if (/model/i.test(message)) return { kind: 'model-unavailable', retryable: false };
    return { kind: 'upstream', retryable: true };
  }
}

export function cheaperInferenceTarget(env = process.env) {
  return { base: cheaperInferenceBase(env), provider: 'cheaper-inference' };
}
