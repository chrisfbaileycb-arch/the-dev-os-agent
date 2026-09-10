import superjson from "superjson";
import type { Note } from "../../helpers/runTypes";

export type OutputType = { notes: Note[] };

export const getNotesList = async (init?: RequestInit): Promise<OutputType> => {
  const result = await fetch(`/_api/notes/list`, { method: "GET", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
