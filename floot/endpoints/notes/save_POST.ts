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
    const existing = await db.selectFrom("notes").select("userId").where("id", "=", input.id).executeTakeFirst();
    if (existing && existing.userId !== user.id) return reply(403, { error: "This note belongs to another account." });
    if (!existing) {
      const count = await db.selectFrom("notes").select(({ fn }) => fn.countAll<number>().as("n")).where("userId", "=", user.id).executeTakeFirstOrThrow();
      if (Number(count.n) >= 100) return reply(400, { error: "Workspace limit: 100 notes. Remove an old note first." });
    }
    const saved = await db
      .insertInto("notes")
      .values({ id: input.id, userId: user.id, title: input.title, content: input.content })
      .onConflict((oc) => oc.column("id").doUpdateSet({ title: input.title, content: input.content }))
      .returningAll()
      .executeTakeFirstOrThrow();
    return reply(200, { note: runRecord.toNote(saved) } satisfies OutputType);
  } catch (error) {
    if (error instanceof NotAuthenticatedError) return reply(401, { error: "Not authenticated" });
    if (error instanceof z.ZodError) return reply(400, { error: error.issues[0]?.message ?? "Invalid note." });
    console.error("notes save failure", error);
    return reply(500, { error: "Could not save the note." });
  }
}
