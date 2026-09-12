import { HttpError } from './proxy.mjs';
import { checkOrigin } from './state.mjs';

// /api/github: the GitHub connector. Reads repositories and audits issues.
//
// Strictly read-only by construction, not by policy: the upstream method is hard-coded to GET
// and the route only ever builds a URL from the closed OPERATIONS map below. There is no path
// the browser can take that writes to a repository, and no way to reach a host other than
// api.github.com, so a token pasted here cannot be turned into a commit or a comment.
//
// A token is optional. Without one, GitHub allows 60 requests an hour per IP and public repos
// only; with one, 5,000 an hour and whatever that token can see. The browser's token is used
// for that request alone and is never written to disk.

const API = 'https://api.github.com';
const TIMEOUT = 20_000;
const MAX_RESPONSE = 4_000_000;
const MAX_FILE_BYTES = 200_000;

const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
const PATH = /^[A-Za-z0-9._\-/ ]{1,300}$/;

const owner = v => { if (!SEGMENT.test(String(v ?? ''))) throw new HttpError(400, 'Enter a repository as owner/name.'); return String(v); };
const repoPath = v => { const value = String(v ?? ''); if (!PATH.test(value) || value.includes('..')) throw new HttpError(400, 'Enter a plain path inside the repository.'); return value.replace(/^\/+/, ''); };
const count = (v, fallback, max) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= max ? n : fallback; };
const issueNumber = v => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 1_000_000) throw new HttpError(400, 'Enter an issue number.'); return n; };

/**
 * Every request this connector can make. Each entry builds one api.github.com path from
 * validated pieces; nothing from the browser is concatenated into a URL unchecked.
 */
export const OPERATIONS = {
  repo: p => `/repos/${owner(p.owner)}/${owner(p.repo)}`,
  readme: p => `/repos/${owner(p.owner)}/${owner(p.repo)}/readme`,
  tree: p => `/repos/${owner(p.owner)}/${owner(p.repo)}/git/trees/${owner(p.ref || 'HEAD')}?recursive=1`,
  file: p => `/repos/${owner(p.owner)}/${owner(p.repo)}/contents/${repoPath(p.path).split('/').map(encodeURIComponent).join('/')}${p.ref ? `?ref=${encodeURIComponent(owner(p.ref))}` : ''}`,
  issues: p => `/repos/${owner(p.owner)}/${owner(p.repo)}/issues?state=${['open', 'closed', 'all'].includes(p.state) ? p.state : 'open'}&per_page=${count(p.limit, 30, 100)}&sort=updated`,
  issue: p => `/repos/${owner(p.owner)}/${owner(p.repo)}/issues/${issueNumber(p.number)}`,
  comments: p => `/repos/${owner(p.owner)}/${owner(p.repo)}/issues/${issueNumber(p.number)}/comments?per_page=${count(p.limit, 30, 100)}`,
};

/** Shrink GitHub's verbose payloads to the fields an agent actually reads. */
export function summarize(operation, data) {
  if (operation === 'repo') return { name: data.full_name, description: data.description, language: data.language, stars: data.stargazers_count, openIssues: data.open_issues_count, defaultBranch: data.default_branch, topics: data.topics, pushedAt: data.pushed_at, archived: data.archived, license: data.license?.spdx_id ?? null };
  if (operation === 'readme' || operation === 'file') {
    if (data.encoding !== 'base64' || typeof data.content !== 'string') throw new HttpError(415, 'That path is a directory or a binary file, not readable text.');
    const buffer = Buffer.from(data.content, 'base64');
    if (buffer.length > MAX_FILE_BYTES) throw new HttpError(413, `${data.path} is larger than this connector will read (200 KB).`);
    const text = buffer.toString('utf8');
    // A NUL byte in the first kilobyte is the cheap, reliable binary tell.
    if (text.slice(0, 1024).includes('\u0000')) throw new HttpError(415, `${data.path} looks like a binary file.`);
    return { path: data.path, size: data.size, text };
  }
  if (operation === 'tree') return { truncated: Boolean(data.truncated), files: (data.tree ?? []).filter(e => e.type === 'blob').map(e => ({ path: e.path, size: e.size })).slice(0, 800) };
  if (operation === 'issues') return { issues: (Array.isArray(data) ? data : []).map(i => ({ number: i.number, title: i.title, state: i.state, isPullRequest: Boolean(i.pull_request), labels: (i.labels ?? []).map(l => l.name ?? l), comments: i.comments, createdAt: i.created_at, updatedAt: i.updated_at, author: i.user?.login ?? null, body: typeof i.body === 'string' ? i.body.slice(0, 800) : '' })) };
  if (operation === 'issue') return { number: data.number, title: data.title, state: data.state, labels: (data.labels ?? []).map(l => l.name ?? l), author: data.user?.login ?? null, createdAt: data.created_at, updatedAt: data.updated_at, comments: data.comments, body: typeof data.body === 'string' ? data.body.slice(0, 20_000) : '' };
  if (operation === 'comments') return { comments: (Array.isArray(data) ? data : []).map(c => ({ author: c.user?.login ?? null, at: c.created_at, body: typeof c.body === 'string' ? c.body.slice(0, 4000) : '' })) };
  return data;
}

export function createGithub({ env = process.env, fetchImpl = fetch } = {}) {
  const budget = Math.max(1, Number(env.GITHUB_MAX_PER_HOUR) || 120);
  const windows = new Map();

  async function call(operation, params, token, workspace) {
    if (!Object.hasOwn(OPERATIONS, operation)) throw new HttpError(400, 'Unsupported GitHub operation.');
    const at = Date.now();
    for (const [key, value] of windows) if (at - value.start > 3_600_000) windows.delete(key);
    const window = windows.get(workspace) ?? { start: at, count: 0 };
    window.count++; windows.set(workspace, window);
    if (window.count > budget) throw new HttpError(429, `GitHub budget reached (${budget} calls an hour). Try again later.`);

    const url = API + OPERATIONS[operation](params ?? {});
    const authorization = token || env.GITHUB_TOKEN || '';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    let response;
    try {
      response = await fetchImpl(url, {
        method: 'GET', redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'HeyBuddyGitHubConnector/0.1', ...(authorization ? { Authorization: `Bearer ${authorization}` } : {}) },
      });
    } catch { throw new HttpError(502, controller.signal.aborted ? 'GitHub took too long to answer.' : 'Could not reach GitHub.'); }
    finally { clearTimeout(timer); }

    if (response.status === 401 || response.status === 403) {
      const remaining = response.headers.get('x-ratelimit-remaining');
      throw new HttpError(response.status, remaining === '0'
        ? 'GitHub rate limit reached. Add a personal access token in Connectors to raise the limit from 60 to 5,000 calls an hour.'
        : 'GitHub refused the request. A private repository needs a token with read access.');
    }
    if (response.status === 404) throw new HttpError(404, 'GitHub found nothing there. Check the owner, repository, path, and whether it is private.');
    if (!response.ok) throw new HttpError(502, `GitHub answered HTTP ${response.status}.`);
    const text = await response.text();
    if (text.length > MAX_RESPONSE) throw new HttpError(502, 'That GitHub response is too large to read.');
    let data; try { data = JSON.parse(text); } catch { throw new HttpError(502, 'GitHub did not return JSON.'); }
    return summarize(operation, data);
  }

  async function handler(req, res) {
    if (new URL(req.url, 'http://github').pathname !== '/api/github') return false;
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
      checkOrigin(req, env);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > 20_000) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
      const token = typeof body?.token === 'string' && body.token.length <= 512 && !/[\r\n]/.test(body.token) ? body.token.trim() : '';
      const workspace = typeof req.headers['x-workspace-id'] === 'string' ? req.headers['x-workspace-id'] : (req.socket.remoteAddress || 'unknown');
      json(200, { result: await call(body?.operation, body?.params, token, workspace) });
      return true;
    } catch (error) { json(error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : 'GitHub request failed.' } }); return true; }
  }
  handler.call = call;
  return handler;
}
