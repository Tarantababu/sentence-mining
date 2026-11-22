import { z } from "zod";
import { requireViewer } from "../../../../lib/auth";
import { errorJson, json } from "../../../../lib/http";
import { openaiConfigured } from "../../../../lib/openai";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { hasPersonalOpenAiKey, savePersonalOpenAiKey } from "../../../../lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  api_key: z.string().max(256),
});

export async function PUT(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const limited = await enforceRateLimit(viewer.ownerId, "save-key", 20, 3600);
  if (limited) return limited;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorJson("invalid json", 400);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return errorJson("invalid key", 400);
  const trimmed = parsed.data.api_key.trim();
  if (trimmed && trimmed.length < 12) return errorJson("key too short", 400);
  await savePersonalOpenAiKey(viewer.ownerId, trimmed || null);
  return json({
    saved: Boolean(trimmed),
    has_personal_key: await hasPersonalOpenAiKey(viewer.ownerId),
    openai_configured: await openaiConfigured(viewer.ownerId),
  });
}
