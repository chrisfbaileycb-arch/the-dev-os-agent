import superjson from "superjson";
import { z } from "zod";
import { schema, OutputType } from "./save_POST.schema";
import { db } from "../../helpers/db";
import { runRecord } from "../../helpers/runRecord";
import { getServerUserSession } from "../../helpers/getServerUserSession";
import { NotAuthenticatedError } from "../../helpers/getSetServerSession";

const reply = (status: number, body: unknown) => new Response(superjson.stringify(body), { status, headers: { "Content-Type": "application/json" } });

export async function handle(request: Request) {
  try {
    const { user } = await getServerUserSession(request);
    const input = schema.parse(superjson.parse(await request.text()));
    const existing = await db.selectFrom("runs").select("userId").where("id", "=", input.id).executeTakeFirst();
    if (existing && existing.userId !== user.id) return reply(403, { error: "This run belongs to another account." });
    const row = runRecord.toRunRow(input, user.id);
    const { id: _id, userId: _userId, ...updates } = row;
    const saved = await db
      .insertInto("runs")
      .values(row)
      .onConflict((oc) => oc.column("id").doUpdateSet(updates))
      .returningAll()
      .executeTakeFirstOrThrow();
    return reply(200, { run: runRecord.toRun(saved) } satisfies OutputType);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) return reply(401, { error: "Not authenticated" });
    if (error instanceof z.ZodError) return reply(400, { error: error.issues[0]?.message ?? "Invalid run." });
    console.error("runs save failure", error);
    return reply(500, { error: "Could not save the run." });
  }
}
