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
