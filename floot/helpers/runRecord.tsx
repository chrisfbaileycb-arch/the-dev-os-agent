import type { Selectable } from "kysely";
import type { Runs, Notes, Json } from "./schema";
import type { Run, Note, StepView } from "./runTypes";

// Server-only mapping between database rows and the shared Run / Note shapes.

function toRun(row: Selectable<Runs>): Run {
  return {
    id: row.id,
    goal: row.goal,
    workflow: row.workflow,
    mode: row.mode,
    model: row.model,
    status: row.status,
    startedAt: new Date(row.startedAt).toISOString(),
    completedAt: row.completedAt ? new Date(row.completedAt).toISOString() : undefined,
    steps: (Array.isArray(row.steps) ? row.steps : []) as unknown as StepView[],
    tokens: row.tokens,
    calls: row.calls,
    cacheHits: row.cacheHits,
    contextTitles: (Array.isArray(row.contextTitles) ? row.contextTitles : []) as unknown as string[],
  };
}

function toRunRow(run: Run, userId: number) {
  return {
    id: run.id,
    userId,
    goal: run.goal,
    workflow: run.workflow,
    mode: run.mode,
    model: run.model,
    status: run.status,
    startedAt: new Date(run.startedAt),
    completedAt: run.completedAt ? new Date(run.completedAt) : null,
    steps: run.steps as unknown as Json,
    tokens: run.tokens,
    calls: run.calls,
    cacheHits: run.cacheHits,
    contextTitles: run.contextTitles as unknown as Json,
    updatedAt: new Date(),
  };
}

function toNote(row: Selectable<Notes>): Note {
  return { id: row.id, title: row.title, content: row.content, createdAt: new Date(row.createdAt).toISOString() };
}

export const runRecord = { toRun, toRunRow, toNote };
