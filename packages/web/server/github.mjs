import { HttpError } from './proxy.mjs';
import { checkOrigin } from './state.mjs';

// /api/github: the GitHub connector. Reads repositories, audits issues, and — the one exception —
// pushes a generated project to a repository the visitor already owns or can write to.
//
// The read path is exactly as read-only as before: `call()` still only ever builds a URL from the
// closed OPERATIONS map and issues a GET, and no change here touches it. Pushing is deliberately a
// separate path (`push()`), reached only through `operation: 'push'`, for one reason worth being
// explicit about: it is the single place in this server where a browser's request can change
// something on GitHub, so it gets its own function, its own validation, and its own token rule —
// the visitor's own token, always. A push with no token is refused outright; the server's own
// GITHUB_TOKEN (used to raise the read path's rate limit) is never substituted in, because that
// token, if set at all, belongs to the operator, not to whoever is chatting with this deployment.
//
// A token is optional for reads. Without one, GitHub allows 60 requests an hour per IP and public
// repos only; with one, 5,000 an hour and whatever that token can see. The browser's token is used
// for that request alone and is never written to disk.

const API = 'https://api.github.com';
const TIMEOUT = 20_000;
const MAX_RESPONSE = 4_000_000;
const MAX_FILE_BYTES = 200_000;
const MAX_PUSH_FILES = 60;
const MAX_PUSH_BYTES = 2_000_000;
const PUSH_CONCURRENCY = 6;

const SEGMENT = /^[A-Za-z0-9._-]{1,100}$/;
const PATH = /^[A-Za-z0-9._\-/ ]{1,300}$/;
const BRANCH = /^[A-Za-z0-9._\-/]{1,200}$/;

const owner = v => { if (!SEGMENT.test(String(v ?? ''))) throw new HttpError(400, 'Enter a repository as owner/name.'); return String(v); };
const repoPath = v => { const value = String(v ?? ''); if (!PATH.test(value) || value.includes('..')) throw new HttpError(400, 'Enter a plain path inside the repository.'); return value.replace(/^\/+/, ''); };
const count = (v, fallback, max) => { const n = Number(v); return Number.isInteger(n) && n > 0 && n <= max ? n : fallback; };
const issueNumber = v => { const n = Number(v); if (!Number.isInteger(n) || n < 1 || n > 1_000_000) throw new HttpError(400, 'Enter an issue number.'); return n; };
const branchName = v => { const value = String(v ?? ''); if (!BRANCH.test(value) || value.includes('..') || value.startsWith('/') || value.endsWith('/')) throw new HttpError(400, 'Enter a plain branch name.'); return value; };
/** A push's own file-path rule: relative, no traversal, no leading slash — stricter than `repoPath`, which still allows `ref`-query use elsewhere. */
const PUSH_PATH = /^[A-Za-z0-9._][A-Za-z0-9._\-/]{0,299}$/;
const pushPath = v => { const value = String(v ?? ''); if (!PUSH_PATH.test(value) || value.split('/').includes('..')) throw new HttpError(400, `"${value}" is not a safe file path.`); return value; };

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
  const pushBudget = Math.max(1, Number(env.GITHUB_PUSH_MAX_PER_HOUR) || 20);
  const windows = new Map();
  const pushWindows = new Map();
  const spend = (map, budgetFor, workspace, what) => {
    const at = Date.now();
    for (const [key, value] of map) if (at - value.start > 3_600_000) map.delete(key);
    const window = map.get(workspace) ?? { start: at, count: 0 };
    window.count++; map.set(workspace, window);
    if (window.count > budgetFor) throw new HttpError(429, `${what} budget reached (${budgetFor} an hour). Try again later.`);
  };

  async function call(operation, params, token, workspace) {
    if (!Object.hasOwn(OPERATIONS, operation)) throw new HttpError(400, 'Unsupported GitHub operation.');
    spend(windows, budget, workspace, 'GitHub');

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

  /** One authenticated api.github.com call for the push flow — GET, POST, or PATCH, always with a token. */
  async function raw(method, path, token, body) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT);
    let response;
    try {
      response = await fetchImpl(API + path, {
        method, redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'HeyBuddyGitHubConnector/0.1', Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch { throw new HttpError(502, controller.signal.aborted ? 'GitHub took too long to answer.' : 'Could not reach GitHub.'); }
    finally { clearTimeout(timer); }
    const text = await response.text();
    if (text.length > MAX_RESPONSE) throw new HttpError(502, 'That GitHub response is too large to read.');
    let data = {}; if (text) { try { data = JSON.parse(text); } catch { throw new HttpError(502, 'GitHub did not return JSON.'); } }
    if (!response.ok) {
      if (response.status === 401) throw new HttpError(401, 'GitHub rejected that token.');
      if (response.status === 403) throw new HttpError(403, 'GitHub refused the request — the token needs write access (Contents: write) to this repository.');
      if (response.status === 404) throw new HttpError(404, 'GitHub found nothing there. Check the owner, repository, and branch.');
      if (response.status === 409) throw new HttpError(409, 'The branch moved while pushing. Try again.');
      if (response.status === 422) throw new HttpError(422, data.message || 'GitHub rejected the request as malformed.');
      throw new HttpError(502, `GitHub answered HTTP ${response.status}.`);
    }
    return data;
  }

  /**
   * Push a whole project as one commit, using the Git Data API rather than one Contents-API call
   * per file: a blob per file, one tree built on top of the branch's current tree, one commit, one
   * ref update. A visitor generating a five-file app gets one commit in their history, not five.
   */
  async function push(params, token, workspace) {
    if (!token) throw new HttpError(400, 'A GitHub token with write access is required to push. Add one in Connectors → GitHub.');
    spend(pushWindows, pushBudget, workspace, 'GitHub push');
    const repoOwner = owner(params?.owner); const repoName = owner(params?.repo);
    const message = String(params?.message ?? '').trim().slice(0, 500) || 'Add generated app from Hey Buddy';
    const files = Array.isArray(params?.files) ? params.files : [];
    if (!files.length) throw new HttpError(400, 'Nothing to push — the project has no files.');
    if (files.length > MAX_PUSH_FILES) throw new HttpError(400, `A push is limited to ${MAX_PUSH_FILES} files.`);
    let totalBytes = 0;
    const clean = files.map(f => {
      const path = pushPath(f?.path);
      const content = String(f?.content ?? '');
      const bytes = Buffer.byteLength(content, 'utf8');
      if (bytes > MAX_FILE_BYTES) throw new HttpError(413, `${path} is larger than this connector will push (200 KB).`);
      totalBytes += bytes;
      return { path, content };
    });
    if (totalBytes > MAX_PUSH_BYTES) throw new HttpError(413, 'That project is larger than this connector will push (2 MB total).');

    const repo = await raw('GET', `/repos/${repoOwner}/${repoName}`, token);
    const branch = params?.branch ? branchName(params.branch) : repo.default_branch;
    const createBranch = Boolean(params?.createBranch);

    let baseSha;
    if (createBranch) {
      const base = await raw('GET', `/repos/${repoOwner}/${repoName}/git/ref/heads/${encodeURIComponent(repo.default_branch)}`, token);
      baseSha = base.object.sha;
    } else {
      const ref = await raw('GET', `/repos/${repoOwner}/${repoName}/git/ref/heads/${encodeURIComponent(branch)}`, token);
      baseSha = ref.object.sha;
    }
    const baseCommit = await raw('GET', `/repos/${repoOwner}/${repoName}/git/commits/${baseSha}`, token);

    const blobs = new Array(clean.length);
    let cursor = 0;
    async function worker() {
      while (cursor < clean.length) {
        const i = cursor++; const f = clean[i];
        const blob = await raw('POST', `/repos/${repoOwner}/${repoName}/git/blobs`, token, { content: Buffer.from(f.content, 'utf8').toString('base64'), encoding: 'base64' });
        blobs[i] = { path: f.path, mode: '100644', type: 'blob', sha: blob.sha };
      }
    }
    await Promise.all(Array.from({ length: Math.min(PUSH_CONCURRENCY, clean.length) }, worker));

    const tree = await raw('POST', `/repos/${repoOwner}/${repoName}/git/trees`, token, { base_tree: baseCommit.tree.sha, tree: blobs });
    const commit = await raw('POST', `/repos/${repoOwner}/${repoName}/git/commits`, token, { message, tree: tree.sha, parents: [baseSha] });
    if (createBranch) await raw('POST', `/repos/${repoOwner}/${repoName}/git/refs`, token, { ref: `refs/heads/${branch}`, sha: commit.sha });
    else await raw('PATCH', `/repos/${repoOwner}/${repoName}/git/refs/heads/${encodeURIComponent(branch)}`, token, { sha: commit.sha, force: false });

    return { commitSha: commit.sha, branch, url: `https://github.com/${repoOwner}/${repoName}/commit/${commit.sha}`, filesPushed: clean.length };
  }

  async function handler(req, res) {
    if (new URL(req.url, 'http://github').pathname !== '/api/github') return false;
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
    try {
      if (req.method !== 'POST') throw new HttpError(405, 'Use POST.');
      checkOrigin(req, env);
      if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(415, 'Use application/json.');
      // A push carries a whole project's file contents, a read carries a few short params; one
      // cap sized for the larger case bounds both, since the per-file and per-project byte checks
      // in `push()` are the ones that actually matter for that path.
      let size = 0; const chunks = [];
      for await (const chunk of req) { size += chunk.length; if (size > MAX_PUSH_BYTES + 100_000) throw new HttpError(413, 'Request is too large.'); chunks.push(chunk); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { throw new HttpError(400, 'Invalid JSON body.'); }
      const token = typeof body?.token === 'string' && body.token.length <= 512 && !/[\r\n]/.test(body.token) ? body.token.trim() : '';
      const workspace = typeof req.headers['x-workspace-id'] === 'string' ? req.headers['x-workspace-id'] : (req.socket.remoteAddress || 'unknown');
      const result = body?.operation === 'push' ? await push(body?.params, token, workspace) : await call(body?.operation, body?.params, token, workspace);
      json(200, { result });
      return true;
    } catch (error) { json(error instanceof HttpError ? error.status : 500, { error: { message: error instanceof HttpError ? error.message : 'GitHub request failed.' } }); return true; }
  }
  handler.call = call;
  handler.push = push;
  return handler;
}
