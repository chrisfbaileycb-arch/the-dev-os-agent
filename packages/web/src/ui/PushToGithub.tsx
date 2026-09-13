import { useState } from 'react';
import { CircleAlert, ExternalLink, GitBranch, Github, LoaderCircle, X } from 'lucide-react';
import { pushProject, type GithubSettings } from '../lib/connectors';
import type { ProjectFile } from '../lib/project';
import { useDismiss } from './useDismiss';

// The push dialog: pick one of the repos already saved in Connectors → GitHub, name a branch (or
// leave it for the repo's default), write a commit message, and send every file in the generated
// project up as one commit. There is no anonymous path here — a token with write access is
// required, and the field says so plainly rather than failing silently on submit.

export interface PushToGithubProps {
  open: boolean;
  close: () => void;
  files: ProjectFile[];
  github: GithubSettings;
  openConnectors: () => void;
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string } | { kind: 'done'; url: string; branch: string; filesPushed: number };

export default function PushToGithub(p: PushToGithubProps) {
  const [repo, setRepo] = useState(p.github.repos[0] ?? '');
  const [branch, setBranch] = useState('');
  const [createBranch, setCreateBranch] = useState(false);
  const [message, setMessage] = useState('Add generated app from Hey Buddy');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  useDismiss(p.open, p.close);
  if (!p.open) return null;

  const hasToken = Boolean(p.github.token.trim());
  const [owner, name] = repo.split('/');

  async function push() {
    if (!hasToken) return;
    setStatus({ kind: 'busy' });
    try {
      const result = await pushProject(
        { owner, repo: name, branch: branch.trim() || undefined, createBranch, message: message.trim() || 'Add generated app from Hey Buddy', files: p.files.map(f => ({ path: f.path, content: f.content })) },
        p.github.token, AbortSignal.timeout(60_000),
      );
      setStatus({ kind: 'done', url: result.url, branch: result.branch, filesPushed: result.filesPushed });
    } catch (e) { setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'The push failed.' }); }
  }

  return <div className="overlay" onClick={e => { if (e.target === e.currentTarget) p.close(); }}>
    <section className="drawer push-drawer" role="dialog" aria-modal="true" aria-labelledby="push-title">
      <div className="drawer-head"><h2 id="push-title"><Github size={15} strokeWidth={1.75} /> Push to GitHub</h2><button className="icon-button" aria-label="Close" onClick={p.close} autoFocus><X size={16} /></button></div>

      {!hasToken && <p className="notice" role="status"><CircleAlert size={13} /><span>No GitHub token saved yet. Add one with write access to Contents in <button className="text-button" onClick={p.openConnectors}>Connectors → GitHub</button> first.</span></p>}

      {p.github.repos.length === 0
        ? <p className="help">No repositories saved yet. Add one in Connectors → GitHub, then come back here to push.</p>
        : <label className="grow">Repository
            <select value={repo} disabled={status.kind === 'busy'} onChange={e => setRepo(e.target.value)}>
              {p.github.repos.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </label>}

      <label className="grow">Branch<input value={branch} disabled={status.kind === 'busy'} placeholder="Leave blank for the repository's default branch" onChange={e => setBranch(e.target.value)} /></label>
      <label className="check"><input type="checkbox" checked={createBranch} disabled={status.kind === 'busy'} onChange={e => setCreateBranch(e.target.checked)} />Create this branch from the default branch if it doesn't exist</label>
      <label className="grow">Commit message<input value={message} disabled={status.kind === 'busy'} onChange={e => setMessage(e.target.value)} /></label>

      <div className="chip-row">{p.files.map(f => <span key={f.path} className="chip"><GitBranch size={11} />{f.path}</span>)}</div>

      {status.kind === 'error' && <p className="msg-error"><CircleAlert size={12} />{status.message}</p>}
      {status.kind === 'done' && <p className="notice" role="status"><span>Pushed {status.filesPushed} file{status.filesPushed === 1 ? '' : 's'} to <strong>{status.branch}</strong>. <a href={status.url} target="_blank" rel="noreferrer">View the commit <ExternalLink size={11} /></a></span></p>}

      <div className="row gap">
        <button className="button primary" disabled={!hasToken || !repo || status.kind === 'busy'} onClick={() => void push()}>
          {status.kind === 'busy' ? <LoaderCircle size={13} className="spin" /> : <Github size={13} />}
          Push {p.files.length} file{p.files.length === 1 ? '' : 's'}
        </button>
        <button className="button small" onClick={p.close}>Close</button>
      </div>
    </section>
  </div>;
}
