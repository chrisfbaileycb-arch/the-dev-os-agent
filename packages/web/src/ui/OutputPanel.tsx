import { useEffect, useRef, useState } from 'react';
import { CircleAlert, Code2, Eye, Github, LoaderCircle, PanelRightClose, PanelRightOpen, RotateCw } from 'lucide-react';
import { parseProject, type Project } from '../lib/project';
import { buildProject } from '../lib/bundle/client';
import type { GithubSettings } from '../lib/connectors';
import PushToGithub from './PushToGithub';

// The Output panel: a reply that reads as a project gets a real preview — bundled and rendered in
// a sandboxed iframe — instead of the text dump this panel always showed before. A reply that
// doesn't (an explanation, a one-off snippet, plain conversation) still gets exactly that text
// dump; detecting nothing is not a failure state here; it is most replies.
//
// The preview iframe loads public/sandbox.html (a real navigation, so it gets its own
// server-set policy rather than inheriting this page's) and the finished bundle reaches it by
// postMessage on load, not by `srcDoc` — see that file and SANDBOX_CSP in server/index.mjs for
// why a `srcdoc` document can't be handed a policy of its own permissive enough to run it.

function SandboxFrame({ html }: { html: string }) {
  const ref = useRef<HTMLIFrameElement>(null);
  return <iframe
    ref={ref} title="App preview" className="output-frame" sandbox="allow-scripts" src="/sandbox.html"
    onLoad={() => ref.current?.contentWindow?.postMessage({ html }, '*')}
  />;
}

export type PreviewSplit = 'even' | 'chat' | 'preview';
export interface OutputPanelProps {
  content: string;
  close: () => void;
  github: GithubSettings;
  openConnectors: () => void;
  /** How the workspace divides between chat and this panel; owned by App so it survives remounts. */
  split: PreviewSplit;
  setSplit: (s: PreviewSplit) => void;
}

type BuildState = { kind: 'idle' } | { kind: 'building' } | { kind: 'ready'; html: string; seq: number } | { kind: 'error'; errors: string[] };

export default function OutputPanel(p: OutputPanelProps) {
  const [tab, setTab] = useState<'preview' | 'code'>('preview');
  const [project, setProject] = useState<Project | null>(null);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [build, setBuild] = useState<BuildState>({ kind: 'idle' });
  const [pushOpen, setPushOpen] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  // A fresh sandbox iframe per build, even a build that lands byte-identical HTML to the last
  // one — the id, not the content, is what tells SandboxFrame a new navigation is needed.
  const seqRef = useRef(0);

  useEffect(() => {
    const next = parseProject(p.content);
    setProject(next);
    setSelectedFile(next?.entry ?? null);
    setTab('preview');
    abortRef.current?.abort();
    if (!next) { setBuild({ kind: 'idle' }); return; }
    const controller = new AbortController(); abortRef.current = controller;
    setBuild({ kind: 'building' });
    void buildProject(next, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setBuild(result.ok ? { kind: 'ready', html: result.html, seq: ++seqRef.current } : { kind: 'error', errors: result.errors });
    }).catch(error => { if (!controller.signal.aborted) setBuild({ kind: 'error', errors: [error instanceof Error ? error.message : 'The build failed.'] }); });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.content]);

  function rebuild() {
    if (!project) return;
    abortRef.current?.abort();
    const controller = new AbortController(); abortRef.current = controller;
    setBuild({ kind: 'building' });
    void buildProject(project, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setBuild(result.ok ? { kind: 'ready', html: result.html, seq: ++seqRef.current } : { kind: 'error', errors: result.errors });
    }).catch(error => { if (!controller.signal.aborted) setBuild({ kind: 'error', errors: [error instanceof Error ? error.message : 'The build failed.'] }); });
  }

  return <aside className="preview-panel">
    <div className="preview-head">
      <span>Output</span>
      {project && <div className="output-tabs" role="tablist" aria-label="Output view">
        <button role="tab" aria-selected={tab === 'preview'} className={tab === 'preview' ? 'output-tab active' : 'output-tab'} onClick={() => setTab('preview')}><Eye size={12} />Preview</button>
        <button role="tab" aria-selected={tab === 'code'} className={tab === 'code' ? 'output-tab active' : 'output-tab'} onClick={() => setTab('code')}><Code2 size={12} />Code</button>
      </div>}
      <span className="row gap">
        <span className="output-tabs split-toggle" role="group" aria-label="Split layout">
          <button role="button" aria-pressed={p.split === 'even'} className={p.split === 'even' ? 'output-tab active' : 'output-tab'} title="Equal split between chat and output" onClick={() => p.setSplit('even')}>50/50</button>
          <button role="button" aria-pressed={p.split === 'chat'} className={p.split === 'chat' ? 'output-tab active' : 'output-tab'} title="Focus chat, keep output beside it" onClick={() => p.setSplit('chat')}>Chat</button>
          <button role="button" aria-pressed={p.split === 'preview'} className={p.split === 'preview' ? 'output-tab active' : 'output-tab'} title="Focus output, keep chat beside it" onClick={() => p.setSplit('preview')}>Preview</button>
        </span>
        {project && <button className="icon-button" title="Rebuild" aria-label="Rebuild" disabled={build.kind === 'building'} onClick={rebuild}><RotateCw size={13} className={build.kind === 'building' ? 'spin' : ''} /></button>}
        {project && <button className="button small" onClick={() => setPushOpen(true)}><Github size={12} />Push to GitHub</button>}
        <button className="icon-button" aria-label="Close output panel" onClick={p.close}><PanelRightClose size={14} /></button>
      </span>
    </div>
    <div className="preview-content">
      {!project && (!p.content
        ? <div className="preview-empty"><PanelRightOpen size={22} strokeWidth={1.25} /><span>Agent output will appear here</span></div>
        : <pre className="preview-body">{p.content}</pre>)}

      {project && tab === 'preview' && <div className="output-preview">
        {build.kind === 'building' && <div className="preview-empty"><LoaderCircle size={20} className="spin" /><span>Building {project.kind === 'react' ? 'the React app' : 'the app'}…</span></div>}
        {build.kind === 'error' && <div className="build-errors"><p className="msg-error"><CircleAlert size={12} />Build failed</p><pre>{build.errors.join('\n')}</pre></div>}
        {build.kind === 'ready' && <SandboxFrame key={build.seq} html={build.html} />}
      </div>}

      {project && tab === 'code' && <div className="output-code">
        <div className="chip-row">{project.files.map(f => <button key={f.path} className={f.path === selectedFile ? 'chip active' : 'chip'} onClick={() => setSelectedFile(f.path)}>{f.path}</button>)}</div>
        <pre className="preview-body">{project.files.find(f => f.path === selectedFile)?.content ?? ''}</pre>
      </div>}
    </div>
    <PushToGithub open={pushOpen} close={() => setPushOpen(false)} files={project?.files ?? []} github={p.github} openConnectors={p.openConnectors} />
  </aside>;
}
