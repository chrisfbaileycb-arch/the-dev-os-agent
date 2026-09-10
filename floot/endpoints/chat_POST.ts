import superjson from "superjson";
import { z } from "zod";
import { schema, OutputType } from "./chat_POST.schema";
import { proxyProvider } from "../helpers/proxyProvider";
import { rateLimit } from "../helpers/rateLimit";

const reply = (status: number, body: unknown) =>
  new Response(superjson.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function handle(request: Request) {
  try {
    const limit = await rateLimit(request);
    if (!limit.allowed) return reply(429, { error: "Proxy request limit reached. Wait one minute." });
    const raw = await request.text();
    if (raw.length > 512_000) return reply(413, { error: "Request is too large." });
    const input = schema.parse(superjson.parse(raw));
    const completion = await proxyProvider.chat({
      provider: input.provider,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      model: input.model,
      messages: input.messages,
      maxTokens: input.maxTokens,
    });
    return reply(200, completion satisfies OutputType);
  } catch (error) {
    if (error instanceof z.ZodError) return reply(400, { error: error.issues[0]?.message ?? "Invalid request." });
    if (error instanceof proxyProvider.ProxyError) return reply(error.status, { error: error.message });
    console.error("chat proxy failure", error instanceof Error ? error.message : error);
    return reply(502, { error: "Could not complete the provider request." });
  }
}
