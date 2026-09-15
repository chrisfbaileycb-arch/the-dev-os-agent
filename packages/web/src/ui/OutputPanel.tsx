import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, CircleAlert, Code2, Copy, Eye, Github, LoaderCircle, PanelRightClose, PanelRightOpen, RotateCw, Server, Settings2 } from 'lucide-react';
import { parseProject, type Project, type ProjectFile } from '../lib/project';
import { buildProject, type BuildResult } from '../lib/bundle/client';
import { highlightCode } from '../lib/highlight';
import type { GithubSettings } from '../lib/connectors';
import PushToGithub from './PushToGithub';

export interface OutputPanelProps {
  content: string;
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
}

type BuildState = { kind: 'idle' } | { kind: 'building' } | { kind: 'ready'; html: string; seq: number } | { kind: 'error'; errors: string[] };
type View = 'preview' | 'code' | 'edit';

function buildState(result: BuildResult, seq: number): BuildState {
  return result.ok ? { kind: 'ready', html: result.html, seq } : { kind: 'error', errors: result.errors };
}

function SandboxFrame({ html, refresh }: { html: string; refresh: number }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  return <iframe
    key={refresh}
    ref={frameRef}
    title="Live generated app preview"
    className="output-frame"
    sandbox="allow-scripts allow-modals allow-same-origin"
    src="/sandbox.html"
    onLoad={() => frameRef.current?.contentWindow?.postMessage({ html }, '*')}
  />;
}

export default function OutputPanel(p: OutputPanelProps) {
  const [view, setView] = useState<View>('preview');
  const [project, setProject] = useState<Project | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [activeCode, setActiveCode] = useState('');
  const [build, setBuild] = useState<BuildState>({ kind: 'idle' });
  const [refresh, setRefresh] = useState(0);
  const [pushOpen, setPushOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [devRunning, setDevRunning] = useState(false);
  const [editDirty, setEditDirty] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const seqRef = useRef(0);
  const editTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selected = useMemo(() => project?.files.find(file => file.path === selectedFile) ?? null, [project, selectedFile]);

  const compile = (next: Project, immediate = false) => {
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    setBuild({ kind: 'building' }); setDevRunning(false);
    const run = () => void buildProject(next, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setBuild(buildState(result, ++seqRef.current));
      if (result.ok) setDevRunning(true);
    }).catch(error => {
      if (!controller.signal.aborted) setBuild({ kind: 'error', errors: [error instanceof Error ? error.message : 'The build failed.'] });
    });
    if (immediate) run(); else editTimer.current = setTimeout(run, 180);
  };

  useEffect(() => {
    const next = parseProject(p.content);
    setProject(next);
    setSelectedFile(next?.entry ?? null);
    setActiveCode(next?.files.find(file => file.path === next.entry)?.content ?? '');
    setView('preview');
    setEditDirty(false);
    abortRef.current?.abort();
    if (!next) { setBuild({ kind: 'idle' }); setDevRunning(false); return; }
    compile(next, true);
    return () => { abortRef.current?.abort(); if (editTimer.current) clearTimeout(editTimer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.content]);

  useEffect(() => {
    if (!selected || selected.content === activeCode) return;
    setActiveCode(selected.content);
  }, [selected, activeCode]);

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

  function rebuild() {
    if (!project) return;
    setDevRunning(false); setRefresh(n => n + 1); compile(project, true);
  }

  async function copyCode() {
    try { await navigator.clipboard.writeText(activeCode); setCopied(true); setTimeout(() => setCopied(false), 1400); }
    catch { setCopied(false); }
  }

  const isBuilding = build.kind === 'building';
  const codeMarkup = highlightCode(activeCode);
  /** Every route back to the running app: re-mount the frame and restore the canonical split. */
  const showPreview = () => { setView('preview'); p.onPreviewFocus(); setRefresh(n => n + 1); };

  return <aside className="preview-panel">
    <header className="preview-head developer-toolbar">
      <div className="toolbar-brand"><Code2 size={14} /><span>Workspace</span></div>
      <nav className="developer-tabs" role="tablist" aria-label="Developer workspace views">
        <button role="tab" aria-selected={view === 'preview'} className={view === 'preview' ? 'developer-tab active' : 'developer-tab'} onClick={showPreview}><Eye size={12} />Preview{(isBuilding || p.streaming) && <LoaderCircle size={11} className="spin" />}{p.streaming && <span className="stream-pulse" aria-label="Code is streaming" />}</button>
        <button role="tab" aria-selected={view === 'code'} className={view === 'code' ? 'developer-tab active' : 'developer-tab'} onClick={() => setView('code')}><Code2 size={12} />Code</button>
        <button role="tab" aria-selected={view === 'edit'} className={view === 'edit' ? 'developer-tab active' : 'developer-tab'} onClick={() => setView('edit')}><Settings2 size={12} />Edit{editDirty && <span className="edit-dot" />}</button>
      </nav>
      <div className="toolbar-actions">
        <span className={devRunning ? 'dev-status running' : 'dev-status'}><Server size={12} />Dev Server: {devRunning ? 'Running' : 'Ready'}</span>
        <button className="toolbar-button" onClick={rebuild} disabled={!project || isBuilding} title="Restart the generated app"><RotateCw size={12} />Restart</button>
        {project && <button className="toolbar-button" onClick={() => setPushOpen(true)} title="Save the current files to GitHub"><Github size={12} />GitHub</button>}
        <button className="icon-button" aria-label="Close output panel" onClick={p.close}><PanelRightClose size={14} /></button>
      </div>
    </header>
    <div className="preview-content">
      {!project && (!p.content ? <div className="preview-empty"><PanelRightOpen size={22} strokeWidth={1.25} /><span>Agent output will appear here</span></div> : <pre className="preview-body">{p.content}</pre>)}
      {project && view === 'preview' && <div className="output-preview">
        {isBuilding && <div className="preview-empty"><LoaderCircle size={20} className="spin" /><span>{p.streaming ? 'Receiving executable code…' : 'Compiling the latest app…'}</span></div>}
        {p.streaming && <span className="streaming-note">Live code stream · preview refreshes when complete</span>}
        {build.kind === 'error' && <div className="build-errors"><p className="msg-error"><CircleAlert size={12} />Build failed</p><pre>{build.errors.join('\n')}</pre></div>}
        {build.kind === 'ready' && <><SandboxFrame html={build.html} refresh={refresh + build.seq} /><button className="rerun-button" onClick={() => { setDevRunning(true); setRefresh(n => n + 1); }}><RotateCw size={13} />Refresh / Rerun</button></>}
      </div>}
      {project && view === 'code' && <div className="output-code">
        <div className="file-tabs">{project.files.map(file => <button key={file.path} className={file.path === selectedFile ? 'file-tab active' : 'file-tab'} onClick={() => chooseFile(file.path)}>{file.path}</button>)}</div>
        <div className="code-toolbar"><span>{selectedFile ?? 'Generated source'}</span><button className="toolbar-button" onClick={() => void copyCode()}><Copy size={12} />{copied ? 'Copied' : 'Copy Code'}</button></div>
        <pre className="syntax-code" dangerouslySetInnerHTML={{ __html: codeMarkup }} />
      </div>}
      {project && view === 'edit' && <div className="output-editor">
        <div className="file-tabs">{project.files.map(file => <button key={file.path} className={file.path === selectedFile ? 'file-tab active' : 'file-tab'} onClick={() => chooseFile(file.path)}>{file.path}</button>)}</div>
        <div className="code-toolbar"><span>Edit source{editDirty ? ' · unsaved' : ''}</span><button className="toolbar-button" onClick={showPreview}><Check size={12} />Apply & Preview</button></div>
        <textarea aria-label="Generated code editor" className="code-editor" spellCheck={false} value={activeCode} onChange={event => edit(event.target.value)} />
      </div>}
    </div>
    <PushToGithub open={pushOpen} close={() => setPushOpen(false)} files={project?.files ?? []} github={p.github} openConnectors={p.openConnectors} />
  </aside>;
}
