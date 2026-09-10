import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

// SQLite persistence for sessions, runs, and the credit ledger, keyed by an anonymous workspace
// id the browser mints. No accounts: the id is the only handle. Bodies are stored as JSON text.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (workspace_id TEXT NOT NULL, id TEXT NOT NULL, updated_at TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (workspace_id, id));
CREATE TABLE IF NOT EXISTS runs (workspace_id TEXT NOT NULL, id TEXT NOT NULL, session_id TEXT, started_at TEXT NOT NULL, body TEXT NOT NULL, PRIMARY KEY (workspace_id, id));
CREATE TABLE IF NOT EXISTS ledger (workspace_id TEXT NOT NULL, id TEXT NOT NULL, at TEXT NOT NULL, session_id TEXT, model TEXT NOT NULL, tier TEXT NOT NULL, mode TEXT NOT NULL, tokens INTEGER NOT NULL, credits REAL NOT NULL, PRIMARY KEY (workspace_id, id));
CREATE INDEX IF NOT EXISTS ledger_workspace_at ON ledger (workspace_id, at);
CREATE INDEX IF NOT EXISTS sessions_workspace_updated ON sessions (workspace_id, updated_at);
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
    used: db.prepare("SELECT COALESCE(SUM(credits), 0) AS used FROM ledger WHERE workspace_id = ? AND mode = 'credits' AND at >= ? AND at < ?"),
    counts: db.prepare('SELECT (SELECT COUNT(*) FROM sessions WHERE workspace_id = ?) AS sessions, (SELECT COUNT(*) FROM runs WHERE workspace_id = ?) AS runs'),
    clear: ['sessions', 'runs', 'ledger'].map(t => db.prepare(`DELETE FROM ${t} WHERE workspace_id = ?`)),
  };
  const parse = rows => rows.map(r => { try { return JSON.parse(r.body); } catch { return null; } }).filter(Boolean);
  return {
    upsertSessions(workspace, list) { const tx = db.prepare('BEGIN'); tx.run(); try { for (const s of list) statements.session.run(workspace, s.id, s.updatedAt, JSON.stringify(s)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
    upsertRuns(workspace, list) { db.exec('BEGIN'); try { for (const r of list) statements.run.run(workspace, r.id, r.sessionId ?? null, r.startedAt, JSON.stringify(r)); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
    addLedger(workspace, list) { db.exec('BEGIN'); try { for (const e of list) statements.ledger.run(workspace, e.id, e.at, e.sessionId ?? null, e.model, e.tier, e.mode, e.tokens, e.credits); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; } },
    state(workspace) { return { sessions: parse(statements.sessions.all(workspace)), runs: parse(statements.runs.all(workspace)), ledger: statements.entries.all(workspace).map(e => ({ id: e.id, at: e.at, sessionId: e.session_id ?? undefined, model: e.model, tier: e.tier, mode: e.mode, tokens: e.tokens, credits: e.credits })) }; },
    usedThisMonth(workspace, now = new Date()) { const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString(); const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString(); return Number(statements.used.get(workspace, start, end)?.used ?? 0); },
    counts(workspace) { return statements.counts.get(workspace, workspace); },
    clear(workspace) { for (const s of statements.clear) s.run(workspace); },
    close() { db.close(); },
  };
}
