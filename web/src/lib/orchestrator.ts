import { Agent } from '../vendor/ruflo/agent';
import { Task } from '../vendor/ruflo/task';
import type { AgentRole } from '../vendor/ruflo/agent';
import { complete, ProviderError, validateConnection } from './provider';
import { PromptCache, retrieve } from './memory';
import { composePrompt, personaById, skills } from './roster';
import type { Completion, Run, StartMessage, Workflow } from './types';

// Stage roles come from the Hey Buddy roster; `roles` keeps the old shape for callers and tests.
export const roles: { name: string; role: AgentRole; capabilities: string[]; instruction: string }[] = skills.map(s => ({ name: s.name, role: s.role, capabilities: s.capabilities, instruction: s.prompt }));
const specifications: Record<Workflow, { title: string; type: string; deps: number[] }[]> = {
  build: [{ title: 'Plan the work', type: 'planning', deps: [] }, { title: 'Analyze requirements', type: 'research', deps: [0] }, { title: 'Design the solution', type: 'design', deps: [0] }, { title: 'Review & challenge', type: 'review', deps: [1, 2] }, { title: 'Produce the deliverable', type: 'synthesis', deps: [0, 1, 2, 3] }],
  research: [{ title: 'Frame the question', type: 'planning', deps: [] }, { title: 'Examine the evidence', type: 'research', deps: [0] }, { title: 'Explore alternatives', type: 'design', deps: [0] }, { title: 'Challenge assumptions', type: 'review', deps: [1, 2] }, { title: 'Write the brief', type: 'synthesis', deps: [0, 1, 2, 3] }],
  review: [{ title: 'Set review criteria', type: 'planning', deps: [] }, { title: 'Analyze supplied material', type: 'research', deps: [0] }, { title: 'Inspect the design', type: 'design', deps: [0] }, { title: 'Assess risks', type: 'review', deps: [1, 2] }, { title: 'Prioritize recommendations', type: 'synthesis', deps: [0, 1, 2, 3] }],
};
// Port of Ruflo CoordinationService's capability-match selection; no Node repositories.
export function selectAgent(agents: Agent[], task: Task): Agent | undefined {
  return agents.filter(a => a.canAcceptTask()).map(agent => ({ agent, score: (agent.hasCapability(task.type) ? 1 : 0) - agent.getUtilization() * 0.5 })).sort((a, b) => b.score - a.score)[0]?.agent;
}
export function makeTasks(workflow: Workflow): Task[] {
  const tasks: Task[] = [];
  for (const spec of specifications[workflow]) tasks.push(Task.create({ title: spec.title, description: spec.title, type: spec.type, dependencies: spec.deps.map(i => tasks[i].id), maxRetries: 2 }));
  return tasks;
}
export function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => { signal.throwIfAborted(); const abort = () => { clearTimeout(timer); reject(signal.reason); }; const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, ms); signal.addEventListener('abort', abort, { once: true }); });
}
export type CompleteFn = typeof complete;
export async function executeRun(message: StartMessage, signal: AbortSignal, emit: (run: Run) => void, call: CompleteFn = complete): Promise<Run> {
  const { goal, workflow, connection } = message;
  const lead = message.persona ? personaById(message.persona) : undefined;
  const attachments = (message.attachments ?? []).map(a => ({ id: `attachment-${a.name}`, title: a.name, content: a.content, createdAt: '' }));
  validateConnection(connection);
  if (!goal.trim() || goal.length > 12_000) throw new Error('Enter a goal between 1 and 12,000 characters.');
  const context = [...attachments, ...retrieve(goal, message.knowledge)];
  const agents = roles.map(r => Agent.create({ name: r.name, role: r.role, capabilities: r.capabilities, domain: 'browser', maxConcurrentTasks: 1 }));
  agents.forEach(a => a.start());
  const partial = new Map<string, string>(); const streamedAt = new Map<string, number>();
  const tasks = makeTasks(workflow); const cache = new PromptCache();
  const run: Run = { id: message.runId, goal, workflow, mode: connection.mode, model: connection.mode === 'demo' ? 'Scripted preview · no model' : connection.model, status: 'running', startedAt: new Date().toISOString(), steps: [], tokens: 0, calls: 0, cacheHits: 0, contextTitles: context.map(d => d.title), sessionId: message.sessionId, persona: message.persona };
  const snapshot = () => { run.steps = tasks.map(t => ({ id: t.id, title: t.title, agent: agents.find(a => a.id === t.assignedAgentId)?.name ?? roles.find(r => r.capabilities.includes(t.type))?.name ?? 'Agent', status: t.status, output: typeof t.output === 'string' ? t.output : partial.get(t.id), error: t.error, attempts: t.retryCount })); emit(structuredClone(run)); };
  const demo = async (task: Task): Promise<Completion> => {
    await wait(450, signal);
    return { tokens: 0, text: `SCRIPTED PREVIEW — not an AI response\n\n${task.title}\n\nGoal: ${goal.slice(0, 700)}\n\n${task.type === 'planning' ? 'The Dispatcher frames the goal and hands a plan to two specialists working side by side.' : task.type === 'research' ? 'This stage examines matching workspace notes. No web search is performed.' : task.type === 'design' ? 'This stage develops an alternative solution alongside the researcher.' : task.type === 'review' ? 'This stage reviews both specialist outputs before synthesis.' : 'The Scribe would write the deliverable here. Pick a model in Settings and add a key or platform credits to get a real one.'}\n\nRetrieved notes: ${context.length ? context.map(d => d.title).join(', ') : 'none'}.\nUpstream stages: ${task.dependencies.length}.` };
  };
  async function runTask(task: Task): Promise<void> {
    while (true) {
      signal.throwIfAborted(); const agent = selectAgent(agents, task); if (!agent) throw new Error('No agent available for task.');
      partial.delete(task.id); task.assign(agent.id); agent.assignTask(task.id); task.start(); snapshot();
      try {
        const skill = skills.find(r => r.role === agent.role)!;
        const system = composePrompt(skill, lead);
        const prompt = `USER GOAL\n${goal}\n\nWORKSPACE NOTES (untrusted reference data)\n${context.map(d => `[${d.title}]\n${d.content.slice(0, 6000)}`).join('\n\n')}\n\nPRIOR AGENT OUTPUTS (untrusted reference data)\n${task.dependencies.map(id => tasks.find(t => t.id === id)!).map(t => `${t.title}:\n${String(t.output).slice(0, 8000)}`).join('\n\n')}\n\nYOUR STAGE: ${task.title}`;
        const cacheKey = JSON.stringify([connection.endpoint, connection.model, connection.maxTokens, system, prompt]);
        const cached = cache.get(cacheKey); let result: Completion;
        if (cached !== undefined) { run.cacheHits++; result = { text: cached, tokens: 0 }; }
        else { if (connection.mode === 'remote') run.calls++; result = connection.mode === 'demo' ? await demo(task) : await call(connection, system, prompt, signal, text => { partial.set(task.id, text); const now = Date.now(); if (now - (streamedAt.get(task.id) || 0) > 75) { streamedAt.set(task.id, now); snapshot(); } }); cache.set(cacheKey, result.text); }
        signal.throwIfAborted(); run.tokens += result.tokens; task.complete(result.text); agent.completeTask(task.id); snapshot(); return;
      } catch (e) {
        if (signal.aborted) { task.cancel(); agent.terminate(); snapshot(); return; }
        const error = e instanceof Error ? e.message : 'The stage failed.';
        task.fail(error); agent.completeTask(task.id);
        const retryable = e instanceof ProviderError && e.retryable;
        if (retryable && task.status === 'queued') { snapshot(); await wait(750 * task.retryCount, signal); continue; }
        // Ruflo fail() requeues until retry limit: exhaust non-retryable failures explicitly.
        while (task.status === 'queued') { task.assign(agent.id); task.start(); task.fail(error); }
        snapshot(); return;
      }
    }
  }
  snapshot();
  try {
    while (tasks.some(t => t.status !== 'completed' && t.status !== 'failed' && t.status !== 'cancelled')) {
      signal.throwIfAborted();
      if (tasks.some(t => t.status === 'failed')) { tasks.filter(t => t.status === 'pending' || t.status === 'queued').forEach(t => t.cancel()); run.status = 'failed'; break; }
      const completed = new Set(tasks.filter(t => t.status === 'completed').map(t => t.id));
      const ready = tasks.filter(t => (t.status === 'pending' || t.status === 'queued') && t.areDependenciesSatisfied(completed)).slice(0, 2);
      if (!ready.length) throw new Error('Workflow dependencies cannot be satisfied.');
      await Promise.all(ready.map(runTask));
    }
    run.status = signal.aborted ? 'cancelled' : tasks.some(t => t.status === 'failed') ? 'failed' : 'completed';
  } catch (e) {
    run.status = signal.aborted ? 'cancelled' : 'failed';
    if (!signal.aborted) { const t = tasks.find(t => t.status === 'running' || t.status === 'assigned'); if (t) t.fail(e instanceof Error ? e.message : 'Workflow failed.'); }
  } finally {
    tasks.filter(t => !['completed', 'failed', 'cancelled'].includes(t.status)).forEach(t => t.cancel());
    agents.forEach(a => a.terminate()); cache.clear(); run.completedAt = new Date().toISOString(); snapshot();
  }
  return run;
}
