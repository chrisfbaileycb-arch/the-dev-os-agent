import type { ProviderModel } from './providerContract';

export const CHEAPER_INFERENCE_DEFAULT_BASE_URL = 'https://api.cheaperinference.com/v1';
export const cheaperInferenceDashboard = 'https://platform.cheaperinference.com/dashboard';

export interface CheaperInferenceClientConfig {
  enabled: boolean;
  baseUrl: string;
  allowedModels: string[];
}

/** Public metadata only. The server remains the source of truth for credentials and routing. */
export function cheaperInferenceClientConfig(raw: Partial<CheaperInferenceClientConfig> = {}): CheaperInferenceClientConfig {
  const baseUrl = typeof raw.baseUrl === 'string' && /^https:\/\//.test(raw.baseUrl) ? raw.baseUrl.replace(/\/+$/, '') : '';
  return {
    enabled: raw.enabled === true,
    baseUrl,
    allowedModels: Array.isArray(raw.allowedModels) ? raw.allowedModels.filter(id => typeof id === 'string').slice(0, 200) as string[] : [],
  };
}

/** The frontend-facing handle is intentionally unable to discover or send with a secret. */
export function createCheaperInferenceProvider(metadata: Partial<CheaperInferenceClientConfig> = {}): { id: string; capabilities: { streaming: boolean; structuredOutput: boolean; toolCalling: boolean; vision: boolean; cancellation: boolean } } {
  cheaperInferenceClientConfig(metadata);
  return {
    id: 'cheaper-inference',
    capabilities: { streaming: true, structuredOutput: true, toolCalling: true, vision: true, cancellation: true },
  };
}

/** Shared normalization shape for tests and future server payloads. */
export function normalizeCheaperInferenceModel(raw: Record<string, unknown>): ProviderModel | null {
  if (typeof raw.id !== 'string' || !raw.id.trim() || raw.id.length > 200) return null;
  const id = raw.id.trim();
  const contextLength = Number(raw.context_length);
  const capabilities = raw.capabilities && typeof raw.capabilities === 'object' ? raw.capabilities as Record<string, unknown> : {};
  return {
    ref: `cheaper-inference:${id}`,
    provider: 'cheaper-inference',
    providerModelId: id,
    modalities: capabilities.vision === true ? ['text', 'image'] : ['text'],
    contextLength: Number.isFinite(contextLength) ? contextLength : null,
    structuredOutput: capabilities.structured_output === true || capabilities.json === true,
    toolUse: capabilities.tool_calling === true || capabilities.tools === true,
    codingSuitability: /code|coder|coding|starcoder|qwen/i.test(id) ? 0.9 : 0.5,
    reasoningSuitability: /reason|think|r1|opus|o[134]|pro|max/i.test(id) ? 0.9 : 0.5,
    vision: capabilities.vision === true,
    expectedLatency: /7b|8b|mini|flash|fast|small/i.test(id) ? 'low' : /70b|120b|large|opus|pro/i.test(id) ? 'high' : 'medium',
    costClass: 'operator-funded',
    privacyClass: 'approved-hosted',
    availability: 'unknown',
    workflows: ['exploration', 'build', 'verification', 'revision', 'repair'],
    operatorApproved: true,
  };
}
