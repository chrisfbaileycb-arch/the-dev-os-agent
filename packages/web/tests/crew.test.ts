import { describe, expect, it, vi } from 'vitest';
import { branchSession } from '../src/lib/branch';
import { CREW_SKILLS, exportSkillStack, instructionText, liveMcpConnections, liveSkillsForEngine, parseSkillFile, saveYourSkills, loadYourSkills, SKILL_CAP, parseSkillStack, type SkillState } from '../src/lib/skillRegistry';
import { ollamaOriginsValue, testLocalEndpoint } from '../src/lib/localNetwork';
import type { Session } from '../src/lib/store';

describe('branch one message', () => {
  const session: Session = {
    id: 's', title: 'Original', persona: 'assistant', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z',
    messages: [
      { id: 'a', role: 'user', content: 'Keep this', at: '2026-10-01T00:00:00.000Z' },
      { id: 'b', role: 'assistant', content: 'And this', at: '2026-10-01T00:00:01.000Z' },
      { id: 'c', role: 'user', content: 'Drop this', at: '2026-10-01T00:00:02.000Z' },
    ],
  };
  it('copies through the chosen message and leaves the original alone', () => {
    const branch = branchSession(session, 'b', '2026-10-09T00:00:00.000Z');
    expect(branch?.id).not.toBe(session.id);
    expect(branch?.messages.map(m => m.id)).toEqual(['a', 'b']);
    expect(session.messages).toHaveLength(3);
    expect(branch?.title.startsWith('Branch:')).toBe(true);
    expect(branchSession(session, 'missing')).toBeNull();
  });
});

describe('skills registry', () => {
  it('preserves complete long files in storage and exports, and refuses oversized activation', () => {
    const original = '---\nname: Full workflow\n---\n\n' + 'workflow step\n'.repeat(1500) + 'FINAL ACCEPTANCE CHECK';
    const parsed = parseSkillFile(original);
    expect(parsed.body).toBe(original);
    const skill = { id: 'complete', name: parsed.name, description: parsed.description, body: parsed.body, enabled: true };
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key) });
    saveYourSkills([skill]);
    expect(loadYourSkills()[0].body).toBe(original);
    expect(exportSkillStack([], [skill]).skills.find(row => row.id === 'complete')?.markdown).toBe(original);
    expect(instructionText([], [skill])).toContain('FINAL ACCEPTANCE CHECK');
    const restored = parseSkillStack(JSON.stringify(exportSkillStack([], [skill])));
    expect(restored.find(row => row.name === parsed.name)?.body).toBe(original);
    expect(restored.every(row => !row.enabled)).toBe(true);
    expect(restored.find(row => row.name === 'Code Reviewer')?.resources?.['LICENSE.txt']).toContain('AgentLand Contributors');
    expect(() => instructionText([], [{ ...skill, body: 'x'.repeat(SKILL_CAP + 1) }])).toThrow(/No instructions were truncated/);
    vi.unstubAllGlobals();
  });
  it('ships three attributed roles from one pinned source, initially disabled', () => {
    const roles = CREW_SKILLS.filter(skill => skill.provenance);
    expect(roles).toHaveLength(3);
    for (const role of roles) {
      expect(role.provenance?.commit).toBe('f99f6aa910a442b0197b768ce0ea7751e35e2060');
      expect(role.provenance?.sha256).toMatch(/^[a-f0-9]{64}$/);
      expect(role.resources?.['LICENSE.txt']).toContain('AgentLand Contributors');
      expect(role.markdown).toContain('---');
      expect(instructionText([])).not.toContain(role.markdown);
    }
  });
  const on: SkillState[] = CREW_SKILLS.map(skill => {
    const config: Record<string, string> = skill.id === 'github' ? { token: 'ghp-secret' } : {};
    return { id: skill.id, enabled: skill.kind === 'live', config };
  });
  it('keeps a pathway as instructions and does not pretend it is a server', () => {
    const stack = exportSkillStack(on);
    const drill = stack.skills.find(skill => skill.id === 'drill');
    expect(drill?.kind).toBe('instructions');
    expect(drill?.markdown).toContain('checkpoints');
    expect(drill?.url).toBe('');
    expect(stack.skills.find(skill => skill.id === 'github')?.kind).toBe('live');
  });
  it('hands the engine only live https skills and keeps the token off the chat connection id', () => {
    const engine = liveSkillsForEngine(on);
    expect(engine.map(skill => skill.name).sort()).toEqual(['context7', 'github']);
    expect(engine.every(skill => skill.transport === 'http' && skill.demo === false)).toBe(true);
    const connections = liveMcpConnections(on);
    expect(connections.map(c => c.id).sort()).toEqual(['skill:context7', 'skill:github']);
    expect(connections.find(c => c.id === 'skill:github')?.token).toBe('ghp-secret');
    expect(liveSkillsForEngine([{ id: 'drill', enabled: true, config: {} }])).toEqual([]);
  });
  it('follows an enabled pathway and a SKILL.md the visitor imported', () => {
    const text = instructionText(
      [{ id: 'drill', enabled: true, config: {} }, { id: 'github', enabled: true, config: { token: 'x' } }],
      [{ id: 'mine', name: 'Review', description: 'Use when a diff is ready.', body: '1. Name the risk.', enabled: true }],
    );
    expect(text).toContain('# The Drill');
    expect(text).toContain('1. Name the risk.');
    expect(text).not.toContain('ghp');
    expect(text).not.toContain('githubcopilot');
    const parsed = parseSkillFile('---\nname: Audit\ndescription: Use when a release is close.\n---\n\n# Audit\n\n1. Read the changelog.');
    expect(parsed.name).toBe('Audit');
    expect(parsed.description).toContain('release');
    expect(parsed.body).toContain('changelog');
  });
});

describe('local network probe', () => {
  it('names the exact OLLAMA_ORIGINS value and does not ask for a native app', async () => {
    expect(ollamaOriginsValue('https://hey-buddy-web.onrender.com/app')).toBe('https://hey-buddy-web.onrender.com');
    const refused = await testLocalEndpoint('http://127.0.0.1:11434/v1', 'https://hey-buddy-web.onrender.com', async () => { throw new TypeError('Failed to fetch'); });
    expect(refused.refused).toBe(true);
    expect(refused.message).toContain('OLLAMA_ORIGINS=https://hey-buddy-web.onrender.com');
    expect(refused.message).toContain('A native app is not required.');
  });
});
