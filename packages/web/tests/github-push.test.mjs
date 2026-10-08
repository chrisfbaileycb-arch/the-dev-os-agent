import test from 'node:test';
import assert from 'node:assert/strict';
import { createGithub } from '../server/github.mjs';

/** A fake api.github.com that answers the exact Git Data API sequence `push()` drives. */
function fakeFetch({ fail } = {}) {
  const calls = [];
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  return {
    calls,
    fetchImpl: async (url, init) => {
      const path = url.replace('https://api.github.com', '');
      const method = init?.method ?? 'GET';
      calls.push(`${method} ${path}`);
      if (fail && fail.on === path) return json(fail.status, { message: fail.message ?? 'nope' });
      if (path === '/repos/acme/widgets') return json(200, { default_branch: 'main' });
      // main is the default branch and always exists, whether it's the push target or the source
      // ref a new branch gets created from.
      if (path === '/repos/acme/widgets/git/ref/heads/main') return json(200, { object: { sha: 'base-sha' } });
      if (path === '/repos/acme/widgets/git/commits/base-sha') return json(200, { tree: { sha: 'base-tree-sha' } });
      if (path === '/repos/acme/widgets/git/blobs') { const body = JSON.parse(init.body); return json(201, { sha: `blob-${Buffer.from(body.content, 'base64').toString('utf8').length}` }); }
      if (path === '/repos/acme/widgets/git/trees') return json(201, { sha: 'new-tree-sha' });
      if (path === '/repos/acme/widgets/git/commits' && method === 'POST') return json(201, { sha: 'new-commit-sha' });
      if (path === '/repos/acme/widgets/git/refs/heads/main' && method === 'PATCH') return json(200, {});
      if (path === '/repos/acme/widgets/git/refs' && method === 'POST') return json(201, {});
      return json(404, { message: `unhandled: ${method} ${path}` });
    },
  };
}

test('push requires a token', async () => {
  const github = createGithub({ env: {}, fetchImpl: async () => { throw new Error('should not fetch'); } });
  await assert.rejects(github.push({ owner: 'acme', repo: 'widgets', files: [{ path: 'a.txt', content: 'hi' }] }, '', 'ws'), /token with write access/);
});

test('push commits to the repo\'s default branch when none is given', async () => {
  const fake = fakeFetch();
  const github = createGithub({ env: {}, fetchImpl: fake.fetchImpl });
  const result = await github.push({ owner: 'acme', repo: 'widgets', message: 'Add app', files: [{ path: 'src/App.tsx', content: 'export default function App(){}' }] }, 'tok', 'ws');
  assert.equal(result.commitSha, 'new-commit-sha');
  assert.equal(result.branch, 'main');
  assert.equal(result.url, 'https://github.com/acme/widgets/commit/new-commit-sha');
  assert.equal(result.filesPushed, 1);
  assert.ok(fake.calls.includes('GET /repos/acme/widgets'));
  assert.ok(fake.calls.includes('POST /repos/acme/widgets/git/blobs'));
  assert.ok(fake.calls.includes('PATCH /repos/acme/widgets/git/refs/heads/main'));
});

test('push creates a branch from the default branch when asked to', async () => {
  const fake = fakeFetch();
  const github = createGithub({ env: {}, fetchImpl: fake.fetchImpl });
  const result = await github.push({ owner: 'acme', repo: 'widgets', branch: 'feature-x', createBranch: true, files: [{ path: 'a.txt', content: 'hi' }] }, 'tok', 'ws');
  assert.equal(result.branch, 'feature-x');
  assert.ok(fake.calls.includes('POST /repos/acme/widgets/git/refs'));
  assert.ok(!fake.calls.some(c => c.startsWith('PATCH')));
});

test('push rejects a file path that escapes the project', async () => {
  const fake = fakeFetch();
  const github = createGithub({ env: {}, fetchImpl: fake.fetchImpl });
  await assert.rejects(
    github.push({ owner: 'acme', repo: 'widgets', files: [{ path: '../../etc/passwd', content: 'x' }] }, 'tok', 'ws'),
    /not a safe file path/,
  );
});

test('push rejects an empty file list', async () => {
  const fake = fakeFetch();
  const github = createGithub({ env: {}, fetchImpl: fake.fetchImpl });
  await assert.rejects(github.push({ owner: 'acme', repo: 'widgets', files: [] }, 'tok', 'ws'), /no files/);
});

test('push surfaces a 403 as a clear write-access message', async () => {
  const fake = fakeFetch({ fail: { on: '/repos/acme/widgets', status: 403 } });
  const github = createGithub({ env: {}, fetchImpl: fake.fetchImpl });
  await assert.rejects(github.push({ owner: 'acme', repo: 'widgets', files: [{ path: 'a.txt', content: 'hi' }] }, 'tok', 'ws'), /write access/);
});

test('push is rate-limited independently of the read budget', async () => {
  const fake = fakeFetch();
  const github = createGithub({ env: { GITHUB_PUSH_MAX_PER_HOUR: '1' }, fetchImpl: fake.fetchImpl });
  await github.push({ owner: 'acme', repo: 'widgets', files: [{ path: 'a.txt', content: 'hi' }] }, 'tok', 'ws-1');
  await assert.rejects(github.push({ owner: 'acme', repo: 'widgets', files: [{ path: 'b.txt', content: 'hi' }] }, 'tok', 'ws-1'), /budget reached/);
  // A different workspace is unaffected by the first one's budget.
  await github.push({ owner: 'acme', repo: 'widgets', files: [{ path: 'c.txt', content: 'hi' }] }, 'tok', 'ws-2');
});

test('the existing read path is unaffected by the push addition', async () => {
  const fake = fakeFetch();
  const github = createGithub({ env: {}, fetchImpl: fake.fetchImpl });
  const result = await github.call('repo', { owner: 'acme', repo: 'widgets' }, 'tok', 'ws');
  assert.equal(result.defaultBranch, 'main');
});

test('push into an empty repository becomes its first commit', async () => {
  const calls = []; const bodies = {};
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const github = createGithub({ env: {}, fetchImpl: async (url, init) => {
    const path = url.replace('https://api.github.com', ''); const method = init?.method ?? 'GET';
    calls.push(`${method} ${path}`); if (init?.body) bodies[`${method} ${path}`] = JSON.parse(init.body);
    if (path === '/repos/acme/fresh') return json(200, { default_branch: 'main' });
    if (path === '/repos/acme/fresh/git/ref/heads/main') return json(409, { message: 'Git Repository is empty.' });
    if (path === '/repos/acme/fresh/git/blobs') return json(201, { sha: 'blob' });
    if (path === '/repos/acme/fresh/git/trees') return json(201, { sha: 'tree' });
    if (path === '/repos/acme/fresh/git/commits') return json(201, { sha: 'first' });
    if (path === '/repos/acme/fresh/git/refs' && method === 'POST') return json(201, {});
    return json(404, { message: `unhandled: ${method} ${path}` });
  } });
  const result = await github.push({ owner: 'acme', repo: 'fresh', branch: 'main', files: [{ path: 'index.html', content: '<p>hi</p>' }] }, 'tok', 'ws');
  assert.equal(result.createdRepoHistory, true);
  assert.equal(bodies['POST /repos/acme/fresh/git/trees'].base_tree, undefined);
  assert.deepEqual(bodies['POST /repos/acme/fresh/git/commits'].parents, []);
  assert.equal(bodies['POST /repos/acme/fresh/git/refs'].ref, 'refs/heads/main');
  assert.ok(!calls.some(c => c.startsWith('PATCH')));
});

test('listing repositories needs the visitor’s own token, never the deployment’s', async () => {
  const github = createGithub({ env: { GITHUB_TOKEN: 'operator-token' }, fetchImpl: async () => { throw new Error('should not fetch'); } });
  await assert.rejects(github.repos('', 'ws'), /Add a GitHub token/);
});

test('pullRepo fetches project files from tree and decodes text', async () => {
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const github = createGithub({ env: {}, fetchImpl: async (url, init) => {
    const path = url.replace('https://api.github.com', '');
    if (path === '/repos/acme/project') return json(200, { default_branch: 'main' });
    if (path === '/repos/acme/project/git/trees/main?recursive=1') {
      return json(200, {
        truncated: false,
        tree: [
          { path: 'index.html', type: 'blob', size: 25 },
          { path: 'src/App.tsx', type: 'blob', size: 35 },
          { path: 'logo.png', type: 'blob', size: 5000 },
        ],
      });
    }
    if (path === '/repos/acme/project/contents/index.html?ref=main') {
      return json(200, { path: 'index.html', size: 25, encoding: 'base64', content: Buffer.from('<!DOCTYPE html>').toString('base64') });
    }
    if (path === '/repos/acme/project/contents/src/App.tsx?ref=main') {
      return json(200, { path: 'src/App.tsx', size: 35, encoding: 'base64', content: Buffer.from('export default function App(){}').toString('base64') });
    }
    return json(404, { message: `unhandled: ${path}` });
  } });

  const result = await github.pullRepo({ owner: 'acme', repo: 'project' }, 'tok', 'ws');
  assert.equal(result.owner, 'acme');
  assert.equal(result.repo, 'project');
  assert.equal(result.branch, 'main');
  assert.equal(result.files.length, 2);
  assert.equal(result.files[0].path, 'index.html');
  assert.equal(result.files[0].content, '<!DOCTYPE html>');
  assert.equal(result.files[1].path, 'src/App.tsx');
  assert.equal(result.files[1].content, 'export default function App(){}');
});

test('handler extracts token from X-GitHub-Token and Authorization headers', async () => {
  let seenToken = '';
  const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
  const github = createGithub({ env: { APP_ORIGIN: 'http://localhost:5173' }, fetchImpl: async (url, init) => {
    seenToken = init?.headers?.Authorization?.replace('Bearer ', '') ?? '';
    return json(200, [{ full_name: 'acme/repo', default_branch: 'main', permissions: { push: true } }]);
  } });

  // Test X-GitHub-Token header
  let resData = null;
  let resStatus = 0;
  const mockRes = {
    writeHead: (s) => { resStatus = s; },
    end: (d) => { resData = JSON.parse(d); },
  };

  const req1 = (async function* () {
    yield Buffer.from(JSON.stringify({ operation: 'repos' }));
  })();
  req1.url = '/api/github';
  req1.method = 'POST';
  req1.headers = {
    'content-type': 'application/json',
    'origin': 'http://localhost:5173',
    'x-github-token': 'header-pat-123',
  };
  req1.socket = { remoteAddress: '127.0.0.1' };

  await github(req1, mockRes);
  assert.equal(resStatus, 200);
  assert.equal(seenToken, 'header-pat-123');

  // Test Authorization: Bearer header
  const req2 = (async function* () {
    yield Buffer.from(JSON.stringify({ operation: 'repos' }));
  })();
  req2.url = '/api/github';
  req2.method = 'POST';
  req2.headers = {
    'content-type': 'application/json',
    'origin': 'http://localhost:5173',
    'authorization': 'Bearer bearer-pat-456',
  };
  req2.socket = { remoteAddress: '127.0.0.1' };

  await github(req2, mockRes);
  assert.equal(resStatus, 200);
  assert.equal(seenToken, 'bearer-pat-456');
});

