import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, Download, PanelRightClose, PanelRightOpen, Plus, Sparkles, Trash2, Wrench, X } from 'lucide-react';
import Rail, { type Page } from './ui/Rail';
import Dock, { type Attached, type RunMode } from './ui/Dock';
import RunCard from './ui/RunCard';
import RosterDrawer, { RosterList } from './ui/Roster';
import KnowledgeHub from './ui/Knowledge';
import Settings from './ui/Settings';
import Connectors, { type ConnectorTab } from './ui/Connectors';
import Pricing from './ui/Pricing';
import StatusBar, { type Stats } from './ui/StatusBar';
import { modelLabel, payLabel } from './ui/ModelPicker';
import { iconFor } from './ui/icons';
import { chatTurn } from './lib/chat';
import { estimateTokens, findModel, tierFor, DEFAULT_MONTHLY_POOL, DEFAULT_FREE_POOL, type CatalogModel, type InferenceMode } from './lib/catalog';
import { retrieve } from './lib/memory';
import { listModels, ProviderError, validateConnection } from './lib/provider';
import { clearProviderStorage, emptyKeyring, forgetKeys, inferenceFor, initialProvider, loadKeyring, persistConnection, providers, saveKeyring, zeroConfigConnection, type Keyring, type Provider } from './lib/providers';
import { keyedProviders, type Reach } from './lib/availability';
import { defaultPersonaId, personaById, workflows, type Persona } from './lib/roster';
import { clearCustomAgents, customAgents, removeCustomAgent } from './lib/customAgents';
import { authConfig, authMe, clearWorkspaceData, computeBalance, exportSession, persistRun, persistSession, recordUsage, serverBalance, setWorkspaceId, storage, sync, loadWorkspace, type AuthUser, type Balance, type ChatMessage, type LedgerEntry, type Session } from './lib/store';
import { FREE_TIER_WARMING, isFreeTierWarming, labelsFrom, loadDeployment, loadWorkerStatus, offlineDeployment, type Deployment } from './lib/deployment';
import { useInstallAvailable, useOnline } from './pwa';
import { isImageFile, photoTokens, readPhoto, type Photo } from './lib/photos';
import { clearConnections, loadConnections, saveConnections, type McpConnection } from './lib/mcp';
import { activeCount, activeTools, clearSettings, loadSettings, saveSettings, type ConnectorSettings } from './lib/connectors';
import type { Connection, Knowledge, Run, WorkerEvent } from './lib/types';

const errorText = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong.';
const now = () => new Date().toISOString();
type Recognition = { lang: string; interimResults: boolean; continuous: boolean; start(): void; stop(): void; onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; onend: (() => void) | null; onerror: (() => void) | null };
const recognitionCtor = () => (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
// Openers that show the range of what agents can do — code, analysis, and general questions.
const starters: { text: string; persona: string; mode: RunMode }[] = [
  { text: 'Write a TypeScript function that retries a fetch with exponential backoff and a hard timeout. Include the types and one usage example.', persona: 'coder', mode: 'chat' },
  { text: 'Explain the difference between a database index and a materialised view, with one example where the wrong choice hurts.', persona: 'assistant', mode: 'chat' },
];
/**
 * The connection as it goes over the wire. A zero-config run carries no secret at all — the
 * server funds it from its own key — so both the visitor's key and the deployment token are
 * stripped before the request leaves the tab.
 */
const requestConnection = (c: Connection): Connection =>
  c.inference === 'free' ? { ...c, token: '', serverAccessToken: '' }
    : c.inference === 'credits' ? { ...c, token: '' }
      : { ...c, serverAccessToken: '' };

async function readTextFile(file: File): Promise<Attached> {
  if (!/\.(txt|md|csv|json|html)$/i.test(file.name) || file.size > 200_000) throw new Error(`${file.name}: attach text, Markdown, CSV, JSON, or HTML files under 200 KB.`);
  return { name: file.name.slice(0, 80), content: (await file.text()).slice(0, 60_000) };
}

export default function App() {
  const [page, setPage] = useState<Page>('workspace');
  const [collapsed, setCollapsed] = useState(() => { try { return localStorage.getItem('hb-rail') !== 'expanded'; } catch { return true; } });
  const canInstall = useInstallAvailable(); const online = useOnline();
  const [connection, setConnection] = useState<Connection>(initialProvider);
  /**
   * One saved key per provider, owned here rather than inside Settings.
   *
   * Both the dock's model dropdown and the model hub decide what is reachable from it, and a
   * component that owned it privately could only tell one of them. Held here, a key typed into the
   * form unlocks that vendor in both places on the next render, before anything is saved.
   */
  const [keys, setKeys] = useState<Keyring>(loadKeyring);
  const [deployment, setDeployment] = useState<Deployment>(offlineDeployment);
  const [backgroundWorker, setBackgroundWorker] = useState(false);
  const [models, setModels] = useState<string[]>([]); const [checking, setChecking] = useState(false);
  const [sessions, setSessions] = useState<Session[]>([]); const sessionsRef = useRef<Session[]>([]);
  const [runs, setRuns] = useState<Run[]>([]); const runsRef = useRef<Run[]>([]);
  const [ledger, setLedger] = useState<LedgerEntry[]>([]); const ledgerRef = useRef<LedgerEntry[]>([]);
  const [knowledge, setKnowledge] = useState<Knowledge[]>([]);
  const [balance, setBalance] = useState<Balance>(() => computeBalance([], DEFAULT_MONTHLY_POOL, 'local'));
  const [freeBalance, setFreeBalance] = useState<Balance>(() => computeBalance([], DEFAULT_FREE_POOL, 'local', undefined, 'free'));
  const [serverReachable, setServerReachable] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [personaId, setPersonaId] = useState(defaultPersonaId);
  const [draft, setDraft] = useState(''); const [mode, setMode] = useState<RunMode>('chat'); const [attachments, setAttachments] = useState<Attached[]>([]);
  const [busy, setBusy] = useState(false); const [ready, setReady] = useState(false); const [notice, setNotice] = useState('');
  const [rosterOpen, setRosterOpen] = useState(false); const [confirm, setConfirm] = useState<'run' | 'clear' | null>(null);
  // Agents the user wrote. Held here because the drawer creates them and the dock displays them.
  const [custom, setCustom] = useState<Persona[]>(customAgents);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [connectorsOpen, setConnectorsOpen] = useState(false); const [connectorTab, setConnectorTab] = useState<ConnectorTab>('github');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [mcp, setMcpState] = useState<McpConnection[]>(loadConnections);
  const [settings, setSettingsState] = useState<ConnectorSettings>(loadSettings);
  const [stats, setStats] = useState<Stats | null>(null); const [listening, setListening] = useState(false);
  const [authUser, setAuthUser] = useState<AuthUser | null>(null);
  const [googleEnabled, setGoogleEnabled] = useState(false);
  const abortRef = useRef<AbortController | null>(null); const worker = useRef<Worker | null>(null); const recognition = useRef<Recognition | null>(null);
  const approvedRuns = useRef(false); const endRef = useRef<HTMLDivElement>(null);

  const setMcp = (list: McpConnection[]) => { saveConnections(list); setMcpState(list); };
  const setSettings = (next: ConnectorSettings) => { saveSettings(next); setSettingsState(next); };

  const active = sessions.find(s => s.id === activeId) ?? null;
  const persona = personaById(active?.persona ?? personaId);
  const demo = connection.mode === 'demo';
  const inference = connection.inference ?? 'byok';
  // Gateway labels, so a discovered id reads as a model name everywhere it is shown.
  const labels = useMemo(() => labelsFrom(deployment.gatewayCatalog), [deployment.gatewayCatalog]);
  const label = modelLabel(connection.model, demo, labels);
  const tierLabel = demo ? 'no model' : tierFor(connection.model || '');
  // What can be paid for right now, from the keyring rather than from the active connection alone.
  const reach: Reach = useMemo(() => ({ free: deployment.free, keys, token: connection.token, provider: connection.provider, credits: inference === 'credits' && Boolean(connection.serverAccessToken?.trim()) }), [deployment.free, keys, connection.token, connection.provider, connection.serverAccessToken, inference]);
  const keyed = useMemo(() => keyedProviders(reach), [reach]);
  const connectorCount = activeCount(settings, mcp);
  // The credit meter tracks whichever budget the current run actually draws from.
  const activeBalance = inference === 'free' ? freeBalance : balance;
  const tokens = useMemo(() => ({ draft: estimateTokens(draft), context: attachments.reduce((n, a) => n + estimateTokens(a.content), 0) + photos.reduce((n, ph) => n + photoTokens(ph), 0) + retrieve(draft, knowledge).reduce((n, d) => n + estimateTokens(d.content.slice(0, 6000)), 0) }), [draft, attachments, photos, knowledge]);

  useEffect(() => {
    const controller = new AbortController();
    // Ask what this deployment can fund before promising the visitor a free model.
    // Auth check first: if the visitor has a signed-in session, override the anonymous workspace
    // id so that loadWorkspace() below pulls the account's data instead of the browser's local copy.
    void Promise.all([authMe(), authConfig()]).then(([user, cfg]) => {
      if (controller.signal.aborted) return;
      if (cfg?.googleEnabled !== undefined) setGoogleEnabled(cfg.googleEnabled);
      if (user) { setAuthUser(user); setWorkspaceId(user.workspaceId); }
      // Surface OAuth error if Google redirected back with an error param.
      const authErr = new URLSearchParams(location.search).get('auth_error');
      if (authErr) { setNotice('Sign-in failed. Please try again.'); history.replaceState(null, '', location.pathname); }
    });

    void loadDeployment(controller.signal, {
      // A free-plan instance takes a moment to wake. Saying so beats a silent wait that ends in
      // the scripted preview.
      onRetry: () => { if (!controller.signal.aborted) setNotice('Waking this deployment up — the first request after a quiet spell takes a few seconds.'); },
    }).then(d => {
      if (controller.signal.aborted) return;
      setDeployment(d);
      setConnection(c => {
        if (c.inference !== 'free') return c;
        if (d.free.enabled && d.free.models.includes(c.model)) return c;
        // A fresh visitor arrives with no model at all, and a returning one may hold an id this
        // deployment has stopped funding. Either way the funded list is the authority, and it is
        // reconciled here rather than left to fail on the first send.
        if (d.free.enabled) {
          const id = d.free.models[0];
          const served = d.free.providers[id];
          const chosen = (served && Object.hasOwn(providers, served) ? served : c.provider ?? 'xkiro') as Provider;
          return { ...c, model: id, provider: chosen, endpoint: providers[chosen].endpoint };
        }
        // Only a deployment that answered and funds nothing sends us to the scripted preview. A
        // server that never answered is a different thing entirely, and forcing demo mode on it
        // was how a slow wake-up turned into "no AI, no network" for the rest of the session.
        return d.reachable ? { ...c, mode: 'demo' } : c;
      });
      if (!d.free.enabled && d.reachable) setNotice(FREE_TIER_WARMING);
      else if (!d.reachable) setNotice('Could not reach this deployment, so no model is selected yet. Reload to try again, or add your own key in Settings.');
      else setNotice('');
    });
    // Whether a Render background worker is deployed alongside this web service. Workflows run
    // in the browser either way; this only reports that the heavier path exists.
    void loadWorkerStatus(controller.signal).then(w => { if (!controller.signal.aborted) setBackgroundWorker(w.worker); });
    loadWorkspace(controller.signal).then(ws => {
      if (controller.signal.aborted) return;
      commitSessions(ws.sessions); runsRef.current = ws.runs; setRuns(ws.runs); ledgerRef.current = ws.ledger; setLedger(ws.ledger);
      setKnowledge(ws.knowledge); setBalance(ws.balance); setFreeBalance(ws.freeBalance); setServerReachable(ws.serverReachable);
      setActiveId(ws.sessions[0]?.id ?? null); if (ws.sessions[0]) setPersonaId(ws.sessions[0].persona);
    })
      .catch(e => { if (!controller.signal.aborted) setNotice(errorText(e)); })
      .finally(() => { if (!controller.signal.aborted) setReady(true); });
    return () => { controller.abort(); worker.current?.terminate(); };
  }, []);
  useEffect(() => { if (!busy) return; const onLeave = (e: BeforeUnloadEvent) => { e.preventDefault(); }; window.addEventListener('beforeunload', onLeave); return () => window.removeEventListener('beforeunload', onLeave); }, [busy]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [active?.messages, runs]);

  function commitSessions(next: Session[]) { sessionsRef.current = next; setSessions(next); }
  function patchSession(id: string, fn: (s: Session) => Session, persist = false) {
    const next = sessionsRef.current.map(s => s.id === id ? { ...fn(s), updatedAt: now() } : s); commitSessions(next);
    if (persist) { const s = next.find(x => x.id === id); if (s) void persistSession(s).catch(e => setNotice(errorText(e))); }
  }
  function patchMessage(sessionId: string, messageId: string, patch: Partial<ChatMessage> | ((m: ChatMessage) => Partial<ChatMessage>), persist = false) {
    patchSession(sessionId, s => ({ ...s, messages: s.messages.map(m => m.id === messageId ? { ...m, ...(typeof patch === 'function' ? patch(m) : patch) } : m) }), persist);
  }
  function newSession(): Session { const s: Session = { id: crypto.randomUUID(), title: 'New session', persona: persona.id, createdAt: now(), updatedAt: now(), messages: [] }; commitSessions([s, ...sessionsRef.current]); setActiveId(s.id); setPage('workspace'); return s; }
  function ensureSession(): Session { return active ?? newSession(); }
  async function deleteSession(id: string) { try { await storage.removeSession(id); commitSessions(sessionsRef.current.filter(s => s.id !== id)); if (activeId === id) setActiveId(sessionsRef.current[0]?.id ?? null); } catch (e) { setNotice(errorText(e)); } }
  function choosePersona(id: string) { setPersonaId(id); if (active) patchSession(active.id, s => ({ ...s, persona: id }), true); }
  /** A newly written agent is selected straight away: whoever just wrote it means to use it. */
  function addCustomAgent(created: Persona) { setCustom(customAgents()); choosePersona(created.id); setNotice(`${created.name} is ready. It is saved in this browser and appears in the agent drawer.`); }
  /** Deleting the agent in use falls back to the default rather than leaving a dangling id. */
  function deleteCustomAgent(id: string) {
    const gone = personaById(id).name;
    setCustom(removeCustomAgent(id));
    if (personaId === id) choosePersona(defaultPersonaId);
    setNotice(`${gone} deleted. Sessions that used it stay readable and fall back to the default agent.`);
  }
  function updateRun(run: Run) { const next = runsRef.current.some(r => r.id === run.id) ? runsRef.current.map(r => r.id === run.id ? run : r) : [run, ...runsRef.current]; runsRef.current = next; setRuns(next); }

  /**
   * Pick a model from the dock. A funded id switches the run onto the free tier by itself.
   *
   * Which provider serves it is the server's answer where it has one, then the catalog's, and
   * only then a guess from the id. That order matters the moment a visitor adds their own key:
   * the free tier ignores the provider field entirely and routes from its own allowlist, but a
   * keyed request goes to whatever endpoint is set here, and a gateway model sent to OpenRouter
   * fails with a puzzling 404 rather than a useful error.
   */
  function pickModel(id: string, mode?: InferenceMode) {
    const served = deployment.free.providers[id];
    setConnection(c => {
      const known = (served ?? findModel(id)?.provider) as Provider | undefined;
      const provider = known && Object.hasOwn(providers, known) ? known : c.provider ?? 'openrouter';
      // `mode` is the group the visitor picked from, which is a statement of intent and is taken
      // as one. Without it, inferenceFor decides — and now leaves a deliberate choice alone.
      return { ...c, mode: 'remote', model: id, provider, endpoint: providers[provider].endpoint, inference: mode ?? inferenceFor(id, c.inference, deployment.free.models) };
    });
    setNotice('');
  }
  function modelNeedsKey(m: CatalogModel) {
    setPage('settings');
    setNotice(`${m.label} needs a ${providers[m.provider].name} key. Add it below and it unlocks straight away — you do not have to save first, and no other provider is affected.`);
  }

  /**
   * Record what a turn cost. A zero-config turn is already billed by the server's own meter, so
   * the browser re-reads that number instead of inventing a second one; every other mode writes
   * its own ledger row locally and syncs it.
   */
  async function charge(sessionId: string, count: number) {
    if (inference === 'free' && !demo) {
      const reading = await sync.usage();
      if (!reading) return;
      setFreeBalance(serverBalance(reading.freePool, reading.freeUsed));
      if (reading.entry && !ledgerRef.current.some(e => e.id === reading.entry!.id)) {
        const next = [reading.entry, ...ledgerRef.current]; ledgerRef.current = next; setLedger(next);
        void storage.saveLedger(reading.entry).catch(() => { /* display-only; the server holds the record */ });
      }
      return;
    }
    try {
      const entry = await recordUsage({ sessionId, model: demo ? 'scripted-preview' : connection.model, mode: demo ? 'demo' : inference, tokens: count });
      const next = [entry, ...ledgerRef.current]; ledgerRef.current = next; setLedger(next);
      setBalance(b => computeBalance(next, b.pool, b.source));
    } catch (e) { setNotice(errorText(e)); }
  }

  /**
   * A failure on a server-funded request is reported as a warming tier rather than as a key
   * problem: the credential was the deployment's, so "invalid API key" would send the visitor
   * looking for a fault that is not theirs. Every other error is reported exactly as it arrived.
   */
  function freeTierMessage(e: unknown): string {
    if (inference === 'free' && e instanceof ProviderError && isFreeTierWarming(e.code)) return FREE_TIER_WARMING;
    return errorText(e);
  }
  function preflight(): string | null {
    if (demo) return null;
    try { validateConnection(connection); } catch (e) { return errorText(e); }
    if (!online) return 'You are offline. Hosted models need a connection; the scripted preview still works.';
    if (inference === 'free') {
      if (!deployment.free.enabled) return FREE_TIER_WARMING;
      if (!deployment.free.models.includes(connection.model)) return `${connection.model || 'No model'} is not on this deployment's free list. Pick a free model from the dropdown.`;
      if (freeBalance.remaining <= 0) return `The free allowance for ${freeBalance.month} is used up. Add your own key in Settings — Groq, OpenRouter and xKiro all offer free accounts — or wait for the monthly reset.`;
      return null;
    }
    if (inference === 'credits') {
      if (!connection.serverAccessToken) return 'Platform credits need the deployment access token. Add it in Settings, or switch to your own key.';
      if (balance.remaining <= 0) return `Platform credits for ${balance.month} are used up. Switch to your own key or wait for the monthly reset.`;
      return null;
    }
    // The key that matters is the one for the model's own provider, which may have been typed into
    // the keyring without the connection's own token field ever being touched.
    if (!connection.token && !keys[connection.provider ?? 'custom']?.trim() && connection.provider !== 'custom') return `Add a ${providers[connection.provider ?? 'custom'].name} key in Settings, or pick a free model from the dropdown.`;
    return null;
  }

  async function addFiles(files: File[]) {
    const added: Attached[] = []; const addedPhotos: Photo[] = [];
    for (const f of files.slice(0, 8)) { try { if (isImageFile(f)) addedPhotos.push(await readPhoto(f)); else added.push(await readTextFile(f)); } catch (e) { setNotice(errorText(e)); } }
    if (added.length) setAttachments(a => [...a.filter(x => !added.some(n => n.name === x.name)), ...added].slice(0, 5));
    if (addedPhotos.length) setPhotos(ps => { const next = [...ps.filter(x => !addedPhotos.some(n => n.name === x.name)), ...addedPhotos]; if (next.length > 4) setNotice('Up to four photos per message.'); return next.slice(0, 4); });
  }

  /** Drag-and-drop straight into the document index, from the Connectors hub. */
  async function addDocuments(files: File[]) {
    let saved = 0;
    for (const file of files.slice(0, 10)) {
      if (!/\.(txt|md|csv|json|html)$/i.test(file.name) || file.size > 200_000) { setNotice(`${file.name}: index text, Markdown, CSV, JSON, or HTML files under 200 KB.`); continue; }
      if (knowledge.length + saved >= 100) { setNotice('Knowledge hub limit: 100 documents. Remove an old one first.'); break; }
      try {
        const doc: Knowledge = { id: crypto.randomUUID(), title: file.name.slice(0, 120), content: (await file.text()).slice(0, 50_000), createdAt: now() };
        await storage.saveKnowledge(doc); setKnowledge(k => [doc, ...k]); saved++;
      } catch (e) { setNotice(errorText(e)); }
    }
    if (saved) setNotice(`Indexed ${saved} document${saved === 1 ? '' : 's'} in this browser. Matching passages attach to your messages automatically.`);
  }

  function toggleVoice() {
    if (listening) { recognition.current?.stop(); return; }
    const Ctor = recognitionCtor(); if (!Ctor) return;
    const r = new Ctor(); r.lang = navigator.language || 'en-US'; r.interimResults = false; r.continuous = true;
    r.onresult = e => { let text = ''; for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript; setDraft(d => `${d}${d && !d.endsWith(' ') ? ' ' : ''}${text.trim()}`); };
    r.onend = () => { setListening(false); recognition.current = null; };
    r.onerror = () => { setListening(false); recognition.current = null; setNotice('Voice input stopped. Check the microphone permission and try again.'); };
    recognition.current = r; try { r.start(); setListening(true); } catch { setNotice('Voice input could not start in this browser.'); }
  }

  function send() {
    const text = draft.trim(); if (!text || busy || !ready) return;
    const problem = preflight(); if (problem) { setNotice(problem); return; }
    if (mode !== 'chat' && photos.length) { setNotice('Photos go with chat messages. Workflows work from text; remove the photo or switch to Chat.'); return; }
    // A workflow is five requests, so a BYOK visitor is asked once per session before it spends.
    if (mode !== 'chat' && !demo && inference === 'byok' && !approvedRuns.current) { setConfirm('run'); return; }
    const session = ensureSession(); const files = attachments; const shots = photos;
    const user: ChatMessage = { id: crypto.randomUUID(), role: 'user', content: text, at: now(), attachments: files.map(a => ({ name: a.name, chars: a.content.length })), photos: shots.map(ph => ({ name: ph.name, thumb: ph.thumb })) };
    const title = session.messages.length ? session.title : text.replace(/\s+/g, ' ').slice(0, 60);
    setDraft(''); setAttachments([]); setPhotos([]); setNotice(''); setBusy(true); setPage('workspace');
    if (mode === 'chat') void runChat(session, user, text, files, shots, title); else startWorkflow(session, user, text, files, title, mode);
  }

  async function runChat(session: Session, user: ChatMessage, text: string, files: Attached[], shots: Photo[], title: string) {
    const reply: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', at: now(), persona: persona.name, model: label };
    patchSession(session.id, s => ({ ...s, title, persona: persona.id, messages: [...s.messages, user, reply] }), true);
    const controller = new AbortController(); abortRef.current = controller; const traces: ChatMessage['tools'] = [];
    try {
      const result = await chatTurn({
        connection: requestConnection(connection), personaId: persona.id, history: session.messages, input: text,
        attachments: files, photos: shots.map(ph => ({ name: ph.name, dataUrl: ph.dataUrl })),
        tools: activeTools({ settings, mcp, knowledge, search: retrieve, personaTools: persona.tools }),
        knowledge, signal: controller.signal,
        onDelta: t => patchMessage(session.id, reply.id, { content: t }),
        onTool: trace => { traces.push(trace); patchMessage(session.id, reply.id, { tools: [...traces] }); },
      });
      patchMessage(session.id, reply.id, { content: result.text, tokens: result.tokens, latencyMs: result.latencyMs, tokensPerSecond: result.tokensPerSecond, tools: result.tools }, true);
      setStats({ latencyMs: result.latencyMs, tokensPerSecond: result.tokensPerSecond, tokens: result.tokens });
      await charge(session.id, result.tokens);
    } catch (e) {
      const stopped = controller.signal.aborted;
      const message = freeTierMessage(e);
      patchMessage(session.id, reply.id, m => stopped ? { content: `${m.content}${m.content ? '\n\n' : ''}(stopped)` } : { error: message }, true);
      if (!stopped) setNotice(message);
    } finally { abortRef.current = null; setBusy(false); }
  }

  function startWorkflow(session: Session, user: ChatMessage, text: string, files: Attached[], title: string, workflow: Exclude<RunMode, 'chat'>) {
    const runId = crypto.randomUUID();
    const reply: ChatMessage = { id: crypto.randomUUID(), role: 'assistant', content: '', at: now(), persona: `${workflows[workflow].label} · led by ${persona.name}`, model: label, runId };
    patchSession(session.id, s => ({ ...s, title, persona: persona.id, messages: [...s.messages, user, reply] }), true);
    updateRun({ id: runId, goal: text, workflow, mode: connection.mode, model: demo ? 'Scripted preview · no model' : connection.model, status: 'running', startedAt: now(), steps: [], tokens: 0, calls: 0, cacheHits: 0, contextTitles: [], sessionId: session.id, persona: persona.id, origin: 'browser' });
    const fail = (message: string) => {
      worker.current?.terminate(); worker.current = null; setBusy(false); setNotice(message);
      const current = runsRef.current.find(r => r.id === runId);
      if (current) { const failed: Run = { ...current, status: 'failed', completedAt: now(), steps: current.steps.map(s => ['running', 'assigned', 'queued', 'pending'].includes(s.status) ? { ...s, status: 'cancelled' } : s) }; updateRun(failed); void persistRun(failed).catch(e => setNotice(errorText(e))); }
    };
    try {
      worker.current?.terminate(); worker.current = new Worker(new URL('./workers/swarm.worker.ts', import.meta.url), { type: 'module' });
      worker.current.onerror = () => fail('The browser worker stopped unexpectedly. Please retry.');
      worker.current.onmessage = (event: MessageEvent<WorkerEvent>) => {
        if (event.data.type === 'error') { fail(event.data.message); return; }
        updateRun(event.data.run);
        if (event.data.type === 'done') {
          const done = event.data.run;
          void persistRun(done).catch(e => setNotice(errorText(e)));
          if (done.status === 'failed') setNotice(done.steps.find(s => s.error)?.error || 'The run failed. Check your model and key in Settings.');
          setBusy(false); worker.current?.terminate(); worker.current = null;
          setStats(s => ({ latencyMs: s?.latencyMs ?? 0, tokensPerSecond: s?.tokensPerSecond ?? 0, tokens: done.tokens }));
          void charge(session.id, done.tokens); patchMessage(session.id, reply.id, { tokens: done.tokens }, true);
        }
      };
      // The lead persona goes over whole, not by id: a custom agent lives in localStorage and the
      // worker cannot read it, so an id alone would silently lose the lead the user chose.
      worker.current.postMessage({ type: 'start', runId, goal: text, workflow, connection: requestConnection(connection), knowledge, sessionId: session.id, persona: persona.id, leadPersona: persona, attachments: files });
    } catch (e) { fail(errorText(e)); }
  }

  function stop() { abortRef.current?.abort(new DOMException('Stopped by user', 'AbortError')); worker.current?.postMessage({ type: 'cancel' }); }
  async function discover() { setChecking(true); try { const ids = await listModels(requestConnection(connection), new AbortController().signal); setModels(ids); if (ids.length && !ids.includes(connection.model)) setConnection(c => ({ ...c, model: ids[0] })); setNotice(ids.length ? `Connected. Found ${ids.length} model${ids.length === 1 ? '' : 's'}.` : 'The endpoint returned no models.'); } catch (e) { setNotice(errorText(e)); } finally { setChecking(false); } }
  /**
   * Save the connection and the whole keyring together. The remember checkbox governs every key,
   * not just the active one: unticked means nothing is written and anything previously stored is
   * cleared, while the keys stay usable in this tab until it closes.
   */
  function saveSettingsForm() {
    try {
      if (connection.mode === 'remote') validateConnection(connection);
      saveKeyring(connection.saveKey ? keys : emptyKeyring());
      persistConnection(connection);
      setNotice(connection.saveKey && inference === 'byok' ? 'Connection saved, including your provider keys in this browser.' : 'Connection saved. Keys and tokens stay in memory for this session.');
    } catch (e) { setNotice(errorText(e)); }
  }
  function forget() { try { forgetKeys(); setKeys(emptyKeyring()); setConnection(c => ({ ...c, token: '', saveKey: false, serverAccessToken: '' })); setNotice('All saved provider keys removed from this browser.'); } catch { setNotice('Could not clear browser storage. Clear this site\'s data in browser settings.'); } }
  async function clearAll() {
    setConfirm(null);
    try {
      await clearWorkspaceData(); localStorage.removeItem('hb-rail'); clearProviderStorage(); clearConnections(); clearSettings(); clearCustomAgents();
      setMcpState([]); setSettingsState(loadSettings()); setPhotos([]); commitSessions([]); setCustom([]); setPersonaId(defaultPersonaId);
      runsRef.current = []; setRuns([]); ledgerRef.current = []; setLedger([]); setKnowledge([]); setActiveId(null);
      setBalance(b => computeBalance([], b.pool, b.source)); setFreeBalance(b => computeBalance([], b.pool, 'local', undefined, 'free'));
      setKeys(emptyKeyring()); setConnection(zeroConfigConnection());
      setNotice('Workspace cleared here and on the server.');
    } catch (e) { setNotice(errorText(e)); }
  }
  function toggleRail() { setCollapsed(c => { try { localStorage.setItem('hb-rail', c ? 'expanded' : 'collapsed'); } catch { /* storage unavailable */ } return !c; }); }

  function download(name: string, body: string) { const url = URL.createObjectURL(new Blob([body], { type: 'text/markdown' })); const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
  function openConnectors(tab?: ConnectorTab) { if (tab) setConnectorTab(tab); setConnectorsOpen(true); }

  const PersonaIcon = iconFor(persona.icon);
  return <div className={collapsed ? 'app rail-collapsed' : 'app'}>
    <Rail page={page} setPage={setPage} collapsed={collapsed} toggle={toggleRail} badge={{ knowledge: knowledge.length }} authUser={authUser} googleEnabled={googleEnabled} />
    <div className="main">
      {(!online || notice) && <div className="notices">
        {!online && <div className="notice" role="status"><CircleAlert size={13} /><span>You are offline. The scripted preview still works; hosted models need a connection.</span></div>}
        {notice && <div className="notice" role="status"><span>{notice}</span><button className="icon-button" aria-label="Dismiss" onClick={() => setNotice('')}><X size={13} /></button></div>}
      </div>}
      <div className="content">
        {page === 'workspace' && <div className={previewOpen ? 'workspace with-preview' : 'workspace'}>
          <aside className="sessions">
            <div className="sessions-head"><strong>Sessions</strong><button className="icon-button" aria-label="New session" title="New session" disabled={busy} onClick={newSession}><Plus size={14} /></button></div>
            {sessions.map(s => { const Icon = iconFor(personaById(s.persona).icon); return <button key={s.id} className={s.id === activeId ? 'session active' : 'session'} disabled={busy} onClick={() => { setActiveId(s.id); setPersonaId(s.persona); }}><Icon size={13} strokeWidth={1.75} /><span><strong>{s.title}</strong><small>{personaById(s.persona).name} · {new Date(s.updatedAt).toLocaleDateString()}</small></span></button>; })}
            {!sessions.length && <p className="help">No sessions yet. Your first message starts one.</p>}
          </aside>
          <section className="canvas">
            <header className="canvas-head">
              <select className="session-select" aria-label="Session" value={activeId ?? ''} disabled={busy} onChange={e => { if (e.target.value === '__new') newSession(); else { setActiveId(e.target.value); const s = sessionsRef.current.find(x => x.id === e.target.value); if (s) setPersonaId(s.persona); } }}><option value="__new">New session</option>{sessions.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}</select>
              <span className="canvas-title"><PersonaIcon size={14} strokeWidth={1.75} />{active ? active.title : 'New session'}<small>{persona.name}</small></span>
              <span className="row gap">
                {active && <><button className="icon-button" title="Export session" aria-label="Export session" onClick={() => download('heybuddy-session.md', exportSession(active))}><Download size={14} /></button><button className="icon-button" title="Delete session" aria-label="Delete session" disabled={busy} onClick={() => void deleteSession(active.id)}><Trash2 size={14} /></button></>}
                <button className={previewOpen ? 'icon-button live' : 'icon-button'} title={previewOpen ? 'Hide output panel' : 'Show output panel'} aria-label={previewOpen ? 'Hide output panel' : 'Show output panel'} onClick={() => setPreviewOpen(p => !p)}>{previewOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}</button>
              </span>
            </header>
            <div className="messages">
              {!active?.messages.length && <div className="starter">
                <h1>Your AI crew. Always in your corner.</h1>
                <p>Ask a question, paste an error, or ask for code — the Assistant answers directly, with no setup and no connectors to switch on. Drop in a file if it helps, and pick a different agent or write your own whenever you want one. {deployment.free.enabled ? 'No sign-up and no API key: your first message streams on a free model this deployment funds.' : 'Add a provider key in Settings for real replies, or try the scripted preview.'}</p>
                {deployment.free.enabled && inference === 'free' && <p className="starter-badge"><Sparkles size={13} strokeWidth={2} />Running on {label} · {freeBalance.remaining.toLocaleString()} free credits left this month</p>}
                <div className="starter-grid">{starters.map((s, i) => { const P = personaById(s.persona); const Icon = iconFor(P.icon); return <button key={i} className="starter-card" onClick={() => { choosePersona(s.persona); setMode(s.mode); setDraft(s.text); document.getElementById('draft')?.focus(); }}><Icon size={15} strokeWidth={1.75} /><strong>{P.name}</strong><span>{s.text}</span></button>; })}</div>
              </div>}
              {active?.messages.map(m => {
                if (m.role === 'user') return <article key={m.id} className="msg user"><div className="msg-meta"><strong>You</strong><time>{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{m.attachments?.map(a => <em key={a.name}>{a.name}</em>)}</div>{m.photos && m.photos.length > 0 && <div className="msg-photos">{m.photos.map(ph => <img key={ph.name} src={ph.thumb} alt={ph.name} title={ph.name} />)}</div>}<pre className="msg-body">{m.content}</pre></article>;
                const run = m.runId ? runs.find(r => r.id === m.runId) : undefined;
                return <article key={m.id} className="msg agent">
                  <div className="msg-meta"><strong>{m.persona ?? 'Agent'}</strong><time>{new Date(m.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time>{m.model && <em>{m.model}</em>}{m.tokens ? <em>{m.tokens.toLocaleString()} tok</em> : null}{m.latencyMs ? <em>{m.latencyMs} ms</em> : null}</div>
                  {run ? <RunCard run={run} /> : <pre className="msg-body">{m.content || (busy && !m.error ? 'Working…' : '')}</pre>}
                  {m.tools?.map((t, i) => { const args = JSON.stringify(t.args); return <div key={i} className={t.ok ? 'tool-trace' : 'tool-trace failed'}><Wrench size={11} /><code>{t.tool} {args.length > 60 ? `${args.slice(0, 57)}...` : args}</code><span>{t.summary}</span></div>; })}
                  {m.error && <p className="msg-error"><CircleAlert size={12} />{m.error}</p>}
                </article>;
              })}
              <div ref={endRef} />
            </div>
            <Dock
              draft={draft} setDraft={setDraft} mode={mode} setMode={setMode}
              persona={persona} openRoster={() => setRosterOpen(true)}
              attachments={attachments} photos={photos} addFiles={f => void addFiles(f)}
              removeAttachment={name => setAttachments(a => a.filter(x => x.name !== name))}
              removePhoto={name => setPhotos(ps => ps.filter(x => x.name !== name))}
              openConnectors={() => openConnectors()} connectorCount={connectorCount}
              model={connection.model} inference={inference} demo={demo} free={deployment.free} labels={labels} reach={reach} keyed={keyed}
              pickModel={pickModel} pickPreview={() => setConnection(c => ({ ...c, mode: 'demo' }))} modelNeedsKey={modelNeedsKey}
              busy={busy} ready={ready} send={send} stop={stop}
              listening={listening} voiceSupported={Boolean(recognitionCtor())} toggleVoice={toggleVoice}
              tokens={tokens}
            />
          </section>
          {previewOpen && <aside className="preview-panel">
            <div className="preview-head">
              <span>Output</span>
              <button className="icon-button" aria-label="Close output panel" onClick={() => setPreviewOpen(false)}><PanelRightClose size={14} /></button>
            </div>
            <div className="preview-content">
              {(() => {
                const lastReply = active?.messages.slice().reverse().find(m => m.role === 'assistant');
                if (!lastReply?.content) return <div className="preview-empty"><PanelRightOpen size={22} strokeWidth={1.25} /><span>Agent output will appear here</span></div>;
                return <pre className="preview-body">{lastReply.content}</pre>;
              })()}
            </div>
          </aside>}
        </div>}
        {page === 'roster' && <div className="page"><div className="page-head"><div><h1>Agent roster</h1><p>One agent answers you directly. The general agents are the plain ones, the specialists take a stronger view, and you can write your own. Every prompt starts with the same safety baseline.</p></div></div><RosterList activeId={persona.id} onPick={id => { choosePersona(id); setPage('workspace'); }} custom={custom} onCreate={addCustomAgent} onDelete={deleteCustomAgent} /></div>}
        {page === 'knowledge' && <KnowledgeHub knowledge={knowledge} busy={busy} notify={setNotice} save={async doc => { await storage.saveKnowledge(doc); setKnowledge(k => [doc, ...k]); }} remove={async id => { try { await storage.removeKnowledge(id); setKnowledge(k => k.filter(x => x.id !== id)); } catch (e) { setNotice(errorText(e)); } }} />}
        {page === 'pricing' && <Pricing free={deployment.free} billing={deployment.billing} freeBalance={freeBalance} onStart={() => setPage('workspace')} onAddKey={() => { setConnection(c => ({ ...c, inference: 'byok' })); setPage('settings'); }} />}
        {page === 'settings' && <Settings gateway={deployment.gateway} gatewayCatalog={deployment.gatewayCatalog} connection={connection} setConnection={setConnection} keys={keys} setKeys={setKeys} keyed={keyed} models={models} checking={checking} discover={() => void discover()} save={saveSettingsForm} forget={forget} balance={balance} freeBalance={freeBalance} free={deployment.free} ledger={ledger} busy={busy} canInstall={canInstall} serverReachable={serverReachable} requestClear={() => setConfirm('clear')} />}
      </div>
      <StatusBar model={label} tier={tierLabel} mode={payLabel(inference, demo)} stats={stats} balance={activeBalance} freeTier={inference === 'free' && !demo} backgroundWorker={backgroundWorker} busy={busy} online={online} synced={serverReachable} />
    </div>
    <RosterDrawer open={rosterOpen} close={() => setRosterOpen(false)} activeId={persona.id} onPick={choosePersona} custom={custom} onCreate={addCustomAgent} onDelete={deleteCustomAgent} />
    <Connectors
      open={connectorsOpen} close={() => setConnectorsOpen(false)} tab={connectorTab} setTab={setConnectorTab}
      settings={settings} setSettings={setSettings} mcp={mcp} setMcp={setMcp}
      knowledge={knowledge} addDocuments={f => void addDocuments(f)}
      removeDocument={id => { void storage.removeKnowledge(id).then(() => setKnowledge(k => k.filter(x => x.id !== id))).catch(e => setNotice(errorText(e))); }}
      notify={setNotice}
    />
    {confirm && <div className="overlay"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <h2 id="confirm-title">{confirm === 'run' ? 'Send workflows to your provider?' : 'Clear this workspace?'}</h2>
      {confirm === 'run'
        ? <p>A workflow makes five requests, up to ten with retries, each capped at {connection.maxTokens.toLocaleString()} output tokens, through this app's proxy to {connection.provider === 'custom' ? connection.endpoint : providers[connection.provider ?? 'custom'].name}. Your provider bills your key. Chat messages do not ask again this session.</p>
        : <p>This removes sessions, runs, the ledger, notes, connectors, and saved connection details from this browser and from the server copy. Export anything you want to keep first.</p>}
      <div className="row gap end"><button className="button small" autoFocus onClick={() => setConfirm(null)}>Cancel</button><button className={confirm === 'run' ? 'button primary small' : 'button danger small'} onClick={() => { if (confirm === 'run') { approvedRuns.current = true; setConfirm(null); send(); } else void clearAll(); }}>{confirm === 'run' ? 'Approve and run' : 'Delete everything'}</button></div>
    </section></div>}
  </div>;
}
