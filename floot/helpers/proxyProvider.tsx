import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Provider } from "./runTypes";

// Server-only. Routes a chat or models request to the user's chosen provider.
// Keys arrive per request from the signed-in user and are never stored or logged.

class ProxyError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ProxyError";
    this.status = status;
  }
}

type ChatPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
type ChatMessage = { role: "system" | "user" | "assistant"; content: string | ChatPart[] };

interface ConnectionInput {
  provider: Provider;
  apiKey?: string;
  baseUrl?: string;
}

interface ChatInput extends ConnectionInput {
  model: string;
  messages: ChatMessage[];
  maxTokens: number;
}

const fixedBases: Record<Exclude<Provider, "custom">, string> = {
  openrouter: "https://openrouter.ai/api/v1",
  groq: "https://api.groq.com/openai/v1",
  cohere: "https://api.cohere.com/v2",
};

function publicAddress(ip: string): boolean {
  if (isIP(ip) !== 4) return false; // Conservative: custom endpoints must resolve to public IPv4.
  const [a, b] = ip.split(".").map(Number);
  return !(
    a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && (b === 18 || b === 19))
  );
}

async function resolveTarget(provider: Provider, baseUrl?: string): Promise<{ base: string; native: "openai" | "cohere" }> {
  if (provider !== "custom") return { base: fixedBases[provider], native: provider === "cohere" ? "cohere" : "openai" };
  let url: URL;
  try { url = new URL(baseUrl ?? ""); } catch { throw new ProxyError(400, "Enter a valid custom API base URL including its version path, for example https://inference.example/v1."); }
  if (url.protocol !== "https:") throw new ProxyError(400, "Custom APIs must use HTTPS.");
  if (url.username || url.password || url.search || url.hash) throw new ProxyError(400, "Custom URLs cannot contain credentials, queries, or fragments.");
  const host = url.hostname.toLowerCase();
  if (isIP(host) || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ProxyError(403, "Custom destinations must be public hostnames. Local Ollama is not reachable from a hosted proxy.");
  }
  const addresses = await lookup(host, { all: true }).catch(() => []);
  if (!addresses.length || addresses.some((a) => !publicAddress(a.address))) {
    throw new ProxyError(403, "Private, reserved, or IPv6 custom destinations are blocked.");
  }
  return { base: url.toString().replace(/\/+$/, ""), native: "openai" };
}

function upstreamMessage(status: number): string {
  if (status === 401 || status === 403) return "Invalid API key or insufficient provider permissions.";
  if (status === 429) return "Provider rate limit reached. Wait and retry.";
  if (status === 404) return "Provider endpoint or model was not found.";
  if (status >= 500) return "Provider is temporarily unavailable.";
  return "Provider rejected the request. Check the model and request settings.";
}

function headersFor(provider: Provider, apiKey: string): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  if (provider === "openrouter") {
    headers["HTTP-Referer"] = "https://github.com/chrisfbaileycb-arch/the-dev-os-agent";
    headers["X-Title"] = "Hey Buddy";
  }
  return headers;
}

async function send(url: string, init: RequestInit): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(120_000) });
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "TimeoutError";
    throw new ProxyError(timedOut ? 504 : 502, timedOut ? "Provider request timed out." : "Could not connect to provider.");
  }
  if (response.status >= 300 && response.status < 400) throw new ProxyError(502, "Provider redirected the request. Redirects are not followed.");
  if (!response.ok) {
    const status = response.status === 401 || response.status === 403 ? 401 : response.status === 429 ? 429 : response.status === 404 ? 404 : 502;
    throw new ProxyError(status, upstreamMessage(response.status));
  }
  const text = await response.text();
  if (text.length > 4_000_000) throw new ProxyError(502, "Provider response exceeded the safety limit.");
  try { return JSON.parse(text); } catch { throw new ProxyError(502, "Provider returned an invalid response."); }
}

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => (part && typeof part === "object" && typeof (part as { text?: unknown }).text === "string" ? (part as { text: string }).text : "")).join("");
  }
  return "";
}

async function chat(input: ChatInput): Promise<{ text: string; tokens: number }> {
  const target = await resolveTarget(input.provider, input.baseUrl);
  const apiKey = (input.apiKey ?? "").trim();
  if (!apiKey && input.provider !== "custom") throw new ProxyError(401, "Add your provider API key in Settings. This deployment does not supply server credits.");
  if (target.native === "cohere" && input.messages.some((m) => Array.isArray(m.content))) throw new ProxyError(400, "Cohere native chat does not accept photos here. Choose a vision model on OpenRouter or Groq.");
  const model = input.provider === "groq" ? input.model.trim().replace(/^groq\//, "") : input.model.trim();
  const url = target.native === "cohere" ? `${target.base}/chat` : `${target.base}/chat/completions`;
  const data = (await send(url, {
    method: "POST",
    headers: headersFor(input.provider, apiKey),
    body: JSON.stringify({ model, messages: input.messages, max_tokens: input.maxTokens, stream: false }),
  })) as Record<string, unknown>;
  let text = "";
  let tokens = 0;
  if (target.native === "cohere") {
    const message = data.message as { content?: unknown } | undefined;
    text = textOf(message?.content);
    const usage = (data.usage as { tokens?: { input_tokens?: number; output_tokens?: number } } | undefined)?.tokens;
    tokens = (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0);
  } else {
    const choice = (data.choices as Array<{ message?: { content?: unknown } }> | undefined)?.[0];
    text = textOf(choice?.message?.content);
    const usage = data.usage as { total_tokens?: number } | undefined;
    tokens = Number.isFinite(usage?.total_tokens) ? (usage?.total_tokens as number) : 0;
  }
  if (data.error) throw new ProxyError(502, "Provider reported an error. Check your model, key, and quota.");
  if (!text.trim()) throw new ProxyError(502, "The model returned no text. Try a different model or raise the output limit.");
  return { text, tokens: Math.max(0, Math.round(tokens)) };
}

async function listModels(input: ConnectionInput): Promise<string[]> {
  const target = await resolveTarget(input.provider, input.baseUrl);
  const apiKey = (input.apiKey ?? "").trim();
  if (!apiKey && input.provider !== "custom" && input.provider !== "openrouter") throw new ProxyError(401, "Add your provider API key to load its model list. You can also type a model ID directly.");
  const url = target.native === "cohere" ? "https://api.cohere.com/v1/models" : `${target.base}/models`;
  const data = (await send(url, { method: "GET", headers: headersFor(input.provider, apiKey) })) as Record<string, unknown>;
  const entries = (target.native === "cohere" ? data.models : data.data) as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(entries)) throw new ProxyError(502, "Unsupported model catalog format. You can still type a model ID.");
  return entries
    .map((m) => (target.native === "cohere" ? m.name : m.id))
    .filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200)
    .slice(0, 2000);
}

export const proxyProvider = { chat, listModels, resolveTarget, publicAddress, ProxyError };
