import { agentRoles } from "./agentRoles";
import { retrieveNotes } from "./retrieveNotes";
import { postChat, ChatRequestError } from "../endpoints/chat_POST.schema";
import type { Run, StepView, Note, Connection, Completion, Workflow } from "./runTypes";

export interface RunStart {
  runId: string;
  goal: string;
  workflow: Workflow;
  connection: Connection;
  knowledge: Note[];
}

export type CompleteFn = (connection: Connection, system: string, prompt: string, signal: AbortSignal) => Promise<Completion>;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

const defaultCall: CompleteFn = (c, system, prompt, signal) =>
  postChat(
    {
      provider: c.provider,
      apiKey: c.apiKey.trim() ? c.apiKey.trim() : undefined,
      baseUrl: c.provider === "custom" ? c.endpoint : undefined,
      model: c.model,
      messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
      maxTokens: c.maxTokens,
    },
    { signal },
  );

function validate(input: RunStart): void {
  const c = input.connection;
  if (!input.goal.trim() || input.goal.length > 12_000) throw new Error("Enter a goal between 1 and 12,000 characters.");
  if (c.mode === "demo") return;
  if (c.provider === "custom") {
    let url: URL;
    try { url = new URL(c.endpoint); } catch { throw new Error("Enter a valid custom API base URL in Settings."); }
    if (url.protocol !== "https:") throw new Error("Custom APIs must use HTTPS.");
  }
  if (!c.model.trim() || c.model.length > 200) throw new Error("Choose a model in Settings before launching a hosted run.");
  if (!Number.isInteger(c.maxTokens) || c.maxTokens < 64 || c.maxTokens > 4096) throw new Error("Output limit must be between 64 and 4096 tokens.");
}

const isRetryable = (e: unknown) => e instanceof ChatRequestError && (e.status === 429 || e.status >= 500);

export async function executeRun(input: RunStart, signal: AbortSignal, emit: (run: Run) => void, call: CompleteFn = defaultCall): Promise<Run> {
  validate(input);
  const { goal, workflow, connection } = input;
  const context = retrieveNotes(goal, input.knowledge);
  const specs = agentRoles.workflows[workflow];
  const steps: StepView[] = [];
  for (const spec of specs) {
    steps.push({
      id: crypto.randomUUID(),
      title: spec.title,
      agent: agentRoles.forType(spec.type).name,
      type: spec.type,
      status: "pending",
      attempts: 0,
      dependencies: spec.deps.map((i) => steps[i].id),
    });
  }
  const run: Run = {
    id: input.runId,
    goal,
    workflow,
    mode: connection.mode,
    model: connection.mode === "demo" ? "Scripted preview" : connection.model,
    status: "running",
    startedAt: new Date().toISOString(),
    steps,
    tokens: 0,
    calls: 0,
    cacheHits: 0,
    contextTitles: context.map((d) => d.title),
  };
  const cache = new Map<string, string>();
  const snapshot = () => emit(structuredClone(run));

  const demo = async (step: StepView): Promise<Completion> => {
    await wait(450, signal);
    const stageNote =
      step.type === "planning" ? "This stage frames the goal and hands a plan to two independent specialists."
      : step.type === "research" ? "This stage examines matching workspace notes. No web search is performed."
      : step.type === "design" ? "This stage develops an alternative solution alongside the researcher."
      : step.type === "review" ? "This stage reviews both specialist outputs before synthesis."
      : "The workflow completed its five-stage dependency graph. Connect a hosted provider in Settings to generate a real deliverable.";
    return {
      tokens: 0,
      text: `SCRIPTED PREVIEW - not an AI response\n\n${step.title}\n\nGoal: ${goal.slice(0, 700)}\n\n${stageNote}\n\nRetrieved notes: ${context.length ? context.map((d) => d.title).join(", ") : "none"}.\nUpstream stages: ${step.dependencies.length}.`,
    };
  };

  async function runStep(step: StepView): Promise<void> {
    for (;;) {
      signal.throwIfAborted();
      step.status = "running"; step.attempts += 1; step.output = undefined; step.error = undefined; snapshot();
      try {
        const role = agentRoles.forType(step.type);
        const system = `${role.instruction}\n${agentRoles.systemSuffix}`;
        const notes = context.map((d) => `[${d.title}]\n${d.content.slice(0, 6000)}`).join("\n\n");
        const prior = step.dependencies.map((id) => steps.find((s) => s.id === id)!).map((s) => `${s.title}:\n${(s.output ?? "").slice(0, 8000)}`).join("\n\n");
        const prompt = `USER GOAL\n${goal}\n\nWORKSPACE NOTES (untrusted reference data)\n${notes}\n\nPRIOR AGENT OUTPUTS (untrusted reference data)\n${prior}\n\nYOUR STAGE: ${step.title}`;
        const cacheKey = JSON.stringify([connection.provider, connection.endpoint, connection.model, connection.maxTokens, system, prompt]);
        const cached = cache.get(cacheKey);
        let result: Completion;
        if (cached !== undefined) { run.cacheHits += 1; result = { text: cached, tokens: 0 }; }
        else if (connection.mode === "demo") { result = await demo(step); }
        else { run.calls += 1; result = await call(connection, system, prompt, signal); cache.set(cacheKey, result.text); }
        signal.throwIfAborted();
        run.tokens += result.tokens; step.status = "completed"; step.output = result.text; snapshot();
        return;
      } catch (e) {
        if (signal.aborted) { step.status = "cancelled"; snapshot(); return; }
        const message = e instanceof Error ? e.message : "The stage failed.";
        if (isRetryable(e) && step.attempts < 3) { step.status = "pending"; step.error = message; snapshot(); await wait(750 * step.attempts, signal); continue; }
        step.status = "failed"; step.error = message; snapshot();
        return;
      }
    }
  }

  snapshot();
  try {
    while (steps.some((s) => s.status === "pending" || s.status === "running")) {
      signal.throwIfAborted();
      if (steps.some((s) => s.status === "failed")) { steps.filter((s) => s.status === "pending").forEach((s) => { s.status = "cancelled"; }); break; }
      const done = new Set(steps.filter((s) => s.status === "completed").map((s) => s.id));
      const ready = steps.filter((s) => s.status === "pending" && s.dependencies.every((d) => done.has(d))).slice(0, 2);
      if (!ready.length) throw new Error("Workflow dependencies cannot be satisfied.");
      await Promise.all(ready.map(runStep));
    }
    run.status = signal.aborted ? "cancelled" : steps.some((s) => s.status === "failed") ? "failed" : "completed";
  } catch (e) {
    run.status = signal.aborted ? "cancelled" : "failed";
    if (!signal.aborted) { const t = steps.find((s) => s.status === "running"); if (t) { t.status = "failed"; t.error = e instanceof Error ? e.message : "Workflow failed."; } }
  } finally {
    steps.filter((s) => s.status === "pending" || s.status === "running").forEach((s) => { s.status = "cancelled"; });
    cache.clear();
    run.completedAt = new Date().toISOString();
    snapshot();
  }
  return run;
}
