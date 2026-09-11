import { useCallback, useState } from "react";
import { postMcp } from "../endpoints/mcp_POST.schema";

// Connected MCP servers for the composer. The list lives in localStorage; a bearer token stays
// in memory for the session unless the person chooses to remember it. Tools on enabled servers
// become tool specs the Researcher stage can call during a run.

export interface McpTool { name: string; description: string; inputSchema?: { properties?: Record<string, { type?: string }>; required?: string[] }; }
export interface McpServer { id: string; name: string; url: string; token: string; saveToken: boolean; enabled: boolean; tools: McpTool[]; checkedAt?: string; error?: string; }
export interface ToolSpec { name: string; description: string; run: (args: Record<string, unknown>, signal: AbortSignal) => Promise<string>; }

const KEY = "hb-mcp";
const tokens = new Map<string, string>();

function load(): McpServer[] {
  try {
    const list = JSON.parse(localStorage.getItem(KEY) || "[]") as Partial<McpServer>[];
    return list.filter((c) => typeof c.id === "string" && typeof c.url === "string").map((c) => ({
      id: c.id!, name: typeof c.name === "string" ? c.name : "MCP server", url: c.url!,
      token: c.saveToken && typeof c.token === "string" ? c.token : (tokens.get(c.id!) ?? ""),
      saveToken: Boolean(c.saveToken), enabled: c.enabled !== false, tools: Array.isArray(c.tools) ? (c.tools as McpTool[]) : [], checkedAt: c.checkedAt, error: c.error,
    }));
  } catch { return []; }
}
function persist(list: McpServer[]): void {
  for (const c of list) tokens.set(c.id, c.token);
  try { localStorage.setItem(KEY, JSON.stringify(list.map((c) => ({ ...c, token: c.saveToken ? c.token : "" })))); } catch { /* storage unavailable */ }
}
const authorization = (server: McpServer) => { const t = server.token.trim(); return t ? (/^bearer /i.test(t) ? t : `Bearer ${t}`) : undefined; };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "mcp";
const schemaSummary = (schema?: McpTool["inputSchema"]) => schema?.properties ? `{${Object.entries(schema.properties).map(([k, v]) => `"${k}": ${v.type ?? "any"}${schema.required?.includes(k) ? "" : "?"}`).join(", ")}}` : "{}";

async function listTools(server: McpServer, signal?: AbortSignal): Promise<McpTool[]> {
  const { result } = await postMcp({ url: server.url, method: "tools/list", params: {}, authorization: authorization(server) }, { signal });
  const tools = (result as { tools?: unknown })?.tools;
  return (Array.isArray(tools) ? tools : []).filter((t): t is McpTool => Boolean(t) && typeof (t as McpTool).name === "string")
    .map((t) => ({ name: t.name.slice(0, 80), description: typeof t.description === "string" ? t.description.slice(0, 400) : "", inputSchema: t.inputSchema })).slice(0, 60);
}
async function callTool(server: McpServer, name: string, args: Record<string, unknown>, signal: AbortSignal): Promise<string> {
  const { result } = await postMcp({ url: server.url, method: "tools/call", params: { name, arguments: args }, authorization: authorization(server) }, { signal });
  const r = result as { content?: { type?: string; text?: string; mimeType?: string }[]; isError?: boolean } | null;
  const text = (r?.content ?? []).map((c) => (c.type === "text" && typeof c.text === "string" ? c.text : `[${c.type ?? "content"}${c.mimeType ? ` ${c.mimeType}` : ""} omitted]`)).join("\n").slice(0, 12_000);
  if (r?.isError) throw new Error(text || "The tool reported an error.");
  return text || "(the tool returned no text)";
}

export function useMcpServers() {
  const [servers, setServers] = useState<McpServer[]>(load);
  const update = useCallback((next: McpServer[]) => { persist(next); setServers(next); }, []);
  const check = useCallback(async (server: McpServer): Promise<McpServer> => {
    try { const tools = await listTools(server, AbortSignal.timeout(45_000)); return { ...server, tools, checkedAt: new Date().toISOString(), error: undefined }; }
    catch (e) { return { ...server, tools: [], checkedAt: new Date().toISOString(), error: e instanceof Error ? e.message : "Could not reach the server." }; }
  }, []);
  const add = useCallback(async (input: { name: string; url: string; token: string; saveToken: boolean }): Promise<McpServer> => {
    const parsed = new URL(input.url.trim());
    const server: McpServer = { id: crypto.randomUUID(), name: input.name.trim() || parsed.host, url: parsed.toString(), token: input.token.trim(), saveToken: input.saveToken, enabled: true, tools: [] };
    const checked = await check(server);
    setServers((current) => { const next = [checked, ...current]; persist(next); return next; });
    return checked;
  }, [check]);
  const refresh = useCallback(async (id: string) => {
    const server = servers.find((s) => s.id === id); if (!server) return;
    const checked = await check(server);
    setServers((current) => { const next = current.map((s) => (s.id === id ? checked : s)); persist(next); return next; });
  }, [servers, check]);
  const remove = useCallback((id: string) => update(servers.filter((s) => s.id !== id)), [servers, update]);
  const toggle = useCallback((id: string, enabled: boolean) => update(servers.map((s) => (s.id === id ? { ...s, enabled } : s))), [servers, update]);
  const toolSpecs = useCallback((): ToolSpec[] => servers.filter((s) => s.enabled && s.tools.length).flatMap((server) => server.tools.map((tool) => {
    const name = `${slug(server.name)}.${tool.name}`;
    return { name, description: `${name} ${schemaSummary(tool.inputSchema)}: ${tool.description || "MCP tool"}`, run: (args, signal) => callTool(server, tool.name, args, signal) };
  })), [servers]);
  const enabledToolCount = servers.filter((s) => s.enabled).reduce((n, s) => n + s.tools.length, 0);
  return { servers, add, refresh, remove, toggle, toolSpecs, enabledToolCount };
}
