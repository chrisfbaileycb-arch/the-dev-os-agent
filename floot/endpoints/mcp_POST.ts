import superjson from "superjson";
import { z } from "zod";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { schema, OutputType } from "./mcp_POST.schema";
import { proxyProvider } from "../helpers/proxyProvider";
import { rateLimit } from "../helpers/rateLimit";

// Server-only. Forwards one tools/list or tools/call to a remote MCP server over Streamable
// HTTP. Serverless keeps no session, so every request runs the initialize handshake first.
// Guardrails: https only, public hosts only, no redirects, bounded responses, the shared
// per-client rate limit. The bearer token arrives per request and is never stored.

const PROTOCOL = "2025-06-18";
const MAX_RESPONSE = 2_000_000;
const TIMEOUT = 30_000;

const reply = (status: number, body: unknown) =>
  new Response(superjson.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

class McpError extends Error { status: number; constructor(status: number, message: string) { super(message); this.status = status; } }

async function checkServer(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new McpError(400, "Enter a valid MCP server URL."); }
  if (url.protocol !== "https:") throw new McpError(400, "MCP servers must use https.");
  if (url.username || url.password) throw new McpError(400, "URLs with credentials are not allowed.");
  const host = url.hostname.toLowerCase();
  if (isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) throw new McpError(403, "MCP servers must be public hostnames. A server on your own machine is not reachable from a hosted app.");
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some((a) => !proxyProvider.publicAddress(a.address))) throw new McpError(403, "Private, reserved, or unresolvable MCP destinations are blocked.");
  return url;
}

function parseSse(text: string, id: number | undefined): Record<string, unknown> | null {
  let fallback: Record<string, unknown> | null = null;
  for (const block of text.split(/\n\n+/)) {
    const data = block.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("\n");
    if (!data) continue;
    try {
      const message = JSON.parse(data) as Record<string, unknown>;
      if (message.id === id) return message;
      if (!fallback && ("result" in message || "error" in message)) fallback = message;
    } catch { /* keep scanning */ }
  }
  return fallback;
}

async function rpc(url: string, message: Record<string, unknown>, authorization: string | undefined, sessionId: string | null): Promise<{ result: unknown; sessionId: string | null }> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": PROTOCOL };
  if (authorization) headers.Authorization = authorization;
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  let response: Response;
  try { response = await fetch(url, { method: "POST", headers, body: JSON.stringify(message), redirect: "manual", signal: AbortSignal.timeout(TIMEOUT) }); }
  catch (error) { const timedOut = error instanceof Error && error.name === "TimeoutError"; throw new McpError(timedOut ? 504 : 502, timedOut ? "The MCP server took too long to answer." : "Could not reach the MCP server."); }
  const newSession = response.headers.get("mcp-session-id") || sessionId;
  if (response.status >= 300 && response.status < 400) throw new McpError(502, "The MCP server redirected the request. Redirects are not followed.");
  if (response.status === 202 || response.status === 204) return { result: null, sessionId: newSession };
  if (response.status === 401 || response.status === 403) throw new McpError(401, "The MCP server rejected the token.");
  if (!response.ok) throw new McpError(502, `The MCP server answered HTTP ${response.status}.`);
  const text = await response.text();
  if (text.length > MAX_RESPONSE) throw new McpError(502, "The MCP response is too large.");
  const type = response.headers.get("content-type") || "";
  let parsed: Record<string, unknown> | null;
  if (type.includes("text/event-stream")) parsed = parseSse(text, message.id as number | undefined);
  else { try { parsed = JSON.parse(text) as Record<string, unknown>; } catch { throw new McpError(502, "The MCP server did not return JSON."); } }
  if (!parsed) throw new McpError(502, "The MCP server did not answer the request.");
  const error = parsed.error as { message?: unknown } | undefined;
  if (error) throw new McpError(502, `MCP error: ${String(error.message ?? "unknown").slice(0, 300)}`);
  return { result: parsed.result ?? null, sessionId: newSession };
}

export async function handle(request: Request) {
  try {
    const limit = await rateLimit(request);
    if (!limit.allowed) return reply(429, { error: "Request limit reached. Wait one minute." });
    const raw = await request.text();
    if (raw.length > 200_000) return reply(413, { error: "Request is too large." });
    const input = schema.parse(superjson.parse(raw));
    const url = (await checkServer(input.url)).toString();
    const init = await rpc(url, { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: PROTOCOL, capabilities: {}, clientInfo: { name: "Hey Buddy", version: "0.1" } } }, input.authorization, null);
    await rpc(url, { jsonrpc: "2.0", method: "notifications/initialized" }, input.authorization, init.sessionId);
    const out = await rpc(url, { jsonrpc: "2.0", id: 2, method: input.method, params: input.params ?? {} }, input.authorization, init.sessionId);
    return reply(200, { result: out.result } satisfies OutputType);
  } catch (error) {
    if (error instanceof z.ZodError) return reply(400, { error: error.issues[0]?.message ?? "Invalid request." });
    if (error instanceof McpError) return reply(error.status, { error: error.message });
    console.error("mcp proxy failure", error instanceof Error ? error.message : error);
    return reply(502, { error: "MCP request failed." });
  }
}
