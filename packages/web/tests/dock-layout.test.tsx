// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import Dock, { type DockProps } from '../src/ui/Dock';
import { personaById } from '../src/lib/roster';
import { defaultPipes } from '../src/lib/pipes';
import { emptyKeyring } from '../src/lib/providers';
import { offlineDeployment } from '../src/lib/deployment';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined; let host: HTMLDivElement;
function mount(element: React.ReactNode) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root!.render(element)); }
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host?.remove(); vi.restoreAllMocks(); });

function dock(patch: Partial<DockProps> = {}): DockProps {
  return {
    draft: '', setDraft: vi.fn(), workMode: 'chat', setWorkMode: vi.fn(), plan: 'build', setPlan: vi.fn(),
    persona: personaById('assistant'), openRoster: vi.fn(), attachments: [], photos: [], addFiles: vi.fn(), removeAttachment: vi.fn(), removePhoto: vi.fn(),
    openConnectors: vi.fn(), connectorCount: 3, openGithubPull: vi.fn(),
    model: '', inference: 'byok', free: offlineDeployment.free, paid: offlineDeployment.paid, labels: {}, reach: { free: offlineDeployment.free, keys: emptyKeyring(), credits: false }, keyed: new Set(),
    openSettings: vi.fn(), discovered: {}, discovering: new Set(), pipes: defaultPipes(),
    pickModel: vi.fn(), modelNeedsKey: vi.fn(), modelNeedsPlan: vi.fn(), discover: vi.fn(),
    busy: false, ready: true, send: vi.fn(), stop: vi.fn(),
    listening: false, voiceSupported: true, toggleVoice: vi.fn(), tokens: { draft: 0, context: 0 }, ...patch,
  };
}

it('keeps the toolbar above the typing surface, with mode, agent, model and connectors', () => {
  const props = dock();
  mount(<Dock {...props} />);
  const bar = host.querySelector('.dock-bar'); const input = host.querySelector('.dock-input');
  expect(bar).not.toBeNull(); expect(input).not.toBeNull();
  // The controls live outside the input box and above it: the bar precedes the textarea in document order.
  expect(bar!.contains(host.querySelector('textarea'))).toBe(false);
  expect(Boolean(bar!.compareDocumentPosition(input!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  // Every control the brief names is present on that line.
  expect(bar!.querySelector('select[aria-label="Interaction Mode"]')).not.toBeNull();
  expect([...bar!.querySelectorAll('.dock-control')].some(c => c.textContent?.includes('Agent'))).toBe(true);
  expect(bar!.querySelector('.model-trigger')).not.toBeNull();
  const connectors = [...bar!.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent?.includes('Connectors'));
  expect(connectors).not.toBeNull(); expect(connectors!.textContent).toContain('3');
  // The mic and send sit together in the input row's lower-right corner, not on the toolbar.
  const send = input!.querySelector('.dock-send'); expect(send).not.toBeNull();
  expect(send!.querySelector('.mic')).not.toBeNull(); expect(send!.querySelector('.send')).not.toBeNull();
});

it('opens Settings when the connectors control is used, and reports a zero count plainly', () => {
  const props = dock({ connectorCount: 0 });
  mount(<Dock {...props} />);
  const connectors = [...host.querySelectorAll<HTMLButtonElement>('.dock-bar button')].find(b => b.textContent?.includes('Connectors'))!;
  act(() => connectors.click());
  expect(props.openConnectors).toHaveBeenCalled();
  expect(connectors.textContent).not.toContain('0');
});
