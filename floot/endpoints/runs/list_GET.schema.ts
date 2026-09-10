import superjson from "superjson";
import type { Run } from "../../helpers/runTypes";

export type OutputType = { runs: Run[] };

export const getRunsList = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/runs/list`, { method: "GET", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
