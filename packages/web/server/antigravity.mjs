// Google's Antigravity managed agent. An execution engine, not a chat model.
//
// Pinned 2026-10-09 from https://ai.google.dev/gemini-api/docs/antigravity-agent.
// Agent id antigravity-preview-09-2026. Re-read that page before changing the id.
//
// The key on the wire is a Gemini API key (header x-goog-api-key). In this product it is a
// different slot from Gemini chat. This module never reads GOOGLE_API_KEY.
import { HttpError } from './proxy.mjs';
import { checkOrigin } from './state.mjs';

export const ANTIGRAVITY_AGENT = 'antigravity-preview-09-2026';
export const ANTIGRAVITY_MODEL = 'gemini-3.8-flash';
export const ANTIGRAVITY_URL = 'https://generativelanguage.googleapis.com/v1beta/interactions';
export const DEFAULT_MAX_TOTAL_TOKENS = 50_000;
const TOKEN_FLOOR = 1_000;
const TOKEN_CEILING = 200_000;
// External tools cannot be safely gated once Google's managed loop owns them.
// Keep execution offline until an app-controlled, per-action approval dispatcher exists.
const DEFAULT_TOOLS = [{ type: 'code_execution' }];

export function enginePolicyError({ skills, continueApproved } = {}) {
  if (continueApproved) return 'A text approval cannot authorize an external tool. Start a new offline run; connector approvals require the application-controlled dispatcher.';
  if (Array.isArray(skills) && skills.some(skill => skill && !skill.demo && skill.enabled !== false)) {
    return 'External connectors are disabled for the managed engine until per-action approvals are implemented. Turn off live connectors to run offline. No connector credentials or run request were sent.';
  }
  return '';
}

export function clampTokenCap(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MAX_TOTAL_TOKENS;
  return Math.min(TOKEN_CEILING, Math.max(TOKEN_FLOOR, Math.floor(n)));
}

/** Offline interactions only. A reused environment also has its network rules replaced. */
export function interactionBody({ input, environmentId, maxTotalTokens, skills, continueApproved }) {
  const error = enginePolicyError({ skills, continueApproved });
  if (error) throw new Error(error);
  return {
    agent: ANTIGRAVITY_AGENT,
    input: typeof input === 'string' && input.trim() ? input.trim().slice(0, 32_000) : 'Continue the current task inside the offline sandbox.',
    agent_config: {
      type: 'antigravity',
      model: ANTIGRAVITY_MODEL,
      max_total_tokens: clampTokenCap(maxTotalTokens),
    },
    tools: DEFAULT_TOOLS.map(tool => ({ ...tool })),
    environment: {
      type: 'remote',
      network: 'disabled',
      ...(typeof environmentId === 'string' && environmentId.trim() ? { environment_id: environmentId.trim().slice(0, 200) } : {}),
    },
  };
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
 * plan, tool, environment, delta, error, done.
 * The engine key is sent only as x-goog-api-key. It is never written into the JSON body.
 */
export async function runAntigravity({ key, input, environmentId, maxTotalTokens, skills, continueApproved, fetchImpl = fetch, signal }) {
  const trimmed = typeof key === 'string' ? key.trim() : '';
  if (!trimmed) {
    return { status: 403, events: [{ type: 'error', message: 'The execution engine is off until its own key is saved. The Gemini chat key is not used.' }] };
  }
  const policyError = enginePolicyError({ skills, continueApproved });
  if (policyError) return { status: 403, events: [{ type: 'error', message: policyError }] };
  const events = [];
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
  // Tool events describe completed upstream work; they are never presented as approvals.
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

export function createEngine({ fetchImpl = fetch, env = process.env } = {}) {
  // The one POST route that carries a visitor-supplied provider key, so it gets the same Origin
  // check and per-IP budget as every other connector. Without a limit here the deployment is an
  // unthrottled relay for anyone holding an engine key.
  const windows = new Map();
  const budget = Math.max(1, Number(env.ENGINE_MAX_PER_HOUR) || 60);
  return async function handler(req, res) {
    const path = new URL(req.url, 'http://engine').pathname;
    if (path !== '/api/engine') return false;
    if (req.method !== 'POST') { res.writeHead(405); res.end(); return true; }
    try { checkOrigin(req, env); }
    catch (error) {
      const status = error instanceof HttpError ? error.status : 403;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: { message: error instanceof Error ? error.message : 'Cross-origin requests are not allowed.' } }));
      return true;
    }
    const ip = req.socket?.remoteAddress || 'unknown'; const now = Date.now();
    for (const [key, value] of windows) if (now - value.start > 3_600_000) windows.delete(key);
    const window = windows.get(ip) || { start: now, count: 0 }; window.count++; windows.set(ip, window);
    if (window.count > budget) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      res.end(JSON.stringify({ error: { message: `Execution engine limit reached (${budget} runs an hour). Try again later.` } }));
      return true;
    }
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
    // Only the visitor's explicit session credential is used. No operator-funded fallback.
    const key = headerKey.trim();
    const skills = Array.isArray(body.skills) ? body.skills.slice(0, 24) : [];
    try {
      const result = await runAntigravity({
        key,
        fetchImpl,
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
