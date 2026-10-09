import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyStorage } from '../server/durability.mjs';

test('only Postgres or a SQLite file outside the temp directories is a server ledger', () => {
  assert.deepEqual(classifyStorage({ databaseUrl: 'postgres://heybuddy' }), { durable: true, kind: 'postgres', ledger: 'server' });
  assert.equal(classifyStorage({ dataFile: '/data/heybuddy.sqlite' }).ledger, 'server');
  assert.equal(classifyStorage({ dataFile: '/data/heybuddy.sqlite' }).durable, true);
  assert.equal(classifyStorage({ dataFile: '/tmp/heybuddy.sqlite' }).ledger, 'browser');
  assert.equal(classifyStorage({ dataFile: '/tmp/heybuddy.sqlite' }).kind, 'ephemeral');
  assert.equal(classifyStorage({ dataFile: '/var/tmp/heybuddy.sqlite' }).durable, false);
  assert.equal(classifyStorage({ dataFile: ':memory:' }).kind, 'ephemeral');
  assert.deepEqual(classifyStorage({}), { durable: false, kind: 'unconfigured', ledger: 'browser' });
});
