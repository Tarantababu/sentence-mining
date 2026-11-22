import "server-only";

import { sql } from "./db";

export async function getPersonalOpenAiKey(ownerId: string): Promise<string> {
  const rows = await sql<{ openai_api_key: string | null }>(
    "select openai_api_key from viewer_settings where owner_id = $1",
    [ownerId],
  );
  return rows[0]?.openai_api_key?.trim() ?? "";
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
  if (!trimmed) {
    await sql("delete from viewer_settings where owner_id = $1", [ownerId]);
    return;
  }
  await sql(
    `insert into viewer_settings (owner_id, openai_api_key, updated_at)
     values ($1, $2, now())
     on conflict (owner_id) do update set
       openai_api_key = excluded.openai_api_key,
       updated_at = now()`,
    [ownerId, trimmed],
  );
}
