import { useMemo, useState } from 'react';
import { Download, FileText, LoaderCircle, Plug, Search, X } from 'lucide-react';
import { GithubMark } from './GithubMark';
import { callGithub, formatGithubError, GithubConnectorError, parseRepo, pullRepo, repoDefaultBranch, type GithubSettings } from '../lib/connectors';
import { loadSyncSettings } from '../lib/githubSync';
import { useDismiss } from './useDismiss';
import type { SyncToast } from './GithubSyncDrawer';

// "Pull from GitHub", opened from the folder button in the prompt dock.
//
// The folder button attaches a file from this machine; this is its sibling for a file that lives in
// a repository. Name a repo, browse its file list, click a file, and it lands in the message as an
// attachment — the same chips, the same token estimate, the same five-file cap as a local file, so
// nothing downstream knows or cares where the text came from.
//
// It reads through /api/github, the read path the Connectors hub already uses, so the token saved
// under Connectors → GitHub works here without pasting it twice (the sync drawer's own token is
// the fallback). Public repositories need no token at all. Writing back is the Output panel's job.

export interface GithubPullDialogProps {
  open: boolean; close: () => void;
  github: GithubSettings;
  /** Hand a pulled file to the message, exactly as if it had been picked from disk. */
  addFiles: (files: File[]) => void;
  openConnectors: () => void;
  notify: (message: string) => void;
  notifyToast?: (toast: SyncToast) => void;
  onImportProject?: (project: { owner: string; repo: string; branch: string; files: { path: string; content: string }[] }) => void;
}

const MAX_LISTED = 200;
const TEXT_FILE = /\.(txt|md|markdown|csv|json|html|css|scss|js|jsx|ts|tsx|mjs|cjs|py|rb|go|rs|java|kt|swift|c|h|cpp|sh|yml|yaml|toml|xml|sql|env\.example)$|(^|\/)(Dockerfile|Makefile|LICENSE|README)$/i;

export default function GithubPullDialog(p: GithubPullDialogProps) {
  const [repo, setRepo] = useState(() => p.github.repos[0] ?? loadSyncSettings().repo);
  const [branch, setBranch] = useState('');
  const [files, setFiles] = useState<{ path: string; size: number }[] | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [filter, setFilter] = useState('');
  const [busy, setBusy] = useState<'list' | string | null>(null);
  const [error, setError] = useState('');
  useDismiss(p.open, p.close);

  const token = p.github.token.trim() || loadSyncSettings().token.trim();
  const target = parseRepo(repo);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (files ?? []).filter(f => TEXT_FILE.test(f.path) && (!q || f.path.toLowerCase().includes(q)));
  }, [files, filter]);
  if (!p.open) return null;

  async function list() {
    if (!target) { setError('Name the repository as owner/name, for example octocat/hello-world.'); return; }
    setBusy('list'); setError('');
    try {
      const ref = branch.trim() || await repoDefaultBranch(target.owner, target.repo, token, AbortSignal.timeout(20_000));
      if (!branch.trim()) setBranch(ref);
      const tree = await callGithub('tree', { owner: target.owner, repo: target.repo, ref }, token, AbortSignal.timeout(30_000)) as { truncated: boolean; files: { path: string; size: number }[] };
      setFiles(tree.files); setTruncated(tree.truncated);
    } catch (e) {
      setFiles(null);
      const status = e instanceof GithubConnectorError ? e.status : undefined;
      const msg = status ? formatGithubError(status, e instanceof Error ? e.message : '') : (e instanceof Error ? e.message : 'Could not list that repository.');
      setError(msg);
      if (p.notifyToast) p.notifyToast({ tone: 'error', title: status ? `${status} · ` : 'GitHub · ', message: msg });
    }
    finally { setBusy(null); }
  }

  async function pull(path: string) {
    if (!target) return;
    setBusy(path); setError('');
    try {
      const file = await callGithub('file', { owner: target.owner, repo: target.repo, path, ref: branch.trim() || undefined }, token, AbortSignal.timeout(30_000)) as { path: string; text: string };
      p.addFiles([new File([file.text], file.path.replace(/^.*\//, ''), { type: 'text/plain' })]);
      const msg = `Pulled ${file.path} from ${target.owner}/${target.repo} into your message.`;
      p.notify(msg);
      if (p.notifyToast) p.notifyToast({ tone: 'success', title: 'File Pulled · ', message: msg });
      p.close();
    } catch (e) {
      const status = e instanceof GithubConnectorError ? e.status : undefined;
      const msg = status ? formatGithubError(status, e instanceof Error ? e.message : '') : (e instanceof Error ? e.message : 'Could not read that file.');
      setError(msg);
      if (p.notifyToast) p.notifyToast({ tone: 'error', title: status ? `${status} · ` : 'Pull failed · ', message: msg });
    }
    finally { setBusy(null); }
  }

  async function importToWorkspace() {
    if (!target) { setError('Name the repository as owner/name, for example octocat/hello-world.'); return; }
    setBusy('import'); setError('');
    try {
      const ref = branch.trim() || undefined;
      const result = await pullRepo({ owner: target.owner, repo: target.repo, branch: ref }, token, AbortSignal.timeout(60_000));
      if (!result.files.length) {
        throw new Error(`No readable text or code files found in ${target.owner}/${target.repo}.`);
      }
      if (p.onImportProject) {
        p.onImportProject(result);
      }
      const msg = `Imported ${target.owner}/${target.repo} (${result.files.length} file${result.files.length === 1 ? '' : 's'}) on branch ${result.branch}.`;
      p.notify(msg);
      if (p.notifyToast) {
        p.notifyToast({
          tone: 'success',
          title: 'Imported to Workspace · ',
          message: msg,
        });
      }
      p.close();
    } catch (e) {
      const status = e instanceof GithubConnectorError ? e.status : undefined;
      const msg = status ? formatGithubError(status, e instanceof Error ? e.message : '') : (e instanceof Error ? e.message : 'Could not import that repository.');
      setError(msg);
      if (p.notifyToast) {
        p.notifyToast({
          tone: 'error',
          title: status ? `${status} Error · ` : 'Import failed · ',
          message: msg,
        });
      }
    } finally {
      setBusy(null);
    }
  }

  return <div className="overlay" onClick={e => { if (e.target === e.currentTarget) p.close(); }}>
    <section className="drawer" role="dialog" aria-modal="true" aria-labelledby="pull-title">
      <div className="drawer-head">
        <h2 id="pull-title"><GithubMark size={15} strokeWidth={1.75} /> Pull from GitHub</h2>
        <button className="icon-button" aria-label="Close" onClick={p.close} autoFocus><X size={16} /></button>
      </div>
      <p className="help">Pick a file from a repository and it attaches to your next message, like a file from your computer. Public repositories need no token; a private one uses the token saved in Connectors → GitHub.</p>

      <div className="form-grid">
        <label className="grow">Repository<input value={repo} spellCheck={false} placeholder="owner/repo-name" onChange={e => setRepo(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void list(); }} /></label>
        <label>Branch<input value={branch} spellCheck={false} placeholder="default" onChange={e => setBranch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void list(); }} /></label>
      </div>
      <div className="row gap">
        <button className="button primary small" disabled={!repo.trim() || busy !== null} onClick={() => void list()}>{busy === 'list' ? <LoaderCircle size={13} className="spin" /> : <Search size={13} />}Browse files</button>
        <button className="button small" disabled={!repo.trim() || busy !== null} onClick={() => void importToWorkspace()} title="Pull this repository and open it as an active project in the canvas">{busy === 'import' ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />}Import to Workspace</button>
        {!token && <button className="text-button" onClick={() => { p.close(); p.openConnectors(); }}><Plug size={11} /> Add a token for private repos</button>}
      </div>
      {error && <p className="msg-error" role="alert">{error}</p>}

      {files && <>
        <label className="grow">Filter<input value={filter} spellCheck={false} placeholder="src/components, .md, README…" onChange={e => setFilter(e.target.value)} /></label>
        <div className="doc-list">
          {shown.slice(0, MAX_LISTED).map(f => <div key={f.path} className="doc-row">
            <FileText size={13} /><span><strong>{f.path}</strong><small>{f.size.toLocaleString()} bytes</small></span>
            <button className="button small" disabled={busy !== null} onClick={() => void pull(f.path)}>{busy === f.path ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />}Pull</button>
          </div>)}
        </div>
        <p className="help">{shown.length ? `${Math.min(shown.length, MAX_LISTED)} of ${shown.length} text files shown${shown.length > MAX_LISTED ? ' — narrow the filter to see the rest' : ''}.` : 'No text files match.'}{truncated ? ' GitHub truncated this repository’s listing, so some files may be missing.' : ''}</p>
      </>}
    </section>
  </div>;
}
