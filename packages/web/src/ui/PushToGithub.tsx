import { useEffect, useMemo, useRef, useState } from 'react';
import { CircleAlert, ExternalLink, GitBranch, LoaderCircle, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { GithubMark } from './GithubMark';
import { commitMessageFor, listRepos, parseRepo, pushProject, repoDefaultBranch, type GithubRepo, type GithubSettings } from '../lib/connectors';
import { sanitizeFiles } from '../lib/secrets';
import type { ProjectFile } from '../lib/project';
import { useDismiss } from './useDismiss';

// Push to GitHub: every generated file, one commit, straight from the workspace.
//
//   Where   type owner/repo, or load your own repositories and pick one. Picking a repository
//           fills in its real default branch; a typed one falls back to "main".
//   What    every file in the generated project is staged, with any credential the scanner finds
//           replaced by [REDACTED] first — the commit never carries a key the model echoed back.
//           Untick a file to leave it out.
//   How     a fine-grained personal access token with Contents: read and write on that
//           repository. It can be typed here and is kept with the Connectors → GitHub setting, so
//           the read tools and this dialog share one token. A brand-new empty repository works:
//           the push becomes its first commit.
//
// The commit message is written from the request and the staged files, and stays editable.

export interface PushToGithubProps {
  open: boolean;
  close: () => void;
  files: ProjectFile[];
  github: GithubSettings;
  /** Store the token (and the repository just pushed to) on the GitHub connector settings. */
  updateGithub: (patch: Partial<GithubSettings>) => void;
  openConnectors: () => void;
  /** Credentials this visitor holds, matched exactly when redacting. */
  secrets: string[];
  /** The request that produced these files, for the commit subject. */
  request?: string;
}

type Status = { kind: 'idle' } | { kind: 'busy' } | { kind: 'error'; message: string } | { kind: 'done'; url: string; branch: string; filesPushed: number; firstCommit: boolean };

export default function PushToGithub(p: PushToGithubProps) {
  const [repo, setRepo] = useState(p.github.repos[0] ?? '');
  const [branch, setBranch] = useState('main');
  const [branchTouched, setBranchTouched] = useState(false);
  const [createBranch, setCreateBranch] = useState(false);
  const [message, setMessage] = useState('');
  const [messageTouched, setMessageTouched] = useState(false);
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [token, setToken] = useState(p.github.token);
  const [rememberToken, setRememberToken] = useState(p.github.saveToken);
  const [repos, setRepos] = useState<GithubRepo[]>([]);
  const [loadingRepos, setLoadingRepos] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const branchRequest = useRef<AbortController | null>(null);
  useDismiss(p.open, p.close);

  const sanitized = useMemo(() => sanitizeFiles(p.files, p.secrets), [p.files, p.secrets]);
  const staged = useMemo(() => sanitized.files.filter(f => !excluded.has(f.path)), [sanitized, excluded]);
  const target = parseRepo(repo);

  // The message follows the staged files until the person edits it themselves.
  useEffect(() => { if (!messageTouched) setMessage(commitMessageFor(staged, p.request)); }, [staged, p.request, messageTouched]);
  // A fresh open starts from the connector's current token.
  useEffect(() => { if (p.open) { setToken(p.github.token); setRememberToken(p.github.saveToken); setStatus({ kind: 'idle' }); } }, [p.open, p.github.token, p.github.saveToken]);

  // Picking or typing a repository fills in its real default branch, unless the branch was typed.
  useEffect(() => {
    if (!p.open || branchTouched || !target) return;
    const known = repos.find(r => r.fullName.toLowerCase() === `${target.owner}/${target.repo}`.toLowerCase());
    if (known) { setBranch(known.defaultBranch); return; }
    branchRequest.current?.abort();
    const controller = new AbortController(); branchRequest.current = controller;
    const timer = setTimeout(() => {
      void repoDefaultBranch(target.owner, target.repo, token.trim(), controller.signal).then(b => { if (!controller.signal.aborted) setBranch(b); }).catch(() => { /* unknown or private without a token: keep "main" */ });
    }, 500);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [p.open, repo, repos, branchTouched, token]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!p.open) return null;

  const hasToken = Boolean(token.trim());
  const busy = status.kind === 'busy';

  async function loadRepos() {
    if (!hasToken) return;
    setLoadingRepos(true);
    try {
      const list = await listRepos(token.trim(), AbortSignal.timeout(30_000));
      setRepos(list);
      if (!repo && list[0]) setRepo(list[0].fullName);
    } catch (e) { setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'Could not list your repositories.' }); }
    finally { setLoadingRepos(false); }
  }

  async function push() {
    if (!hasToken || !target || !staged.length) return;
    setStatus({ kind: 'busy' });
    try {
      const result = await pushProject(
        { owner: target.owner, repo: target.repo, branch: branch.trim() || undefined, createBranch, message: message.trim() || commitMessageFor(staged, p.request), files: staged.map(f => ({ path: f.path, content: f.content })) },
        token.trim(), AbortSignal.timeout(90_000),
      );
      const full = `${target.owner}/${target.repo}`;
      p.updateGithub({ token: token.trim(), saveToken: rememberToken, repos: [full, ...p.github.repos.filter(r => r.toLowerCase() !== full.toLowerCase())].slice(0, 10) });
      setStatus({ kind: 'done', url: result.url, branch: result.branch, filesPushed: result.filesPushed, firstCommit: Boolean(result.createdRepoHistory) });
    } catch (e) { setStatus({ kind: 'error', message: e instanceof Error ? e.message : 'The push failed.' }); }
  }

  const toggle = (path: string) => setExcluded(current => { const next = new Set(current); if (next.has(path)) next.delete(path); else next.add(path); return next; });
  const suggestions = [...new Set([...repos.map(r => r.fullName), ...p.github.repos])];

  return <div className="overlay" onClick={e => { if (e.target === e.currentTarget) p.close(); }}>
    <section className="drawer push-drawer" role="dialog" aria-modal="true" aria-labelledby="push-title">
      <div className="drawer-head"><h2 id="push-title"><GithubMark size={15} strokeWidth={1.75} /> Push to GitHub</h2><button className="icon-button" aria-label="Close" onClick={p.close} autoFocus><X size={16} /></button></div>
      <p className="help">Commits every staged file to one branch as a single commit.</p>

      <label className="grow">Personal access token
        <input type="password" autoComplete="off" spellCheck={false} value={token} disabled={busy} placeholder="github_pat_… with Contents: read and write" onChange={e => setToken(e.target.value)} />
      </label>
      <label className="check"><input type="checkbox" checked={rememberToken} disabled={busy} onChange={e => setRememberToken(e.target.checked)} />Remember this token in this browser (shared with Connectors → GitHub)</label>
      {!hasToken && <p className="help">Create a fine-grained token at github.com → Settings → Developer settings, scoped to the repository with <strong>Contents: Read and write</strong>. <button className="text-button" onClick={p.openConnectors}>Or set it in Connectors → GitHub</button>.</p>}

      <div className="form-grid">
        <label className="grow">Repository
          <span className="row gap">
            <input list="push-repos" value={repo} disabled={busy} spellCheck={false} placeholder="owner/repo-name" onChange={e => { setRepo(e.target.value); setBranchTouched(false); }} />
            <button type="button" className="button small" disabled={!hasToken || loadingRepos || busy} onClick={() => void loadRepos()} title="List the repositories this token can reach">{loadingRepos ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />}My repos</button>
          </span>
          <datalist id="push-repos">{suggestions.map(r => <option key={r} value={r} />)}</datalist>
        </label>
        <label>Branch<input value={branch} disabled={busy} spellCheck={false} placeholder="main" onChange={e => { setBranch(e.target.value); setBranchTouched(true); }} /></label>
      </div>
      {repo.trim() && !target && <p className="field-error">Name the repository as owner/repo-name — a pasted github.com URL works too.</p>}
      {repos.find(r => r.fullName === repo && !r.canPush) && <p className="field-error">This token cannot push to {repo}.</p>}
      <label className="check"><input type="checkbox" checked={createBranch} disabled={busy} onChange={e => setCreateBranch(e.target.checked)} />Create <code>{branch || 'this branch'}</code> from the default branch if it doesn't exist</label>

      <label className="grow">Commit message<textarea rows={4} value={message} disabled={busy} onChange={e => { setMessage(e.target.value); setMessageTouched(true); }} /></label>

      <div className="stage-list" role="group" aria-label="Staged files">
        {sanitized.files.map(f => <label key={f.path} className="check mono"><input type="checkbox" checked={!excluded.has(f.path)} disabled={busy} onChange={() => toggle(f.path)} /><GitBranch size={11} />{f.path}{sanitized.touched.includes(f.path) && <em className="redacted-tag">redacted</em>}</label>)}
      </div>
      {sanitized.redactions > 0 && <p className="notice" role="status"><ShieldCheck size={13} /><span>{sanitized.redactions} credential{sanitized.redactions === 1 ? '' : 's'} found in {sanitized.touched.join(', ')} {sanitized.redactions === 1 ? 'was' : 'were'} replaced with <code>[REDACTED]</code> before staging.</span></p>}

      {status.kind === 'error' && <p className="msg-error"><CircleAlert size={12} />{status.message}</p>}
      {status.kind === 'done' && <p className="notice" role="status"><span>Pushed {status.filesPushed} file{status.filesPushed === 1 ? '' : 's'} to <strong>{status.branch}</strong>{status.firstCommit ? ' as the repository’s first commit' : ''}. <a href={status.url} target="_blank" rel="noreferrer">View the commit <ExternalLink size={11} /></a></span></p>}

      <div className="row gap">
        <button className="button primary" disabled={!hasToken || !target || !staged.length || busy} onClick={() => void push()}>
          {busy ? <LoaderCircle size={13} className="spin" /> : <GithubMark size={13} />}
          Push {staged.length} file{staged.length === 1 ? '' : 's'}
        </button>
        <button className="button small" onClick={p.close}>Close</button>
      </div>
    </section>
  </div>;
}
