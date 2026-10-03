// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import ModelPicker, { type ModelPickerProps } from '../src/ui/ModelPicker';
import Settings, { type SettingsProps } from '../src/ui/Settings';
import StatusBar from '../src/ui/StatusBar';
import Pricing from '../src/ui/Pricing';
import { defaultConnection, emptyKeyring } from '../src/lib/providers';
import { defaultPipes } from '../src/lib/pipes';
import { keyFingerprint } from '../src/lib/discovered';
import { offlineDeployment } from '../src/lib/deployment';
import { serverBalance } from '../src/lib/store';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root | undefined;
let host: HTMLDivElement;
function mount(element: React.ReactNode) { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root!.render(element)); return host; }
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host?.remove(); vi.restoreAllMocks(); });
const free = { ...offlineDeployment.free, enabled: true, models: ['managed-free'], providers: { 'managed-free': 'groq' }, labels: { 'managed-free': 'Free model' } };
const paid = { enabled: true, configured: true, models: ['managed-paid'], providers: { 'managed-paid': 'openai' }, labels: { 'managed-paid': 'Plan model' } };
function picker(patch: Partial<ModelPickerProps> = {}): ModelPickerProps {
  return { lane: 'us', model: '', inference: 'byok', provider: 'openai', free, paid, labels: {}, reach: { free, keys: emptyKeyring(), credits: false }, keyed: new Set(), discovered: {}, discovering: new Set(), pipes: defaultPipes(), onPick: vi.fn(), onOpenSettings: vi.fn(), onNeedsKey: vi.fn(), onNeedsPlan: vi.fn(), onDiscover: vi.fn(), ...patch };
}
function open() { act(() => (host.querySelector('.model-trigger') as HTMLButtonElement).click()); }

describe('chat is selection-only and respects the connected funding lane', () => {
  it('both menus have no API-key fields and locked plan models are not selectable', () => {
    const us = picker(); const own = picker({ lane: 'own' });
    mount(<><ModelPicker {...us} /><ModelPicker {...own} /></>);
    open();
    expect(host.querySelectorAll('[role=option]')).toHaveLength(1);
    expect(host.textContent).toContain('Free model'); expect(host.textContent).not.toContain('Plan model');
    expect(host.querySelectorAll('input[type=password]')).toHaveLength(0);
    act(() => (host.querySelectorAll('.model-trigger')[1] as HTMLButtonElement).click());
    expect(host.querySelectorAll('input[type=password]')).toHaveLength(0);
    expect(host.textContent).toContain('Open Settings');
  });
  it('a plan token unlocks only published managed models, not arbitrary vendor seeds', () => {
    const props = picker({ free: offlineDeployment.free, reach: { free: offlineDeployment.free, keys: emptyKeyring(), credits: true } });
    mount(<ModelPicker {...props} />); open();
    const options = host.querySelectorAll('[role=option]'); expect(options).toHaveLength(1);
    act(() => (options[0] as HTMLButtonElement).click());
    expect(props.onPick).toHaveBeenCalledWith('managed-paid', 'credits', 'openai');
  });
  it('personal US model selection uses the personal key even with a plan connected', () => {
    const keys = { ...emptyKeyring(), openai: 'personal-account-key' };
    const props = picker({ free: offlineDeployment.free, paid: offlineDeployment.paid, reach: { free, keys, credits: true }, keyed: new Set(['openai']), discovered: { openai: { at: Date.now(), key: keyFingerprint(keys.openai), models: [{ id: 'gpt-4o', label: 'Personal GPT' }] } } });
    mount(<ModelPicker {...props} />); open();
    act(() => (host.querySelector('[role=option]') as HTMLButtonElement).click());
    expect(props.onPick).toHaveBeenCalledWith('gpt-4o', 'byok', 'openai');
  });
  it('a catalogue from a different key is withheld until the new connection is discovered', () => {
    const keys = { ...emptyKeyring(), openai: 'new-account-key' };
    mount(<ModelPicker {...picker({ free: offlineDeployment.free, paid: offlineDeployment.paid, reach: { free, keys, credits: false }, keyed: new Set(['openai']), discovered: { openai: { at: Date.now(), key: keyFingerprint('old-account-key'), models: [{ id: 'gpt-4o', label: 'Old account model' }] } } })} />); open();
    expect(host.querySelectorAll('[role=option]')).toHaveLength(0); expect(host.textContent).not.toContain('Old account model');
  });
  it('enabled local models appear only for their current local address and never use plan credits', () => {
    const pipes = { ...defaultPipes(), ollamaEnabled: true };
    const props = picker({ lane: 'own', pipes, keyed: new Set(['ollama']), discovered: { ollama: { at: Date.now(), key: keyFingerprint(pipes.ollamaUrl), models: [{ id: 'my-local-model', label: 'Local model' }] } } });
    mount(<ModelPicker {...props} />); open();
    act(() => (host.querySelector('[role=option]') as HTMLButtonElement).click());
    expect(props.onPick).toHaveBeenCalledWith('my-local-model', 'byok', 'ollama');
  });
});

it('settings contains the verified plan allowance, tier reply cap, and local connector', () => {
  const props: SettingsProps = { connection: { ...defaultConnection('openai'), inference: 'credits', serverAccessToken: 'plan-token', maxTokens: 32768 }, setConnection: vi.fn(), keys: emptyKeyring(), setKeys: vi.fn(), keyed: new Set(), discovered: {}, discovering: new Set(), discover: vi.fn(), save: vi.fn(), forget: vi.fn(), balance: serverBalance(6000, 12), freeBalance: serverBalance(400, 0), free, paid, adminConfigured: true, openAdmin: vi.fn(), ledger: [], busy: false, canInstall: false, serverReachable: true, requestClear: vi.fn(), theme: 'light', setTheme: vi.fn(), pipes: { ...defaultPipes(), ollamaEnabled: true }, setPipes: vi.fn(), subscription: { plan: { id: 'pro', name: 'Studio', price: '$100', monthlyCredits: 6000, maxOutputTokens: 32768 }, pool: 6000, used: 12, entry: null } };
  mount(<Settings {...props} />);
  expect(host.textContent).toContain('Studio verified'); expect(host.textContent).toContain('5,988 of 6,000 credits left');
  expect(host.querySelector('select[aria-describedby=reply-length-help]')?.getAttribute('aria-describedby')).toBe('reply-length-help');
  expect((host.querySelector('select[aria-describedby=reply-length-help]') as HTMLSelectElement).value).toBe('32768');
  expect(host.textContent).toContain('Local server API key (optional)');
  expect(host.textContent).toContain('Connect a model running on this computer');
});

it('pricing renders three server-reported plan allowances and disables unconfigured checkout', () => {
  mount(<Pricing billing={{ enabled: false, plans: [] }} free={free} freeBalance={serverBalance(400, 0)} onStart={vi.fn()} onAddKey={vi.fn()} />);
  expect(host.querySelectorAll('.plan')).toHaveLength(3);
  for (const price of ['$25', '$50', '$100']) expect(host.textContent).toContain(price);
  expect(host.querySelectorAll('.plan-cta:disabled')).toHaveLength(3);
  expect(host.textContent).toContain('Local model toggle');
});

it('the bottom bar avoids an invented platform balance on personal keys', () => {
  mount(<StatusBar model="M" tier="pro" mode="your key" paymentMode="byok" localModel={false} outputLimit={8192} stats={null} balance={serverBalance(100000, 0)} freeTier={false} backgroundWorker={false} busy={false} online={true} synced={true} />);
  expect(host.textContent).toContain('8,192 output max'); expect(host.textContent).toContain('Your key · no plan charge'); expect(host.textContent).not.toContain('100,000');
});
