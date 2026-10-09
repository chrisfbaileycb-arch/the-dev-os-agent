import { describe, expect, it } from 'vitest';
import { branchSession } from '../src/lib/branch';
import { CREW_SKILLS, exportSkillStack, liveMcpConnections, liveSkillsForEngine, type SkillState } from '../src/lib/skillRegistry';
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
  const on: SkillState[] = CREW_SKILLS.map(skill => {
    const config: Record<string, string> = skill.id === 'github' ? { token: 'ghp-secret' } : {};
    return { id: skill.id, enabled: skill.kind === 'live', config };
  });
  it('marks demos and exports them as not callable', () => {
    const stack = exportSkillStack(on);
    const drill = stack.skills.find(skill => skill.id === 'drill');
    expect(drill?.demo).toBe(true);
    expect(drill?.url).toBe('');
    expect(stack.skills.find(skill => skill.id === 'github')?.demo).toBe(false);
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
