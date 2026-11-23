import { z } from "zod";
import { requireViewer } from "../../../lib/auth";
import { errorJson, json } from "../../../lib/http";
import { envOpenAiConfigured, openaiConfigured } from "../../../lib/openai";
import { getViewerSettings, hasPersonalOpenAiKey, saveDailyLimit } from "../../../lib/secrets";
import { remainingDailyBudget } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function settingsPayload(ownerId: string) {
  const hasPersonal = await hasPersonalOpenAiKey(ownerId);
  const hasHosted = envOpenAiConfigured();
  const configured = await openaiConfigured(ownerId);
  const { daily_limit } = await getViewerSettings(ownerId);
  const remaining = await remainingDailyBudget(ownerId);
  return {
    openai_configured: configured,
    has_personal_key: hasPersonal,
    has_hosted_key: hasHosted,
    api_key_set: configured,
    daily_limit,
    remaining_today: daily_limit == null ? null : remaining,
  };
}

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  return json(await settingsPayload(viewer.ownerId));
}

const bodySchema = z.object({
  daily_limit: z.number().int().min(1).max(200).nullable(),
});

export async function PUT(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorJson("invalid json", 400);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return errorJson("invalid daily limit", 400);
  await saveDailyLimit(viewer.ownerId, parsed.data.daily_limit);
  return json(await settingsPayload(viewer.ownerId));
}
