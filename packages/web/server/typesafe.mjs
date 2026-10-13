import { HttpError } from './proxy.mjs';
import { checkOrigin } from './state.mjs';

// /api/typesafe/systemone: an optional, strictly opt-in System-1 router.
//
// TypeSafe (https://typesafe.ai) answers typed questions — a Choice, a Score, or a Noul (yes/no)
// — against a `state` you provide, returning decisions and probabilities the client can branch on.
// This is a "System 1" call: a fast, cheap classifier for routing, not a generative model.
//
// Two rules make this safe on a public host:
//
//   * BYOK only, never funded. The operator sets no JEV_API_KEY and this route never reads one, so
//     there is no server-funded lane to exhaust. A request that carries no key is refused. A plan
//     token buys nothing here — the funder is always the visitor's own key.
//   * The browser never talks to api.typesafe.ai. The call is made here, server-side, so the app's
//     connect-src stays 'self' and the key travels only in this request. Widening connect-src to
//     reach TypeSafe from the page would hand the key to any injected script instead.
//
// The route is off unless TYPESAFE_ENABLED=true, so a deployment that never configured it has no
// third-party egress at all.

const ORIGIN = 'https://api.typesafe.ai';
const MODEL = 'jev-latest';
const MAX_BODY = 256_000;
const MAX_QUESTIONS = 20;
const MAX_INSTRUCTIONS = 4_000;
const MAX_OPTIONS = 255;
const MAX_LEVELS = 10;

/** The request shape TypeSafe documents; validated here so we never forward junk upstream. */
export function cleanQuestions(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new HttpError(400, 'questions must be an object of named typed questions.');
  const names = Object.keys(input);
  if (!names.length) throw new HttpError(400, 'At least one question is required.');
  if (names.length > MAX_QUESTIONS) throw new HttpError(400, `Use at most ${MAX_QUESTIONS} questions per call.`);
  const instructions = value => {
    if (typeof value === 'string') { if (!value.trim() || value.length > MAX_INSTRUCTIONS) throw new HttpError(400, 'Each question needs instructions under 4,000 characters.'); return value; }
    // A structured instruction holds the question plus the data it refers to; bound it and move on.
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new HttpError(400, 'Question instructions must be text or an object.');
    if (JSON.stringify(value).length > MAX_INSTRUCTIONS) throw new HttpError(400, 'Question instructions are too large.');
    return value;
  };
  const out = {};
  for (const name of names) {
    const q = input[name];
    if (!q || typeof q !== 'object' || typeof q.type !== 'string') throw new HttpError(400, `Question "${name}" needs a type.`);
    if (q.type === 'noul') out[name] = { type: 'noul', instructions: instructions(q.instructions), ...(q.criteria ? { criteria: q.criteria } : {}) };
    else if (q.type === 'choice') {
      const options = q.criteria;
      if (!options || typeof options !== 'object' || Array.isArray(options)) throw new HttpError(400, `Choice "${name}" needs a criteria map of option to description.`);
      if (Object.keys(options).length > MAX_OPTIONS) throw new HttpError(400, `Choice "${name}" has too many options.`);
      out[name] = { type: 'choice', instructions: instructions(q.instructions), criteria: options };
    } else if (q.type === 'score') {
      const levels = q.criteria;
      if (!Array.isArray(levels) || levels.length < 2 || levels.length > MAX_LEVELS || levels.some(l => typeof l !== 'string')) throw new HttpError(400, `Score "${name}" needs 2 to ${MAX_LEVELS} level descriptions.`);
      out[name] = { type: 'score', instructions: instructions(q.instructions), criteria: levels };
    } else throw new HttpError(400, `Question "${name}" has an unknown type. Use noul, choice, or score.`);
  }
  return out;
}

/** A TypeSafe key is opaque here; we only require it to be a header-safe, non-empty string. */
export function cleanTypesafeKey(value) {
  if (typeof value !== 'string') return '';
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 8_192) return '';
  return /^[\x20-\x7e]+$/.test(trimmed) ? trimmed : '';
}

export function createTypesafe({ env = process.env, fetchImpl = fetch } = {}) {
  const rateWindows = new Map();

  async function handler(req, res) {
    let path; try { path = new URL(req.url, 'http://typesafe').pathname; } catch { return false; }
    if (path !== '/api/typesafe/systemone') return false;
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      if (env.TYPESAFE_ENABLED !== 'true') throw new HttpError(503, 'The TypeSafe router is not enabled on this deployment.', 'typesafe_disabled');
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
      checkOrigin(req, env);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      // Rate limit on the network address, like the proxy and the browser tool: a browser-supplied
      // header can change on every request and would make each request its own fresh budget.
      const ip = req.socket.remoteAddress || 'unknown'; const now = Date.now();
      for (const [k, v] of rateWindows) if (now - v.start > 60_000) rateWindows.delete(k);
      const window = rateWindows.get(ip) || { start: now, count: 0 }; window.count++; rateWindows.set(ip, window);
      if (window.count > 60) throw new HttpError(429, 'Router request limit reached. Wait one minute.');
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
      if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Expected an object.');
      // BYOK only. A plan token is deliberately ignored: there is no server-funded lane here.
      const apiKey = cleanTypesafeKey(body.apiKey);
      if (!apiKey) throw new HttpError(401, 'The TypeSafe router needs your own key. Add it in Settings.', 'key_required');
      if (body.state === undefined) throw new HttpError(400, 'A state is required.');
      const questions = cleanQuestions(body.questions);
      const url = `${ORIGIN}/v1/systemone`;
      let upstream;
      try {
        upstream = await fetchImpl(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', Authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({ state: body.state, model: MODEL, questions }),
          signal: AbortSignal.timeout(60_000),
        });
      } catch { throw new HttpError(502, 'Could not reach the TypeSafe router.'); }
      let payload;
      try { payload = await upstream.json(); } catch { payload = null; }
      if (!upstream.ok) {
        // Name the status plainly. Never echo the upstream body, which could reflect the key.
        if (upstream.status === 401) throw new HttpError(401, 'TypeSafe rejected this key.', 'key_rejected');
        if (upstream.status === 422) throw new HttpError(422, 'TypeSafe rejected the request as invalid.');
        throw new HttpError(upstream.status === 429 || upstream.status === 529 ? 429 : 502, `The TypeSafe router answered HTTP ${upstream.status}.`);
      }
      if (!payload || typeof payload !== 'object') throw new HttpError(502, 'The TypeSafe router returned an unexpected reply.');
      // Pass the structured answers through. Routing decisions stay in the caller's code.
      json(200, { model: payload.model ?? MODEL, answers: payload.answers ?? {}, usage: payload.usage ?? null });
      return true;
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      json(status, { error: { message: error instanceof HttpError ? error.message : 'The router failed.', code: error instanceof HttpError ? error.code : undefined } });
      return true;
    }
  }
  return handler;
}
