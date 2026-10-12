import { workspaceId } from './store';
import { sessionSecret, setSessionSecret } from './sessionSecrets';
import type { ArtifactOutput } from './executionTypes';
import type { ToolOutput, ToolSpec } from './tools';
export type MediaProvider = 'heygen' | 'nano-banana';
export interface MediaConfig { provider: MediaProvider; enabled: boolean; key: string; avatarId: string; voiceId: string; model: string; }
const KEY = 'sf-media-tools';
export const IMAGE_MODELS = ['gemini-nano-banana-2.1', 'gemini-3.1-flash-image', 'gemini-3.1-flash-lite-image', 'gemini-3-pro-image', 'gemini-2.5-flash-image'] as const;
export function loadMediaConfigs(): MediaConfig[] {
  let saved: Partial<MediaConfig>[] = [];
  try { const value: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]'); if (Array.isArray(value)) saved = value; } catch { saved = []; }
  return (['heygen', 'nano-banana'] as const).map(provider => {
    const row = saved.find(s => s?.provider === provider);
    return { provider, enabled: row?.enabled === true, key: sessionSecret(`media:${provider}`), avatarId: typeof row?.avatarId === 'string' ? row.avatarId : '', voiceId: typeof row?.voiceId === 'string' ? row.voiceId : '', model: IMAGE_MODELS.includes(row?.model as typeof IMAGE_MODELS[number]) ? row!.model! : IMAGE_MODELS[0] };
  });
}
export function saveMediaConfigs(configs: MediaConfig[]): void {
  for (const config of configs) setSessionSecret(`media:${config.provider}`, config.key);
  localStorage.setItem(KEY, JSON.stringify(configs.map(({ key: _key, ...rest }) => rest)));
}
export function clearMediaConfigs(): void {
  for (const provider of ['heygen', 'nano-banana']) setSessionSecret(`media:${provider}`, '');
  try { localStorage.removeItem(KEY); } catch { /* In-memory credentials are already cleared. */ }
}
export const mediaToolName = (provider: MediaProvider) => provider === 'heygen' ? 'heygen_generate_video' : 'nano_banana_generate_image';
export async function callMediaTool(config: MediaConfig, tool: string, args: Record<string, unknown>, signal: AbortSignal, callId: string): Promise<ToolOutput> {
  if (!config.enabled || !config.key.trim()) throw new Error('This optional media tool needs your own key and must be enabled in Connectors.');
  const response = await fetch('/api/media/call', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.any([signal, AbortSignal.timeout(180_000)]), headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId() }, body: JSON.stringify({ provider: config.provider, key: config.key, tool, args, model: config.model, avatarId: config.avatarId, voiceId: config.voiceId, callId }) });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error?.message ?? `Media tool answered HTTP ${response.status}.`);
  if (typeof payload.output !== 'string' || typeof payload.summary !== 'string' || !Array.isArray(payload.artifacts)) throw new Error('Media provider returned an invalid response.');
  return { output: payload.output, summary: payload.summary, artifacts: payload.artifacts as ArtifactOutput[] };
}
export function mediaToolSpecs(configs: MediaConfig[]): ToolSpec[] {
  return configs.filter(c => c.enabled && c.key.trim()).flatMap(config => {
    const name = mediaToolName(config.provider);
    const description = config.provider === 'heygen'
      ? `${name} {"script":"avatar narration","avatar_id":"optional configured avatar","voice_id":"optional configured voice","aspect_ratio":"16:9|9:16|1:1","title":"optional title"}: OPTIONAL avatar video tool. Only call for an explicit video/marketing request. Requires separate approval; never needed for compiling code. Returns a video job manifest. Use heygen_video_status {"video_id":"id"} to retrieve its completed video URL.`
      : `${name} {"prompt":"image description"}: OPTIONAL marketing/creative image tool. Only call when the user asks for an image or marketing asset. Requires separate approval and the user's image key; never needed for code generation. Saves generated images as downloadable artifacts.`;
    const specs: ToolSpec[] = [{ name, description, run: (args, signal) => callMediaTool(config, name, args, signal, crypto.randomUUID()) }];
    if (config.provider === 'heygen') specs.push({ name: 'heygen_video_status', description: 'heygen_video_status {"video_id":"id"}: retrieve the status and download manifest of a previously requested HeyGen video; does not create a new video.', run: (args, signal) => callMediaTool(config, 'heygen_video_status', args, signal, crypto.randomUUID()) });
    return specs;
  });
}
