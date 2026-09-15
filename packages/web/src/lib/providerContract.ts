import type { Connection } from './types';

/** Provider-neutral capability flags used by Orator policy, not by individual provider code. */
export interface ProviderCapabilities {
  streaming: boolean;
  structuredOutput: boolean;
  toolCalling: boolean;
  vision: boolean;
  cancellation: boolean;
}

export type CostClass = 'free-allocation' | 'operator-funded' | 'paid-api' | 'local' | 'customer-funded' | 'unknown';
export type PrivacyClass = 'local' | 'approved-hosted' | 'hosted' | 'unknown';
export type ProviderHealth = 'healthy' | 'degraded' | 'unavailable' | 'unknown';

/** Normalized model data. Provider-specific catalog shapes stop at the adapter boundary. */
export interface ProviderModel {
  ref: string;
  provider: string;
  providerModelId: string;
  modalities: ('text' | 'image')[];
  contextLength: number | null;
  structuredOutput: boolean;
  toolUse: boolean;
  codingSuitability: number;
  reasoningSuitability: number;
  vision: boolean;
  expectedLatency: 'low' | 'medium' | 'high' | 'unknown';
  costClass: CostClass;
  privacyClass: PrivacyClass;
  availability: ProviderHealth;
  lastHealthCheck?: string;
  benchmarkVersion?: string;
  workflows: string[];
  operatorApproved: boolean;
}

export interface ProviderUsage {
  inputTokens: number;
  outputTokens: number;
  cachedTokens?: number;
  reportedCost?: number;
  returnedModel?: string;
}

export interface ProviderResult {
  text: string;
  usage: ProviderUsage;
}

export interface ProviderErrorInfo {
  kind: 'authentication' | 'unavailable' | 'rate-limited' | 'model-unavailable' | 'context-exceeded' | 'invalid-output' | 'tool-failure' | 'timeout' | 'upstream' | 'configuration' | 'unknown';
  retryable: boolean;
}

/** The adapter contract Orator works against; no provider SDK types cross this boundary. */
export interface ModelProvider {
  readonly id: string;
  readonly capabilities: ProviderCapabilities;
  discover(signal?: AbortSignal): Promise<ProviderModel[]>;
  complete(connection: Connection, system: string, prompt: string, signal: AbortSignal, onDelta?: (text: string) => void): Promise<ProviderResult>;
  classifyError(error: unknown): ProviderErrorInfo;
}

/** Policy inputs shared by hosted and future local adapters. */
export interface RouteRequirements {
  workflow: 'exploration' | 'build' | 'verification' | 'revision' | 'repair';
  minContext?: number;
  needsTools?: boolean;
  needsStructuredOutput?: boolean;
  privacy: PrivacyClass;
  maxCost?: number;
}

/** A route is eligible only after policy, approval, privacy, and budget checks pass. */
export interface EligibleRoute {
  provider: string;
  model: ProviderModel;
  reason: string;
}
