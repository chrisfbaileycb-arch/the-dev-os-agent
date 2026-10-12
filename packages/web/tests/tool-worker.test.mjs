import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
const files = await readdir(new URL('../dist/assets/', import.meta.url));
const name = files.find(file => /^tool\.worker-.*\.js$/.test(file));
const compiled = name ? new URL(`../dist/assets/${name}`, import.meta.url).href : null;
const id = '11111111-1111-4111-8111-111111111111'; const nonce = '22222222-2222-4222-8222-222222222222';
const base = { channel: 'signal-forge-tool-runtime-v1', version: 1, type: 'execute', id, nonce, workspaceId: id, approved: true, args: {} };
/** Run the actual Vite-built worker in a separate thread with the Web Worker messaging interface. */
async function invoke(target, args = {}) {
  assert.ok(compiled, 'Build the app before testing the compiled tool worker.');
  const worker = new Worker(`
    const { parentPort } = require('node:worker_threads');
    globalThis.self = { postMessage: message => parentPort.postMessage(message), close: () => process.exit(0) };
    const buffered = [];
    parentPort.on('message', data => self.onmessage ? self.onmessage({ data }) : buffered.push(data));
    globalThis.fetch = async (path, init) => {
      if (path !== '/api/fetch') throw new Error('Unexpected network destination');
      if (init.headers['X-Workspace-Id'] !== '${id}') throw new Error('Missing signed workspace identity');
      return new Response(JSON.stringify({ url: 'https://example.com', status: 200, contentType: 'text/html', title: 'Worker page', description: '', headings: [], wordCount: 3, text: 'Complete page output', truncated: false, links: [] }));
    };
    import(${JSON.stringify(compiled)}).then(() => buffered.forEach(data => self.onmessage({ data }))).catch(error => { throw error; });
  `, { eval: true });
  const events = [];
  try {
    const done = new Promise((resolve, reject) => {
      worker.on('message', message => { events.push(message); if (message.type === 'result' || message.type === 'error') resolve(message); });
      worker.on('error', reject); worker.on('exit', code => { if (code !== 0) reject(new Error(`Worker exited ${code}`)); });
    });
    worker.postMessage({ ...base, target: { kind: 'eval', code: 'invalid' } });
    worker.postMessage({ ...base, target, args });
    worker.postMessage({ ...base, id: '33333333-3333-4333-8333-333333333333', target, args });
    const result = await Promise.race([done, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Compiled worker did not answer.')), 10_000); timer.unref(); })]);
    return { result, events };
  } finally { await worker.terminate(); }
}
test('compiled worker runs a local skill resource without DOM/storage access and accepts exactly one approved request', async () => {
  const content = 'Complete skill resource\n'.repeat(3000);
  const { result, events } = await invoke({ kind: 'resource', skill: 'skill1', path: 'guide.md', name: 'Engineering', content }, { skill: 'skill1', path: 'guide.md' });
  assert.equal(result.type, 'result'); assert.equal(result.result.output, content);
  assert.equal(events.length, 2); assert.equal(events[0].type, 'started'); assert.equal(result.nonce, nonce); assert.ok(result.durationMs >= 0);
});
test('compiled worker forwards the explicitly supplied workspace identity to the built-in tool proxy', async () => {
  const { result } = await invoke({ kind: 'fetch' }, { url: 'https://example.com' });
  assert.equal(result.type, 'result'); assert.match(result.result.output, /Complete page output/); assert.match(result.result.summary, /Worker page/);
});
test('compiled worker traps unavailable adapter actions and reports a structured error', async () => {
  const { result } = await invoke({ kind: 'mcp', tool: 'request', connection: { id, name: 'Custom', url: 'https://example.com', enabled: true, transport: 'rest', method: 'GET', token: '', tools: [{ name: 'request', description: 'Request' }] } }, {});
  assert.equal(result.type, 'error'); assert.match(result.message, /Unexpected network destination/); assert.ok(result.durationMs >= 0);
});
