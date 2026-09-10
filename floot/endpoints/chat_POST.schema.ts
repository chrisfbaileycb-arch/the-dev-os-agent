import { z } from "zod";
import superjson from "superjson";

export const schema = z.object({
  provider: z.enum(["openrouter", "groq", "cohere", "custom"]),
  apiKey: z.string().max(8192).regex(/^[^\r\n]*$/, "Invalid API key format.").optional(),
  baseUrl: z.string().max(2048).optional(),
  model: z.string().trim().min(1, "A model identifier is required.").max(200),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(150_000) })).min(1).max(100),
  maxTokens: z.number().int().min(1).max(4096),
});

export type InputType = z.infer<typeof schema>;

export type OutputType = { text: string; tokens: number };

export class ChatRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ChatRequestError";
    this.status = status;
  }
}

export const postChat = async (body: InputType, init?: RequestInit): Promise<OutputType> => {
  const validatedInput = schema.parse(body);
  const result = await fetch(`/_api/chat`, {
    method: "POST",
    body: superjson.stringify(validatedInput),
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!result.ok) {
    let message = "Provider request failed.";
    try { message = superjson.parse<{ error: string }>(await result.text()).error; } catch { /* keep default */ }
    throw new ChatRequestError(message, result.status);
  }
  return superjson.parse<OutputType>(await result.text());
};
