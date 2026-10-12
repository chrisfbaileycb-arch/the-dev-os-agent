import type { GithubSettings } from './toolAdapters';
import type { Knowledge } from './types';
import type { McpConnection } from './mcp';
import type { MediaConfig } from './mediaTools';
import type { ToolOutput } from './tools';
export const SANDBOX_CHANNEL = 'signal-forge-tool-runtime-v1';
export type SandboxTarget =
  | { kind: 'mcp'; connection: McpConnection; tool: string }
  | { kind: 'github'; settings: GithubSettings; tool: string }
  | { kind: 'fetch' | 'inspect' }
  | { kind: 'knowledge'; documents: Knowledge[] }
  | { kind: 'resource'; skill: string; path: string; content: string; name: string }
  | { kind: 'media'; config: MediaConfig; tool: string };
export interface SandboxRequest { channel: typeof SANDBOX_CHANNEL; version: 1; type: 'execute'; id: string; nonce: string; workspaceId: string; approved: true; target: SandboxTarget; args: Record<string, unknown>; }
export type SandboxReply =
  | { channel: typeof SANDBOX_CHANNEL; version: 1; id: string; nonce: string; type: 'started' }
  | { channel: typeof SANDBOX_CHANNEL; version: 1; id: string; nonce: string; type: 'result'; result: ToolOutput; durationMs: number }
  | { channel: typeof SANDBOX_CHANNEL; version: 1; id: string; nonce: string; type: 'error'; message: string; durationMs: number };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function isSandboxRequest(value: unknown): value is SandboxRequest {
  if (!record(value) || value.channel !== SANDBOX_CHANNEL || value.version !== 1 || value.type !== 'execute' || value.approved !== true || typeof value.id !== 'string' || typeof value.nonce !== 'string' || !/^[0-9a-f-]{36}$/i.test(String(value.workspaceId)) || !record(value.args) || !record(value.target)) return false;
  if (!/^[0-9a-f-]{36}$/i.test(value.id) || !/^[0-9a-f-]{36}$/i.test(value.nonce)) return false;
  const target = value.target;
  switch (target.kind) {
    case 'mcp': return record(target.connection) && typeof target.tool === 'string' && target.connection.enabled === true && Array.isArray(target.connection.tools) && target.connection.tools.some(t => record(t) && t.name === target.tool);
    case 'github': return record(target.settings) && target.settings.enabled === true && ['github_repo', 'github_files', 'github_issues'].includes(String(target.tool));
    case 'fetch': case 'inspect': return true;
    case 'knowledge': return Array.isArray(target.documents) && target.documents.every(d => record(d) && typeof d.id === 'string' && typeof d.content === 'string');
    case 'resource': return typeof target.content === 'string' && typeof target.name === 'string' && value.args.skill === target.skill && value.args.path === target.path;
    case 'media': return record(target.config) && target.config.enabled === true && typeof target.config.key === 'string' && !!target.config.key.trim() && ((target.config.provider === 'heygen' && ['heygen_generate_video', 'heygen_video_status'].includes(String(target.tool))) || (target.config.provider === 'nano-banana' && target.tool === 'nano_banana_generate_image'));
    default: return false;
  }
}
export function isSandboxReply(value: unknown, id: string, nonce: string): value is SandboxReply {
  if (!record(value) || value.channel !== SANDBOX_CHANNEL || value.version !== 1 || value.id !== id || value.nonce !== nonce) return false;
  if (value.type === 'started') return true;
  if (typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs) || value.durationMs < 0) return false;
  if (value.type === 'error') return typeof value.message === 'string';
  if (value.type !== 'result' || !record(value.result) || typeof value.result.output !== 'string' || typeof value.result.summary !== 'string') return false;
  return value.result.artifacts === undefined || (Array.isArray(value.result.artifacts) && value.result.artifacts.every(a => record(a) && typeof a.path === 'string' && typeof a.content === 'string' && typeof a.mimeType === 'string' && typeof a.source === 'string' && ['utf8', 'base64'].includes(String(a.encoding))));
}
