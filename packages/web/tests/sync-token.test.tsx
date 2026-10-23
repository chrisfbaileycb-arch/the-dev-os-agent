// @vitest-environment happy-dom
import { afterEach, beforeEach, expect, it } from 'vitest';
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import GithubSyncDrawer from '../src/ui/GithubSyncDrawer';
import { emptySyncState, loadSyncSettings, type GithubSyncState } from '../src/lib/githubSync';
import { clearSessionSecrets } from '../src/lib/sessionSecrets';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const TOKEN = 'github_pat_' + 'A'.repeat(60);
let root: Root | undefined; let host: HTMLDivElement;
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); clearSessionSecrets(); });
afterEach(() => { if (root) act(() => root!.unmount()); root = undefined; host?.remove(); localStorage.clear(); sessionStorage.clear(); clearSessionSecrets(); });

// Holds the drawer's state the way the Output panel does: in component state that is lost when the
// panel unmounts (the visitor leaves the Workspace page), seeded from the session slot when it mounts.
function Panel() {
  const [state, setState] = useState<GithubSyncState>(() => ({ ...emptySyncState(), ...loadSyncSettings(), sha: null }));
  return <GithubSyncDrawer open close={() => {}} state={state} patch={partial => setState(current => ({ ...current, ...partial }))} activePath={null} activeContent="" applyPulled={() => {}} files={[]} notify={() => {}} secrets={[]} />;
}
function mount() { host = document.createElement('div'); document.body.append(host); root = createRoot(host); act(() => root!.render(<Panel />)); }
function leavePage() { act(() => root!.unmount()); root = undefined; host.remove(); }
const tokenField = () => host.querySelector<HTMLInputElement>('.token-field input')!;
function type(input: HTMLInputElement, value: string) {
  // The native setter, so React's value tracker sees a real change rather than its own write.
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); });
}

it('keeps a typed token in page memory before any Save or push', () => {
  mount();
  expect(loadSyncSettings().token).toBe('');
  type(tokenField(), TOKEN);
  expect(loadSyncSettings().token).toBe(TOKEN);
});

it('has the token back when the panel is mounted again after leaving the page', () => {
  // Typing a token and switching pages used to lose it: only Save or a successful push wrote it down.
  mount();
  type(tokenField(), TOKEN);
  leavePage();
  mount();
  expect(tokenField().value).toBe(TOKEN);
});

it('never writes the token to browser storage', () => {
  mount();
  type(tokenField(), TOKEN);
  for (let i = 0; i < localStorage.length; i++) expect(localStorage.getItem(localStorage.key(i)!)).not.toContain(TOKEN);
  expect(sessionStorage.length).toBe(0);
});

it('forgets the token when the field is emptied', () => {
  mount();
  type(tokenField(), TOKEN);
  type(tokenField(), '');
  expect(loadSyncSettings().token).toBe('');
  leavePage();
  mount();
  expect(tokenField().value).toBe('');
});
