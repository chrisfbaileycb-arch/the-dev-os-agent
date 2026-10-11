// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

beforeEach(() => { localStorage.clear(); sessionStorage.clear(); vi.resetModules(); });
afterEach(() => { localStorage.clear(); sessionStorage.clear(); vi.resetModules(); });

it('keeps all personal credential slots usable in this page without writing them to storage', async () => {
  const providers = await import('../src/lib/providers');
  const engine = await import('../src/lib/engineKey');
  const github = await import('../src/lib/githubSync');
  const connectors = await import('../src/lib/connectors');
  const mcp = await import('../src/lib/mcp');
  const skills = await import('../src/lib/skillRegistry');
  providers.persistConnection({ ...providers.defaultConnection('openai'), token: 'secret-model', saveKey: true });
  engine.saveEngineKey('secret-engine');
  github.saveSyncSettings({ ...github.emptySyncState(), token: 'secret-sync' });
  connectors.saveSettings({ ...connectors.defaultSettings(), github: { enabled: true, token: 'secret-github', saveToken: true, repos: ['owner/repo'] } });
  mcp.saveConnections([{ id: 'mcp-1', name: 'Test', url: 'https://mcp.example', transport: 'http', token: 'secret-mcp', saveToken: true, enabled: true, tools: [] }]);
  const state = skills.defaultSkillState().map(row => row.id === 'github' ? { ...row, config: { token: 'secret-skill' } } : row);
  skills.saveSkillState(state);
  expect(providers.loadKeyring().openai).toBe('secret-model');
  expect(engine.loadEngineKey()).toBe('secret-engine');
  expect(github.loadSyncSettings().token).toBe('secret-sync');
  expect(connectors.loadSettings().github.token).toBe('secret-github');
  expect(mcp.loadConnections()[0].token).toBe('secret-mcp');
  expect(skills.loadSkillState().find(row => row.id === 'github')?.config.token).toBe('secret-skill');
  for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain('secret-');
  expect(sessionStorage.length).toBe(0);
  vi.resetModules();
  expect((await import('../src/lib/providers')).loadKeyring().openai).toBe('');
  expect((await import('../src/lib/engineKey')).loadEngineKey()).toBe('');
  expect((await import('../src/lib/githubSync')).loadSyncSettings().token).toBe('');
  expect((await import('../src/lib/connectors')).loadSettings().github.token).toBe('');
  expect((await import('../src/lib/mcp')).loadConnections()[0].token).toBe('');
  expect((await import('../src/lib/skillRegistry')).loadSkillState().find(row => row.id === 'github')?.config.token).toBe('');
});

it('purges legacy keys at startup while preserving non-secret model and repository preferences', async () => {
  localStorage.setItem('sf-engine-key', 'old-secret'); localStorage.setItem('hb-plan-token', 'old-secret');
  localStorage.setItem('ft-provider-openai', JSON.stringify({ model: 'chosen-model', token: 'old-secret', saveKey: true }));
  localStorage.setItem('hb-github-sync', JSON.stringify({ repo: 'owner/repo', token: 'old-secret' }));
  localStorage.setItem('hb-connectors', JSON.stringify({ github: { token: 'old-secret', saveToken: true, repos: ['owner/repo'] } }));
  localStorage.setItem('hb-mcp', JSON.stringify([{ id: 'test', token: 'old-secret', saveToken: true }]));
  localStorage.setItem('sf-skills', JSON.stringify([{ id: 'github', enabled: true, config: { token: 'old-secret' } }]));
  (await import('../src/lib/sessionSecrets')).purgeLegacyBrowserSecrets();
  expect(localStorage.getItem('sf-engine-key')).toBeNull(); expect(localStorage.getItem('hb-plan-token')).toBeNull();
  for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain('old-secret');
  expect((await import('../src/lib/providers')).loadConnection('openai').model).toBe('chosen-model');
  expect((await import('../src/lib/githubSync')).loadSyncSettings().repo).toBe('owner/repo');
});
