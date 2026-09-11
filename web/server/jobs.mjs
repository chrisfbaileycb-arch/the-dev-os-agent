import { randomUUID } from 'node:crypto';
import { timingSafeEqual } from 'node:crypto';
import { HttpError } from './proxy.mjs';
import { checkOrigin } from './state.mjs';

// /api/jobs: the hand-off between Render's two services.
//
// Render's topology puts a public HTTP Web Service and a Background Worker in separate
// containers. A disk attaches to exactly one service, so the two cannot share this SQLite file
// directly; the web service owns the database and the worker reaches it over HTTP on the
// private network, authenticated by WORKER_TOKEN. That is the whole protocol:
//
//   browser  POST /api/jobs          enqueue a workflow, get an id back
//   browser  GET  /api/jobs?id=…     poll status and stage output
//   worker   POST /api/jobs/claim    lease the oldest queued job  (WORKER_TOKEN)
//   worker   POST /api/jobs/update   report stage progress        (WORKER_TOKEN)
//   worker   POST /api/jobs/finish   post the finished run        (WORKER_TOKEN)
//
// Heavy multi-step runs therefore survive the browser tab closing, and a slow workflow never
// occupies a web dyno that should be streaming SSE. When no worker is deployed the route still
// answers: /api/jobs reports `worker: false` and the browser keeps running workflows in its own
// Web Worker, which is the default and needs no second service at all.
//
// Queued jobs are written to disk, so a job may not carry a secret: only zero-config runs are
// accepted here. A visitor's own API key stays in their tab and their workflows run there.

const LEASE_MS = 5 * 60_000;
const MAX_ATTEMPTS = 2;
const MAX_BODY = 2_000_000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, leased_until TEXT, attempts INTEGER NOT NULL DEFAULT 0,
  request TEXT NOT NULL, result TEXT, error TEXT);
CREATE INDEX IF NOT EXISTS jobs_queue ON jobs (status, created_at);
CREATE INDEX IF NOT EXISTS jobs_workspace ON jobs (workspace_id, created_at);
`;

/** Job storage on the web service's disk. The worker never touches SQLite; it goes through HTTP. */
export function openJobs(db) {
  const handle = db.raw();
  handle.exec(SCHEMA);
  const statements = {
    insert: handle.prepare('INSERT INTO jobs (id, workspace_id, status, created_at, updated_at, request) VALUES (?, ?, ?, ?, ?, ?)'),
    get: handle.prepare('SELECT * FROM jobs WHERE id = ? AND workspace_id = ?'),
    next: handle.prepare("SELECT * FROM jobs WHERE status = 'queued' OR (status = 'running' AND leased_until < ?) ORDER BY created_at LIMIT 1"),
    lease: handle.prepare("UPDATE jobs SET status = 'running', leased_until = ?, attempts = attempts + 1, updated_at = ? WHERE id = ? AND (status = 'queued' OR (status = 'running' AND leased_until < ?))"),
    progress: handle.prepare("UPDATE jobs SET result = ?, leased_until = ?, updated_at = ? WHERE id = ? AND status = 'running'"),
    finish: handle.prepare('UPDATE jobs SET status = ?, result = ?, error = ?, leased_until = NULL, updated_at = ? WHERE id = ?'),
    queued: handle.prepare("SELECT COUNT(*) AS n FROM jobs WHERE status IN ('queued', 'running')"),
    sweep: handle.prepare("UPDATE jobs SET status = 'failed', error = 'The background worker did not finish this job.', leased_until = NULL, updated_at = ? WHERE status = 'running' AND leased_until < ? AND attempts >= ?"),
    prune: handle.prepare("DELETE FROM jobs WHERE created_at < ?"),
  };
  const row = r => r && ({ id: r.id, status: r.status, createdAt: r.created_at, updatedAt: r.updated_at, attempts: r.attempts, request: JSON.parse(r.request), result: r.result ? JSON.parse(r.result) : null, error: r.error ?? null });
  return {
    enqueue(workspace, request) { const at = new Date().toISOString(); const id = randomUUID(); statements.insert.run(id, workspace, 'queued', at, at, JSON.stringify(request)); return { id, status: 'queued', createdAt: at }; },
    get(workspace, id) { return row(statements.get.get(id, workspace)); },
    /** Lease the oldest queued job, or reclaim one whose lease expired. Returns null when idle. */
    claim(now = new Date()) {
      const iso = now.toISOString();
      statements.sweep.run(iso, iso, MAX_ATTEMPTS);
      const candidate = statements.next.get(iso);
      if (!candidate) return null;
      const changed = statements.lease.run(new Date(now.getTime() + LEASE_MS).toISOString(), iso, candidate.id, iso);
      if (!changed.changes) return null;
      return { id: candidate.id, workspaceId: candidate.workspace_id, attempts: candidate.attempts + 1, request: JSON.parse(candidate.request) };
    },
    /** Store partial output and extend the lease, so a long run is visible while it happens. */
    progress(id, result, now = new Date()) { statements.progress.run(JSON.stringify(result), new Date(now.getTime() + LEASE_MS).toISOString(), now.toISOString(), id); },
    finish(id, { status, result = null, error = null }) { statements.finish.run(status, result ? JSON.stringify(result) : null, error, new Date().toISOString(), id); },
    depth() { return Number(statements.queued.get()?.n ?? 0); },
    prune(before) { statements.prune.run(before); },
  };
}

const constantEquals = (a, b) => typeof a === 'string' && typeof b === 'string' && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function readBody(req) {
  let size = 0; const chunks = [];
  for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
  if (!size) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createJobs({ env = process.env, jobs }) {
  const token = env.WORKER_TOKEN || '';
  // Workers announce themselves by claiming; the browser uses this to decide whether offloading
  // a workflow is worth it, and falls back to its own Web Worker when nothing has checked in.
  let lastSeen = 0;
  const workerOnline = () => Boolean(token) && Date.now() - lastSeen < 120_000;

  return async function handler(req, res) {
    const path = new URL(req.url, 'http://jobs').pathname;
    if (!path.startsWith('/api/jobs')) return false;
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      const worker = ['/api/jobs/claim', '/api/jobs/update', '/api/jobs/finish'].includes(path);
      if (worker) {
        // Service-to-service: a shared token, not a browser origin. Never CORS-checked, because
        // the caller is another Render service and sends no Origin.
        const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
        if (!token || !constantEquals(supplied, token)) throw new HttpError(401, 'Worker authorization failed.');
        lastSeen = Date.now();
        if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
        const body = await readBody(req);
        if (path === '/api/jobs/claim') { const job = jobs.claim(); json(200, { job }); return true; }
        if (typeof body.id !== 'string' || !ID.test(body.id)) throw new HttpError(400, 'A job id is required.');
        if (path === '/api/jobs/update') { jobs.progress(body.id, body.run ?? null); json(200, { ok: true }); return true; }
        jobs.finish(body.id, { status: body.status === 'completed' ? 'completed' : 'failed', result: body.run ?? null, error: typeof body.error === 'string' ? body.error.slice(0, 500) : null });
        json(200, { ok: true }); return true;
      }

      checkOrigin(req, env);
      const workspace = req.headers['x-workspace-id'];
      if (typeof workspace !== 'string' || !ID.test(workspace)) throw new HttpError(400, 'A workspace id header is required.');
      if (path !== '/api/jobs') throw new HttpError(404, 'Unknown jobs route.');
      if (req.method === 'GET') {
        const id = new URL(req.url, 'http://jobs').searchParams.get('id');
        if (!id) { json(200, { worker: workerOnline(), depth: jobs.depth() }); return true; }
        if (!ID.test(id)) throw new HttpError(400, 'Invalid job id.');
        const job = jobs.get(workspace, id);
        if (!job) throw new HttpError(404, 'No such job in this workspace.');
        json(200, { job: { id: job.id, status: job.status, run: job.result, error: job.error, updatedAt: job.updatedAt } });
        return true;
      }
      if (req.method !== 'POST') throw new HttpError(405, 'Use GET or POST.');
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      if (!workerOnline()) throw new HttpError(503, 'No background worker is running on this deployment. Workflows run in your browser instead.');
      const body = await readBody(req);
      const request = body.request;
      if (!request || typeof request !== 'object' || typeof request.goal !== 'string' || !request.goal.trim() || request.goal.length > 12_000) throw new HttpError(400, 'A workflow goal is required.');
      if (!['build', 'research', 'review'].includes(request.workflow)) throw new HttpError(400, 'Unknown workflow.');
      // A queued job sits on disk until a worker claims it, so it must never hold a credential.
      const connection = request.connection ?? {};
      if (connection.token || connection.apiKey || connection.serverAccessToken) throw new HttpError(400, 'Background jobs are stored until a worker claims them, so they cannot carry a key. Runs on your own key stay in your browser.');
      if (connection.inference && connection.inference !== 'free') throw new HttpError(400, 'Only free-tier runs can be sent to the background worker.');
      if (jobs.depth() > 200) throw new HttpError(429, 'The background queue is full. Try again shortly.');
      json(202, { job: jobs.enqueue(workspace, request) });
      return true;
    } catch (error) { json(error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : 'Job request failed.' } }); return true; }
  };
}
