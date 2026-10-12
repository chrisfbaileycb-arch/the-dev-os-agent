import { expect, it, vi } from 'vitest';
import { executeRun } from '../src/lib/orchestrator';
import type { StartMessage } from '../src/lib/types';
const message: StartMessage = { type: 'start', runId: 'fixture', workflow: 'build', goal: 'Review the fixture repository', connection: { mode: 'remote', provider: 'openai', inference: 'byok', model: 'gpt-5', endpoint: 'https://api.openai.com/v1', token: 'fixture-key', maxTokens: 1000 }, knowledge: [], tools: [{ name: 'github_repo', description: 'github_repo {"repo":"owner/repo"}: read repository' }], approvalGates: true };
it('workflow stages offer connectors and consume tool results through the approval bridge', async () => {
  let calls = 0; const prompts: string[] = [];
  const call = vi.fn(async (_connection, system, prompt) => { prompts.push(prompt); expect(system).toContain('github_repo'); calls++; return { text: calls === 1 ? 'TOOL {"tool":"github_repo","args":{"repo":"fixture/repo"}}' : 'Verified stage result', tokens: 11 }; });
  const tool = vi.fn(async () => 'README evidence from the approved request');
  const gate = vi.fn(async () => {});
  const result = await executeRun(message, new AbortController().signal, () => {}, call, gate, tool);
  expect(result.status).toBe('completed'); expect(result.calls).toBe(6); expect(result.tokens).toBe(66);
  expect(tool).toHaveBeenCalledWith('github_repo', { repo: 'fixture/repo' }, expect.any(AbortSignal));
  expect(prompts[1]).toContain('README evidence from the approved request'); expect(gate).toHaveBeenCalled();
});
it('declining a workflow tool stops that stage and retains the model usage already spent', async () => {
  const result = await executeRun(message, new AbortController().signal, () => {}, async () => ({ text: 'TOOL {"tool":"github_repo","args":{}}', tokens: 17 }), undefined, async () => { throw new Error('Tool call declined by the user.'); });
  expect(result.status).toBe('failed'); expect(result.calls).toBe(1); expect(result.tokens).toBe(17);
  expect(result.steps.some(s => s.error?.includes('declined'))).toBe(true);
});
