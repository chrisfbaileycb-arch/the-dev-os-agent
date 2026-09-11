import type { Knowledge, Run } from './types';
import { creditsFor, DEFAULT_MONTHLY_POOL, tierFor, type InferenceMode, type Tier } from './catalog';

// Local-first workspace store. IndexedDB is the source of truth for the open tab; the server
// keeps a copy in SQLite keyed by an anonymous workspace id so sessions and credit balances
// survive a refresh, a reinstall, or a cleared cache. Knowledge notes stay local only.

export interface Attachment { name: string; chars: number; }
export interface ToolTrace { tool: string; args: Record<string, unknown>; summary: string; ok: boolean; }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; content: string; at: string; persona?: string; model?: string; tokens?: number; latencyMs?: number; tokensPerSecond?: number; tools?: ToolTrace[]; runId?: string; attachments?: Attachment[]; photos?: { name: string; thumb: string }[]; error?: string; }
export interface Session { id: string; title: string; persona: string; createdAt: string; updatedAt: string; messages: ChatMessage[]; }
export interface LedgerEntry { id: string; at: string; sessionId: string; model: string; tier: Tier; mode: InferenceMode | 'demo'; tokens: number; credits: number; }
export interface Balance { pool: number; used: number; remaining: number; month: string; source: 'server' | 'local'; }
export interface Workspace { sessions: Session[]; runs: Run[]; ledger: LedgerEntry[]; knowledge: Knowledge[]; balance: Balance; serverReachable: boolean; }

const DB = 'freetoken-web-v1';
type Store = 'runs' | 'knowledge' | 'sessions' | 'ledger';
const STORES: Store[] = ['runs', 'knowledge', 'sessions', 'ledger'];

export function workspaceId(): string {
  try { const existing = localStorage.getItem('hb-workspace-id'); if (existing && /^[0-9a-f-]{36}$/.test(existing)) return existing; const id = crypto.randomUUID(); localStorage.setItem('hb-workspace-id', id); return id; }
  catch { return '00000000-0000-4000-8000-000000000000'; }
}

async function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 2);
    request.onupgradeneeded = () => { for (const name of STORES) if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name, { keyPath: 'id' }); };
    request.onsuccess = () => resolve(request.result); request.onerror = () => reject(new Error('Browser storage is unavailable. Your workspace may not persist.'));
    request.onblocked = () => reject(new Error('Close other Hey Buddy tabs to unlock workspace storage.'));
  });
}
async function transaction<T>(store: Store, mode: IDBTransactionMode, action: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode); const request = action(tx.objectStore(store));
    tx.oncomplete = () => { db.close(); resolve(request.result); };
    tx.onerror = tx.onabort = () => { db.close(); reject(new Error('Could not save the workspace. Browser storage may be full or disabled.')); };
  });
}

export const storage = {
  runs: () => transaction<Run[]>('runs', 'readonly', s => s.getAll()),
  knowledge: () => transaction<Knowledge[]>('knowledge', 'readonly', s => s.getAll()),
  sessions: () => transaction<Session[]>('sessions', 'readonly', s => s.getAll()),
  ledger: () => transaction<LedgerEntry[]>('ledger', 'readonly', s => s.getAll()),
  saveRun: (run: Run) => transaction('runs', 'readwrite', s => s.put(run)),
  saveKnowledge: (doc: Knowledge) => transaction('knowledge', 'readwrite', s => s.put(doc)),
  saveSession: (session: Session) => transaction('sessions', 'readwrite', s => s.put(session)),
  saveLedger: (entry: LedgerEntry) => transaction('ledger', 'readwrite', s => s.put(entry)),
  removeKnowledge: (id: string) => transaction('knowledge', 'readwrite', s => s.delete(id)),
  removeSession: (id: string) => transaction('sessions', 'readwrite', s => s.delete(id)),
  clearRuns: () => transaction('runs', 'readwrite', s => s.clear()),
  clearKnowledge: () => transaction('knowledge', 'readwrite', s => s.clear()),
  clearSessions: () => transaction('sessions', 'readwrite', s => s.clear()),
  clearLedger: () => transaction('ledger', 'readwrite', s => s.clear()),
};

export const monthKey = (date = new Date()) => date.toISOString().slice(0, 7);
export function computeBalance(entries: LedgerEntry[], pool = DEFAULT_MONTHLY_POOL, source: Balance['source'] = 'local', month = monthKey()): Balance {
  const used = Math.round(entries.filter(e => e.mode === 'credits' && e.at.startsWith(month)).reduce((sum, e) => sum + e.credits, 0) * 100) / 100;
  return { pool, used, remaining: Math.max(0, Math.round((pool - used) * 100) / 100), month, source };
}
export function makeEntry(input: { sessionId: string; model: string; mode: InferenceMode | 'demo'; tokens: number }): LedgerEntry {
  return { id: crypto.randomUUID(), at: new Date().toISOString(), sessionId: input.sessionId, model: input.model, tier: tierFor(input.model), mode: input.mode, tokens: Math.max(0, Math.round(input.tokens)), credits: creditsFor(input.model, input.tokens, input.mode) };
}

// Server sync. Failures are silent: the tab keeps working from IndexedDB and retries on next load.
interface ServerState { sessions: Session[]; runs: Run[]; ledger: LedgerEntry[]; pool: number; }
async function api<T>(path: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T | null> {
  try {
    const response = await fetch(path, { ...init, credentials: 'same-origin', signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(15_000)]), headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId(), ...(init.headers ?? {}) } });
    if (!response.ok) return null;
    return await response.json() as T;
  } catch { return null; }
}
export const sync = {
  pull: (signal?: AbortSignal) => api<ServerState>('/api/state', {}, signal),
  push: (payload: { sessions?: Session[]; runs?: Run[]; ledger?: LedgerEntry[] }) => api<{ ok: true }>('/api/state', { method: 'POST', body: JSON.stringify(payload) }),
  clear: () => api<{ ok: true }>('/api/state/clear', { method: 'POST', body: '{}' }),
};

const byId = <T extends { id: string }>(list: T[]) => new Map(list.map(item => [item.id, item]));
/** Merge local and server copies: newest session wins by updatedAt; runs and ledger entries are unioned. */
export function merge(local: { sessions: Session[]; runs: Run[]; ledger: LedgerEntry[] }, server: ServerState | null) {
  if (!server) return { sessions: local.sessions, runs: local.runs, ledger: local.ledger, toPush: { sessions: [] as Session[], runs: [] as Run[], ledger: [] as LedgerEntry[] } };
  const sessions = byId(server.sessions); const toPush = { sessions: [] as Session[], runs: [] as Run[], ledger: [] as LedgerEntry[] };
  for (const s of local.sessions) { const remote = sessions.get(s.id); if (!remote || remote.updatedAt < s.updatedAt) { sessions.set(s.id, s); toPush.sessions.push(s); } }
  const runs = byId(server.runs); for (const r of local.runs) if (!runs.has(r.id)) { runs.set(r.id, r); toPush.runs.push(r); }
  const ledger = byId(server.ledger); for (const e of local.ledger) if (!ledger.has(e.id)) { ledger.set(e.id, e); toPush.ledger.push(e); }
  return { sessions: [...sessions.values()], runs: [...runs.values()], ledger: [...ledger.values()], toPush };
}

/** Load everything for the tab: local first, then reconcile with the server if it answers. */
export async function loadWorkspace(signal?: AbortSignal): Promise<Workspace> {
  const [runs, knowledge, sessions, ledger] = await Promise.all([storage.runs(), storage.knowledge(), storage.sessions(), storage.ledger()]);
  const fixedRuns = runs.map(r => r.status === 'running' ? { ...r, status: 'interrupted' as const, steps: r.steps.map(s => ['pending', 'queued', 'assigned', 'running'].includes(s.status) ? { ...s, status: 'cancelled' } : s) } : r);
  const server = await sync.pull(signal);
  const merged = merge({ sessions, runs: fixedRuns, ledger }, server);
  await Promise.all([...merged.sessions.filter(s => !sessions.find(l => l.id === s.id && l.updatedAt >= s.updatedAt)).map(storage.saveSession), ...merged.runs.filter(r => !runs.find(l => l.id === r.id) || fixedRuns.find(l => l.id === r.id)?.status === 'interrupted').map(storage.saveRun), ...merged.ledger.filter(e => !ledger.find(l => l.id === e.id)).map(storage.saveLedger)]);
  if (server && (merged.toPush.sessions.length || merged.toPush.runs.length || merged.toPush.ledger.length)) void sync.push(merged.toPush);
  const pool = server?.pool ?? DEFAULT_MONTHLY_POOL;
  return { sessions: merged.sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), runs: merged.runs.sort((a, b) => b.startedAt.localeCompare(a.startedAt)), ledger: merged.ledger, knowledge, balance: computeBalance(merged.ledger, pool, server ? 'server' : 'local'), serverReachable: Boolean(server) };
}

export async function persistSession(session: Session): Promise<void> { await storage.saveSession(session); void sync.push({ sessions: [session] }); }
export async function persistRun(run: Run): Promise<void> { await storage.saveRun(run); if (run.status !== 'running') void sync.push({ runs: [run] }); }
export async function recordUsage(input: { sessionId: string; model: string; mode: InferenceMode | 'demo'; tokens: number }): Promise<LedgerEntry> {
  const entry = makeEntry(input); await storage.saveLedger(entry); void sync.push({ ledger: [entry] }); return entry;
}
export async function clearWorkspaceData(): Promise<void> {
  await Promise.all([storage.clearRuns(), storage.clearKnowledge(), storage.clearSessions(), storage.clearLedger()]);
  await sync.clear();
}

export function exportRun(run: Run): string {
  return `# Hey Buddy — ${run.workflow}\n\nMode: ${run.mode === 'demo' ? 'SCRIPTED PREVIEW — not AI-generated' : 'Hosted inference'}\nModel: ${run.model}\nStatus: ${run.status}\nStarted: ${run.startedAt}\n\n## Goal\n${run.goal}\n\n${run.steps.map(s => `## ${s.agent}: ${s.title}\nStatus: ${s.status}\n\n${s.output ?? s.error ?? 'No output.'}`).join('\n\n')}\n\n---\nReported tokens: ${run.tokens} (0 may mean usage was not reported)\nProvider requests: ${run.calls}\nRetrieved notes: ${run.contextTitles.join(', ') || 'none'}\n`;
}
export function exportSession(session: Session): string {
  return `# ${session.title}\n\nAgent: ${session.persona}\nStarted: ${session.createdAt}\n\n${session.messages.map(m => `## ${m.role === 'user' ? 'You' : (m.persona ?? 'Agent')} · ${new Date(m.at).toLocaleString()}\n\n${m.content}${m.tools?.length ? `\n\nTools: ${m.tools.map(t => `${t.tool} ${JSON.stringify(t.args)} (${t.ok ? 'ok' : 'failed'})`).join('; ')}` : ''}`).join('\n\n')}\n`;
}
