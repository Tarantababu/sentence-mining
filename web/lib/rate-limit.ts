import "server-only";

import { sql } from "./db";
import { errorJson } from "./http";

function cutoff(windowSeconds: number): Date {
  return new Date(Date.now() - windowSeconds * 1000);
}

export async function enforceRateLimit(
  ownerId: string,
  route: string,
  max: number,
  windowSeconds: number,
): Promise<Response | null> {
  const rows = await sql<{ n: string | number }>(
    `select count(*)::int as n from rate_events
     where owner_id = $1 and route = $2 and called_at > $3`,
    [ownerId, route, cutoff(windowSeconds)],
  );
  const n = Number(rows[0]?.n ?? 0);
  if (n >= max) {
    return errorJson("rate limit exceeded", 429);
  }
  await sql("insert into rate_events (owner_id, route) values ($1, $2)", [ownerId, route]);
  return null;
}

export async function openaiCallsInWindow(ownerId: string, windowSeconds: number): Promise<number> {
  const rows = await sql<{ n: string | number }>(
    `select count(*)::int as n from rate_events
     where owner_id = $1 and route = 'openai' and called_at > $2`,
    [ownerId, cutoff(windowSeconds)],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function recordOpenAiCall(ownerId: string): Promise<void> {
  await sql("insert into rate_events (owner_id, route) values ($1, $2)", [ownerId, "openai"]);
}
