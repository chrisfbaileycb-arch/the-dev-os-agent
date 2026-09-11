import { workspaceId } from './store';
import type { ToolSpec } from './tools';

// Connected MCP servers. Connections live in localStorage; the bearer token stays in memory
// unless the person chooses to remember it. Calls go through /api/mcp, which does the
// handshake and the safety checks. Tools from enabled servers become chat tools.

export interface McpTool { name: string; description: string; inputSchema?: { properties?: Record<string, { type?: string; description?: string }>; required?: string[] }; }
export interface McpConnection { id: string; name: string; url: string; token: string; saveToken: boolean; enabled: boolean; tools: McpTool[]; checkedAt?: string; error?: string; }

const KEY = 'hb-mcp';
const tokens = new Map<string, string>();

export function loadConnections(): McpConnection[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]') as Partial<McpConnection>[];
    return list.filter(c => typeof c.id === 'string' && typeof c.url === 'string').map(c => ({ id: c.id!, name: typeof c.name === 'string' ? c.name : 'MCP server', url: c.url!, token: c.saveToken && typeof c.token === 'string' ? c.token : (tokens.get(c.id!) ?? ''), saveToken: Boolean(c.saveToken), enabled: c.enabled !== false, tools: Array.isArray(c.tools) ? c.tools as McpTool[] : [], checkedAt: c.checkedAt, error: c.error }));
  } catch { return []; }
}
export function saveConnections(list: McpConnection[]): void {
  for (const c of list) tokens.set(c.id, c.token);
  try { localStorage.setItem(KEY, JSON.stringify(list.map(c => ({ ...c, token: c.saveToken ? c.token : '' })))); } catch { /* storage unavailable; connections stay for this session */ }
}
export function clearConnections(): void { tokens.clear(); try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }

async function rpc<T>(conn: McpConnection, method: 'tools/list' | 'tools/call', params: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const token = conn.token.trim();
  const response = await fetch('/api/mcp', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]), headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId() }, body: JSON.stringify({ url: conn.url, method, params, ...(token ? { authorization: /^bearer /i.test(token) ? token : `Bearer ${token}` } : {}) }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error?.message === 'string' ? body.error.message : `MCP request failed (HTTP ${response.status}).`);
  return body.result as T;
}

export async function refreshTools(conn: McpConnection, signal: AbortSignal): Promise<McpTool[]> {
  const result = await rpc<{ tools?: unknown }>(conn, 'tools/list', {}, signal);
  const tools = Array.isArray(result?.tools) ? result.tools : [];
  return tools.filter((t): t is McpTool => Boolean(t) && typeof (t as McpTool).name === 'string').map(t => ({ name: t.name.slice(0, 80), description: typeof t.description === 'string' ? t.description.slice(0, 400) : '', inputSchema: t.inputSchema })).slice(0, 60);
}

export async function callMcpTool(conn: McpConnection, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const result = await rpc<{ content?: { type?: string; text?: string; mimeType?: string }[]; isError?: boolean }>(conn, 'tools/call', { name, arguments: args }, signal);
  const text = (result?.content ?? []).map(c => c.type === 'text' && typeof c.text === 'string' ? c.text : `[${c.type ?? 'content'}${c.mimeType ? ` ${c.mimeType}` : ''} omitted]`).join('\n').slice(0, 12_000);
  if (result?.isError) throw new Error(text || 'The tool reported an error.');
  return text || '(the tool returned no text)';
}

export const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'mcp';
const schemaSummary = (schema?: McpTool['inputSchema']) => schema?.properties ? `{${Object.entries(schema.properties).map(([k, v]) => `"${k}": ${v.type ?? 'any'}${schema.required?.includes(k) ? '' : '?'}`).join(', ')}}` : '{}';

/** Chat tool specs for every enabled connection with a tool list. */
export function mcpToolSpecs(connections: McpConnection[]): ToolSpec[] {
  return connections.filter(c => c.enabled && c.tools.length).flatMap(conn => conn.tools.map(tool => {
    const name = `${slug(conn.name)}.${tool.name}`;
    return { name, description: `${name} ${schemaSummary(tool.inputSchema)}: ${tool.description || 'MCP tool'}`, run: (args, signal) => callMcpTool(conn, tool.name, args, signal) } as ToolSpec;
  }));
}
export const enabledToolCount = (connections: McpConnection[]) => connections.filter(c => c.enabled).reduce((n, c) => n + c.tools.length, 0);
