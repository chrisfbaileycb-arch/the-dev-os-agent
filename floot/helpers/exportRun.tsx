import type { Run } from "./runTypes";

export function exportRun(run: Run): string {
  const lines = [
    `# Hey Buddy - ${run.workflow} workflow`,
    "",
    `Mode: ${run.mode === "demo" ? "SCRIPTED PREVIEW - not AI-generated" : "Hosted inference"}`,
    `Model: ${run.model}`,
    `Status: ${run.status}`,
    `Started: ${run.startedAt}`,
    run.completedAt ? `Completed: ${run.completedAt}` : "",
    `Provider requests: ${run.calls}   Reported tokens: ${run.tokens}   Cache hits: ${run.cacheHits}`,
    run.contextTitles.length ? `Retrieved notes: ${run.contextTitles.join(", ")}` : "Retrieved notes: none",
    "",
    "## Goal",
    run.goal,
    "",
  ];
  for (const step of run.steps) {
    lines.push(`## ${step.title} (${step.agent}) - ${step.status}${step.attempts > 1 ? `, ${step.attempts} attempts` : ""}`);
    lines.push("");
    lines.push(step.output ?? (step.error ? `Error: ${step.error}` : "(no output)"));
    lines.push("");
  }
  return lines.filter((l, i, arr) => !(l === "" && arr[i - 1] === "")).join("\n");
}
