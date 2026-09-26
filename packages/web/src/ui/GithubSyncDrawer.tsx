import { useEffect, useRef, useState } from 'react';
import { Check, CircleAlert, Download, Eye, ExternalLink, FileCode2, GitCompareArrows, LoaderCircle, X } from 'lucide-react';
import { GithubMark } from './GithubMark';
import {
  DEFAULT_COMMIT_MESSAGE, parseRepoTarget, pullFile, pushFile, saveSyncSettings,
  syncReady, type GithubSyncState,
} from '../lib/githubSync';
import type { ProjectFile } from '../lib/project';
import { useDismiss } from './useDismiss';

// "GitHub Repository Sync": one file, in and out of a branch, without leaving the workspace.
//
// The shape of the drawer follows the two things it has to be honest about. First, a token: the
// field is masked, the help text says where it lives (this browser, not a server), and Forget
// clears it in the same place you typed it. Second, the SHA: GitHub's Contents API refuses a write
// whose `sha` is not the file's current blob, which is the only thing standing between a stale tab
// and an overwritten commit — so the drawer shows the SHA it holds, and a 409 explains that the
// reason the push failed is somebody else got there first.
//
// Everything typed here writes straight through to the caller's state (`patch`), because these
// values are workspace state: they survive closing the drawer, they drive the pill's badge, and
// the next agent turn should reuse the repo/branch/path the visitor just named rather than ask
// them to type it twice.

export interface GithubSyncDrawerProps {
  open: boolean;
  close: () => void;
  state: GithubSyncState;
  patch: (partial: Partial<GithubSyncState>) => void;
  /** The file currently open in the editor, which is what the path field defaults to. */
  activePath: string | null;
  /** The editor buffer for that file — what a push sends and a pull replaces. */
  activeContent: string;
  /** Write a pulled file into the editor buffer. */
  applyPulled: (path: string, content: string) => void;
  files: ProjectFile[];
  notify: (message: string) => void;
}

type Status = { kind: 'idle' } | { kind: 'busy'; action: 'pull' | 'push' } | { kind: 'error'; message: string } | { kind: 'pulled'; path: string; branch: string; sha: string; bytes: number } | { kind: 'pushed'; path: string; branch: string; commitSha: string; url: string };

const short = (sha: string) => sha ? sha.slice(0, 7) : '—';

export default function GithubSyncDrawer(p: GithubSyncDrawerProps) {
  const [revealToken, setRevealToken] = useState(false);
  // Every hook runs before the closed-drawer early return, so React sees the same hook order on
  // every render whether the drawer is open or not.
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const closeRef = useRef<HTMLButtonElement>(null);
  useDismiss(p.open, p.close);
  useEffect(() => { if (p.open) closeRef.current?.focus(); }, [p.open]);
  if (!p.open) return null;

  const { state, patch } = p;
  const target = parseRepoTarget(state.repo);
  const ready = syncReady(state);

  function save() { saveSyncSettings({ token: state.token, repo: state.repo, branch: state.branch, path: state.path, message: state.message }); }

  async function pull() {
    patch({ path: state.path || p.activePath || '' });
    setStatus({ kind: 'busy', action: 'pull' });
    try {
      const result = await pullFile({ ...state, path: state.path || p.activePath || '' }, undefined, AbortSignal.timeout(30_000));
      patch({ sha: result.sha, path: result.path });
      p.applyPulled(result.path, result.content);
      setStatus({ kind: 'pulled', path: result.path, branch: (state.branch || 'main').trim(), sha: result.sha, bytes: new TextEncoder().encode(result.content).length });
      p.notify(`Successfully pulled ${result.path} (${(state.branch || 'main').trim()})`);
    } catch (e) { setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'The pull failed.' }); }
  }

  async function push() {
    setStatus({ kind: 'busy', action: 'push' });
    try {
      const result = await pushFile({ ...state, path: state.path || p.activePath || '' }, p.activeContent, undefined, AbortSignal.timeout(30_000));
      patch({ sha: result.sha, path: result.path });
      save();
      setStatus({ kind: 'pushed', path: result.path, branch: result.branch, commitSha: result.commitSha, url: result.commitUrl });
      p.notify(`Pushed ${result.path} to ${result.branch} · commit ${short(result.commitSha)}`);
    } catch (e) { setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'The push failed.' }); }
  }

  const busyAction = status.kind === 'busy' ? status.action : null;
  const errorText = status.kind === 'error' ? status.message : '';
  const conflict = errorText.includes('409');
  const unauthorized = errorText.includes('401') || errorText.includes('Bad credentials');

  return <div className="overlay" onClick={e => { if (e.target === e.currentTarget) p.close(); }}>
    <section className="drawer sync-drawer" role="dialog" aria-modal="true" aria-labelledby="sync-title">
      <div className="drawer-head">
        <h2 id="sync-title"><GithubMark size={15} strokeWidth={1.75} /> GitHub Repository Sync</h2>
        <button className="icon-button" aria-label="Close" ref={closeRef} onClick={p.close}><X size={16} /></button>
      </div>
      <p className="help">Pull one file down from a branch, edit it here, and push it back as a commit. The file's SHA travels with the edit, so a push that would land on top of someone else's work fails instead of overwriting it.</p>

      <label className="grow">GitHub Personal Access Token
        <span className="token-field">
          <input
            type={revealToken ? 'text' : 'password'} value={state.token} spellCheck={false} autoComplete="off"
            placeholder="ghp_… or github_pat_…, with the repo scope"
            onChange={e => patch({ token: e.target.value })}
          />
          <button className="icon-button" aria-label={revealToken ? 'Hide token' : 'Show token'} title={revealToken ? 'Hide token' : 'Show token'} onClick={() => setRevealToken(v => !v)}>{revealToken ? <Eye size={13} /> : <FileCode2 size={13} />}</button>
        </span>
      </label>
      <p className="help">Create one at github.com → Settings → Developer settings → Fine-grained or classic tokens, with <code>repo</code> read/write. It is stored in this browser only and sent straight to api.github.com — never to this app's server.</p>

      <div className="form-grid">
        <label className="grow">Repository
          <input value={state.repo} spellCheck={false} placeholder="owner/repo-name" onChange={e => patch({ repo: e.target.value })} />
        </label>
        <label>Branch
          <input value={state.branch} spellCheck={false} placeholder="main" onChange={e => patch({ branch: e.target.value })} />
        </label>
      </div>
      {state.repo.trim() && !target && <p className="field-error">Name the repository as owner/repo-name — a pasted github.com URL works too.</p>}

      <label className="grow">File Path
        <input value={state.path} spellCheck={false} placeholder={p.activePath || 'src/components/Component.tsx'} onChange={e => patch({ path: e.target.value })} />
      </label>
      <label className="grow">Commit Message
        <input value={state.message} placeholder={DEFAULT_COMMIT_MESSAGE} onChange={e => patch({ message: e.target.value })} />
      </label>

      <div className="sync-meta">
        <span title="The blob SHA this tab last read or wrote. A push sends it as the parent, which is how GitHub detects a conflicting edit.">Parent SHA <code>{short(state.sha ?? '')}</code></span>
        <span>{p.files.length} file{p.files.length === 1 ? '' : 's'} in this workspace</span>
      </div>

      {errorText && <div className={conflict ? 'sync-alert conflict' : 'sync-alert'} role="alert">
        <CircleAlert size={13} />
        <span>
          {conflict && <strong>Someone pushed first. </strong>}
          {unauthorized && <strong>This token was refused. </strong>}
          {errorText}
          {conflict && <button className="text-button" onClick={() => void pull()}> Pull the latest version <GitCompareArrows size={11} /></button>}
        </span>
      </div>}
      {status.kind === 'pulled' && <p className="notice" role="status"><Check size={13} /><span>Pulled <strong>{status.path}</strong> from <strong>{status.branch}</strong> ({status.bytes.toLocaleString()} bytes) into the editor. Parent SHA is now <code>{short(status.sha)}</code>.</span></p>}
      {status.kind === 'pushed' && <p className="notice" role="status"><Check size={13} /><span>Committed <strong>{status.path}</strong> to <strong>{status.branch}</strong>. <a href={status.url} target="_blank" rel="noreferrer">commit {short(status.commitSha)} <ExternalLink size={11} /></a></span></p>}

      <div className="row gap sync-actions">
        <button className="button primary small" disabled={Boolean(busyAction) || !ready} onClick={() => void pull()}>
          {busyAction === 'pull' ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />} Pull from GitHub
        </button>
        <button className="button small" disabled={Boolean(busyAction) || !ready || !p.activeContent} onClick={() => void push()}>
          {busyAction === 'push' ? <LoaderCircle size={13} className="spin" /> : <GithubMark size={13} />} Push to GitHub
        </button>
        <button className="button small" onClick={save} title="Keep these values in this browser">Save</button>
      </div>
      {!ready && <p className="help">A token, an <code>owner/repo</code>, and a file path are all needed before either request can run.</p>}

      <div className="row gap end">
        <button className="text-button" onClick={() => { patch({ token: '', sha: null }); saveSyncSettings({ token: '', repo: state.repo, branch: state.branch, path: state.path, message: state.message }); p.notify('GitHub token forgotten from this browser.'); }}>Forget token</button>
        <button className="button small" onClick={p.close}>Close</button>
      </div>
    </section>
  </div>;
}
