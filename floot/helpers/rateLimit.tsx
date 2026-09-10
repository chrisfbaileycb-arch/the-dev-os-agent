import { db } from "./db";

// Server-only. Fixed-window per-client limit backed by the rate_limits table, because
// endpoints are serverless and keep nothing in memory. Mirrors the original's
// 60 requests per minute per peer address.

const WINDOW_MS = 60_000;

function clientKey(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || request.headers.get("cf-connecting-ip") || "unknown";
  return `ip:${ip.slice(0, 64)}`;
}

export async function rateLimit(request: Request, limit = 60): Promise<{ allowed: boolean; remaining: number }> {
  const key = clientKey(request);
  const now = new Date();
  try {
    if (Math.random() < 0.05) {
      await db.deleteFrom("rateLimits").where("windowStart", "<", new Date(now.getTime() - 10 * WINDOW_MS)).execute();
    }
    const row = await db.selectFrom("rateLimits").selectAll().where("key", "=", key).executeTakeFirst();
    if (!row || now.getTime() - new Date(row.windowStart).getTime() > WINDOW_MS) {
      await db.insertInto("rateLimits").values({ key, windowStart: now, count: 1 })
        .onConflict((oc) => oc.column("key").doUpdateSet({ windowStart: now, count: 1 })).execute();
      return { allowed: true, remaining: limit - 1 };
    }
    if (row.count >= limit) return { allowed: false, remaining: 0 };
    await db.updateTable("rateLimits").set({ count: row.count + 1 }).where("key", "=", key).execute();
    return { allowed: true, remaining: limit - row.count - 1 };
  } catch (error) {
    // A limiter outage must not take the proxy down; log and allow.
    console.warn("rate limit check failed", error instanceof Error ? error.message : error);
    return { allowed: true, remaining: limit };
  }
}
