import { stringify as yaml } from 'yaml';
import { composePrompt, type Persona } from './roster';
import { exportSkillStack, loadSkillState, loadYourSkills, protectedSystemPrompts } from './skillRegistry';
import { loadWorkingMemory } from './workingMemory';
import { generatedFiles, type ProjectFile } from './project';
import { redactSecrets } from './secrets';
import { saveBlob, zipBlob, type ZipFile } from './download';
import { storage, type ChatMessage } from './store';
import type { MemoryEntry, Run } from './types';
import type { McpConnection } from './mcp';
import type { ExecutionEvent, RuntimeArtifact } from './executionTypes';
import type { MediaConfig } from './mediaTools';
export interface AgentExportContext { persona: Persona; connectors: McpConnection[]; secrets?: string[]; media?: MediaConfig[]; memories?: MemoryEntry[]; }
export type AgentExportFormat = 'json' | 'yaml';
const PRIVATE_FIELD = /^(?:authorization|proxy-authorization|x-api-key|x-goog-api-key|key|token|access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret|client[_-]?secret|private[_-]?key)$/i;
/** Remove credential-bearing URL fields while retaining project selectors and other safe query parameters. */
export function publicConnectorUrl(value: string): string {
  try {
    const url = new URL(value); url.username = ''; url.password = '';
    for (const name of [...url.searchParams.keys()]) if (PRIVATE_FIELD.test(name) || /(?:signature|credential|auth|apiKey)/i.test(name)) url.searchParams.delete(name);
    return url.toString();
  } catch { return value; }
}
export function redactExportValue(value: unknown, secrets: string[] = []): unknown {
  if (typeof value === 'string') return redactSecrets(value.replace(/https?:\/\/[^\s<>"']+/g, url => publicConnectorUrl(url)), secrets).text;
  if (Array.isArray(value)) return value.map(item => redactExportValue(item, secrets));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, PRIVATE_FIELD.test(key) && typeof item === 'string' ? '[REDACTED]' : redactExportValue(item, secrets)]));
  return value;
}
export function agentDefinition(context: AgentExportContext, includeMemory = true) {
  const { persona, connectors } = context;
  const definition = {
    schemaVersion: '2.0', name: persona.name, persona,
    systemInstructions: composePrompt(persona), systemDefaults: protectedSystemPrompts(),
    skills: exportSkillStack(loadSkillState(), loadYourSkills()).skills.filter(skill => skill.enabled),
    connectors: connectors.filter(c => c.enabled).map(c => ({ id: c.id, name: c.name, url: publicConnectorUrl(c.url), transport: c.transport, authHeader: c.authHeader ?? 'Authorization', ...(c.method ? { method: c.method } : {}), tools: c.tools })),
    optionalMedia: (context.media ?? []).filter(c => c.enabled).map(c => ({ provider: c.provider, model: c.model, avatarId: c.avatarId, voiceId: c.voiceId, requiresUserKey: true, approvalBeforeGeneration: true })),
    ...(includeMemory ? { workingMemory: loadWorkingMemory(), browserMemories: context.memories ?? [] } : {}),
    execution: { runner: 'isolated-browser-web-worker', protocol: 'signal-forge-tool-runtime-v1', phaseApprovals: true, maxWorkflowCalls: 15, maxToolCallsPerChat: 2 },
  };
  return redactExportValue(definition, [...(context.secrets ?? []), ...connectors.map(c => c.token), ...(context.media ?? []).map(c => c.key)]) as typeof definition;
}
export function serializeAgentDefinition(context: AgentExportContext, format: AgentExportFormat, includeMemory = true): string {
  const definition = agentDefinition(context, includeMemory);
  return format === 'yaml' ? yaml(definition, { lineWidth: 0, aliasDuplicateObjects: false }) : `${JSON.stringify(definition, null, 2)}\n`;
}
export async function exportAgentBundle(context: AgentExportContext, format: AgentExportFormat = 'json', includeMemory = true): Promise<void> {
  const memories = includeMemory ? context.memories ?? await storage.memory() : [];
  const text = serializeAgentDefinition({ ...context, memories }, format, includeMemory);
  saveBlob(new Blob([text], { type: format === 'yaml' ? 'application/yaml' : 'application/json' }), `signal-forge-agent.${format}`);
}
export interface ExecutionBundleContext extends AgentExportContext {
  runs: Run[]; messages: ChatMessage[]; events: ExecutionEvent[]; artifacts: RuntimeArtifact[];
  projectFiles?: ProjectFile[]; previewHtml?: string; includeMemory?: boolean;
}
const safeSegment = (value: string) => value.replace(/[^A-Za-z0-9_-]/g, '_') || 'item';
function binaryArtifact(artifact: RuntimeArtifact): Uint8Array {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(artifact.content) || artifact.content.length % 4 !== 0) throw new Error(`Invalid binary artifact ${artifact.path}. Nothing was shortened or exported.`);
  const decoded = atob(artifact.content); return Uint8Array.from(decoded, c => c.charCodeAt(0));
}
export function executionBundleFiles(context: ExecutionBundleContext): ZipFile[] {
  const secrets = [...(context.secrets ?? []), ...context.connectors.map(c => c.token), ...(context.media ?? []).map(c => c.key)];
  const clean = (text: string) => redactSecrets(text, secrets).text;
  const includeMemory = context.includeMemory !== false;
  const files: ZipFile[] = [
    { path: 'agent.json', content: serializeAgentDefinition(context, 'json', includeMemory) },
    { path: 'agent.yaml', content: serializeAgentDefinition(context, 'yaml', includeMemory) },
    { path: 'execution-log.json', content: JSON.stringify(redactExportValue({ schemaVersion: '1.0', exportedAt: new Date().toISOString(), transcriptKind: 'User-visible agent step outputs and tool responses; private model reasoning is not collected.', events: context.events, runs: context.runs, messages: context.messages }, secrets), null, 2) },
    { path: 'transcript.md', content: clean([...context.messages.map(m => `## ${m.role} · ${m.at}\n\n${m.content}${m.error ? `\n\nError: ${m.error}` : ''}`), ...context.runs.map(run => `# Workflow: ${run.goal}\n\n${run.steps.map(step => `## ${step.title} · ${step.agent} · ${step.status}\n\n${step.output ?? ''}${step.error ? `\nError: ${step.error}` : ''}`).join('\n\n')}`)].join('\n\n')) },
  ];
  const addGenerated = (prefix: string, text: string) => {
    for (const [index, file] of generatedFiles(text).entries()) files.push({ path: `${prefix}/${index + 1}/${file.path}`, content: clean(file.content) });
  };
  for (const message of context.messages.filter(m => m.role === 'assistant')) addGenerated(`generated/messages/${safeSegment(message.id)}`, message.content);
  for (const run of context.runs) for (const step of run.steps) if (step.output) addGenerated(`generated/runs/${safeSegment(run.id)}/${safeSegment(step.id)}`, step.output);
  for (const file of context.projectFiles ?? []) files.push({ path: `project/${file.path}`, content: clean(file.content) });
  if (context.previewHtml) files.push({ path: 'preview/index.html', content: clean(context.previewHtml) });
  for (const event of context.events) if (event.kind === 'tool' && event.stdout) addGenerated(`generated/tools/${safeSegment(event.callId ?? event.id)}`, event.stdout);
  for (const artifact of context.artifacts) files.push({ path: `artifacts/${safeSegment(artifact.id)}/${artifact.path}`, content: artifact.encoding === 'base64' ? binaryArtifact(artifact) : clean(artifact.content) });
  files.push({ path: 'artifact-manifest.json', content: JSON.stringify(redactExportValue(context.artifacts.map(({ content: _content, ...metadata }) => ({ ...metadata, archivePath: `artifacts/${safeSegment(metadata.id)}/${metadata.path}` })), secrets), null, 2) });
  return files;
}
export async function downloadExecutionBundle(context: ExecutionBundleContext): Promise<void> {
  const memories = context.includeMemory === false ? [] : context.memories ?? await storage.memory();
  saveBlob(zipBlob(executionBundleFiles({ ...context, memories })), `signal-forge-execution-${new Date().toISOString().replace(/[:.]/g, '-')}.zip`);
}
