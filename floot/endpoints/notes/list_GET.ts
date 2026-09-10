import superjson from "superjson";
import { OutputType } from "./list_GET.schema";
import { db } from "../../helpers/db";
import { runRecord } from "../../helpers/runRecord";
import { getServerUserSession } from "../../helpers/getServerUserSession";
import { NotAuthenticatedError } from "../../helpers/getSetServerSession";

export async function handle(request: Request) {
  try {
    const { user } = await getServerUserSession(request);
    const rows = await db.selectFrom("notes").selectAll().where("userId", "=", user.id).orderBy("createdAt", "desc").limit(100).execute();
    return new Response(superjson.stringify({ notes: rows.map(runRecord.toNote) } satisfies OutputType), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    if (error instanceof NotAuthenticatedError) return new Response(superjson.stringify({ error: "Not authenticated" }), { status: 401 });
    console.error("notes list failure", error);
    return new Response(superjson.stringify({ error: "Could not load notes." }), { status: 500 });
  }
}
