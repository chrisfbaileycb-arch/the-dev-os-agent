# Render setup: free tier, durable storage

Two settings on the live `hey-buddy-web` service. Neither needs a code change. Enter secrets in
the Render dashboard (Environment), never in chat or in this repository.

## Connect Groq to the free tier

The free tier already knows two Groq models (`server/freetier.mjs`): `llama-3.3-70b-versatile`
and `llama-3.1-8b-instant`. They appear as soon as the deployment holds a key.

1. Create a key at console.groq.com.
2. Render > hey-buddy-web > Environment > add `GROQ_API_KEY`. Save; the service restarts.
3. Optional: Groq's limits are higher than the xKiro gateway's, so `FREE_MAX_OUTPUT_TOKENS`
   (default 1024, ceiling 4096) can be raised, for example to 2048, so most generated pages finish
   in one call instead of needing continuation calls. Every free reply is funded from the
   deployment's own quota, so raise it gradually and watch usage.

The xKiro key can stay set. Free models from every configured provider are listed together.

## Keep sessions, ledger and quota across restarts

The live boot log reads `Workspace data: /tmp/heybuddy.sqlite`. `/tmp` is wiped on every restart
and redeploy, so the server's record of sessions, runs, the credit ledger and the free-tier
monthly quota resets each time. Browsers keep their own IndexedDB copy, which is why history
still shows for returning visitors, but a paid product cannot rely on that.

**Option A, a Render disk (simplest).** The service is on a paid instance, which can attach one.

1. Render > hey-buddy-web > Disks > Add disk. Mount path `/var/data`, size 1 GB is plenty.
2. Environment: set `DATA_FILE` to `/var/data/heybuddy.sqlite`.
3. Save. The service redeploys and keeps its SQLite file from then on.

Trade-offs: a service with a disk runs a single instance and redeploys with a short gap.

**Option B, Postgres.** The server already uses Postgres whenever `DATABASE_URL` is set
(`server/index.mjs`). Create a Render Postgres instance, set `DATABASE_URL` from its internal
connection string, and the disk is not needed. Check the current terms of Render's free Postgres
plan before relying on it for data you want to keep.

Either way, confirm afterwards: the next boot log should no longer say `/tmp/heybuddy.sqlite`.
