import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname } from 'node:path';

// SQLite persistence for sessions, runs, and the credit ledger. The HTTP handlers establish
// workspace ownership before calling this storage adapter. Bodies are stored as JSON text.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (workspace_id TEXT NOT NULL, id TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (workspace_id, id));
CREATE TABLE IF NOT EXISTS runs (workspace_id TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT, started_at TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (workspace_id, id));
CREATE TABLE IF NOT EXISTS ledger (workspace_id TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, session_id TEXT, model TEXT NOT NULL, tier TEXT NOT NULL, mode TEXT NOT NULL, tokens INTEGER NOT NULL, credits REAL NOT NULL, PRIMARY KEY (workspace_id, id));
CREATE INDEX IF NOT EXISTS ledger_workspace_at ON ledger (workspace_id, at);
CREATE INDEX IF NOT EXISTS sessions_workspace_updated ON sessions (workspace_id, updated_at);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS daily_server_budget (day TEXT PRIMARY KEY, charged_nanos INTEGER NOT NULL DEFAULT 0 CHECK(charged_nanos >= 0), blocked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS server_budget_attempts (id TEXT PRIMARY KEY, day TEXT NOT NULL, charged_nanos INTEGER NOT NULL, settled INTEGER NOT NULL DEFAULT 0);
`;

export function openDatabase(file = ':memory:') {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec(SCHEMA);
  const statements = {
    session: db.prepare('INSERT INTO sessions (workspace_id, id, updated_at, body) VALUES (?, ?, ?, ?) ON CONFLICT (workspace_id, id) DO UPDATE SET updated_at = excluded.updated_at, body = excluded.body WHERE excluded.updated_at >= sessions.updated_at'),
    run: db.prepare('INSERT INTO runs (workspace_id, id, session_id, started_at, body) VALUES (?, ?, ?, ?, ?) ON CONFLICT (workspace_id, id) DO UPDATE SET session_id = excluded.session_id, body = excluded.body'),
    ledger: db.prepare('INSERT OR IGNORE INTO ledger (workspace_id, id, at, session_id, model, tier, mode, tokens, credits) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'),
    sessions: db.prepare('SELECT body FROM sessions WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT 200'),
    runs: db.prepare('SELECT body FROM runs WHERE workspace_id = ? ORDER BY started_at DESC LIMIT 200'),
    entries: db.prepare('SELECT id, at, session_id, model, tier, mode, tokens, credits FROM ledger WHERE workspace_id = ? ORDER BY at DESC LIMIT 2000'),
    used: db.prepare('SELECT COALESCE(SUM(credits), 0) AS used FROM ledger WHERE workspace_id = ? AND mode = ? AND at >= ? AND at < ?'),
    counts: db.prepare('SELECT (SELECT COUNT(*) FROM sessions WHERE workspace_id = ?) AS sessions, (SELECT COUNT(*) FROM runs WHERE workspace_id = ?) AS runs'),
    latest: db.prepare('SELECT id, at, session_id, model, tier, mode, tokens, credits FROM ledger WHERE workspace_id = ? AND mode = ? ORDER BY at DESC LIMIT 1'),
    removeSession: db.prepare('DELETE FROM sessions WHERE workspace_id = ? AND id = ?'),
    clear: [
      db.prepare('DELETE FROM sessions WHERE workspace_id = ?'),
      db.prepare('DELETE FROM runs WHERE workspace_id = ?'),
      db.prepare('DELETE FROM ledger WHERE workspace_id = ?'),
    ],
    getSetting: db.prepare('SELECT value FROM settings WHERE key = ?'),
    setSetting: db.prepare('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'),
    createSetting: db.prepare('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)'),
    deleteSetting: db.prepare('DELETE FROM settings WHERE key = ?'),
    allSettings: db.prepare('SELECT key, value FROM settings ORDER BY key'),
  };
  const parse = rows => rows.map(r => { try { return JSON.parse(r.body); } catch { return null; } }).filter(Boolean);
  return {
    reserveDailyBudget({ id, day, nanos, limit }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        db.prepare('INSERT OR IGNORE INTO daily_server_budget (day) VALUES (?)').run(day);
        const accepted = db.prepare('UPDATE daily_server_budget SET charged_nanos=charged_nanos+? WHERE day=? AND blocked=0 AND charged_nanos<=?').run(nanos, day, limit - nanos).changes === 1;
        if (accepted) db.prepare('INSERT INTO server_budget_attempts (id,day,charged_nanos) VALUES (?,?,?)').run(id, day, nanos);
        db.exec('COMMIT'); return accepted;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    settleDailyBudget(id, actual, blocked = false) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const row = db.prepare('SELECT day,charged_nanos FROM server_budget_attempts WHERE id=? AND settled=0').get(id);
        if (row) {
          db.prepare('UPDATE daily_server_budget SET charged_nanos=charged_nanos+?,blocked=MAX(blocked,?) WHERE day=?').run(actual - row.charged_nanos, blocked ? 1 : 0, row.day);
          db.prepare('UPDATE server_budget_attempts SET charged_nanos=?,settled=1 WHERE id=?').run(actual, id);
        }
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    },
    upsertSessions(workspace, list) { const tx = db.prepare('BEGIN'); tx.run(); try { for (const s of list) statements.session.run(workspace, s.id, s.updatedAt, JSON.stringify(s)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
    /** Forget specific sessions for one workspace. The pull would otherwise hand them straight back. */
    removeSessions(workspace, ids) { db.exec('BEGIN'); try { for (const id of ids) statements.removeSession.run(workspace, id); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
    upsertRuns(workspace, list) { db.exec('BEGIN'); try { for (const r of list) statements.run.run(workspace, r.id, r.sessionId ?? null, r.startedAt, JSON.stringify(r)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
    addLedger(workspace, list) { db.exec('BEGIN'); try { for (const e of list) statements.ledger.run(workspace, e.id, e.at, e.sessionId ?? null, e.model, e.tier, e.mode, e.tokens, e.credits); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
    state(workspace) { return { sessions: parse(statements.sessions.all(workspace)), runs: parse(statements.runs.all(workspace)), ledger: statements.entries.all(workspace).map(e => ({ id: e.id, at: e.at, sessionId: e.session_id ?? undefined, model: e.model, tier: e.tier, mode: e.mode, tokens: e.tokens, credits: e.credits })) }; },
    // Credits a workspace has drawn in the current UTC month for one payment mode. The free
    // tier and the token-funded pool are separate budgets, so the mode is part of the query.
    usedThisMonth(workspace, now = new Date(), mode = 'credits') { const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(); const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(); return Number(statements.used.get(workspace, mode, start, end)?.used ?? 0); },
    /** Write one server-measured ledger row. Used by the proxy to bill the zero-config tier. */
    recordUsage(workspace, { model, tier = 'free', mode = 'free', tokens, credits, sessionId = null, at = new Date().toISOString() }) {
      const entry = { id: randomUUID(), at, sessionId: sessionId ?? undefined, model, tier, mode, tokens: Math.max(0, Math.round(tokens)), credits };
      statements.ledger.run(workspace, entry.id, entry.at, sessionId, model, tier, mode, entry.tokens, credits);
      return entry;
    },
    counts(workspace) { return statements.counts.get(workspace, workspace); },
    /** The newest server-written row for one payment mode, so the client can show it without a full pull. */
    latestEntry(workspace, mode = 'free') { const e = statements.latest.get(workspace, mode); return e ? { id: e.id, at: e.at, sessionId: e.session_id ?? undefined, model: e.model, tier: e.tier, mode: e.mode, tokens: e.tokens, credits: e.credits } : null; },
    clear(workspace) { for (const s of statements.clear) s.run(workspace); },
    // Deployment settings entered in the admin dashboard: provider keys (sealed), tier lists, knobs.
    getSetting(key) { return statements.getSetting.get(key)?.value ?? null; },
    setSetting(key, value) { statements.setSetting.run(key, value, new Date().toISOString()); },
    createSetting(key, value) { return statements.createSetting.run(key, value, new Date().toISOString()).changes === 1; },
    deleteSetting(key) { statements.deleteSetting.run(key); },
    allSettings() { return statements.allSettings.all(); },
    /** The underlying handle, so server/jobs.mjs can own its own table in the same file. */
    raw() { return db; },
    close() { db.close(); },
  };
}
