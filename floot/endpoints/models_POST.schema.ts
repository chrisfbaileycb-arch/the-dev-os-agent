import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  provider: z.enum(["openrouter", "groq", "cohere", "custom"]),
  apiKey: z.string().max(8192).regex(/^[^\r\n]*$/, "Invalid API key format.").optional(),
  baseUrl: z.string().max(2048).optional(),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = { ids: string[] };

export const postModels = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/models`, {
    method: "POST",
    body: superjson.stringify(validatedInput),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    const errorObject = superjson.parse<{ error: string }>(await result.text());
    throw new Error(errorObject.error);
  }
  return superjson.parse<OutputType>(await result.text());
};
