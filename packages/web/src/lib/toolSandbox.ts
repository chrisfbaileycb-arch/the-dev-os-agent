import { CREW_SKILLS, loadSkillState } from './skillRegistry';
import { mcpToolSpecs, slug } from './mcp';
import { mediaToolSpecs, type MediaConfig } from './mediaTools';
import type { ToolContext } from './connectors';
import type { ToolOutput, ToolSpec } from './tools';
import { workspaceId } from './store';
import { isSandboxReply, SANDBOX_CHANNEL, type SandboxTarget } from './sandboxProtocol';
export interface ToolObservation { type: 'start' | 'result' | 'error'; callId: string; tool: string; connector: string; args: Record<string, unknown>; durationMs?: number; result?: ToolOutput; error?: string; }
export type ToolObserver = (event: ToolObservation) => void;
export function runToolInSandbox(target: SandboxTarget, args: Record<string, unknown>, signal: AbortSignal, id = crypto.randomUUID()): Promise<ToolOutput> {
  if (signal.aborted) return Promise.reject(signal.reason ?? new DOMException('Cancelled', 'AbortError'));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/tool.worker.ts', import.meta.url), { type: 'module', name: `sf-tool-${id}` });
    const nonce = crypto.randomUUID(); let settled = false;
    const finish = (error?: Error, result?: ToolOutput) => {
      if (settled) return; settled = true; clearTimeout(timer); signal.removeEventListener('abort', abort); worker.terminate();
      if (error) reject(error); else resolve(result!);
    };
    const abort = () => finish(new DOMException('Tool action cancelled. A submitted remote job may continue; inspect its provider status before retrying.', 'AbortError'));
    const timer = setTimeout(() => finish(new Error('Sandbox execution timed out. No automatic tool retry was attempted.')), 185_000);
    signal.addEventListener('abort', abort, { once: true });
    worker.onerror = () => finish(new Error('The isolated tool worker failed.'));
    worker.onmessageerror = () => finish(new Error('The sandbox returned an unreadable message.'));
    worker.onmessage = (event: MessageEvent<unknown>) => {
      if (!isSandboxReply(event.data, id, nonce)) { finish(new Error('The sandbox returned an invalid execution message.')); return; }
      const reply = event.data;
      if (reply.type === 'error') finish(new Error(reply.message));
      else if (reply.type === 'result') finish(undefined, reply.result);
    };
    try { worker.postMessage({ channel: SANDBOX_CHANNEL, version: 1, type: 'execute', id, nonce, workspaceId: workspaceId(), approved: true, target, args }); }
    catch (error) { finish(error instanceof Error ? error : new Error('Could not start the sandbox.')); }
  });
}
/** Captures a turn's capability snapshot. Only the called adapter and its credential enter the worker. */
export function sandboxedTools(specs: ToolSpec[], context: ToolContext, media: MediaConfig[], observe: ToolObserver, preapproved = false): ToolSpec[] {
  const state = loadSkillState();
  const resources = CREW_SKILLS.filter(skill => state.some(row => row.id === skill.id && row.enabled));
  const targets = new Map<string, SandboxTarget>();
  for (const connection of context.mcp.filter(c => c.enabled)) for (const spec of mcpToolSpecs([connection])) {
    const tool = connection.tools.find(t => spec.name === `${slug(connection.name)}.${t.name}`);
    if (tool) { if (targets.has(spec.name)) throw new Error(`Duplicate tool name ${spec.name}. Give connected servers distinct names.`); targets.set(spec.name, { kind: 'mcp', connection, tool: tool.name }); }
  }
  for (const config of media) for (const spec of mediaToolSpecs([config])) targets.set(spec.name, { kind: 'media', config, tool: spec.name });
  return specs.map(spec => ({ name: spec.name, description: spec.description, run: async (args, signal) => {
    const callId = crypto.randomUUID(); const started = performance.now();
    let target = targets.get(spec.name);
    if (!target && spec.name.startsWith('github_') && context.settings.github.enabled) target = { kind: 'github', settings: context.settings.github, tool: spec.name };
    if (!target && spec.name === 'fetch_url' && context.settings.web.enabled) target = { kind: 'fetch' };
    if (!target && spec.name === 'inspect_page' && context.personaTools?.includes('inspect_page')) target = { kind: 'inspect' };
    if (!target && spec.name === 'search_documents' && context.settings.knowledge.enabled) target = { kind: 'knowledge', documents: context.knowledge };
    if (!target && spec.name === 'read_skill_resource') {
      const skill = resources.find(s => s.id === args.skill); const path = typeof args.path === 'string' ? args.path : '';
      if (skill && Object.hasOwn(skill.resources ?? {}, path)) target = { kind: 'resource', skill: skill.id, name: skill.name, path, content: skill.resources![path] };
    }
    const connector = target?.kind === 'mcp' ? target.connection.name : target?.kind === 'media' ? target.config.provider : target?.kind ?? 'Unavailable';
    const info = { callId, tool: spec.name, connector, args };
    observe({ ...info, type: 'start' });
    try {
      if (!target) throw new Error('This tool is not registered for isolated execution.');
      const needsApproval = target.kind === 'mcp' || (target.kind === 'media' && spec.name !== 'heygen_video_status');
      if (!preapproved && needsApproval && !window.confirm(`Allow ${spec.name} through ${connector}?${target.kind === 'media' ? '\nThis optional generation uses your own provider credits.' : ''}\n\n${JSON.stringify(args, null, 2)}`)) throw new Error('Tool call declined by the user.');
      const result = await runToolInSandbox(target, args, signal, callId);
      observe({ ...info, type: 'result', result, durationMs: performance.now() - started });
      return result;
    } catch (error) { observe({ ...info, type: 'error', error: error instanceof Error ? error.message : 'Sandbox action failed.', durationMs: performance.now() - started }); throw error; }
  } }));
}
