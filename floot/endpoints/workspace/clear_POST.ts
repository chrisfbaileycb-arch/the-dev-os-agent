import superjson from "superjson";
import { z } from "zod";
import { schema, OutputType } from "./clear_POST.schema";
import { db } from "../../helpers/db";
import { getServerUserSession } from "../../helpers/getServerUserSession";
import { NotAuthenticatedError } from "../../helpers/getSetServerSession";

const reply = (status: number, body: unknown) => new Response(superjson.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function handle(request: Request) {
  try {
    const { user } = await getServerUserSession(request);
    schema.parse(superjson.parse(await request.text()));
    const runs = await db.deleteFrom("runs").where("userId", "=", user.id).executeTakeFirst();
    const notes = await db.deleteFrom("notes").where("userId", "=", user.id).executeTakeFirst();
    return reply(200, { runsDeleted: Number(runs.numDeletedRows), notesDeleted: Number(notes.numDeletedRows) } satisfies OutputType);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) return reply(401, { error: "Not authenticated" });
    if (error instanceof z.ZodError) return reply(400, { error: "Confirmation required." });
    console.error("workspace clear failure", error);
    return reply(500, { error: "Could not clear the workspace." });
  }
}
