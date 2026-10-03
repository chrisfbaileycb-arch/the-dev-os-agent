import { HttpError } from './proxy.mjs';
import { freeTierStatus, monthlyPool } from './freetier.mjs';
import { planAccess } from './plans.mjs';
import { parseSession } from './auth.mjs';

// /api/state: the server copy of a workspace. The X-Workspace-Id header is the only handle;
// there are no accounts, so the id is a bearer of its own data. Keep it in the browser.

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const MAX_BODY = 4_000_000; const MAX_ITEMS = 100; const MAX_SESSIONS = 200; const MAX_RUNS = 200;
const isId = v => typeof v === 'string' && v.length <= 64 && /^[A-Za-z0-9_-]+$/.test(v);
const isIso = v => typeof v === 'string' && ISO.test(v);

function json(res, status, data) { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); }
async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
}
export function checkOrigin(req, env) {
  const origin = req.headers.origin; if (!origin) return;
  const expected = env.APP_ORIGIN;
  let host; try { host = new URL(origin).host; } catch { throw new HttpError(403, 'Cross-origin requests are not allowed.'); }
  if (expected ? origin !== expected : host !== req.headers.host) throw new HttpError(403, 'Cross-origin requests are not allowed.');
}
export function validateSession(s) { if (!s || !isId(s.id) || typeof s.title !== 'string' || s.title.length > 200 || !isIso(s.updatedAt) || !isIso(s.createdAt) || !Array.isArray(s.messages) || s.messages.length > 500 || typeof s.persona !== 'string') throw new HttpError(400, 'Invalid session.'); if (JSON.stringify(s).length > 1_000_000) throw new HttpError(413, 'Session is too large.'); }
export function validateRun(r) { if (!r || !isId(r.id) || !isIso(r.startedAt) || !Array.isArray(r.steps) || typeof r.goal !== 'string') throw new HttpError(400, 'Invalid run.'); if (JSON.stringify(r).length > 1_000_000) throw new HttpError(413, 'Run is too large.'); }
export function validateEntry(e) { if (!e || !isId(e.id) || !isIso(e.at) || typeof e.model !== 'string' || e.model.length > 200 || !['free', 'byok', 'pro'].includes(e.tier) || !['credits', 'byok', 'free'].includes(e.mode) || !Number.isInteger(e.tokens) || e.tokens < 0 || e.tokens > 10_000_000 || typeof e.credits !== 'number' || !Number.isFinite(e.credits) || e.credits < 0 || e.credits > 1_000_000) throw new HttpError(400, 'Invalid ledger entry.'); }

export function createState({ env: baseEnv = process.env, db, settings = null }) {
  // Dashboard settings over the process environment, resolved per request like the proxy does.
  const currentEnv = () => settings ? settings.env(baseEnv) : baseEnv;
  // The zero-config allowance is metered by the proxy, not by the browser, so the balance the
  // client shows for it is read back from the server rather than recomputed from local rows.
  const fundingWorkspace = (req, env) => parseSession(req.headers.cookie, env.SESSION_SECRET)?.workspaceId ?? req.socket.remoteAddress ?? 'unknown';
  const budget = async (workspace, env, req) => ({ pool: Math.max(0, Number(env.CREDIT_MONTHLY_POOL) || 100_000), freePool: monthlyPool(env), freeUsed: await db.usedThisMonth(fundingWorkspace(req, env), new Date(), 'free'), free: freeTierStatus(env) });
  return async function handler(req, res) {
    const path = new URL(req.url, 'http://state').pathname;
    if (!['/api/state', '/api/state/clear', '/api/state/delete', '/api/state/usage', '/api/state/plan'].includes(path)) return false;
    const env = currentEnv();
    try {
      checkOrigin(req, env);
      const workspace = req.headers['x-workspace-id'];
      if (typeof workspace !== 'string' || !ID.test(workspace)) throw new HttpError(400, 'A workspace id header is required.');
      if (path === '/api/state' && req.method === 'GET') { json(res, 200, { ...(await db.state(workspace)), ...(await budget(workspace, env, req)) }); return true; }
      // A cheap read the client polls after a zero-config turn, so the credit meter moves in
      // step with the server's own measurement instead of a guess made in the browser.
      if (path === '/api/state/usage' && req.method === 'GET') { const [b, used, entry] = await Promise.all([budget(workspace, env, req), db.usedThisMonth(workspace), db.latestEntry(fundingWorkspace(req, env), 'free')]); json(res, 200, { ...b, used, entry }); return true; }
      if (req.method !== 'POST') throw new HttpError(405, 'Use GET or POST.');
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      const body = await readBody(req);
      if (path === '/api/state/plan') {
        const plan = planAccess(body.token, env);
        if (!plan) throw new HttpError(401, 'This plan token is invalid or has been revoked.');
        const [used, entry] = await Promise.all([db.usedThisMonth(plan.workspace, new Date(), 'credits'), db.latestEntry(plan.workspace, 'credits')]);
        const { workspace: _workspace, ...publicPlan } = plan;
        json(res, 200, { plan: publicPlan, pool: plan.monthlyCredits, used, entry }); return true;
      }
      if (path === '/api/state/clear') { await db.clear(workspace); json(res, 200, { ok: true }); return true; }
      // Deleting a session has to reach the server too: the tab merges the server's copy back in
      // on every load, so a session removed only from this browser comes back on the next refresh.
      if (path === '/api/state/delete') {
        const ids = Array.isArray(body.sessions) ? body.sessions : [];
        if (ids.length > MAX_ITEMS || !ids.every(isId)) throw new HttpError(400, 'Invalid session ids.');
        await db.removeSessions(workspace, ids); json(res, 200, { ok: true }); return true;
      }
      const sessions = Array.isArray(body.sessions) ? body.sessions : []; const runs = Array.isArray(body.runs) ? body.runs : []; const ledger = Array.isArray(body.ledger) ? body.ledger : [];
      if (sessions.length > MAX_ITEMS || runs.length > MAX_ITEMS || ledger.length > MAX_ITEMS) throw new HttpError(400, 'Too many items in one request.');
      sessions.forEach(validateSession); runs.forEach(validateRun); ledger.forEach(validateEntry);
      const counts = await db.counts(workspace);
      if (counts.sessions + sessions.length > MAX_SESSIONS * 2 || counts.runs + runs.length > MAX_RUNS * 2) throw new HttpError(429, 'Workspace storage limit reached. Clear old sessions first.');
      await Promise.all([sessions.length && db.upsertSessions(workspace, sessions), runs.length && db.upsertRuns(workspace, runs), ledger.length && db.addLedger(workspace, ledger)]);
      const [used, b] = await Promise.all([db.usedThisMonth(workspace), budget(workspace, env, req)]);
      json(res, 200, { ok: true, used, ...b }); return true;
    } catch (error) {
      json(res, error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : 'Workspace storage failed.' } }); return true;
    }
  };
}
