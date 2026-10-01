import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { REGISTRY, allowedUnderShield, isShieldEligible, providerRecord, shieldProviders } from '../server/providerRegistry.mjs';
import { PROVIDER_KEY_VARS } from '../server/freetier.mjs';

const clientProviders = () => {
  const src = readFileSync(new URL('../src/lib/providers.ts', import.meta.url), 'utf8');
  const union = src.match(/export type Provider = ([^;]+);/)?.[1] ?? '';
  return [...union.matchAll(/'([^']+)'/g)].map(m => m[1]);
};

test('every provider the app can route to has a registry record, so none ships without a Shield decision', () => {
  for (const id of clientProviders()) assert.ok(providerRecord(id), `${id} is in the Provider type but not in the registry`);
  for (const id of Object.keys(PROVIDER_KEY_VARS)) assert.ok(providerRecord(id), `${id} funds requests but is not in the registry`);
});

test('records are well formed and retention is never claimed without a source and a date', () => {
  const ids = new Set();
  for (const r of REGISTRY) {
    assert.ok(!ids.has(r.id), `duplicate ${r.id}`); ids.add(r.id);
    assert.ok(r.name && r.hq && r.kind, `${r.id} is incomplete`);
    if (r.retention === 'verified') assert.ok(r.verifiedOn && r.source, `${r.id} says verified with no date or source`);
    else assert.equal(r.verifiedOn, null, `${r.id} has a date but is not marked verified`);
  }
});

test('Shield allows US companies and hosts, and refuses relays, other countries, unknowns and custom endpoints', () => {
  for (const id of ['anthropic', 'openai', 'google', 'xai', 'groq', 'cerebras', 'github', 'azure', 'bedrock', 'meta']) assert.equal(allowedUnderShield(id), true, id);
  // OpenRouter and Hugging Face are US companies but relays: the upstream host is not guaranteed to be US.
  for (const id of ['openrouter', 'huggingface', 'cohere', 'venice', 'xkiro', 'aihubmix', 'cheaper-inference', 'omniroute', 'custom', 'ollama']) assert.equal(allowedUnderShield(id), false, id);
  assert.equal(allowedUnderShield('not-a-provider'), false, 'an unknown id is refused, never assumed');
  assert.equal(allowedUnderShield(undefined), false);
});

test('the integrated Shield list is exactly what the proxy can reach today; unbuilt ones wait', () => {
  const live = shieldProviders();
  assert.deepEqual([...live].sort(), ['anthropic', 'cerebras', 'github', 'google', 'groq', 'openai', 'xai']);
  for (const id of ['azure', 'bedrock', 'meta']) { assert.equal(isShieldEligible(providerRecord(id)), true); assert.ok(!live.includes(id), `${id} is not integrated yet`); }
  assert.ok(shieldProviders({ onlyIntegrated: false }).includes('meta'));
});
