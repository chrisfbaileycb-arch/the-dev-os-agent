import { redactSecrets } from './secrets';
import { workspaceId } from './store';
import type { ToolOutput, ToolSpec } from './tools';

// Connected MCP servers. Connections live in localStorage; the bearer token stays in memory
// and is never written to browser storage. Calls go through /api/mcp, which does the
// handshake and the safety checks. Tools from enabled servers become chat tools.
//
// Two transports, because servers in the wild speak both: Streamable HTTP (MCP 2025-06-18, one
// POST per request, the current standard) and HTTP+SSE (MCP 2024-11-05, a long-lived event stream
// plus a POST endpoint it names), which many existing servers still expose at a `/sse` path.

export interface JsonSchema { [key: string]: unknown; type?: string | string[]; properties?: Record<string, JsonSchema>; required?: string[]; }
export interface McpTool { name: string; description: string; inputSchema?: JsonSchema; [key: string]: unknown; }
export type McpTransport = 'http' | 'sse' | 'rest' | 'websocket';
export type McpAuthHeader = 'Authorization' | 'x-api-key';
export interface McpConnection { authHeader?: McpAuthHeader; id: string; name: string; url: string; transport: McpTransport; method?: 'GET' | 'POST'; token: string; saveToken: boolean; enabled: boolean; tools: McpTool[]; checkedAt?: string; error?: string; }
/** A URL ending in /sse is almost always the older transport; everything else defaults to Streamable HTTP. */
export const guessTransport = (url: string): McpTransport => /\/sse\/?$/i.test(url.trim()) ? 'sse' : 'http';

const KEY = 'hb-mcp';
const tokens = new Map<string, string>();

export function loadConnections(): McpConnection[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || '[]') as Partial<McpConnection>[];
    return list.filter(c => typeof c.id === 'string' && typeof c.url === 'string').map(c => ({ id: c.id!, name: typeof c.name === 'string' ? c.name : 'Tool connector', url: c.url!, transport: c.transport && ['sse', 'rest', 'websocket'].includes(c.transport) ? c.transport : 'http', method: c.method === 'POST' ? 'POST' : 'GET', token: tokens.get(c.id!) ?? '', saveToken: false, authHeader: c.authHeader === 'x-api-key' ? 'x-api-key' : 'Authorization', enabled: c.enabled !== false, tools: Array.isArray(c.tools) ? c.tools as McpTool[] : [], checkedAt: c.checkedAt, error: c.error }));
  } catch { return []; }
}
export function saveConnections(list: McpConnection[]): void {
  tokens.clear();
  for (const c of list) tokens.set(c.id, c.token);
  try { localStorage.setItem(KEY, redactSecrets(JSON.stringify(list.map(c => ({ ...c, token: '', saveToken: false }))), list.map(c => c.token)).text); } catch { /* storage unavailable; connections stay for this session */ }
}
export function clearConnections(): void { tokens.clear(); try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }

async function rpc<T>(conn: McpConnection, method: 'tools/list' | 'tools/call', params: Record<string, unknown>, signal: AbortSignal): Promise<T> {
  const token = conn.token.trim();
  const response = await fetch('/api/mcp', { method: 'POST', credentials: 'same-origin', signal: AbortSignal.any([signal, AbortSignal.timeout(40_000)]), headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId() }, body: JSON.stringify({ url: conn.url, transport: conn.transport, method, params, ...(token ? conn.authHeader === 'x-api-key' ? { apiKey: token } : { authorization: /^bearer /i.test(token) ? token : `Bearer ${token}` } : {}) }) });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body?.error?.message === 'string' ? body.error.message : `MCP request failed (HTTP ${response.status}).`);
  return body.result as T;
}

export async function refreshTools(conn: McpConnection, signal: AbortSignal): Promise<McpTool[]> {
  if (conn.transport === 'rest' || conn.transport === 'websocket') return [{ name: 'request', description: `${conn.transport === 'rest' ? conn.method ?? 'GET' : 'Send JSON over WebSocket'} to the configured ${conn.name} endpoint.`, inputSchema: { properties: { input: { type: 'object', description: 'JSON payload for the configured endpoint' } } } }];
  const all: McpTool[] = []; const cursors = new Set<string>(); let cursor: string | undefined;
  do {
    const result = await rpc<{ tools?: unknown; nextCursor?: unknown }>(conn, 'tools/list', cursor ? { cursor } : {}, signal);
    if (!Array.isArray(result?.tools) || result.tools.some(t => !t || typeof t.name !== 'string' || !t.name.trim())) throw new Error('The MCP server returned an invalid tool catalog.');
    all.push(...result.tools.map(t => ({ ...t, description: typeof t.description === 'string' ? t.description : '' })));
    if (all.length > 1000) throw new Error('MCP catalog exceeds 1,000 tools. Nothing was shortened or registered.');
    cursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : undefined;
    if (cursor) { if (cursors.has(cursor)) throw new Error('MCP catalog pagination repeated a cursor.'); cursors.add(cursor); }
  } while (cursor);
  if (new Set(all.map(t => t.name)).size !== all.length) throw new Error('MCP catalog contains duplicate tool names.');
  return all;
}

export async function callMcpTool(conn: McpConnection, name: string, args: Record<string, unknown>, signal: AbortSignal, approved = false): Promise<string | ToolOutput> {
  if (conn.transport === 'rest' || conn.transport === 'websocket') {
    if (name !== 'request') throw new Error('Unknown custom connector tool.');
    if ((conn.transport === 'websocket' || conn.method === 'POST') && !approved && (typeof window === 'undefined' || !window.confirm(`Allow ${conn.name} to send this request to ${new URL(conn.url).host}?\n\n${JSON.stringify(args.input ?? {}, null, 2)}`))) throw new Error('Connector request declined by the user.');
    const response = await fetch('/api/connectors/call', { method: 'POST', credentials: 'same-origin', signal, headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId() }, body: JSON.stringify({ url: conn.url, transport: conn.transport, method: conn.method ?? 'GET', input: args.input ?? {}, ...(conn.token ? { authorization: `Bearer ${conn.token}` } : {}) }) });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error?.message ?? 'Connector request failed.');
    return payload.result;
  }
  const result = await rpc<{ content?: { type?: string; text?: string; mimeType?: string; data?: string; resource?: { uri?: string; text?: string; blob?: string; mimeType?: string } }[]; structuredContent?: unknown; isError?: boolean }>(conn, 'tools/call', { name, arguments: args }, signal);
  const artifacts: NonNullable<ToolOutput['artifacts']> = []; const parts: string[] = [];
  for (const [index, content] of (result?.content ?? []).entries()) {
    if (content.type === 'text' && typeof content.text === 'string') { parts.push(content.text); continue; }
    const data = content.type === 'resource' ? content.resource?.blob : content.data;
    const text = content.type === 'resource' ? content.resource?.text : undefined;
    const mime = content.resource?.mimeType ?? content.mimeType ?? 'application/octet-stream';
    if (typeof data === 'string' || typeof text === 'string') {
      const ext = mime === 'image/png' ? 'png' : mime === 'image/jpeg' ? 'jpg' : mime === 'image/webp' ? 'webp' : mime === 'text/html' ? 'html' : mime.startsWith('text/') ? 'txt' : 'bin';
      const path = `artifacts/${slug(conn.name)}-${slug(name)}-${index}.${ext}`;
      artifacts.push({ path, mimeType: mime, encoding: typeof text === 'string' ? 'utf8' : 'base64', content: text ?? data!, source: conn.name }); parts.push(`Saved artifact: ${path}`);
    } else parts.push(JSON.stringify(content));
  }
  if (result?.structuredContent !== undefined) parts.push(JSON.stringify(result.structuredContent, null, 2));
  const output = parts.join('\n') || '(the tool returned no content)';
  if (result?.isError) throw new Error(output);
  return { output, summary: `${conn.name}: ${name} completed`, ...(artifacts.length ? { artifacts } : {}) };
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
