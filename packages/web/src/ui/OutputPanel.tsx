import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, CircleAlert, CircleCheck, Code2, Columns2, Copy, Eye, FileArchive, FileDown, LoaderCircle, Maximize2, Minimize2, Monitor, MonitorPlay, PanelRightClose, Pencil, RotateCw, Server, Smartphone, X } from 'lucide-react';
import { GithubMark } from './GithubMark';
import { parseProject, preparePreviewProject, type Project, type ProjectFile } from '../lib/project';
import { cssDraft } from '../lib/buildPreview';
import { buildProject, type BuildResult } from '../lib/bundle/client';
import { highlightCode } from '../lib/highlight';
import { archiveName, saveBlob, zipBlob } from '../lib/download';
import { redactSecrets, sanitizeFiles } from '../lib/secrets';
import type { GithubSettings } from '../lib/connectors';
import PushToGithub from './PushToGithub';
import GithubSyncDrawer, { type SyncToast } from './GithubSyncDrawer';
import { emptySyncState, loadSyncSettings, type GithubSyncState } from '../lib/githubSync';
import { HourglassIcon } from './WritingStatus';

export interface OutputPanelProps {
  content: string;
  issue?: string;
  onFinish?: () => void;
  close: () => void;
  github: GithubSettings;
  openConnectors: () => void;
  /**
   * Show the live app. The workspace is a dedicated preview surface, so activating it always
   * returns the split to the canonical half-and-half layout rather than leaving whatever a drag
   * last settled on — one button that means one thing.
   */
  onPreviewFocus: () => void;
  streaming?: boolean;
  /** Store a token or a pushed-to repository on the GitHub connector. */
  updateGithub: (patch: Partial<GithubSettings>) => void;
  /** Credentials this visitor holds, redacted from anything exported or pushed. */
  secrets: string[];
  /** The request that produced the current project, for the commit message. */
  request?: string;
}

type BuildState = { kind: 'idle' } | { kind: 'building' } | { kind: 'ready'; html: string; seq: number } | { kind: 'error'; errors: string[] };
type View = 'preview' | 'code';
/** How wide the frame renders: the panel's full width, or a phone-sized column inside it. */
type Device = 'desktop' | 'mobile';

function buildState(result: BuildResult, seq: number): BuildState {
  return result.ok ? { kind: 'ready', html: result.html, seq } : { kind: 'error', errors: result.errors };
}

/**
 * The frame the generated app runs in.
 *
 * No `allow-same-origin`, deliberately. With it, the generated page shares this app's origin and
 * can read everything this origin stores — the visitor's saved provider keys in localStorage,
 * their sessions in IndexedDB, their workspace id — and call /api with their cookies. Without it
 * the page has an opaque origin and can see none of that, which is what makes it safe to let the
 * sandbox load stylesheets, fonts, images and scripts from the public internet (see the sandbox
 * policy in server/csp.mjs). The one thing an opaque origin costs, working `localStorage`, the
 * sandbox shell gives back with an in-memory shim.
 */
type Runtime = { state: 'starting' } | { state: 'ready' } | { state: 'blank' } | { state: 'error'; message: string };

function SandboxFrame({ html, refresh, onRuntime }: { html: string; refresh: number; onRuntime: (r: Runtime) => void }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  // The page inside reports whether it actually ran: ready once something is on screen, blank if
  // nothing rendered, error on the first uncaught error. Only messages from this frame count.
  useEffect(() => {
    onRuntime({ state: 'starting' });
    const listen = (event: MessageEvent) => {
      if (event.source !== frameRef.current?.contentWindow) return;
      const d = event.data;
      if (!d || typeof d !== 'object' || d.type !== 'sf-preview') return;
      if (d.state === 'ready' || d.state === 'blank') onRuntime({ state: d.state });
      else if (d.state === 'error') onRuntime({ state: 'error', message: typeof d.message === 'string' ? d.message : 'Unknown error' });
    };
    window.addEventListener('message', listen);
    return () => window.removeEventListener('message', listen);
  }, [html, refresh]); // eslint-disable-line react-hooks/exhaustive-deps
  return <iframe
    key={refresh}
    ref={frameRef}
    title="Live generated app preview"
    className="output-frame"
    sandbox="allow-scripts allow-modals allow-forms"
    src="/sandbox.html"
    onLoad={() => frameRef.current?.contentWindow?.postMessage({ html }, '*')}
  />;
}

/** What the badge above the toolbar can honestly say about the preview. */
type PreviewStatus = 'idle' | 'building' | 'starting' | 'live' | 'blank' | 'crashed' | 'failed';

/**
 * The state of the preview, named for what it actually is.
 *
 * There is no server hosting the generated app: `buildProject` compiles the project in a worker
 * and the result is handed to a sandboxed iframe, so the honest words are about the build and the
 * frame, never a "Dev Server: Running" that does not exist.
 */
function statusLabel(status: PreviewStatus): { text: string; running: boolean } {
  if (status === 'building') return { text: 'Building…', running: false };
  if (status === 'starting') return { text: 'Starting app…', running: false };
  if (status === 'live') return { text: 'App running', running: true };
  if (status === 'blank') return { text: 'Built, but nothing rendered', running: false };
  if (status === 'crashed') return { text: 'App crashed', running: false };
  if (status === 'failed') return { text: 'Build failed', running: false };
  return { text: 'Idle', running: false };
}

/**
 * A file pulled into an empty canvas becomes a project of its own.
 *
 * Wrapping it in a path-named fence and handing it to `parseProject` means a pulled `index.html`
 * or `App.tsx` gets exactly the same treatment as one an agent wrote. A file that is not runnable
 * on its own (a README, a helper module) still opens, so it can be read, edited and pushed back.
 */
function projectFromFile(path: string, content: string): { project: Project; runnable: boolean } {
  const parsed = parseProject(`\`\`\`${path}\n${content}\n\`\`\``);
  if (parsed) return { project: parsed, runnable: true };
  return { project: { files: [{ path, content }], entry: path, dependencies: {}, kind: /\.(tsx|jsx)$/.test(path) ? 'react' : 'html' }, runnable: false };
}

export default function OutputPanel(p: OutputPanelProps) {
  const [view, setView] = useState<View>('preview');
  const [editing, setEditing] = useState(false);
  const [device, setDevice] = useState<Device>('desktop');
  const [split, setSplit] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [project, setProject] = useState<Project | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState('');
  const [build, setBuild] = useState<BuildState>({ kind: 'idle' });
  const [runtime, setRuntime] = useState<Runtime>({ state: 'starting' });
  const [refresh, setRefresh] = useState(0);
  const [pushOpen, setPushOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [syncState, setSyncState] = useState<GithubSyncState>(() => ({ ...emptySyncState(), ...loadSyncSettings(), sha: null }));
  const [toast, setToast] = useState<SyncToast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const parsedRef = useRef('');
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const exportRef = useRef<HTMLDivElement>(null);

  const selected = useMemo(() => project?.files.find(file => file.path === selectedFile) ?? null, [project, selectedFile]);

  const compile = (next: Project, immediate = false) => {
    abortRef.current?.abort();
    if (editTimer.current) clearTimeout(editTimer.current);
    editTimer.current = null;
    const controller = new AbortController(); abortRef.current = controller;
    setBuild({ kind: 'building' });
    const run = () => void buildProject(preparePreviewProject(next), controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setBuild(buildState(result, ++seqRef.current));
    }).catch(error => {
      if (!controller.signal.aborted) setBuild({ kind: 'error', errors: [error instanceof Error ? error.message : 'The build failed.'] });
    });
    if (immediate) run(); else editTimer.current = setTimeout(run, 180);
  };

  useEffect(() => {
    const next = parseProject(p.content);
    // A reply with no runnable code leaves whatever is already on the canvas — a pulled file, an
    // edit in progress — rather than blanking it; the chat already shows the prose. Only an empty
    // session (new, or cleared) returns the canvas to idle.
    if (!next) {
      const css = cssDraft(p.content);
      if (css) {
        const signature = `css:${css}`;
        if (parsedRef.current !== signature) {
          parsedRef.current = signature;
          abortRef.current?.abort();
          setProject({ files: [{ path: 'styles.css', content: css }], entry: 'styles.css', dependencies: {}, kind: 'html' });
          setSelectedFile('styles.css'); setActiveCode(css); setView('code'); setEditing(false);
          setBuild({ kind: 'idle' }); setEditDirty(false);
        }
        return;
      }
      if (!p.content && !p.streaming) { abortRef.current?.abort(); parsedRef.current = ''; setProject(null); setSelectedFile(null); setActiveCode(''); setBuild({ kind: 'idle' }); setEditDirty(false); }
      return;
    }
    const signature = JSON.stringify(next);
    if (parsedRef.current === signature) return;
    parsedRef.current = signature;
    setProject(next);
    setSelectedFile(next.entry);
    setActiveCode(next.files.find(file => file.path === next.entry)?.content ?? '');
    setView('preview'); setEditing(false);
    setEditDirty(false);
    compile(next, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.content]);

  useEffect(() => () => { abortRef.current?.abort(); parsedRef.current = ''; if (editTimer.current) clearTimeout(editTimer.current); }, []);

  useEffect(() => {
    if (!selected || selected.content === activeCode) return;
    setActiveCode(selected.content);
  }, [selected, activeCode]);

  // The export menu closes on any click outside it, and on Escape.
  useEffect(() => {
    if (!exportOpen) return;
    const onDown = (e: MouseEvent) => { if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setExportOpen(false); };
    document.addEventListener('mousedown', onDown); document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [exportOpen]);

  // Escape leaves fullscreen — unless a dialog is open on top, which Escape belongs to first.
  useEffect(() => {
    if (!fullscreen || syncOpen || pushOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setFullscreen(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [fullscreen, syncOpen, pushOpen]);

  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  function chooseFile(path: string) {
    const file = project?.files.find(f => f.path === path);
    setSelectedFile(path); setActiveCode(file?.content ?? ''); setEditDirty(false);
  }

  function edit(value: string) {
    if (!project || !selectedFile) return;
    setActiveCode(value); setEditDirty(true);
    const files: ProjectFile[] = project.files.map(file => file.path === selectedFile ? { ...file, content: value } : file);
    const next = { ...project, files };
    setProject(next); compile(next);
  }

  /** A pulled file replaces the one at that path, joins the project if it is new, or seeds an empty canvas. */
  function applyPulled(path: string, content: string) {
    if (!project) {
      const { project: seeded, runnable } = projectFromFile(path, content);
      setProject(seeded); setSelectedFile(path); setActiveCode(content); setEditDirty(false);
      if (runnable) { setView('preview'); compile(seeded, true); } else { setView('code'); setBuild({ kind: 'idle' }); }
      return;
    }
    const exists = project.files.some(file => file.path === path);
    const files: ProjectFile[] = exists
      ? project.files.map(file => file.path === path ? { ...file, content } : file)
      : [...project.files, { path, content }];
    const next = { ...project, files };
    setProject(next); setSelectedFile(path); setActiveCode(content); setEditDirty(false);
    compile(next, true);
  }

  /** A visible toast for sync results, also read out by screen readers, cleared after a few seconds. */
  function notify(next: SyncToast) {
    setToast(next);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), next.tone === 'error' ? 7000 : 4000);
  }

  function rebuild() {
    if (!project) return;
    setRefresh(n => n + 1); compile(project, true);
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(activeCode); setCopied(true); setTimeout(() => setCopied(false), 1400); }
    catch { setCopied(false); }
  }

  // Exports go through the same scanner as a push: a key the model echoed into a file, or one of
  // this visitor's own saved credentials, is replaced with [REDACTED] before the file leaves.
  function downloadZip() {
    if (!project) return;
    const clean = sanitizeFiles(project.files, p.secrets);
    saveBlob(zipBlob(clean.files), archiveName(project.entry)); setExportOpen(false);
    if (clean.redactions) notify({ tone: 'success', title: 'ZIP saved · ', message: `${clean.redactions} credential${clean.redactions === 1 ? '' : 's'} in ${clean.touched.join(', ')} replaced with [REDACTED].` });
  }
  function downloadFile() {
    if (!selectedFile) return;
    const clean = redactSecrets(activeCode, p.secrets);
    saveBlob(new Blob([clean.text], { type: 'text/plain' }), selectedFile.replace(/^.*\//, '')); setExportOpen(false);
    if (clean.count) notify({ tone: 'success', title: 'File saved · ', message: `${clean.count} credential${clean.count === 1 ? '' : 's'} replaced with [REDACTED].` });
  }

  const isBuilding = build.kind === 'building';
  // The badge tracks the build state, which is the only state there is: a compiled result or a
  // failure, never a server that might or might not be listening.
  // "Live" used to mean only that the code compiled. It now means the page actually ran and put
  // something on screen, as reported from inside the sandbox.
  const previewStatus: PreviewStatus = isBuilding || (p.streaming && project) ? 'building'
    : build.kind === 'ready' ? (runtime.state === 'ready' ? 'live' : runtime.state === 'blank' ? 'blank' : runtime.state === 'error' ? 'crashed' : 'starting')
      : build.kind === 'error' ? 'failed' : 'idle';
  const devStatus = statusLabel(previewStatus);
  const codeMarkup = highlightCode(activeCode);
  /** Every route back to the running app: re-mount the frame and restore the canonical split. */
  const showPreview = () => { setView('preview'); setEditing(false); p.onPreviewFocus(); setRefresh(n => n + 1); };
  const sourceOnly = project?.entry === 'styles.css';
  const codeShown = view === 'code' || split;

  const fileTabs = project && project.files.length > 1 && <div className="file-tabs">{project.files.map(file => <button key={file.path} className={file.path === selectedFile ? 'file-tab active' : 'file-tab'} onClick={() => chooseFile(file.path)}>{file.path}</button>)}</div>;

  const codePane = project && <div className={editing ? 'output-editor' : 'output-code'}>
    {fileTabs}
    <div className="code-toolbar">
      <span>{selectedFile ?? 'Generated source'}{editing && editDirty ? ' · edited' : ''}</span>
      <span className="row gap">
        <span className="segmented" role="group" aria-label="Code mode">
          <button aria-pressed={!editing} className={!editing ? 'active' : ''} onClick={() => setEditing(false)}><Eye size={11} />View</button>
          <button aria-pressed={editing} className={editing ? 'active' : ''} onClick={() => setEditing(true)}><Pencil size={11} />Edit{editDirty && <span className="edit-dot" />}</button>
        </span>
        {editing && !split
          ? <button className="toolbar-button" onClick={showPreview}><Check size={12} />Apply & Preview</button>
          : <button className="toolbar-button" onClick={() => void copyCode()}><Copy size={12} />{copied ? 'Copied' : 'Copy'}</button>}
      </span>
    </div>
    {editing
      ? <textarea aria-label="Generated code editor" className="code-editor" spellCheck={false} value={activeCode} onChange={event => edit(event.target.value)} />
      : <pre className="syntax-code" dangerouslySetInnerHTML={{ __html: codeMarkup }} />}
  </div>;

  const previewPane = project && <div className="output-preview">
    <div className={device === 'mobile' ? 'device-stage mobile' : 'device-stage'}>
      {isBuilding && <div className="preview-empty">{p.streaming ? <HourglassIcon size={22} /> : <LoaderCircle size={20} className="spin" />}<span>{p.streaming ? 'Receiving executable code…' : 'Compiling the latest app…'}</span></div>}
      {p.streaming && <span className="streaming-note"><HourglassIcon size={11} /> Live code stream · preview refreshes when complete</span>}
      {build.kind === 'error' && <div className="build-errors"><p className="msg-error"><CircleAlert size={12} />Build failed</p><pre>{build.errors.join('\n')}</pre></div>}
      {build.kind === 'idle' && <div className="preview-empty"><Code2 size={20} strokeWidth={1.25} /><span>{selectedFile} is not a page on its own. Open it in the code view, or pull an HTML or React entry file.</span></div>}
      {build.kind === 'ready' && <><SandboxFrame html={build.html} refresh={refresh + build.seq} onRuntime={setRuntime} />{runtime.state === 'error' && <p className="preview-runtime-error" role="alert">The app crashed: {runtime.message}</p>}{runtime.state === 'blank' && <p className="preview-runtime-error" role="status">The app built but put nothing on screen. Check the code view, or ask the agent to fix the blank page.</p>}<button className="rerun-button" onClick={() => setRefresh(n => n + 1)}><RotateCw size={13} />Rerun</button></>}
    </div>
  </div>;

  return <aside className={fullscreen ? 'preview-panel fullscreen' : 'preview-panel'}>
    <header className="preview-head developer-toolbar">
      <div className="toolbar-group">
        <button className={codeShown ? 'toolbar-button active' : 'toolbar-button'} aria-pressed={codeShown} disabled={!project || split} onClick={() => { if (view === 'code') showPreview(); else setView('code'); }} title="View or edit the generated source"><Code2 size={12} />View / Edit Code</button>
        <button className="toolbar-button" onClick={() => { if ((!project || sourceOnly) && p.onFinish) p.onFinish(); else showPreview(); }} disabled={p.streaming || ((!project || sourceOnly) && !p.onFinish)} title={sourceOnly ? 'Complete the generated source into a runnable page' : 'Show the live app'}><MonitorPlay size={12} />{!project || sourceOnly ? 'Generate Preview' : 'Preview'}</button>
        <div className="menu-anchor" ref={exportRef}>
          <button className="toolbar-button" aria-haspopup="menu" aria-expanded={exportOpen} disabled={!project} onClick={() => setExportOpen(o => !o)}><FileArchive size={12} />Export<ChevronDown size={11} /></button>
          {exportOpen && <div className="toolbar-menu" role="menu">
            <button role="menuitem" onClick={downloadZip}><FileArchive size={13} /><span><strong>Download ZIP</strong><small>{project?.files.length ?? 0} file{project?.files.length === 1 ? '' : 's'}</small></span></button>
            <button role="menuitem" disabled={!selectedFile} onClick={downloadFile}><FileDown size={13} /><span><strong>Download current file</strong><small>{selectedFile}</small></span></button>
            <button role="menuitem" onClick={() => { setExportOpen(false); setPushOpen(true); }}><GithubMark size={13} /><span><strong>Export all files to GitHub…</strong><small>Uses Connectors → GitHub</small></span></button>
          </div>}
        </div>
        <button className="toolbar-button" onClick={() => setSyncOpen(true)} title="Pull or push one file against a GitHub branch"><GithubMark size={12} />GitHub: Sync</button>
      </div>
      <div className="toolbar-actions">
        <span className="segmented" role="group" aria-label="Viewport">
          <button aria-pressed={device === 'desktop'} className={device === 'desktop' ? 'active' : ''} title="Desktop width" aria-label="Desktop viewport" onClick={() => setDevice('desktop')}><Monitor size={12} /></button>
          <button aria-pressed={device === 'mobile'} className={device === 'mobile' ? 'active' : ''} title="Mobile width" aria-label="Mobile viewport" onClick={() => setDevice('mobile')}><Smartphone size={12} /></button>
          <button aria-pressed={split} className={split ? 'active' : ''} title="Code and preview side by side" aria-label="Split code and preview" disabled={!project} onClick={() => setSplit(s => !s)}><Columns2 size={12} /></button>
          <button aria-pressed={fullscreen} className={fullscreen ? 'active' : ''} title={fullscreen ? 'Exit fullscreen (Esc)' : 'Fullscreen'} aria-label={fullscreen ? 'Exit fullscreen' : 'Fullscreen'} onClick={() => setFullscreen(f => !f)}>{fullscreen ? <Minimize2 size={12} /> : <Maximize2 size={12} />}</button>
        </span>
        <span className={devStatus.running ? 'dev-status running' : 'dev-status'} title="The generated app is compiled in this browser and rendered in a sandboxed frame; nothing is served from a dev server."><Server size={12} />{devStatus.text}</span>
        <button className="icon-button" onClick={rebuild} disabled={!project || sourceOnly || isBuilding} title="Rebuild the generated app" aria-label="Rebuild the generated app"><RotateCw size={13} /></button>
        <button className="icon-button" aria-label="Close output panel" onClick={() => { setFullscreen(false); p.close(); }}><PanelRightClose size={14} /></button>
      </div>
    </header>
    {p.issue && <div className="preview-issue" role="alert"><CircleAlert size={13} /><span>{p.issue}</span>{p.onFinish && <button className="button small" onClick={p.onFinish}>Finish &amp; Preview</button>}</div>}
    <div className="preview-content">
      {!project && <div className="preview-empty canvas-idle">
        <MonitorPlay size={26} strokeWidth={1.1} />
        <strong>Canvas Idle · Ready to preview</strong>
        <span>Prompt the agent on the left or load a file to see live rendering.</span>
      </div>}
      {project && split && <div className="output-split">{codePane}{previewPane}</div>}
      {project && !split && (view === 'code' ? codePane : previewPane)}
    </div>
    {toast && <div className={`toast ${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'} aria-live="polite">
      {toast.tone === 'error' ? <CircleAlert size={14} /> : <CircleCheck size={14} />}
      <span><strong>{toast.title}</strong>{toast.message}</span>
      <button className="icon-button" aria-label="Dismiss" onClick={() => setToast(null)}><X size={12} /></button>
    </div>}
    <GithubSyncDrawer
      open={syncOpen} close={() => setSyncOpen(false)}
      state={syncState} patch={partial => setSyncState(current => ({ ...current, ...partial }))}
      activePath={selectedFile} activeContent={activeCode} applyPulled={applyPulled}
      files={project?.files ?? []} notify={notify} secrets={p.secrets}
    />
    <PushToGithub open={pushOpen} close={() => setPushOpen(false)} files={project?.files ?? []} github={p.github} updateGithub={p.updateGithub} openConnectors={p.openConnectors} secrets={p.secrets} request={p.request} notifyToast={notify} />
  </aside>;
}
