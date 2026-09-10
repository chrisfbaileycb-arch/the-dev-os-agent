import superjson from "superjson";
import { z } from "zod";
import { schema, OutputType } from "./models_POST.schema";
import { proxyProvider } from "../helpers/proxyProvider";
import { getServerUserSession } from "../helpers/getServerUserSession";
import { NotAuthenticatedError } from "../helpers/getSetServerSession";

const reply = (status: number, body: unknown) =>
  new Response(superjson.stringify(body), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

export async function handle(request: Request) {
  try {
    await getServerUserSession(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const ids = await proxyProvider.listModels(input);
    return reply(200, { ids } satisfies OutputType);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) return reply(401, { error: "Sign in to load provider models." });
    if (error instanceof z.ZodError) return reply(400, { error: error.issues[0]?.message ?? "Invalid request." });
    if (error instanceof proxyProvider.ProxyError) return reply(error.status, { error: error.message });
    console.error("models proxy failure", error instanceof Error ? error.message : error);
    return reply(502, { error: "Could not load the model catalog." });
  }
}
