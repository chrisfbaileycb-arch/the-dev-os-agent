// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AgentSandboxConsole, { sandboxStatus, type ExecutionProps } from '../src/ui/AgentSandboxConsole';
import Connectors from '../src/ui/Connectors';
import OutputPanel from '../src/ui/OutputPanel';
import { personaById } from '../src/lib/roster';
import { defaultSettings } from '../src/lib/connectors';
// The panel compiles in a Web Worker, which this DOM does not have; the code view needs no build result.
vi.mock('../src/lib/bundle/client', async importOriginal => ({ ...(await importOriginal<typeof import('../src/lib/bundle/client')>()), buildProject: vi.fn(() => new Promise(() => {})) }));
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
it('keeps the custom MCP form visible, lists the MCP tools, and the two optional media providers stay out of the grid', () => {
  mount(<Connectors open close={vi.fn()} tab="mcp" setTab={vi.fn()} settings={defaultSettings()} setSettings={vi.fn()} mcp={[]} setMcp={vi.fn()} knowledge={[]} addDocuments={vi.fn()} removeDocument={vi.fn()} notify={vi.fn()} />);
  expect(host.querySelectorAll('.preset')).toHaveLength(23); expect(host.querySelector('#mcp-config-form')).not.toBeNull();
  expect(host.textContent).toContain('Add or Configure a Model Context Protocol server'); expect(host.textContent).toContain('HeyGen'); expect(host.textContent).toContain('Nano Banana'); expect(host.textContent).not.toContain('Hugging Face'); expect(host.textContent).not.toContain('Context7');
  expect([...host.querySelectorAll('button')].some(b => b.textContent === 'Connect listed servers')).toBe(false);
  // The drawer is for external connections only. Skills moved to the Agents & Skills page.
  expect([...host.querySelectorAll('.connector-tab strong')].map(n => n.textContent)).toEqual(['GitHub', 'Web', 'Documents', 'MCP & Tools']);
});
it('switches the right pane between the exact requested tabs and supports keyboard navigation', () => {
  mount(<OutputPanel execution={execution} content="" close={vi.fn()} github={defaultSettings().github} openConnectors={vi.fn()} onPreviewFocus={vi.fn()} updateGithub={vi.fn()} secrets={[]} />);
  const tabs = [...host.querySelectorAll<HTMLButtonElement>('[role=tab]')]; expect(tabs.map(t => t.textContent)).toEqual(['App Live Preview', 'Agent Sandbox / DevOps Console']);
  // With no project on the canvas the live tab is idle, so its status LED is the greyscale one.
  const led = tabs[0].querySelector('.status-led'); expect(led).not.toBeNull(); expect(led?.classList.contains('online')).toBe(false);
  act(() => tabs[1].click()); expect(host.querySelector('[role=tabpanel]')?.id).toBe('agent-sandbox-panel'); expect(host.querySelector('.agent-sandbox-console')).not.toBeNull();
  act(() => tabs[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })));
  expect(host.querySelector('[role=tabpanel]')?.id).toBe('app-preview-panel'); expect(tabs[0].getAttribute('aria-selected')).toBe('true');
});
it('numbers the lines of the generated code in both the read-only view and the editor', () => {
  const code = '<h1>hello</h1>\n<p>two</p>\n<p>three</p>';
  mount(<OutputPanel execution={execution} content={'```html\n' + code + '\n```'} close={vi.fn()} github={defaultSettings().github} openConnectors={vi.fn()} onPreviewFocus={vi.fn()} updateGithub={vi.fn()} secrets={[]} />);
  act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('View / Edit Code'))!.click());
  const gutter = () => host.querySelector('[data-testid="code-gutter"]');
  // The parser wraps a bare fragment in a page, so count what the pane really holds.
  const lines = host.querySelector('.syntax-code')!.textContent!.split('\n').length;
  const expected = Array.from({ length: lines }, (_, i) => i + 1).join('\n');
  expect(lines).toBe(4);
  expect(gutter()?.textContent).toBe(expected);
  expect(gutter()?.getAttribute('aria-hidden')).toBe('true');
  // The numbers are a separate column, so copying the code never picks them up.
  expect(host.querySelector('.syntax-code')?.textContent).not.toContain('1\n2');
  act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Edit')!.click());
  const editor = host.querySelector<HTMLTextAreaElement>('textarea[aria-label="Generated code editor"]');
  expect(editor?.getAttribute('wrap')).toBe('off');
  expect(gutter()?.textContent).toBe(expected);
});
