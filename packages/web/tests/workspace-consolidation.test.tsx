// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ModelPicker from '../src/ui/ModelPicker';
import AgentSkills from '../src/ui/AgentSkills';
import { defaultPipes } from '../src/lib/pipes';
import { emptyKeyring } from '../src/lib/providers';
import { offlineDeployment } from '../src/lib/deployment';
import { keyFingerprint } from '../src/lib/discovered';
import { loadWorkingMemory, saveWorkingMemory, workingMemoryText, clearWorkingMemory } from '../src/lib/workingMemory';
import { agentPackage } from '../src/ui/ExecutionPanel';
import { personaById } from '../src/lib/roster';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined; let host: HTMLDivElement;
function mount(element: React.ReactNode) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root!.render(element)); }
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host?.remove(); localStorage.clear(); vi.restoreAllMocks(); });
it('developer model selection hides legacy conversation-only models but keeps current coding models', () => {
  const keys = { ...emptyKeyring(), openai: 'fixture-key' };
  mount(<ModelPicker developer model="gpt-5" inference="byok" provider="openai" onOpenSettings={vi.fn()} free={offlineDeployment.free} paid={offlineDeployment.paid} labels={{}} reach={{ free: offlineDeployment.free, keys, credits: false }} keyed={new Set(['openai'])} discovered={{ openai: { at: Date.now(), key: keyFingerprint(keys.openai), models: [{ id: 'gpt-3.5-turbo', label: 'Legacy' }, { id: 'gpt-5', label: 'Coder' }, { id: 'text-embedding-3-small', label: 'Embedding' }] } }} discovering={new Set()} onPick={vi.fn()} onNeedsKey={vi.fn()} onNeedsPlan={vi.fn()} onDiscover={vi.fn()} pipes={defaultPipes()} />);
  act(() => (host.querySelector('.model-trigger') as HTMLButtonElement).click());
  expect(host.querySelectorAll('[role=option]')).toHaveLength(1);
  expect(host.textContent).toContain('Coder'); expect(host.textContent).not.toContain('Legacy'); expect(host.textContent).not.toContain('Embedding');
});
it('regular users can toggle complete skills but cannot import, edit or delete catalog definitions', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ skills: [], systemPrompts: { general: '', build: '' } })));
  mount(<AgentSkills mcp={[]} setMcp={vi.fn()} notify={vi.fn()} />);
  expect(host.querySelectorAll('input[type=file]')).toHaveLength(0);
  expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Add')).toBe(false);
  expect(host.querySelectorAll('input[type=checkbox]').length).toBeGreaterThanOrEqual(65);
  expect(host.querySelector('[aria-label="Read Multi-Agent Systems Architect"]')).not.toBeNull();
});
it('working memory is local, complete, explicitly cleared, and rejects credentials', () => {
  const fetch = vi.spyOn(globalThis, 'fetch');
  const value = { task: 'Follow project conventions\n'.repeat(100), knowledge: 'PRIVATE PROJECT FACT' };
  saveWorkingMemory(value); expect(loadWorkingMemory()).toEqual(value); expect(workingMemoryText()).toContain('PRIVATE PROJECT FACT'); expect(fetch).not.toHaveBeenCalled();
  expect(() => saveWorkingMemory({ task: 'Use fixture-sensitive-key', knowledge: '' }, ['fixture-sensitive-key'])).toThrow(/credential/);
  expect(loadWorkingMemory()).toEqual(value);
  clearWorkingMemory(); expect(loadWorkingMemory()).toEqual({ task: '', knowledge: '' });
});
it('agent export includes complete linked configuration without connector credentials or implicit memory', () => {
  saveWorkingMemory({ task: 'PRIVATE TASK', knowledge: '' });
  const exported = agentPackage({ persona: personaById('coder'), connectors: [{ id: 'fixture', name: 'GitHub', url: 'https://example.com/mcp', transport: 'http', token: 'secret-connector-token', enabled: true, saveToken: false, tools: [{ name: 'read', description: 'Read repository', inputSchema: { properties: { repo: { type: 'string' } } } }] }] });
  expect(JSON.stringify(exported)).not.toContain('secret-connector-token'); expect(JSON.stringify(exported)).not.toContain('PRIVATE TASK');
  expect(exported.persona.prompt).toContain('You are'); expect(exported.systemInstructions.length).toBeGreaterThan(exported.persona.prompt.length); expect(exported.connectors[0].tools[0].inputSchema).toBeDefined();
});
