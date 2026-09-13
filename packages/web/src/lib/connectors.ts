import { workspaceId } from './store';
import { mcpToolSpecs, type McpConnection } from './mcp';
import { inspectPageSpec, type ToolSpec } from './tools';
import type { Knowledge } from './types';

// The Connectors hub: everything that gives an agent reach beyond the model.
//
// Four kinds, each one a small, explicit tool the model may call by name:
//   github     read a repository and audit its issues, through /api/github
//   web        pull a text snapshot of any public URL, through /api/fetch
//   knowledge  search the notes and documents held in this browser (no network at all)
//   mcp        tools exposed by remote Model Context Protocol servers, through /api/mcp
//
// Each connector's settings live in localStorage; secrets (a GitHub token, an MCP bearer) stay
// in memory for the session unless the person explicitly asks to remember them.
//
// `pushProject` below is the one write path in the whole hub: the Output panel's "Push to
// GitHub" button, not a model-callable tool, and it always sends the visitor's own token —
// there is no server-funded fallback for it the way there is for reads.

export type ConnectorKind = 'github' | 'web' | 'knowledge' | 'mcp';

export interface GithubSettings { enabled: boolean; token: string; saveToken: boolean; repos: string[]; }
export interface WebSettings { enabled: boolean; }
export interface KnowledgeSettings { enabled: boolean; }
export interface ConnectorSettings { github: GithubSettings; web: WebSettings; knowledge: KnowledgeSettings; }

const KEY = 'hb-connectors';
let sessionToken = '';

export const defaultSettings = (): ConnectorSettings => ({
  github: { enabled: false, token: '', saveToken: false, repos: [] },
  web: { enabled: true },
  knowledge: { enabled: true },
});

export function loadSettings(): ConnectorSettings {
  const base = defaultSettings();
  try {
    const stored = JSON.parse(localStorage.getItem(KEY) || '{}') as Partial<ConnectorSettings>;
    return {
      github: {
        enabled: stored.github?.enabled === true,
        token: stored.github?.saveToken && typeof stored.github.token === 'string' ? stored.github.token : sessionToken,
        saveToken: stored.github?.saveToken === true,
        repos: Array.isArray(stored.github?.repos) ? stored.github.repos.filter(r => typeof r === 'string').slice(0, 10) : [],
      },
      web: { enabled: stored.web?.enabled !== false },
      knowledge: { enabled: stored.knowledge?.enabled !== false },
    };
  } catch { return base; }
}

export function saveSettings(settings: ConnectorSettings): void {
  sessionToken = settings.github.token;
  try { localStorage.setItem(KEY, JSON.stringify({ ...settings, github: { ...settings.github, token: settings.github.saveToken ? settings.github.token : '' } })); }
  catch { /* storage unavailable; settings hold for this session */ }
}
export function clearSettings(): void { sessionToken = ''; try { localStorage.removeItem(KEY); } catch { /* storage unavailable */ } }

/** Split "owner/name" into its parts, tolerating a pasted github.com URL. */
export function parseRepo(value: string): { owner: string; repo: string } | null {
  const cleaned = value.trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '').replace(/\/+$/, '');
  const [owner, repo] = cleaned.split('/');
  return owner && repo && /^[A-Za-z0-9._-]+$/.test(owner) && /^[A-Za-z0-9._-]+$/.test(repo) ? { owner, repo } : null;
}

async function post<T>(path: string, body: unknown, signal: AbortSignal, timeoutMs = 30_000): Promise<T> {
  const response = await fetch(path, {
    method: 'POST', credentials: 'same-origin',
    signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]),
    headers: { 'Content-Type': 'application/json', 'X-Workspace-Id': workspaceId() },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof (data as { error?: { message?: string } })?.error?.message === 'string' ? (data as { error: { message: string } }).error.message : `Request failed (HTTP ${response.status}).`);
  return data as T;
}

export interface GithubResult { result: Record<string, unknown>; }
export const callGithub = (operation: string, params: Record<string, unknown>, token: string, signal: AbortSignal) =>
  post<GithubResult>('/api/github', { operation, params, ...(token ? { token } : {}) }, signal).then(r => r.result);

export interface PushResult { commitSha: string; branch: string; url: string; filesPushed: number; }
export interface PushParams { owner: string; repo: string; branch?: string; createBranch?: boolean; message: string; files: { path: string; content: string }[]; }
/** Push a generated project as one commit. Requires the visitor's own token — there is no other kind for a write. */
export const pushProject = (params: PushParams, token: string, signal: AbortSignal) =>
  post<{ result: PushResult }>('/api/github', { operation: 'push', params, token }, signal, 60_000).then(r => r.result);

export interface PageSnapshot { url: string; status: number; contentType: string; title: string; description: string; headings: string[]; wordCount: number; text: string; truncated: boolean; links: { href: string }[]; }
export const fetchUrl = (url: string, signal: AbortSignal) => post<PageSnapshot>('/api/fetch', { url }, signal, 25_000);

const asString = (value: unknown, fallback = '') => typeof value === 'string' ? value : typeof value === 'number' ? String(value) : fallback;
const lines = (record: Record<string, unknown>) => Object.entries(record).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : JSON.stringify(v ?? null)}`).join('\n');

/** The GitHub tools an agent sees when the connector is on. Read-only by construction. */
export function githubSpecs(settings: GithubSettings): ToolSpec[] {
  if (!settings.enabled) return [];
  const hint = settings.repos.length ? ` Repositories in this workspace: ${settings.repos.join(', ')}.` : '';
  const token = settings.token;
  const target = (args: Record<string, unknown>) => {
    const parsed = parseRepo(asString(args.repo) || settings.repos[0] || '');
    if (!parsed) throw new Error('Name the repository as owner/name, for example octocat/hello-world.');
    return parsed;
  };
  return [
    {
      name: 'github_repo',
      description: `github_repo {"repo": "owner/name", "path": "optional/file.md"}: read a repository. With no path it returns the description, language, stars, open issue count, default branch, and the README; with a path it returns that file's text.${hint}`,
      run: async (args, signal) => {
        const { owner, repo } = target(args);
        const path = asString(args.path).trim();
        if (path) { const file = await callGithub('file', { owner, repo, path, ref: asString(args.ref) || undefined }, token, signal) as { path: string; size: number; text: string }; return { output: `file: ${file.path} (${file.size} bytes)\n\n${file.text}`, summary: `${owner}/${repo} ${file.path}` }; }
        const meta = await callGithub('repo', { owner, repo }, token, signal);
        let readme = '';
        try { readme = (await callGithub('readme', { owner, repo }, token, signal) as { text: string }).text.slice(0, 8000); } catch { readme = '(no readable README)'; }
        return { output: `${lines(meta)}\n\nREADME:\n${readme}`, summary: `${owner}/${repo}: ${asString(meta.description, 'no description')}` };
      },
    },
    {
      name: 'github_files',
      description: 'github_files {"repo": "owner/name"}: list the file paths in a repository, so you can pick one to read with github_repo.',
      run: async (args, signal) => {
        const { owner, repo } = target(args);
        const tree = await callGithub('tree', { owner, repo, ref: asString(args.ref) || undefined }, token, signal) as { truncated: boolean; files: { path: string; size: number }[] };
        return { output: `${tree.files.length} files${tree.truncated ? ' (listing truncated by GitHub)' : ''}\n${tree.files.map(f => f.path).join('\n')}`, summary: `${owner}/${repo}: ${tree.files.length} files` };
      },
    },
    {
      name: 'github_issues',
      description: 'github_issues {"repo": "owner/name", "state": "open|closed|all", "number": 12}: audit issues. Without a number it lists recent issues with labels and a body excerpt; with one it returns that issue and its comments.',
      run: async (args, signal) => {
        const { owner, repo } = target(args);
        const number = Number(args.number);
        if (Number.isInteger(number) && number > 0) {
          const issue = await callGithub('issue', { owner, repo, number }, token, signal) as Record<string, unknown>;
          const { comments } = await callGithub('comments', { owner, repo, number }, token, signal) as { comments: { author: string; at: string; body: string }[] };
          return { output: `${lines(issue)}\n\ncomments (${comments.length}):\n${comments.map(c => `- ${c.author} at ${c.at}: ${c.body}`).join('\n')}`, summary: `#${number} ${asString(issue.title)}` };
        }
        const { issues } = await callGithub('issues', { owner, repo, state: asString(args.state) || 'open', limit: Number(args.limit) || 30 }, token, signal) as { issues: { number: number; title: string; state: string; labels: string[]; isPullRequest: boolean; updatedAt: string; body: string }[] };
        return { output: `${issues.length} issues\n\n${issues.map(i => `#${i.number} [${i.state}${i.isPullRequest ? ', pull request' : ''}] ${i.title}\n  labels: ${i.labels.join(', ') || 'none'} · updated ${i.updatedAt}\n  ${i.body.replace(/\s+/g, ' ').slice(0, 300)}`).join('\n\n')}`, summary: `${owner}/${repo}: ${issues.length} issues` };
      },
    },
  ];
}

/** The URL crawler tool: a text snapshot of any public page, taken server-side to bypass CORS. */
export function webSpecs(settings: WebSettings): ToolSpec[] {
  if (!settings.enabled) return [];
  return [{
    name: 'fetch_url',
    description: 'fetch_url {"url": "https://example.com/page"}: fetch a public URL server-side and return its title, description, headings, readable text, and links. No JavaScript runs, so a page that renders entirely in the browser may come back thin.',
    run: async (args, signal) => {
      const snapshot = await fetchUrl(asString(args.url).trim(), signal);
      return {
        output: `url: ${snapshot.url}\nstatus: ${snapshot.status}\ntype: ${snapshot.contentType}\ntitle: ${snapshot.title}\ndescription: ${snapshot.description}\nheadings: ${snapshot.headings.join(' | ')}\nwords: ${snapshot.wordCount}${snapshot.truncated ? ' (text truncated)' : ''}\n\ntext:\n${snapshot.text}\n\nlinks:\n${snapshot.links.map(l => l.href).join('\n')}`,
        summary: `${snapshot.status} ${snapshot.title || snapshot.url} (${snapshot.wordCount} words)`,
      };
    },
  }];
}

/**
 * Search the local document index. Notes never leave the browser for this: the lookup is the
 * same bounded lexical scoring the workspace already uses to attach context automatically,
 * exposed as a tool so an agent can go looking for a document the query did not surface.
 */
export function knowledgeSpecs(settings: KnowledgeSettings, docs: Knowledge[], search: (query: string, docs: Knowledge[], limit?: number) => Knowledge[]): ToolSpec[] {
  if (!settings.enabled || !docs.length) return [];
  return [{
    name: 'search_documents',
    description: `search_documents {"query": "menu prices"}: search the ${docs.length} note${docs.length === 1 ? '' : 's'} and document${docs.length === 1 ? '' : 's'} saved in this workspace and return the best matches. Runs entirely in the browser.`,
    run: async args => {
      const hits = search(asString(args.query), docs, 3);
      if (!hits.length) return { output: 'No document matched that query.', summary: 'no match' };
      return { output: hits.map(d => `[${d.title}]\n${d.content.slice(0, 6000)}`).join('\n\n'), summary: `${hits.length} document${hits.length === 1 ? '' : 's'}: ${hits.map(d => d.title).join(', ')}` };
    },
  }];
}

export interface ToolContext { settings: ConnectorSettings; mcp: McpConnection[]; knowledge: Knowledge[]; search: (query: string, docs: Knowledge[], limit?: number) => Knowledge[]; personaTools?: string[]; }

/** Every tool available for one turn, in the order the model sees them. */
export function activeTools(context: ToolContext): ToolSpec[] {
  return [
    ...(context.personaTools?.includes('inspect_page') ? [inspectPageSpec] : []),
    ...githubSpecs(context.settings.github),
    ...webSpecs(context.settings.web),
    ...knowledgeSpecs(context.settings.knowledge, context.knowledge, context.search),
    ...mcpToolSpecs(context.mcp),
  ];
}

/** How many connectors are switched on, for the dock badge. */
export function activeCount(settings: ConnectorSettings, mcp: McpConnection[]): number {
  return (settings.github.enabled ? 1 : 0) + (settings.web.enabled ? 1 : 0) + (settings.knowledge.enabled ? 1 : 0) + mcp.filter(c => c.enabled && c.tools.length).length;
}
