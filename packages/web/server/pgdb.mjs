import { randomUUID } from 'node:crypto';
import pg from 'pg';

// Postgres adapter. Implements the same interface as openDatabase() in db.mjs so callers
// can swap between the two without changes — every method is async, and `await` on the
// SQLite sync version is a no-op, so callers work with both.

const { Pool } = pg;

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS sessions (workspace_id TEXT NOT NULL, id TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (workspace_id, id))`,
  `CREATE TABLE IF NOT EXISTS runs (workspace_id TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT, started_at TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (workspace_id, id))`,
  `CREATE TABLE IF NOT EXISTS ledger (workspace_id TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, session_id TEXT, model TEXT NOT NULL, tier TEXT NOT NULL, mode TEXT NOT NULL, tokens INTEGER NOT NULL, credits REAL NOT NULL, PRIMARY KEY (workspace_id, id))`,
  `CREATE INDEX IF NOT EXISTS ledger_workspace_at ON ledger (workspace_id, at)`,
  `CREATE INDEX IF NOT EXISTS sessions_workspace_updated ON sessions (workspace_id, updated_at)`,
];

export async function openPostgresDb(connectionString) {
  const ssl = /sslmode=require/.test(connectionString) ? { rejectUnauthorized: false } : false;
  const pool = new Pool({ connectionString, max: 5, ssl });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const stmt of SCHEMA) await client.query(stmt);
    await client.query('COMMIT');
  } catch (e) { await client.query('ROLLBACK'); throw e; }
  finally { client.release(); }

  const parse = rows => rows.map(r => { try { return JSON.parse(r.body); } catch { return null; } }).filter(Boolean);

  return {
    async upsertSessions(workspace, list) {
      if (!list.length) return;
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const s of list) await c.query(`INSERT INTO sessions (workspace_id,id,updated_at,body) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,id) DO UPDATE SET updated_at=EXCLUDED.updated_at,body=EXCLUDED.body WHERE EXCLUDED.updated_at>=sessions.updated_at`, [workspace, s.id, s.updatedAt, JSON.stringify(s)]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    async upsertRuns(workspace, list) {
      if (!list.length) return;
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const r of list) await c.query(`INSERT INTO runs (workspace_id,id,session_id,started_at,body) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (workspace_id,id) DO UPDATE SET session_id=EXCLUDED.session_id,body=EXCLUDED.body`, [workspace, r.id, r.sessionId ?? null, r.startedAt, JSON.stringify(r)]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    async addLedger(workspace, list) {
      if (!list.length) return;
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const e of list) await c.query(`INSERT INTO ledger (workspace_id,id,at,session_id,model,tier,mode,tokens,credits) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (workspace_id,id) DO NOTHING`, [workspace, e.id, e.at, e.sessionId ?? null, e.model, e.tier, e.mode, e.tokens, e.credits]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    async state(workspace) {
      const [s, r, l] = await Promise.all([
        pool.query('SELECT body FROM sessions WHERE workspace_id=$1 ORDER BY updated_at DESC LIMIT 200', [workspace]),
        pool.query('SELECT body FROM runs WHERE workspace_id=$1 ORDER BY started_at DESC LIMIT 200', [workspace]),
        pool.query('SELECT id,at,session_id,model,tier,mode,tokens,credits FROM ledger WHERE workspace_id=$1 ORDER BY at DESC LIMIT 2000', [workspace]),
      ]);
      return { sessions: parse(s.rows), runs: parse(r.rows), ledger: l.rows.map(e => ({ id: e.id, at: e.at, sessionId: e.session_id ?? undefined, model: e.model, tier: e.tier, mode: e.mode, tokens: Number(e.tokens), credits: Number(e.credits) })) };
    },
    async usedThisMonth(workspace, now = new Date(), mode = 'credits') {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString();
      const { rows } = await pool.query('SELECT COALESCE(SUM(credits),0) AS used FROM ledger WHERE workspace_id=$1 AND mode=$2 AND at>=$3 AND at<$4', [workspace, mode, start, end]);
      return Number(rows[0]?.used ?? 0);
    },
    async recordUsage(workspace, { model, tier = 'free', mode = 'free', tokens, credits, sessionId = null, at = new Date().toISOString() }) {
      const id = randomUUID();
      const entry = { id, at, sessionId: sessionId ?? undefined, model, tier, mode, tokens: Math.max(0, Math.round(tokens)), credits };
      await pool.query(`INSERT INTO ledger (workspace_id,id,at,session_id,model,tier,mode,tokens,credits) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (workspace_id,id) DO NOTHING`, [workspace, id, at, sessionId, model, tier, mode, entry.tokens, credits]);
      return entry;
    },
    async counts(workspace) {
      const { rows } = await pool.query('SELECT (SELECT COUNT(*) FROM sessions WHERE workspace_id=$1)::int AS sessions,(SELECT COUNT(*) FROM runs WHERE workspace_id=$1)::int AS runs', [workspace]);
      return { sessions: rows[0].sessions, runs: rows[0].runs };
    },
    async latestEntry(workspace, mode = 'free') {
      const { rows } = await pool.query('SELECT id,at,session_id,model,tier,mode,tokens,credits FROM ledger WHERE workspace_id=$1 AND mode=$2 ORDER BY at DESC LIMIT 1', [workspace, mode]);
      const e = rows[0];
      return e ? { id: e.id, at: e.at, sessionId: e.session_id ?? undefined, model: e.model, tier: e.tier, mode: e.mode, tokens: Number(e.tokens), credits: Number(e.credits) } : null;
    },
    async clear(workspace) {
      await Promise.all(['sessions','runs','ledger'].map(t => pool.query(`DELETE FROM ${t} WHERE workspace_id=$1`, [workspace])));
    },
    close() { return pool.end(); },
  };
}
