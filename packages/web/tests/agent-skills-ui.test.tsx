// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AgentSkills from '../src/ui/AgentSkills';
import Rail from '../src/ui/Rail';
import { exportSkillStack, instructionText, loadSkillState, loadYourSkills } from '../src/lib/skillRegistry';

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
let root: Root;
let host: HTMLDivElement;
function mount(element: React.ReactNode) {
  localStorage.clear();
  host = document.createElement('div'); document.body.append(host);
  root = createRoot(host); act(() => root.render(element));
}
function click(label: string) {
  const button = [...host.querySelectorAll('button')].find(b => b.textContent?.trim() === label);
  expect(button).toBeDefined(); act(() => button!.click());
}
function input(label: string, value: string) {
  const field = [...host.querySelectorAll('label')].find(l => l.textContent?.startsWith(label))?.querySelector('input, textarea') as HTMLInputElement;
  expect(field).toBeDefined();
  act(() => {
    const prototype = field.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ skills: [], systemPrompts: {general: '', build: ''} })));
afterEach(() => { act(() => root?.unmount()); host?.remove(); localStorage.clear(); });

describe('Agent Skills', () => {
  it('offers a primary navigation tab', () => {
    const setPage = vi.fn();
    mount(<Rail page="skills" setPage={setPage} collapsed={false} toggle={vi.fn()} badge={{}} />);
    click('Agent Skills');
    expect(setPage).toHaveBeenCalledWith('skills');
    expect(host.querySelector('[aria-current=page]')?.textContent).toBe('Agent Skills');
  });
  it('saves, edits, disables, and searches the same instructions used by chat and plans', () => {
    mount(<AgentSkills mcp={[]} setMcp={vi.fn()} notify={vi.fn()} adminMode />);
    click('Add'); input('Name', 'Release review'); input('When to use it', 'Before deployment'); input('Steps', 'Read the diff and report failed checks.'); click('Save skill');
    const id = loadYourSkills()[0]?.id;
    expect(instructionText()).toContain('Read the diff and report failed checks.');
    act(() => (host.querySelector('[aria-label="Edit Release review"]') as HTMLButtonElement).click());
    input('Steps', 'Check the live URL and report its status.'); click('Save changes');
    expect(loadYourSkills()[0].id).toBe(id);
    expect(instructionText()).toContain('Check the live URL');
    act(() => (host.querySelector('[aria-label="Enable Release review"]') as HTMLInputElement).click());
    expect(instructionText()).not.toContain('Check the live URL');
    input('Search skills', 'no such skill');
    expect(host.textContent).toContain('No skills match this search.');
    expect(host.querySelector('[aria-label="Edit Release review"]')).toBeNull();
  });
  it('exports skills and connector addresses without remembered credentials', () => {
    const exported = exportSkillStack([{ id: 'github', enabled: true, config: { token: 'ghp-private-token', unknown: 'private-value' } }]);
    expect(JSON.stringify(exported)).not.toContain('ghp-private-token');
    expect(JSON.stringify(exported)).not.toContain('private-value');
    expect(exported.skills.find(s => s.id === 'github')?.url).toBe('https://api.githubcopilot.com/mcp/');
    expect(loadSkillState().find(s => s.id === 'github')?.enabled).toBe(false);
  });
});
