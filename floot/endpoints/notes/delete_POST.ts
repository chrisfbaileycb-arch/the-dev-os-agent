import superjson from "superjson";
import { z } from "zod";
import { schema, OutputType } from "./delete_POST.schema";
import { db } from "../../helpers/db";
import { getServerUserSession } from "../../helpers/getServerUserSession";
import { NotAuthenticatedError } from "../../helpers/getSetServerSession";

const reply = (status: number, body: unknown) => new Response(superjson.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function handle(request: Request) {
  try {
    const { user } = await getServerUserSession(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const result = await db.deleteFrom("notes").where("id", "=", input.id).where("userId", "=", user.id).executeTakeFirst();
    return reply(200, { deleted: Number(result.numDeletedRows) > 0 } satisfies OutputType);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) return reply(401, { error: "Not authenticated" });
    if (error instanceof z.ZodError) return reply(400, { error: error.issues[0]?.message ?? "Invalid request." });
    console.error("notes delete failure", error);
    return reply(500, { error: "Could not delete the note." });
  }
}
