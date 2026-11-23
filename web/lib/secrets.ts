import "server-only";

import { sql } from "./db";

export type ViewerSettings = {
  openai_api_key: string | null;
  daily_limit: number | null;
};

function parseLimit(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) return null;
  return Math.min(n, 200);
}

export async function getViewerSettings(ownerId: string): Promise<ViewerSettings> {
  const rows = await sql<{ openai_api_key: string | null; daily_limit: number | null }>(
    "select openai_api_key, daily_limit from viewer_settings where owner_id = $1",
    [ownerId],
  );
  const row = rows[0];
  return {
    openai_api_key: row?.openai_api_key?.trim() || null,
    daily_limit: parseLimit(row?.daily_limit),
  };
}

export async function getPersonalOpenAiKey(ownerId: string): Promise<string> {
  return (await getViewerSettings(ownerId)).openai_api_key ?? "";
}

export async function resolveOpenAiKey(ownerId: string): Promise<string> {
  const personal = await getPersonalOpenAiKey(ownerId);
  if (personal) return personal;
  return process.env.OPENAI_API_KEY?.trim() ?? "";
}

export async function hasPersonalOpenAiKey(ownerId: string): Promise<boolean> {
  return Boolean(await getPersonalOpenAiKey(ownerId));
}

export async function savePersonalOpenAiKey(ownerId: string, apiKey: string | null): Promise<void> {
  const trimmed = apiKey?.trim() ?? "";
  await sql(
    `insert into viewer_settings (owner_id, openai_api_key, updated_at)
     values ($1, $2, now())
     on conflict (owner_id) do update set
       openai_api_key = excluded.openai_api_key,
       updated_at = now()`,
    [ownerId, trimmed || null],
  );
}

export async function saveDailyLimit(ownerId: string, dailyLimit: number | null): Promise<void> {
  await sql(
    `insert into viewer_settings (owner_id, daily_limit, updated_at)
     values ($1, $2, now())
     on conflict (owner_id) do update set
       daily_limit = excluded.daily_limit,
       updated_at = now()`,
    [ownerId, dailyLimit],
  );
}
