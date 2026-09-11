import { z } from "zod";
import superjson from "superjson";

// Message content is plain text, or OpenAI-style parts: text plus up to five bounded images
// (data URLs resized in the browser, or https links) for vision models.
const imageUrl = z.string().max(3_000_000).regex(/^(data:image\/(jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]+|https:\/\/\S{1,2000})$/, "Images must be jpeg, png, webp, or gif data URLs, or https links.");
const part = z.union([
  z.object({ type: z.literal("text"), text: z.string().max(150_000) }),
  z.object({ type: z.literal("image_url"), image_url: z.object({ url: imageUrl }) }),
]);
const content = z.union([
  z.string().max(150_000),
  z.array(part).min(1).max(8).refine((parts) => parts.filter((p) => p.type === "image_url").length <= 5, "Up to five images per message."),
]);

export const schema = z.object({
  provider: z.enum(["openrouter", "groq", "cohere", "custom"]),
  apiKey: z.string().max(8192).regex(/^[^\r\n]*$/, "Invalid API key format.").optional(),
  baseUrl: z.string().max(2048).optional(),
  model: z.string().trim().min(1, "A model identifier is required.").max(200),
  messages: z.array(z.object({ role: z.enum(["system", "user", "assistant"]), content })).min(1).max(100),
  maxTokens: z.number().int().min(1).max(4096),
});

export type InputType = z.infer<typeof schema>;
export type ChatContent = z.infer<typeof content>;

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
