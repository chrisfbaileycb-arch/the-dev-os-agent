// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import AgentSkills from '../src/ui/AgentSkills';
import Rail from '../src/ui/Rail';
import { RosterList } from '../src/ui/Roster';
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
  it('offers one consolidated Agents & Skills navigation tab', () => {
    const setPage = vi.fn();
    mount(<Rail page="agents" setPage={setPage} collapsed={false} toggle={vi.fn()} badge={{}} />);
    click('Agents & Skills');
    expect(setPage).toHaveBeenCalledWith('agents');
    expect(host.querySelector('[aria-current=page]')?.textContent).toBe('Agents & Skills');
    // The old separate entries are gone: exactly one nav item covers roster and skills.
    const labels = [...host.querySelectorAll('.rail-item')].map(b => b.textContent);
    expect(labels).not.toContain('Agent roster');
    expect(labels).not.toContain('Agent Skills');
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
  it('scopes an export to one agent: per-card action, no whole-library export button', () => {
    const onExport = vi.fn();
    mount(<RosterList activeId="assistant" onPick={vi.fn()} custom={[]} onCreate={vi.fn()} onDelete={vi.fn()} onExport={onExport} />);
    // Every agent card carries its own export, and none of them is a global dump.
    const exportButtons = [...host.querySelectorAll<HTMLButtonElement>('button.persona-export')];
    expect(exportButtons.length).toBeGreaterThan(5);
    expect(exportButtons.every(b => /^Export .+/.test(b.getAttribute('aria-label') ?? ''))).toBe(true);
    expect([...host.querySelectorAll('button')].map(b => b.textContent)).not.toContain('Export Agent');
    act(() => (host.querySelector('[aria-label="Export Assistant"]') as HTMLButtonElement).click());
    expect(onExport).toHaveBeenCalledWith('assistant');
  });
  it('filters the skill catalog by category and drops the export controls', () => {
    mount(<AgentSkills mcp={[]} setMcp={vi.fn()} notify={vi.fn()} />);
    // No whole-library or agent-dump buttons live in the catalog any more.
    const labels = [...host.querySelectorAll('button')].map(b => b.textContent);
    expect(labels).not.toContain('Export Skills');
    expect(labels).not.toContain('Export Agent');
    // Category tabs are present and switching one narrows the visible catalog.
    const tabs = [...host.querySelectorAll<HTMLButtonElement>('.tool-category-tabs button')];
    expect(tabs.map(t => t.textContent)).toContain('All');
    expect(tabs.map(t => t.textContent)).toContain('First-party pathways');
    const allCount = host.querySelectorAll('.doc-row').length;
    const firstParty = tabs.find(t => t.textContent === 'First-party pathways')!;
    act(() => firstParty.click());
    expect(host.querySelectorAll('.doc-row').length).toBeLessThan(allCount);
    expect(host.textContent).toContain('Jev System-1 Router');
  });
  it('surfaces an imported repository as its own "Imported:" category tab', async () => {
    const imported = {
      id: `repo-${'a'.repeat(24)}`, name: 'Release Engineer', blurb: 'Release a verified build', markdown: '# Release',
      repository: 'agency-enterprise/agency-agents', kind: 'instructions', url: '', fields: [],
    };
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce(new Response(JSON.stringify({ skills: [imported], systemPrompts: { general: '', build: '' } })));
    mount(<AgentSkills mcp={[]} setMcp={vi.fn()} notify={vi.fn()} />);
    await act(async () => { await new Promise(r => setTimeout(r, 0)); });
    const tab = (label: string) => [...host.querySelectorAll<HTMLButtonElement>('.tool-category-tabs button')].find(t => t.textContent === label);
    expect(tab('Imported: agency-agents')).toBeDefined();
    // It must not be mis-filed as a first-party pathway.
    act(() => tab('First-party pathways')!.click());
    expect(host.textContent).not.toContain('Release Engineer');
    act(() => tab('Imported: agency-agents')!.click());
    const row = [...host.querySelectorAll('.doc-row')].find(n => n.textContent?.includes('Release Engineer'));
    expect(row).toBeDefined();
    // The row carries a compact attribution badge with the source repository.
    expect(row!.querySelector('.skill-attribution')?.textContent).toBe('Imported from agency-enterprise/agency-agents');
  });
  it('exports skills and connector addresses without remembered credentials', () => {
    const exported = exportSkillStack([{ id: 'github', enabled: true, config: { token: 'ghp-private-token', unknown: 'private-value' } }]);
    expect(JSON.stringify(exported)).not.toContain('ghp-private-token');
    expect(JSON.stringify(exported)).not.toContain('private-value');
    expect(exported.skills.find(s => s.id === 'github')?.url).toBe('https://api.githubcopilot.com/mcp/');
    expect(loadSkillState().find(s => s.id === 'github')?.enabled).toBe(false);
  });
});
