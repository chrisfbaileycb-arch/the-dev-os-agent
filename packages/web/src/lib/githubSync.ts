// GitHub Repository Sync: the browser-side half of pushing and pulling a single workspace file.
//
// The connectors hub already has a write path — `pushProject` in lib/connectors.ts posts to
// /api/github, which drives the Git Data API server-side with the deployment's rate limit and
// origin check. That is the right shape for committing a whole generated project, and it stays
// exactly as it is. What it does not do is pull one file down into the editor, which is the other
// half of "sync": read the current contents, keep its blob SHA, and send an edit back against that
// SHA so a stale push fails instead of clobbering someone else's work.
//
// So this module talks to api.github.com directly, using the Contents API, which is the endpoint
// designed for exactly that round trip:
//   GET  /repos/{owner}/{repo}/contents/{path}?ref={branch}  -> { content (base64), sha }
//   PUT  /repos/{owner}/{repo}/contents/{path}               -> { commit.sha, content.sha }
// Direct means one extra thing has to be true of the deployment: the main page's CSP must allow
// connect-src https://api.github.com (see server/csp.mjs). It does now, and the reason is written
// there alongside the entry.
//
// Everything here is pure logic over injected fetch/input so it can be unit-tested without a
// network or a DOM; the only browser globals used are atob/btoa, wrapped in encodeBase64 /
// decodeBase64 below.

export const GITHUB_API = 'https://api.github.com';
/** The default text of the commit message field in the sync drawer. */
export const DEFAULT_COMMIT_MESSAGE = 'Update from Sovereign Workspace';
const DEFAULT_BRANCH = 'main';

/** What the drawer keeps in workspace state, and what the two handlers need to run. */
export interface GithubSyncState {
  token: string;
  repo: string;
  branch: string;
  path: string;
  message: string;
  /** The blob SHA of the last version this tab pulled or pushed. A push sends it as the parent. */
  sha?: string | null;
}

export const emptySyncState = (): GithubSyncState => ({ token: '', repo: '', branch: DEFAULT_BRANCH, path: '', message: DEFAULT_COMMIT_MESSAGE, sha: null });

/** The saved settings minus the transient bits, ready to persist with the rest of the workspace. */
export type GithubSyncSettings = Omit<GithubSyncState, 'sha'>;

/** A GitHub error is never just a status code; the message says which guard tripped. */
export class GithubApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.name = 'GithubApiError'; this.status = status; }
}

/**
 * The words shown in the drawer's error alert, keyed off the HTTP status.
 *
 * Four statuses earn their own sentence because each one needs a different fix and the raw GitHub
 * message does not always say so: 401 means the token is wrong or expired, 403 covers both a
 * token without `repo` scope and the rate limit, 404 usually means the path or branch does not
 * exist yet rather than that the repository is gone, and 409 means somebody else committed to
 * that file since this tab last looked.
 */
export function githubErrorMessage(status: number, detail = ''): string {
  const suffix = detail ? ` ${detail}` : '';
  if (status === 401) return `Bad credentials — GitHub rejected this token (HTTP 401). It may have expired or been revoked; paste a fresh one with the repo scope.${suffix}`;
  if (status === 403) return `GitHub refused this request (HTTP 403). Either the token is missing the repo scope, the path is protected, or you have hit the rate limit.${suffix}`;
  if (status === 404) return `GitHub has no such file on that branch (HTTP 404). Check the repository, the branch name, and the path — a push will create the file where it is allowed.${suffix}`;
  if (status === 409) return `Conflict (HTTP 409): someone else changed ${'this file'} since you pulled it, so the stored SHA no longer matches HEAD. Pull first to take their version into the editor, then push again.${suffix}`;
  return `GitHub returned HTTP ${status}.${suffix}`;
}

/** A pasted URL, an "owner/repo", or "owner repo" all mean the same thing to a person typing fast. */
export function normalizeRepo(value: string): string {
  const cleaned = value.trim()
    .replace(/^https?:\/\/(?:www\.)?github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/\s+/g, '/')
    .replace(/\/{2,}/g, '/')
    .replace(/^\/|\/$/g, '');
  return cleaned;
}

/** owner/name with neither side empty, or null. Shared by the drawer's inline hint and the guards. */
export function parseRepoTarget(repo: string): { owner: string; name: string } | null {
  const [owner, name, ...rest] = normalizeRepo(repo).split('/');
  if (!owner || !name || rest.length) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(owner) || !/^[A-Za-z0-9._-]+$/.test(name)) return null;
  return { owner, name };
}

/** A relative file path with no traversal and no leading slash, as the Contents API wants it. */
export function normalizeFilePath(path: string): string {
  return path.trim().replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/{2,}/g, '/');
}

/**
 * The same guard as `parseRepoTarget`, under the name the connector hub already uses.
 *
 * `lib/connectors.ts` exports a `parseRepo` for its own read tools; the sync drawer and anything
 * bridging the two surfaces need one shared answer for "is this owner/name valid", so this is an
 * alias rather than a second implementation that could drift.
 */
export const parseRepo = (value: string): { owner: string; repo: string } | null => {
  const target = parseRepoTarget(value);
  return target ? { owner: target.owner, repo: target.name } : null;
};

/** Each path segment encoded separately, so `src/a b.tsx` reaches the API as `src/a%20b.tsx`. */
export function encodePathSegments(path: string): string {
  return normalizeFilePath(path).split('/').map(encodeURIComponent).join('/');
}

/** base64 of UTF-8 text. TextEncoder first, because btoa is latin-1 only and throws on an emoji. */
export function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** base64 (possibly chunked with newlines, as GitHub returns it) back into UTF-8 text. */
export function decodeBase64(b64: string): string {
  const binary = atob(b64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

export interface GithubRequestInput { method?: string; path: string; token: string; body?: unknown; signal?: AbortSignal; }
export type GithubFetch = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<{ status: number; ok: boolean; json(): Promise<unknown> }>;

/** One call to api.github.com. Anything other than a 2xx becomes a GithubApiError with our words. */
export async function githubRequest<T>(input: GithubRequestInput, fetchImpl: GithubFetch = fetch): Promise<T> {
  const method = input.method ?? 'GET';
  const response = await fetchImpl(`${GITHUB_API}${input.path}`, {
    method,
    headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
    ...(input.body === undefined ? {} : { body: JSON.stringify(input.body) }),
    ...(input.signal ? { signal: input.signal } : {}),
  });
  const data = await response.json().catch(() => ({}) as unknown) as T & { message?: string };
  if (!response.ok) throw new GithubApiError(response.status, githubErrorMessage(response.status, typeof data?.message === 'string' ? data.message : ''));
  return data;
}

/** The fields of a Contents-API response this app cares about. */
// A GET returns `content` as base64 text; a PUT returns it as the new blob's metadata object.
interface ContentsResponse { content?: string | { sha?: string; path?: string }; encoding?: string; sha?: string; path?: string; message?: string; commit?: { sha?: string; html_url?: string }; }

export interface PullResult { content: string; sha: string; path: string; size: number; }

/**
 * Read one file out of a branch and decode it for the editor buffer.
 *
 * The blob SHA comes back with it and is kept in state, because that SHA is what makes the next
 * push honest: GitHub rejects a PUT whose `sha` is not the file's current blob, which is how a
 * push that would overwrite someone else's commit turns into a 409 instead of a silent loss.
 */
export async function pullFile(state: Pick<GithubSyncState, 'token' | 'repo' | 'branch' | 'path'>, fetchImpl: GithubFetch = fetch, signal?: AbortSignal): Promise<PullResult> {
  const target = parseRepoTarget(state.repo);
  if (!target) throw new Error('Name the repository as owner/repo-name, for example octocat/hello-world.');
  const path = normalizeFilePath(state.path);
  if (!path) throw new Error('Give the file path to pull, for example src/components/Component.tsx.');
  if (!state.token.trim()) throw new Error('Add a GitHub personal access token with the repo scope before pulling.');
  const branch = (state.branch || DEFAULT_BRANCH).trim();
  const data = await githubRequest<ContentsResponse>({ method: 'GET', path: `/repos/${target.owner}/${target.name}/contents/${encodePathSegments(path)}?ref=${encodeURIComponent(branch)}`, token: state.token, signal }, fetchImpl);
  // A directory comes back as a listing with no content, which is not something an editor holds.
  if (typeof data.content !== 'string') throw new Error(`${path} is not a file GitHub can hand back as text — point the path at a single file.`);
  return { content: decodeBase64(data.content), sha: data.sha ?? '', path: data.path ?? path, size: data.content.length };
}

export interface PushResult { commitSha: string; commitUrl: string; sha: string; path: string; branch: string; }

/**
 * Commit the editor buffer to one file on one branch.
 *
 * The body is exactly the Contents API contract: the base64 content, the branch to land on, the
 * commit message, and the SHA of the version this edit started from. Omitting `sha` when nothing
 * was pulled first is deliberate — GitHub then treats it as a create, and answers with a 409 if
 * the file already exists, which is still the safe failure.
 */
export async function pushFile(state: GithubSyncState, content: string, fetchImpl: GithubFetch = fetch, signal?: AbortSignal): Promise<PushResult> {
  const target = parseRepoTarget(state.repo);
  if (!target) throw new Error('Name the repository as owner/repo-name, for example octocat/hello-world.');
  const path = normalizeFilePath(state.path);
  if (!path) throw new Error('Give the file path to write, for example src/components/Component.tsx.');
  if (!state.token.trim()) throw new Error('Add a GitHub personal access token with the repo scope before pushing. A fine without write access answers 403.');
  const branch = (state.branch || DEFAULT_BRANCH).trim();
  const body = {
    message: state.message.trim() || DEFAULT_COMMIT_MESSAGE,
    content: encodeBase64(content),
    branch,
    ...(state.sha ? { sha: state.sha } : {}),
  };
  const data = await githubRequest<ContentsResponse>({ method: 'PUT', path: `/repos/${target.owner}/${target.name}/contents/${encodePathSegments(path)}`, token: state.token, body, signal }, fetchImpl);
  const commitSha = data.commit?.sha ?? '';
  return { commitSha, commitUrl: data.commit?.html_url ?? `${GITHUB_API.replace('api.', '')}/${target.owner}/${target.name}/commit/${commitSha}`, sha: (typeof data.content === 'object' ? data.content?.sha : undefined) ?? state.sha ?? '', path: (typeof data.content === 'object' ? data.content?.path : undefined) ?? data.path ?? path, branch };
}

/** Is this state enough to try a request at all? The pill's badge and the buttons share the answer. */
export function syncReady(state: Pick<GithubSyncState, 'token' | 'repo' | 'path'>): boolean {
  return Boolean(state.token.trim() && parseRepoTarget(state.repo) && normalizeFilePath(state.path));
}

const SETTINGS_KEY = 'hb-github-sync';

export function loadSyncSettings(): GithubSyncSettings {
  const base = { ...emptySyncState(), sha: undefined };
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') as Partial<GithubSyncSettings>;
    return {
      token: typeof stored.token === 'string' ? stored.token : '',
      repo: typeof stored.repo === 'string' ? stored.repo : '',
      branch: typeof stored.branch === 'string' && stored.branch.trim() ? stored.branch : DEFAULT_BRANCH,
      path: typeof stored.path === 'string' ? stored.path : '',
      message: typeof stored.message === 'string' && stored.message.trim() ? stored.message : DEFAULT_COMMIT_MESSAGE,
    };
  } catch { return base; }
}

/**
 * Save the sync settings. The token goes to localStorage with everything else on this device.
 *
 * That is the same trade the provider keyring already makes, and it is the only way this feature
 * works at all: the app ships a zero-backend static build too, and a token held in memory alone
 * would mean re-pasting it on every reload. It is also why the field is masked, why the drawer
 * says plainly that the token is stored in this browser, and why "Forget" sits next to Save.
 */
export function saveSyncSettings(settings: GithubSyncSettings): void {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch { /* storage unavailable; the settings hold for this session */ }
}

export function clearSyncSettings(): void { try { localStorage.removeItem(SETTINGS_KEY); } catch { /* storage unavailable */ } }
