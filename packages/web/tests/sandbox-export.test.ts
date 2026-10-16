// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { executionBundleFiles, agentDefinition, serializeAgentDefinition, publicConnectorUrl } from '../src/lib/exportAgentBundle';
import { crc32, zipFiles } from '../src/lib/download';
import { personaById } from '../src/lib/roster';
import { saveSkillState, loadSkillState, CREW_SKILLS } from '../src/lib/skillRegistry';
import { saveWorkingMemory } from '../src/lib/workingMemory';
import { loadMediaConfigs, saveMediaConfigs, mediaToolSpecs } from '../src/lib/mediaTools';
import { clearSessionSecrets } from '../src/lib/sessionSecrets';
import { isSandboxRequest, isSandboxReply, SANDBOX_CHANNEL } from '../src/lib/sandboxProtocol';
import { runToolInSandbox } from '../src/lib/toolSandbox';
import type { SandboxRequest } from '../src/lib/sandboxProtocol';
import type { ExecutionBundleContext } from '../src/lib/exportAgentBundle';
import type { McpConnection } from '../src/lib/mcp';
const id = '11111111-1111-4111-8111-111111111111'; const nonce = '22222222-2222-4222-8222-222222222222';
const connector: McpConnection = { id, name: 'Test MCP', url: 'https://tools.example/mcp?project=p1&api_key=hidden-key', transport: 'http', token: 'private-session-token', saveToken: false, enabled: true, tools: [{ name: 'read', description: 'Complete description '.repeat(100), inputSchema: { type: 'object', properties: { token: { type: 'string', description: 'A schema field, not a credential' }, path: { type: 'string' } }, required: ['path'] } }] };
const request: SandboxRequest = { channel: SANDBOX_CHANNEL, version: 1, type: 'execute', id, nonce, workspaceId: id, approved: true, target: { kind: 'fetch' }, args: { url: 'https://example.com' } };
afterEach(() => { localStorage.clear(); clearSessionSecrets(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
describe('agent and runtime exports', () => {
  it('exports complete active skill definitions, persona, memory and schemas as equivalent JSON/YAML without auth', () => {
    const skill = CREW_SKILLS.find(s => s.kind === 'instructions' && s.markdown && s.markdown.length > 5000)!;
    saveSkillState(loadSkillState().map(row => ({ ...row, enabled: row.id === skill.id })));
    saveWorkingMemory({ task: 'Keep the task in this browser', knowledge: 'Use the customer knowledge core' });
    const context = { persona: personaById('coder'), connectors: [connector], secrets: [connector.token] };
    const definition = agentDefinition(context);
    expect(definition.skills.find(s => s.id === skill.id)?.markdown).toBe(skill.markdown);
    expect(definition.workingMemory?.task).toBe('Keep the task in this browser');
    expect(definition.connectors[0].tools[0].description).toHaveLength(connector.tools[0].description.length);
    expect(definition.connectors[0].tools[0].inputSchema?.properties?.token.type).toBe('string');
    const json = serializeAgentDefinition(context, 'json'); const yaml = serializeAgentDefinition(context, 'yaml');
    expect(parseYaml(yaml)).toEqual(JSON.parse(json)); expect(json).not.toContain(connector.token); expect(json).not.toContain('hidden-key');
    expect(agentDefinition(context, false).workingMemory).toBeUndefined();
  });
  it('scopes the bundle to one agent: only enabled skills, never the whole library', () => {
    saveSkillState(loadSkillState().map(row => ({ ...row, enabled: false })));
    const definition = agentDefinition({ persona: personaById('assistant'), connectors: [] });
    // The persona is the selected one, and nothing from the 65-package catalog rides along.
    expect(definition.name).toBe('Assistant');
    expect(definition.persona.id).toBe('assistant');
    expect(definition.skills).toEqual([]);
    expect(CREW_SKILLS.length).toBeGreaterThan(60);
    // Turning on exactly one skill ships exactly that one.
    const skill = CREW_SKILLS.find(s => s.kind === 'instructions' && s.markdown)!;
    saveSkillState(loadSkillState().map(row => ({ ...row, enabled: row.id === skill.id })));
    const one = agentDefinition({ persona: personaById('assistant'), connectors: [] });
    expect(one.skills.map(s => s.id)).toEqual([skill.id]);
  });
  it('strips credentials in connector URLs but retains safe project scoping', () => {
    expect(publicConnectorUrl('https://user:password@tools.example/mcp?project=p1&access_token=secret&X-Amz-Credential=secret')).toBe('https://tools.example/mcp?project=p1');
  });
  it('exports all step/message versions, SQL files, edited files, full logs, binary assets and preview HTML', () => {
    const large = 'const data = "complete";\n'.repeat(3000);
    const context: ExecutionBundleContext = { persona: personaById('coder'), connectors: [connector], secrets: [connector.token], runs: [{ id, goal: 'Build', workflow: 'build', mode: 'remote', model: 'fixture', status: 'completed', startedAt: new Date().toISOString(), tokens: 0, calls: 0, cacheHits: 0, contextTitles: [], steps: [{ id: 's1', title: 'Migration', agent: 'Engineer', status: 'completed', attempts: 0, output: '```schema.sql\nCREATE TABLE tasks (id INTEGER);\n```' }] }], messages: [{ id: 'm1', role: 'assistant', at: new Date().toISOString(), content: `\`\`\`src/data.ts\n${large}\`\`\`` }], events: [{ id: 'e1', sessionId: id, at: new Date().toISOString(), kind: 'tool', title: 'Tool response', status: 'Success', args: { authorization: 'secret-to-remove' }, stdout: large, durationMs: 120 }], artifacts: [{ id: 'a1', sessionId: id, createdAt: new Date().toISOString(), path: 'image.png', encoding: 'base64', content: 'AAECA/8=', mimeType: 'image/png', source: 'Image tool' }], projectFiles: [{ path: 'src/data.ts', content: `${large}// latest edit` }], previewHtml: '<html><body>Preview</body></html>' };
    const files = executionBundleFiles(context);
    expect(files.find(f => f.path.endsWith('/schema.sql'))?.content).toBe('CREATE TABLE tasks (id INTEGER);');
    expect(files.find(f => f.path === 'project/src/data.ts')?.content).toBe(`${large}// latest edit`);
    expect(files.find(f => f.path.endsWith('/1/src/data.ts'))?.content).toBe(large.replace(/\n$/, ''));
    expect(files.find(f => f.path === 'preview/index.html')?.content).toContain('Preview');
    const bytes = files.find(f => f.path.endsWith('/image.png'))?.content as Uint8Array;
    expect([...bytes]).toEqual([0, 1, 2, 3, 255]);
    const log = String(files.find(f => f.path === 'execution-log.json')?.content);
    expect(JSON.parse(log).events[0].stdout).toBe(large); expect(log).not.toContain('secret-to-remove');
    const zip = zipFiles(files); expect(zip.length).toBeGreaterThan(large.length * 3);
  });
  it('stores binary bytes with the correct CRC and rejects unsafe or colliding ZIP paths', () => {
    const bytes = new Uint8Array([0, 255, 127, 4]); const zip = zipFiles([{ path: 'media/x.png', content: bytes }]); const view = new DataView(zip.buffer);
    expect(view.getUint32(14, true)).toBe(crc32(bytes)); const offset = 30 + view.getUint16(26, true); expect(zip.slice(offset, offset + bytes.length)).toEqual(bytes);
    for (const path of ['../private', '/root/x', 'C:/private', 'a/../x', 'a//b']) expect(() => zipFiles([{ path, content: 'x' }])).toThrow(/Unsafe/);
    expect(() => zipFiles([{ path: 'x', content: '1' }, { path: 'x', content: '2' }])).toThrow(/Duplicate/);
  });
});
describe('optional media credentials', () => {
  it('requires an enabled personal key and never persists it or adds tools to an unconfigured turn', () => {
    expect(mediaToolSpecs(loadMediaConfigs())).toEqual([]);
    const configs = loadMediaConfigs().map(c => c.provider === 'nano-banana' ? { ...c, key: 'personal-media-key', enabled: true } : c);
    saveMediaConfigs(configs); expect(loadMediaConfigs().find(c => c.provider === 'nano-banana')?.key).toBe('personal-media-key');
    expect(localStorage.getItem('sf-media-tools')).not.toContain('personal-media-key'); expect(mediaToolSpecs(configs).map(t => t.name)).toEqual(['nano_banana_generate_image']);
    clearSessionSecrets(); expect(mediaToolSpecs(loadMediaConfigs())).toEqual([]);
  });
});
describe('isolated tool protocol', () => {
  it('requires a valid capability, explicit approval, channel/version and matching reply nonce', () => {
    expect(isSandboxRequest(request)).toBe(true);
    for (const patch of [{ channel: 'other' }, { version: 2 }, { approved: false }, { workspaceId: 'invalid' }, { target: { kind: 'eval', code: 'window.alert(1)' } }, { target: { kind: 'github', settings: { enabled: true }, tool: 'push' } }]) expect(isSandboxRequest({ ...request, ...patch })).toBe(false);
    expect(isSandboxReply({ channel: SANDBOX_CHANNEL, version: 1, type: 'result', id, nonce, durationMs: 1, result: { output: 'stdout', summary: 'done' } }, id, nonce)).toBe(true);
    expect(isSandboxReply({ channel: SANDBOX_CHANNEL, version: 1, type: 'started', id, nonce: 'wrong' }, id, nonce)).toBe(false);
    expect(isSandboxReply({ channel: SANDBOX_CHANNEL, version: 1, type: 'result', id, nonce, durationMs: -1, result: { output: 'x', summary: 'x' } }, id, nonce)).toBe(false);
  });
  it('dispatches one selected capability, returns complete stdout, and terminates after completion', async () => {
    const workers: FakeWorker[] = [];
    class FakeWorker {
      onmessage?: (event: MessageEvent) => void; onerror?: () => void; onmessageerror?: () => void; terminated = false; request?: SandboxRequest;
      constructor() { workers.push(this); }
      postMessage(value: SandboxRequest) { this.request = value; queueMicrotask(() => this.onmessage?.({ data: { channel: SANDBOX_CHANNEL, version: 1, id: value.id, nonce: value.nonce, type: 'result', durationMs: 10, result: { output: 'Full response '.repeat(3000), summary: 'done' } } } as MessageEvent)); }
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal('Worker', FakeWorker);
    const result = await runToolInSandbox({ kind: 'fetch' }, { url: 'https://example.com' }, new AbortController().signal, id);
    expect(result.output.length).toBe(42000); expect(workers[0].terminated).toBe(true); expect(workers[0].request?.target).toEqual({ kind: 'fetch' });
  });
  it('traps worker failures, forged messages, and cancellation without leaving a worker alive', async () => {
    let worker: FakeWorker;
    class FakeWorker {
      onmessage?: (event: MessageEvent) => void; onerror?: () => void; onmessageerror?: () => void; terminated = false; mode: string;
      constructor() { worker = this; this.mode = mode; }
      postMessage(value: SandboxRequest) { if (this.mode === 'forged') queueMicrotask(() => this.onmessage?.({ data: { ...value, type: 'result', nonce: 'forged' } } as MessageEvent)); if (this.mode === 'error') queueMicrotask(() => this.onerror?.()); }
      terminate() { this.terminated = true; }
    }
    vi.stubGlobal('Worker', FakeWorker); let mode = 'forged';
    await expect(runToolInSandbox({ kind: 'fetch' }, {}, new AbortController().signal)).rejects.toThrow(/invalid execution message/); expect(worker!.terminated).toBe(true);
    mode = 'error'; await expect(runToolInSandbox({ kind: 'fetch' }, {}, new AbortController().signal)).rejects.toThrow(/worker failed/); expect(worker!.terminated).toBe(true);
    mode = 'wait'; const controller = new AbortController(); const pending = runToolInSandbox({ kind: 'fetch' }, {}, controller.signal); controller.abort(); await expect(pending).rejects.toThrow(/cancelled/); expect(worker!.terminated).toBe(true);
  });
});
