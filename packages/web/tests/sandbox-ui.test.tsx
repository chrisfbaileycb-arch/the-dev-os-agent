// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AgentSandboxConsole, { sandboxStatus, type ExecutionProps } from '../src/ui/AgentSandboxConsole';
import Connectors from '../src/ui/Connectors';
import OutputPanel from '../src/ui/OutputPanel';
import { personaById } from '../src/lib/roster';
import { defaultSettings } from '../src/lib/connectors';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined; let host: HTMLDivElement;
function mount(element: React.ReactNode) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root!.render(element)); }
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host?.remove(); localStorage.clear(); vi.restoreAllMocks(); });
const execution: ExecutionProps = { runs: [], messages: [], persona: personaById('coder'), connectors: [], secrets: ['private-media-token'], busy: false, onApprove: vi.fn(), onStop: vi.fn() };
it('streams complete argument/response details, shows trapped errors and runtime downloads', () => {
  mount(<AgentSandboxConsole {...execution} events={[{ id: 'e1', sessionId: 's1', at: new Date().toISOString(), kind: 'tool', status: 'Error Trapped', title: 'Tool: image', connector: 'Nano Banana', args: { prompt: 'Marketing asset', token: 'private-media-token' }, stdout: 'Provider quota exhausted', durationMs: 1200 }]} />);
  expect(host.textContent).toContain('Error Trapped'); expect(host.textContent).toContain('1.20s'); expect(host.textContent).toContain('Arguments payload'); expect(host.textContent).toContain('Marketing asset'); expect(host.textContent).toContain('Provider quota exhausted'); expect(host.textContent).not.toContain('private-media-token');
  expect([...host.querySelectorAll('button')].map(b => b.textContent)).toContain('Export Agent'); expect([...host.querySelectorAll('button')].map(b => b.textContent)).toContain('Download Execution Bundle');
  expect(sandboxStatus({ busy: true, runs: [] })).toBe('Running'); expect(sandboxStatus({ busy: false, runs: [] })).toBe('Idle');
});
it('keeps the custom MCP form visible and distinguishes all 25 tools and the two optional media providers', () => {
  mount(<Connectors open close={vi.fn()} tab="mcp" setTab={vi.fn()} settings={defaultSettings()} setSettings={vi.fn()} mcp={[]} setMcp={vi.fn()} knowledge={[]} addDocuments={vi.fn()} removeDocument={vi.fn()} notify={vi.fn()} />);
  expect(host.querySelectorAll('.preset')).toHaveLength(25); expect(host.querySelector('#mcp-config-form')).not.toBeNull();
  expect(host.textContent).toContain('Add or Configure a Model Context Protocol server'); expect(host.textContent).toContain('HeyGen'); expect(host.textContent).toContain('Nano Banana'); expect(host.textContent).not.toContain('Hugging Face'); expect(host.textContent).not.toContain('Context7');
  expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Connect listed servers')).toBe(false);
});
it('switches the right pane between the exact requested tabs and supports keyboard navigation', () => {
  mount(<OutputPanel execution={execution} content="" close={vi.fn()} github={defaultSettings().github} openConnectors={vi.fn()} onPreviewFocus={vi.fn()} updateGithub={vi.fn()} secrets={[]} />);
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')]; expect(tabs.map(t => t.textContent)).toEqual(['App Live Preview', 'Agent Sandbox / DevOps Console']);
  act(() => tabs[1].click()); expect(host.querySelector('[role=tabpanel]')?.id).toBe('agent-sandbox-panel'); expect(host.querySelector('.agent-sandbox-console')).not.toBeNull();
  act(() => tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  expect(host.querySelector('[role=tabpanel]')?.id).toBe('app-preview-panel'); expect(tabs[0].getAttribute('aria-selected')).toBe('true');
});
