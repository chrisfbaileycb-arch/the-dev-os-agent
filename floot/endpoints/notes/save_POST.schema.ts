import { z } from "zod";
import superjson from "superjson";
import type { Note } from "../../helpers/runTypes";

export const schema = z.object({
  id: z.string().min(1).max(64),
  title: z.string().trim().min(1, "Give your note a title.").max(120),
  content: z.string().trim().min(1, "Add some content to the note.").max(50_000, "Notes are limited to 50,000 characters."),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = { note: Note };

export const postNotesSave = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/notes/save`, { method: "POST", body: superjson.stringify(validatedInput), ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
