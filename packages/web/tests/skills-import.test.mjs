import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { openDatabase } from '../server/db.mjs';
import { openSettings } from '../server/settings.mjs';
import { createAdmin } from '../server/admin.mjs';
import { importRepositorySkills, parseRepository, BUILTIN_SKILLS } from '../server/skills.mjs';
const commit = 'a'.repeat(40);
const main = '---\nname: Release engineer\ndescription: Release a verified build\n---\n\n' + 'Complete release step\n'.repeat(1000) + 'FINAL CHECK';
const resource = 'print("supporting script retained, never run")\n';
function github({ truncated = false } = {}) {
  return async url => {
    const path = new URL(url).pathname;
    let data;
    if (path.endsWith('/fixture/repo/')) data = { default_branch: 'main', license: { spdx_id: 'MIT' } };
    else if (path.includes('/commits/')) data = { sha: commit, commit: { tree: { sha: 'b'.repeat(40) } } };
    else if (path.includes('/git/trees/')) data = { truncated, tree: [{ path: 'skills/release/SKILL.md', type: 'blob', mode: '100644', sha: 'main', size: main.length }, { path: 'skills/release/scripts/check.py', type: 'blob', mode: '100644', sha: 'script', size: resource.length }] };
    else if (path.endsWith('/git/blobs/main')) data = { encoding: 'base64', content: Buffer.from(main).toString('base64') };
    else if (path.endsWith('/git/blobs/script')) data = { encoding: 'base64', content: Buffer.from(resource).toString('base64') };
    else throw new Error(`Unexpected request ${url}`);
    return new Response(JSON.stringify(data));
  };
}
async function withServer(handler, fn) {
  const server = createServer((req, res) => { void handler(req, res); });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  try { await fn(`http://127.0.0.1:${server.address().port}`); } finally { await new Promise(r => server.close(r)); }
}
test('the full catalog has byte-consistent source hashes and engineering coverage', () => {
  assert.equal(BUILTIN_SKILLS.length, 65);
  for (const skill of BUILTIN_SKILLS) assert.equal(createHash('sha256').update(skill.markdown).digest('hex'), skill.provenance.sha256);
  for (const name of ['Frontend Developer', 'Backend Architect', 'Multi-Agent Systems Architect', 'Prompt Engineer', 'Privacy Engineer']) assert.ok(BUILTIN_SKILLS.some(s => s.name === name), name);
});
test('repository ingestion preserves complete markdown, support resources and a pinned commit', async () => {
  const result = await importRepositorySkills({ url: 'https://github.com/fixture/repo.git', directory: 'skills' }, github());
  assert.equal(result.skills.length, 1);
  assert.equal(result.skills[0].markdown, main);
  assert.equal(result.skills[0].resources['scripts/check.py'], resource);
  assert.equal(result.skills[0].provenance.commit, commit);
  assert.equal(result.skills[0].kind, 'instructions');
  assert.deepEqual(result.skills[0].fields, []);
  assert.equal(result.skills[0].url, '');
  // The source repository is tagged so the browser can build an "Imported: <repo>" category.
  assert.equal(result.skills[0].repository, 'fixture/repo');
});
test('incomplete trees and non-GitHub sources fail without partial indexing', async () => {
  await assert.rejects(() => importRepositorySkills({ url: 'https://github.com/fixture/repo' }, github({ truncated: true })), /incomplete tree/);
  for (const url of ['http://github.com/a/b', 'https://github.com.evil.test/a/b', 'https://user:secret@github.com/a/b', 'https://github.com/a/b/tree/main']) assert.throws(() => parseRepository(url));
});
test('only an authenticated admin can publish skills and change persistent system defaults', async () => {
  const db = openDatabase(':memory:');
  const env = { ADMIN_TOKEN: 'owner-password-for-fixtures', SESSION_SECRET: 'test-session-secret-32-characters-long' };
  const settings = await openSettings({ db, env });
  let fetched = 0;
  await withServer(createAdmin({ db, env, settings, storage: { durable: true }, fetchImpl: async url => { fetched++; return github()(url); }, log: () => {} }), async origin => {
    const call = (path, data, cookie = '') => fetch(origin + path, { method: 'POST', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
    assert.equal((await call('/api/admin/skills/import', { url: 'https://github.com/fixture/repo' })).status, 401);
    assert.equal(fetched, 0);
    const login = await call('/api/admin/login', { token: env.ADMIN_TOKEN });
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const imported = await call('/api/admin/skills/import', { url: 'https://github.com/fixture/repo', token: 'fixture-token' }, cookie);
    assert.equal(imported.status, 200);
    assert.ok(!(await imported.text()).includes('fixture-token'));
    const write = await fetch(origin + '/api/admin/system-prompts', { method: 'PUT', headers: { Origin: origin, Cookie: cookie, 'Content-Type': 'application/json' }, body: JSON.stringify({ general: 'Protected system prompt', build: 'Full build instructions' }) });
    assert.equal(write.status, 200);
    const denied = await fetch(origin + '/api/admin/skills', { method: 'DELETE', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ id: settings.skillCatalog()[0].id }) });
    assert.equal(denied.status, 401);
  });
  const reopened = await openSettings({ db, env });
  assert.equal(reopened.skillCatalog()[0].markdown, main);
  assert.equal(reopened.systemPrompts().general, 'Protected system prompt');
  db.close();
});
