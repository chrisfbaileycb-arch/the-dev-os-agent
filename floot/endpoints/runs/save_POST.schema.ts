import { z } from "zod";
import superjson from "superjson";
import type { Run } from "../../helpers/runTypes";

const isoDate = z.string().max(40).refine((s) => !Number.isNaN(Date.parse(s)), "Invalid timestamp.");

const stepSchema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().max(200),
  agent: z.string().max(60),
  type: z.string().max(40),
  status: z.enum(["pending", "running", "completed", "failed", "cancelled"]),
  output: z.string().max(200_000).optional(),
  error: z.string().max(2000).optional(),
  attempts: z.number().int().min(0).max(10),
  dependencies: z.array(z.string().max(64)).max(10),
});

export const schema = z.object({
  id: z.string().min(1).max(64),
  goal: z.string().min(1).max(12_000),
  workflow: z.enum(["build", "research", "review"]),
  mode: z.enum(["demo", "remote"]),
  model: z.string().max(200),
  status: z.enum(["running", "completed", "failed", "cancelled", "interrupted"]),
  startedAt: isoDate,
  completedAt: isoDate.optional(),
  steps: z.array(stepSchema).max(5),
  tokens: z.number().int().min(0),
  calls: z.number().int().min(0),
  cacheHits: z.number().int().min(0),
  contextTitles: z.array(z.string().max(120)).max(10),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = { run: Run };

export const postRunsSave = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/runs/save`, { method: "POST", body: superjson.stringify(validatedInput), ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
