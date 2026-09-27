import { describe, expect, it } from 'vitest';
import { findSecrets, redactSecrets, REDACTED, sanitizeFiles } from '../src/lib/secrets';
import { failureText, formatMemories, MemoryRejected, prepareMemory, pruneMemories, rememberRequest, scoreMemory, selectMemories } from '../src/lib/memory';
import { executeRun, phaseCount } from '../src/lib/orchestrator';
import { localEndpointError, normalizeLocalEndpoint, pipeEnabled, defaultPipes } from '../src/lib/pipes';
import { commitMessageFor } from '../src/lib/connectors';
import type { MemoryEntry, Run, StartMessage } from '../src/lib/types';

const entry = (kind: MemoryEntry['kind'], text: string, extra: Partial<MemoryEntry> = {}): MemoryEntry => ({ ...prepareMemory(kind, text), ...extra });

describe('secret scanner', () => {
  it('finds vendor key shapes and leaves ordinary text alone', () => {
    expect(findSecrets('key sk-or-v1-abcdefghijklmnopqrstuvwxyz0123456789')).toHaveLength(1);
    expect(findSecrets('token ghp_abcdefghijklmnopqrstuvwxyz0123456789AB')).toHaveLength(1);
    expect(findSecrets('xai-abcdefghijklmnopqrstuvwxyz0123456789ABCD')).toHaveLength(1);
    expect(findSecrets('The commit 4f9c2a1b3d5e7f9012345678abcdef0123456789 fixed it.')).toHaveLength(0);
    expect(findSecrets('Ask for the skeleton, and ask again.')).toHaveLength(0);
  });
  it('matches the visitor’s own saved credentials exactly, whatever their shape', () => {
    expect(findSecrets('const k = "my-custom-key-123";', ['my-custom-key-123'])).toHaveLength(1);
  });
  it('redacts password assignments but not placeholders', () => {
    expect(redactSecrets('password = "hunter22"').text).toBe(`password = "${REDACTED}"`);
    expect(redactSecrets('API_KEY="YOUR_API_KEY"').count).toBe(0);
    expect(redactSecrets('apiKey: process.env.API_KEY').count).toBe(0);
  });
  it('reports which project files were touched', () => {
    const out = sanitizeFiles([{ path: 'a.js', content: 'const k = "sk-ant-abcdefghijklmnopqrstuvwxyz";' }, { path: 'b.js', content: 'ok' }]);
    expect(out.touched).toEqual(['a.js']);
    expect(out.files[0].content).toContain(REDACTED);
    expect(out.files[1].content).toBe('ok');
  });
});

describe('persistent memory', () => {
  it('refuses to store anything holding a secret', () => {
    expect(() => prepareMemory('preference', 'my OpenAI key is sk-proj-abcdefghijklmnopqrstuvwxyz0123456789')).toThrow(MemoryRejected);
    expect(() => prepareMemory('preference', 'the password: "correct-horse"')).toThrow(MemoryRejected);
    expect(() => prepareMemory('preference', 'I deploy on Render', ['Render'])).not.toThrow();
  });
  it('reads explicit remember requests only', () => {
    expect(rememberRequest('remember that I use pnpm, not npm.')).toBe('I use pnpm, not npm');
    expect(rememberRequest('Remember: tabs over spaces')).toBe('tabs over spaces');
    expect(rememberRequest('Do you remember the capital of France?')).toBeNull();
  });
  it('looks up only the memories that match, inside a budget', () => {
    const all = [entry('preference', 'Use pnpm for every JavaScript project'), entry('project', 'Built a Pomodoro timer in React'), entry('failure', 'Gemini refused an image request')];
    const picked = selectMemories('set up a new JavaScript project', all);
    expect(picked.map(m => m.text)).toEqual(['Use pnpm for every JavaScript project']);
    expect(selectMemories('weather tomorrow', all)).toEqual([]);
    expect(selectMemories('javascript project react pomodoro', all, { limit: 5, budget: 40 })).toHaveLength(1);
  });
  it('ranks a stated preference above a project note on the same words', () => {
    const pref = entry('preference', 'React components use Tailwind');
    const note = entry('project', 'React components use Tailwind');
    expect(scoreMemory('react tailwind', pref)).toBeGreaterThan(scoreMemory('react tailwind', note));
  });
  it('formats memories as labelled reference lines and prunes the stalest first', () => {
    expect(formatMemories([entry('preference', 'Use pnpm')])).toBe('[memory: preference] Use pnpm');
    const old = entry('project', 'old thing', { createdAt: '2020-01-01T00:00:00.000Z' });
    const used = entry('project', 'used thing', { hits: 5 });
    expect(pruneMemories([old, used], 1)).toEqual([old.id]);
    expect(failureText({ model: 'm', error: 'HTTP 429', request: 'hi' })).toContain('HTTP 429');
  });
});

describe('approval gates', () => {
  const message = (): StartMessage => ({ type: 'start', runId: crypto.randomUUID(), goal: 'Design a search box', workflow: 'build', connection: { mode: 'remote', endpoint: 'https://api.example.com/v1', model: 'test-model', token: 't', maxTokens: 512 }, knowledge: [], approvalGates: true });
  const ok = async () => ({ text: 'done', tokens: 1 });

  it('counts the build workflow as four phases', () => expect(phaseCount('build')).toBe(4));

  it('stops after every phase but the last and waits for approval', async () => {
    const gates: Run[] = [];
    const run = await executeRun(message(), new AbortController().signal, () => {}, ok, async r => { gates.push(r); });
    expect(run.status).toBe('completed');
    expect(gates.map(g => g.gate)).toEqual([{ phase: 1, phases: 4 }, { phase: 2, phases: 4 }, { phase: 3, phases: 4 }]);
    expect(gates.every(g => g.status === 'awaiting_approval')).toBe(true);
    // At the first gate only the planning step has run.
    expect(gates[0].steps.filter(s => s.status === 'completed').map(s => s.phase)).toEqual([0]);
  });

  it('spends nothing more once a gate is refused', async () => {
    const controller = new AbortController(); let calls = 0;
    const run = await executeRun(message(), controller.signal, () => {}, async () => { calls++; return { text: 'x', tokens: 1 }; }, async () => { controller.abort(new DOMException('Stopped', 'AbortError')); throw controller.signal.reason; });
    expect(run.status).toBe('cancelled');
    expect(calls).toBe(1);
  });

  it('runs straight through without gates when none are asked for', async () => {
    let gated = 0;
    const run = await executeRun({ ...message(), approvalGates: false }, new AbortController().signal, () => {}, ok, async () => { gated++; });
    expect(run.status).toBe('completed');
    expect(gated).toBe(0);
  });

  it('carries only memories matching the goal into the run', async () => {
    const run = await executeRun({ ...message(), approvalGates: false, memories: [entry('preference', 'Search boxes debounce input by 200ms'), entry('preference', 'I like gardening')] }, new AbortController().signal, () => {}, ok);
    expect(run.contextTitles).toEqual(['memory: preference']);
  });
});

describe('provider pipes', () => {
  it('only accepts this machine on Ollama’s port', () => {
    expect(localEndpointError('http://localhost:11434/v1')).toBe('');
    expect(localEndpointError('http://127.0.0.1:11434')).toBe('');
    expect(localEndpointError('http://192.168.1.4:11434/v1')).toMatch(/Only this machine/);
    expect(localEndpointError('http://localhost:8080/v1')).toMatch(/11434/);
    expect(normalizeLocalEndpoint('http://localhost:11434/')).toBe('http://localhost:11434/v1');
  });
  it('shows every hosted pipe by default and keeps Ollama off until switched on', () => {
    expect(pipeEnabled('openrouter', defaultPipes())).toBe(true);
    expect(pipeEnabled('ollama', defaultPipes())).toBe(false);
  });
});

describe('commit messages', () => {
  it('name the request and list the staged files', () => {
    const msg = commitMessageFor([{ path: 'index.html' }, { path: 'app.js' }], 'a pomodoro timer');
    expect(msg.split('\n')[0]).toBe('Add generated app: a pomodoro timer');
    expect(msg).toContain('- index.html\n- app.js');
  });
});
