// Google's Antigravity managed agent. An execution engine, not a chat model.
//
// Pinned 2026-10-09 from https://ai.google.dev/gemini-api/docs/antigravity-agent.
// Agent id antigravity-preview-09-2026. Re-read that page before changing the id.
//
// The key on the wire is a Gemini API key (header x-goog-api-key). In this product it is a
// different slot from Gemini chat. This module never reads GOOGLE_API_KEY.

export const ANTIGRAVITY_AGENT = 'antigravity-preview-09-2026';
export const ANTIGRAVITY_MODEL = 'gemini-3.8-flash';
export const ANTIGRAVITY_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const CREDENTIALS_URL = 'https://generativelanguage.googleapis.com/v1beta/credentials';
export const DEFAULT_MAX_TOTAL_TOKENS = 50_000;
const TOKEN_FLOOR = 1_000;
const TOKEN_CEILING = 200_000;

const DEFAULT_TOOLS = [
  { type: 'code_execution' },
  { type: 'google_search' },
  { type: 'url_context' },
];

// A tool whose name says it spends money, sends a message, or is an MCP call the sandbox
// would make on the visitor's behalf. The default tools stay inside Google's sandbox.
const LEAVES_SANDBOX = /(pay|stripe|charge|invoice|billing|checkout|sms|twilio|send[_-]?mail|send[_-]?message|slack|email|discord|whatsapp)/i;

export function clampTokenCap(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_TOTAL_TOKENS;
  return Math.min(TOKEN_CEILING, Math.max(TOKEN_FLOOR, Math.floor(n)));
}

/** MCP tool names must match ^[a-z0-9_-]+$. Anything else is rewritten, never forwarded raw. */
export function mcpToolName(name) {
  const clean = String(name ?? '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return clean || 'skill';
}

/**
 * Live skills only. Demo entries, empty URLs, and SSE transports are dropped.
 * The token is not placed on the tool. It is stored with the Credentials API and referenced by id.
 * @param {Array<{ name?: string, url?: string, token?: string, transport?: string, demo?: boolean, enabled?: boolean }>} skills
 */
export function liveMcpTools(skills) {
  const tools = [];
  const credentials = [];
  const seen = new Set();
  for (const skill of Array.isArray(skills) ? skills : []) {
    if (!skill || skill.demo || skill.enabled === false) continue;
    if (skill.transport === 'sse') continue;
    const url = typeof skill.url === 'string' ? skill.url.trim() : '';
    if (!/^https:\/\//.test(url)) continue;
    let name = mcpToolName(skill.name);
    while (seen.has(name)) name = `${name}-${seen.size}`.slice(0, 48);
    seen.add(name);
    const tool = { type: 'mcp_server', name, url };
    const token = typeof skill.token === 'string' ? skill.token.trim() : '';
    if (token) {
      const id = `sf-${name}`.slice(0, 64);
      tool.credential = id;
      credentials.push({ id, type: 'bearer_token', token });
    }
    tools.push(tool);
  }
  return { tools, credentials };
}

/** The interactions body. Temperature and other generation params are never copied in. */
export function interactionBody({ input, environmentId, maxTotalTokens, skills, continueApproved }) {
  const { tools } = liveMcpTools(skills);
  const body = {
    agent: ANTIGRAVITY_AGENT,
    input: typeof input === 'string' && input.trim() ? input.trim().slice(0, 32_000) : 'Continue the current task inside the sandbox.',
    agent_config: {
      type: 'antigravity',
      model: ANTIGRAVITY_MODEL,
      max_total_tokens: clampTokenCap(maxTotalTokens),
    },
    tools: [...DEFAULT_TOOLS, ...tools],
  };
  if (typeof environmentId === 'string' && environmentId.trim()) body.environment_id = environmentId.trim().slice(0, 200);
  else body.environment = 'remote';
  if (continueApproved) body.input = `The operator approved "${String(continueApproved).slice(0, 80)}". Continue inside the sandbox. Do not spend money, send a message, or call a connector that leaves the sandbox unless that approval names it.`;
  return body;
}

/** True when a streamed tool should stop for the visitor before it leaves the sandbox. */
export function needsApproval(toolName) {
  const name = String(toolName ?? '');
  if (!name) return false;
  if (['code_execution', 'google_search', 'url_context', 'filesystem'].includes(name)) return false;
  return LEAVES_SANDBOX.test(name) || name.startsWith('mcp:') || name.startsWith('sf-');
}

function textFrom(value) {
  if (typeof value === 'string') return value;
  if (!value || typeof value !== 'object') return '';
  if (typeof value.text === 'string') return value.text;
  if (typeof value.content === 'string') return value.content;
  if (Array.isArray(value.parts)) return value.parts.map(textFrom).filter(Boolean).join('');
  if (Array.isArray(value.content)) return value.content.map(textFrom).filter(Boolean).join('');
  return '';
}

/** Pull plan text, tool names, and the sandbox id out of one interactions payload. */
export function readInteraction(payload) {
  const events = [];
  if (!payload || typeof payload !== 'object') return events;
  const env = payload.environment_id || payload.environmentId || (payload.environment && typeof payload.environment === 'object' ? payload.environment.id : null);
  if (typeof env === 'string' && env.trim()) events.push({ type: 'environment', id: env.trim() });
  const plan = textFrom(payload.plan) || textFrom(payload.output) || textFrom(payload);
  const steps = []
    .concat(payload.steps || [], payload.actions || [], payload.tool_calls || [], payload.outputs || [])
    .filter(Boolean);
  if (plan && !steps.length) events.push({ type: 'plan', text: plan.slice(0, 20_000) });
  for (const step of steps) {
    const name = step.name || step.tool || step.type || 'step';
    const detail = textFrom(step.input) || textFrom(step.args) || textFrom(step.arguments) || textFrom(step.result) || textFrom(step.output) || textFrom(step);
    if (step.type === 'plan' || name === 'plan') events.push({ type: 'plan', text: detail.slice(0, 20_000) });
    else events.push({ type: 'tool', name: String(name).slice(0, 80), detail: detail.slice(0, 4_000) });
  }
  const finalText = textFrom(payload.output_text) || textFrom(payload.final) || (typeof payload.output === 'string' ? payload.output : '');
  if (finalText) events.push({ type: 'delta', text: finalText.slice(0, 100_000) });
  return events;
}

async function readJson(response) {
  const text = await response.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

/**
 * Run one interactions call. `fetchImpl` is injectable. Emits our own SSE events:
 * plan, tool, environment, delta, approval, error, done.
 * The engine key is sent only as x-goog-api-key. It is never written into the JSON body.
 */
export async function runAntigravity({ key, input, environmentId, maxTotalTokens, skills, continueApproved, fetchImpl = fetch, signal }) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) {
    return { status: 403, events: [{ type: 'error', message: 'The execution engine is off until its own key is saved. The Gemini chat key is not used.' }] };
  }
  const { credentials } = liveMcpTools(skills);
  const events = [];
  for (const credential of credentials) {
    const saved = await fetchImpl(CREDENTIALS_URL, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': trimmed },
      body: JSON.stringify(credential),
    });
    if (!saved.ok) {
      const body = await readJson(saved);
      const message = body?.error?.message || `Could not store a connector credential (HTTP ${saved.status}). The run was not started.`;
      return { status: 502, events: [{ type: 'error', message }] };
    }
  }
  const body = interactionBody({ input, environmentId, maxTotalTokens, skills, continueApproved });
  const upstream = await fetchImpl(ANTIGRAVITY_URL, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-goog-api-key': trimmed },
    body: JSON.stringify(body),
  });
  if (!upstream.ok) {
    const failure = await readJson(upstream);
    const message = failure?.error?.message || failure?.raw || `Execution engine refused the run (HTTP ${upstream.status}).`;
    return { status: upstream.status, events: [{ type: 'error', message: String(message).slice(0, 500) }] };
  }
  const contentType = upstream.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/event-stream') || !upstream.body?.getReader) {
    const payload = await readJson(upstream);
    events.push(...readInteraction(payload));
  } else {
    const reader = upstream.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split('\n\n');
      buffer = chunks.pop() ?? '';
      for (const chunk of chunks) {
        const data = chunk.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
        if (!data || data === '[DONE]') continue;
        try { events.push(...readInteraction(JSON.parse(data))); } catch { events.push({ type: 'plan', text: data.slice(0, 4_000) }); }
      }
    }
  }
  for (const event of events) {
    if (event.type === 'tool' && needsApproval(event.name)) {
      events.push({ type: 'approval', name: event.name, detail: event.detail || '' });
      return { status: 200, events, held: true };
    }
  }
  events.push({ type: 'done' });
  return { status: 200, events, held: false };
}

export function writeSse(res, events) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'X-Content-Type-Options': 'nosniff',
    Connection: 'keep-alive',
  });
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.end();
}

export function createEngine({ env: baseEnv = process.env, settings = null } = {}) {
  return async function handler(req, res) {
    const path = new URL(req.url, 'http://engine').pathname;
    if (path !== '/api/engine') return false;
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
    const chunks = [];
    let size = 0;
    for await (const chunk of req) {
      size += chunk.length;
      if (size > 1_000_000) { res.writeHead(413); res.end(); return true; }
      chunks.push(chunk);
    }
    let body = {};
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { res.writeHead(400); res.end('{"error":{"message":"Invalid JSON."}}'); return true; }
    const headerKey = typeof req.headers['x-engine-key'] === 'string' ? req.headers['x-engine-key'] : '';
    const env = settings?.env ? settings.env(baseEnv) : baseEnv;
    const stored = typeof env.ANTIGRAVITY_API_KEY === 'string' ? env.ANTIGRAVITY_API_KEY : '';
    // The header is the browser slot. The stored admin secret is used only when the header is empty.
    // GOOGLE_API_KEY is intentionally not consulted.
    const key = headerKey.trim() || stored.trim();
    const skills = Array.isArray(body.skills) ? body.skills.slice(0, 24) : [];
    try {
      const result = await runAntigravity({
        key,
        input: body.input,
        environmentId: body.environmentId,
        maxTotalTokens: body.maxTotalTokens,
        skills,
        continueApproved: body.continueApproved,
      });
      if (result.status !== 200) {
        res.writeHead(result.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify({ error: { message: result.events[0]?.message || 'Execution engine failed.' } }));
        return true;
      }
      writeSse(res, result.events);
    } catch (error) {
      res.writeHead(502, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error?.message || 'Execution engine failed.' } }));
    }
    return true;
  };
}
