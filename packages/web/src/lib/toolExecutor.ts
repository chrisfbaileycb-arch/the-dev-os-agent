import { githubSpecs, knowledgeSpecs, webSpecs } from './toolAdapters';
import { retrieve } from './memory';
import { callMcpTool } from './mcp';
import { callMediaTool } from './mediaTools';
import { setWorkspaceId } from './store';
import { inspectPageSpec, type ToolOutput } from './tools';
import type { SandboxRequest } from './sandboxProtocol';
/** Executes only a built-in adapter selected by the host; no model-authored JS is evaluated. */
export async function executeSandboxTool(request: SandboxRequest, signal: AbortSignal): Promise<ToolOutput> {
  setWorkspaceId(request.workspaceId);
  const { target, args } = request;
  let value: string | ToolOutput;
  switch (target.kind) {
    case 'mcp': value = await callMcpTool(target.connection, target.tool, args, signal, request.approved); break;
    case 'github': {
      const spec = githubSpecs(target.settings).find(tool => tool.name === target.tool);
      if (!spec) throw new Error('This GitHub action is not permitted.');
      value = await spec.run(args, signal); break;
    }
    case 'fetch': value = await webSpecs({ enabled: true })[0].run(args, signal); break;
    case 'inspect': value = await inspectPageSpec.run(args, signal); break;
    case 'knowledge': {
      const spec = knowledgeSpecs({ enabled: true }, target.documents, retrieve)[0];
      value = spec ? await spec.run(args, signal) : { output: 'No documents are attached.', summary: 'No documents' }; break;
    }
    case 'resource': value = { output: target.content, summary: `${target.name}: ${target.path}` }; break;
    case 'media': value = await callMediaTool(target.config, target.tool, args, signal, request.id); break;
  }
  return typeof value === 'string' ? { output: value, summary: `${target.kind} action completed` } : value;
}
