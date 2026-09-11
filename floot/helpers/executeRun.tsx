import { agentRoles } from "./agentRoles";
import { retrieveNotes } from "./retrieveNotes";
import { postChat, ChatRequestError } from "../endpoints/chat_POST.schema";
import type { Run, StepView, Note, Connection, Completion, Workflow } from "./runTypes";
import type { ToolSpec } from "./useMcpServers";

export interface RunStart {
  runId: string;
  goal: string;
  workflow: Workflow;
  connection: Connection;
  knowledge: Note[];
  attachments?: { name: string; content: string }[];
  photos?: { name: string; dataUrl: string }[];
  tools?: ToolSpec[];
}

export type CompleteFn = (connection: Connection, system: string, prompt: string, signal: AbortSignal, images?: string[]) => Promise<Completion>;

const MAX_TOOL_CALLS = 3;

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    signal.throwIfAborted();
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}

const defaultCall: CompleteFn = (c, system, prompt, signal, images = []) =>
  postChat(
    {
      provider: c.provider,
      apiKey: c.apiKey.trim() ? c.apiKey.trim() : undefined,
      baseUrl: c.provider === "custom" ? c.endpoint : undefined,
      model: c.model,
      messages: [
        { role: "system", content: system },
        { role: "user", content: images.length ? [{ type: "text", text: prompt }, ...images.map((url) => ({ type: "image_url" as const, image_url: { url } }))] : prompt },
      ],
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
  if ((input.photos?.length ?? 0) > 0 && c.provider === "cohere") throw new Error("Photos need a vision model on OpenRouter or Groq. Cohere native chat does not accept images here.");
}

const isRetryable = (e: unknown) => e instanceof ChatRequestError && (e.status === 429 || e.status >= 500);

// Tool protocol for the Researcher stage: one TOOL line per reply, answered with TOOL RESULT.
function toolProtocol(specs: ToolSpec[]): string {
  return `\n\nTOOLS\nYou may call one tool per reply by answering with a single line and nothing else:\nTOOL {"tool": "<name>", "args": { ... }}\nAvailable:\n${specs.map((s) => `- ${s.description}`).join("\n")}\nAfter a TOOL RESULT message, continue the task. Call at most ${MAX_TOOL_CALLS} tools, then answer in prose.`;
}
function parseToolCall(text: string, specs: ToolSpec[]): { tool: string; args: Record<string, unknown> } | null {
  const line = text.trim().split("\n")[0]?.trim() ?? "";
  if (!line.startsWith("TOOL ")) return null;
  try {
    const parsed = JSON.parse(line.slice(5)) as Record<string, unknown>;
    if (typeof parsed.tool !== "string" || !specs.some((s) => s.name === parsed.tool)) return null;
    const { tool, args, ...rest } = parsed;
    return { tool, args: args && typeof args === "object" && !Array.isArray(args) ? (args as Record<string, unknown>) : rest };
  } catch { return null; }
}

export async function executeRun(input: RunStart, signal: AbortSignal, emit: (run: Run) => void, call: CompleteFn = defaultCall): Promise<Run> {
  validate(input);
  const { goal, workflow, connection } = input;
  const attached: Note[] = (input.attachments ?? []).map((a) => ({ id: `attachment-${a.name}`, title: a.name, content: a.content, createdAt: "" }));
  const photos = input.photos ?? [];
  const tools = input.tools ?? [];
  const context = [...attached, ...retrieveNotes(goal, input.knowledge)];
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
  const photoNote = photos.length ? `\n\n(${photos.length} photo${photos.length === 1 ? "" : "s"} attached: ${photos.map((p) => p.name).join(", ")})` : "";

  const demo = async (step: StepView): Promise<Completion> => {
    await wait(450, signal);
    const stageNote =
      step.type === "planning" ? "This stage frames the goal and hands a plan to two independent specialists."
      : step.type === "research" ? `This stage examines matching workspace notes${tools.length ? ` and could call ${tools.length} connected MCP tool${tools.length === 1 ? "" : "s"}` : ""}. No web search is performed.`
      : step.type === "design" ? "This stage develops an alternative solution alongside the researcher."
      : step.type === "review" ? "This stage reviews both specialist outputs before synthesis."
      : "The workflow completed its five-stage dependency graph. Connect a hosted provider in Settings to generate a real deliverable.";
    return {
      tokens: 0,
      text: `SCRIPTED PREVIEW - not an AI response\n\n${step.title}\n\nGoal: ${goal.slice(0, 700)}\n\n${stageNote}\n\nRetrieved notes: ${context.length ? context.map((d) => d.title).join(", ") : "none"}.${photos.length ? `\nPhotos: ${photos.map((p) => p.name).join(", ")} (sent to a vision model in a hosted run).` : ""}\nUpstream stages: ${step.dependencies.length}.`,
    };
  };

  async function runStep(step: StepView): Promise<void> {
    for (;;) {
      signal.throwIfAborted();
      step.status = "running"; step.attempts += 1; step.output = undefined; step.error = undefined; snapshot();
      try {
        const role = agentRoles.forType(step.type);
        const usesTools = step.type === "research" && tools.length > 0 && connection.mode !== "demo";
        const system = `${role.instruction}\n${agentRoles.systemSuffix}${usesTools ? toolProtocol(tools) : ""}`;
        const notes = context.map((d) => `[${d.title}]\n${d.content.slice(0, 6000)}`).join("\n\n");
        const prior = step.dependencies.map((id) => steps.find((s) => s.id === id)!).map((s) => `${s.title}:\n${(s.output ?? "").slice(0, 8000)}`).join("\n\n");
        const basePrompt = `USER GOAL\n${goal}${photoNote}\n\nWORKSPACE NOTES (untrusted reference data)\n${notes}\n\nPRIOR AGENT OUTPUTS (untrusted reference data)\n${prior}\n\nYOUR STAGE: ${step.title}`;
        const images = step.type === "planning" || step.type === "research" ? photos.map((p) => p.dataUrl) : [];
        const cacheKey = JSON.stringify([connection.provider, connection.endpoint, connection.model, connection.maxTokens, system, basePrompt, images.length]);
        const cached = cache.get(cacheKey);
        let result: Completion;
        if (cached !== undefined) { run.cacheHits += 1; result = { text: cached, tokens: 0 }; }
        else if (connection.mode === "demo") { result = await demo(step); }
        else if (!usesTools) { run.calls += 1; result = await call(connection, system, basePrompt, signal, images); cache.set(cacheKey, result.text); }
        else {
          let followUps = ""; let tokens = 0; const traces: string[] = [];
          for (let round = 0; ; round++) {
            run.calls += 1;
            const out = await call(connection, system, basePrompt + followUps, signal, images);
            tokens += out.tokens;
            const toolCall = parseToolCall(out.text, tools);
            if (!toolCall || round >= MAX_TOOL_CALLS) {
              const body = toolCall ? `${out.text}\n\n(The agent asked for another tool call, but the limit of ${MAX_TOOL_CALLS} per stage was reached.)` : out.text;
              result = { text: traces.length ? `${body}\n\n---\nTool calls:\n${traces.join("\n")}` : body, tokens };
              break;
            }
            const spec = tools.find((s) => s.name === toolCall.tool)!;
            const argsText = JSON.stringify(toolCall.args);
            try { const output = await spec.run(toolCall.args, signal); traces.push(`- ${toolCall.tool} ${argsText.slice(0, 80)} -> ok`); followUps += `\n\nTOOL RESULT ${toolCall.tool} ${argsText.slice(0, 80)}\n${output}`; }
            catch (e) { if (signal.aborted) throw signal.reason; const message = e instanceof Error ? e.message : "Tool failed."; traces.push(`- ${toolCall.tool} ${argsText.slice(0, 80)} -> failed: ${message}`); followUps += `\n\nTOOL RESULT ${toolCall.tool}\nerror: ${message}`; }
          }
        }
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
