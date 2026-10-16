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
  // User accounts: Google OAuth identity tied to a canonical workspace_id.
  `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, google_id TEXT UNIQUE NOT NULL, email TEXT NOT NULL, name TEXT NOT NULL, picture TEXT NOT NULL, workspace_id TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS users_google_id ON users (google_id)`,
  // Deployment settings entered in the admin dashboard: provider keys (sealed), tier lists, knobs.
  `CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS daily_server_budget (day TEXT PRIMARY KEY, charged_nanos BIGINT NOT NULL DEFAULT 0 CHECK(charged_nanos >= 0), blocked BOOLEAN NOT NULL DEFAULT FALSE)`,
  `CREATE TABLE IF NOT EXISTS server_budget_attempts (id TEXT PRIMARY KEY, day TEXT NOT NULL, charged_nanos BIGINT NOT NULL, settled BOOLEAN NOT NULL DEFAULT FALSE)`,
  // Customer spending controller (server/controller.mjs): global ceiling per UTC day, account
  // spend per billing cycle. Cents, separate from the nanos meter above.
  `CREATE TABLE IF NOT EXISTS controller_global (day TEXT PRIMARY KEY, charged_cents BIGINT NOT NULL DEFAULT 0 CHECK(charged_cents >= 0), blocked BOOLEAN NOT NULL DEFAULT FALSE)`,
  `CREATE TABLE IF NOT EXISTS controller_attempts (id TEXT PRIMARY KEY, day TEXT NOT NULL, charged_cents BIGINT NOT NULL, settled BOOLEAN NOT NULL DEFAULT FALSE)`,
  `CREATE TABLE IF NOT EXISTS controller_customers (user_id TEXT PRIMARY KEY, cycle TEXT NOT NULL, allowance_cents BIGINT NOT NULL DEFAULT 500 CHECK(allowance_cents >= 0), spent_cents BIGINT NOT NULL DEFAULT 0 CHECK(spent_cents >= 0), is_suspended BOOLEAN NOT NULL DEFAULT FALSE, concurrency_limit INTEGER NOT NULL DEFAULT 2 CHECK(concurrency_limit >= 1))`,
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
    async reserveDailyBudget({ id, day, nanos, limit }) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('INSERT INTO daily_server_budget (day) VALUES ($1) ON CONFLICT (day) DO NOTHING', [day]);
        // The conditional UPDATE locks the shared day row: simultaneous instances cannot
        // both spend the same remaining allowance. The attempt and charge commit together.
        const result = await c.query('UPDATE daily_server_budget SET charged_nanos=charged_nanos+$1 WHERE day=$2 AND blocked=FALSE AND charged_nanos<=$3 RETURNING day', [nanos, day, limit - nanos]);
        const accepted = result.rowCount === 1;
        if (accepted) await c.query('INSERT INTO server_budget_attempts (id,day,charged_nanos) VALUES ($1,$2,$3)', [id, day, nanos]);
        await c.query('COMMIT'); return accepted;
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    async settleDailyBudget(id, actual, blocked = false) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const { rows } = await c.query('SELECT day,charged_nanos FROM server_budget_attempts WHERE id=$1 AND settled=FALSE FOR UPDATE', [id]);
        const row = rows[0];
        if (row) {
          await c.query('UPDATE daily_server_budget SET charged_nanos=charged_nanos+$1,blocked=blocked OR $2 WHERE day=$3', [actual - Number(row.charged_nanos), blocked, row.day]);
          await c.query('UPDATE server_budget_attempts SET charged_nanos=$1,settled=TRUE WHERE id=$2', [actual, id]);
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    // Customer spending controller (server/controller.mjs). Mirrors reserveDailyBudget's locking
    // pattern: the conditional UPDATE on the shared day row serialises concurrent spenders, and
    // the attempt and charge commit together. Account spend carries its own billing cycle.
    async controllerGlobalSpent(day) {
      const { rows } = await pool.query('SELECT charged_cents FROM controller_global WHERE day=$1', [day]);
      return Number(rows[0]?.charged_cents ?? 0);
    },
    async controllerTryReserve({ id, day, cents, limit }) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        await c.query('INSERT INTO controller_global (day) VALUES ($1) ON CONFLICT (day) DO NOTHING', [day]);
        const result = await c.query('UPDATE controller_global SET charged_cents=charged_cents+$1 WHERE day=$2 AND blocked=FALSE AND charged_cents<=$3 RETURNING day', [cents, day, limit - cents]);
        const accepted = result.rowCount === 1;
        if (accepted) await c.query('INSERT INTO controller_attempts (id,day,charged_cents) VALUES ($1,$2,$3)', [id, day, cents]);
        await c.query('COMMIT'); return accepted;
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    async controllerSettle(id, actual, blocked = false) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const { rows } = await c.query('SELECT day,charged_cents FROM controller_attempts WHERE id=$1 AND settled=FALSE FOR UPDATE', [id]);
        const row = rows[0];
        if (row) {
          await c.query('UPDATE controller_global SET charged_cents=charged_cents+$1,blocked=blocked OR $2 WHERE day=$3', [actual - Number(row.charged_cents), blocked, row.day]);
          await c.query('UPDATE controller_attempts SET charged_cents=$1,settled=TRUE WHERE id=$2', [actual, id]);
        }
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    async controllerCustomer(userId) {
      const { rows } = await pool.query('SELECT * FROM controller_customers WHERE user_id=$1', [userId]);
      return rows[0] ?? null;
    },
    async controllerUpsertCustomer({ userId, cycle, allowanceCents, concurrencyLimit }) {
      const { rows } = await pool.query(
        `INSERT INTO controller_customers (user_id, cycle, allowance_cents, concurrency_limit) VALUES ($1,$2,$3,$4)
         ON CONFLICT (user_id) DO UPDATE SET
           spent_cents = CASE WHEN controller_customers.cycle <> EXCLUDED.cycle THEN 0 ELSE controller_customers.spent_cents END,
           is_suspended = CASE WHEN controller_customers.cycle <> EXCLUDED.cycle THEN FALSE ELSE controller_customers.is_suspended END,
           cycle = EXCLUDED.cycle, allowance_cents = EXCLUDED.allowance_cents, concurrency_limit = EXCLUDED.concurrency_limit
         RETURNING *`,
        [userId, cycle, allowanceCents, concurrencyLimit]
      );
      return rows[0];
    },
    async controllerAddCustomerSpend(userId, cents) { await pool.query('UPDATE controller_customers SET spent_cents=spent_cents+$1 WHERE user_id=$2', [cents, userId]); },
    async controllerSuspendIfOver(userId) { await pool.query('UPDATE controller_customers SET is_suspended=TRUE WHERE user_id=$1 AND spent_cents>=allowance_cents', [userId]); },
    async controllerSetGlobalCap(day, cents) { await pool.query('INSERT INTO controller_global (day, charged_cents) VALUES ($1,0) ON CONFLICT (day) DO NOTHING', [day]); await pool.query('UPDATE controller_global SET charged_cents=$1 WHERE day=$2', [cents, day]); },
    async upsertSessions(workspace, list) {
      if (!list.length) return;
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        for (const s of list) await c.query(`INSERT INTO sessions (workspace_id,id,updated_at,body) VALUES ($1,$2,$3,$4) ON CONFLICT (workspace_id,id) DO UPDATE SET updated_at=EXCLUDED.updated_at,body=EXCLUDED.body WHERE EXCLUDED.updated_at>=sessions.updated_at`, [workspace, s.id, s.updatedAt, JSON.stringify(s)]);
        await c.query('COMMIT');
      } catch (e) { await c.query('ROLLBACK'); throw e; } finally { c.release(); }
    },
    async removeSessions(workspace, ids) {
      if (!ids.length) return;
      await pool.query('DELETE FROM sessions WHERE workspace_id=$1 AND id = ANY($2::text[])', [workspace, ids]);
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
    // User accounts — only meaningful on the Postgres path; the SQLite adapter has no users table.
    async findOrCreateUser(googleId, email, name, picture) {
      const now = new Date().toISOString();
      const { rows } = await pool.query(
        `INSERT INTO users (id, google_id, email, name, picture, workspace_id, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
         ON CONFLICT (google_id) DO UPDATE SET email=EXCLUDED.email, name=EXCLUDED.name, picture=EXCLUDED.picture, updated_at=EXCLUDED.updated_at
         RETURNING id, google_id, email, name, picture, workspace_id, created_at, updated_at`,
        [randomUUID(), googleId, email, name, picture, randomUUID(), now]
      );
      return rows[0];
    },
    async getUserById(id) {
      const { rows } = await pool.query('SELECT id, google_id, email, name, picture, workspace_id, created_at, updated_at FROM users WHERE id=$1', [id]);
      return rows[0] ?? null;
    },
    async getSetting(key) {
      const { rows } = await pool.query('SELECT value FROM settings WHERE key=$1', [key]);
      return rows[0]?.value ?? null;
    },
    async setSetting(key, value) {
      await pool.query('INSERT INTO settings (key,value,updated_at) VALUES ($1,$2,$3) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value, updated_at=EXCLUDED.updated_at', [key, value, new Date().toISOString()]);
    },
    async deleteSetting(key) { await pool.query('DELETE FROM settings WHERE key=$1', [key]); },
    async createSetting(key, value) {
      const result = await pool.query('INSERT INTO settings (key,value,updated_at) VALUES ($1,$2,$3) ON CONFLICT (key) DO NOTHING', [key, value, new Date().toISOString()]);
      return result.rowCount === 1;
    },
    async allSettings() {
      const { rows } = await pool.query('SELECT key, value FROM settings ORDER BY key');
      return rows;
    },
    close() { return pool.end(); },
  };
}
