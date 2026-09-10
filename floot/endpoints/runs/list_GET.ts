import superjson from "superjson";
import { OutputType } from "./list_GET.schema";
import { db } from "../../helpers/db";
import { runRecord } from "../../helpers/runRecord";
import { getServerUserSession } from "../../helpers/getServerUserSession";
import { NotAuthenticatedError } from "../../helpers/getSetServerSession";

export async function handle(request: Request) {
  try {
    const { user } = await getServerUserSession(request);
    const rows = await db.selectFrom("runs").selectAll().where("userId", "=", user.id).orderBy("startedAt", "desc").limit(200).execute();
    return new Response(superjson.stringify({ runs: rows.map(runRecord.toRun) } satisfies OutputType), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    if (error instanceof NotAuthenticatedError) return new Response(superjson.stringify({ error: "Not authenticated" }), { status: 401 });
    console.error("runs list failure", error);
    return new Response(superjson.stringify({ error: "Could not load run history." }), { status: 500 });
  }
}
