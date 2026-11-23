import { requireViewer } from "../../../lib/auth";
import { json } from "../../../lib/http";
import { openaiConfigured } from "../../../lib/openai";
import { hasPersonalOpenAiKey } from "../../../lib/secrets";
import { seedIfNeeded } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  await seedIfNeeded(viewer.ownerId);
  return json({
    status: "ok",
    openai_configured: await openaiConfigured(viewer.ownerId),
    has_personal_key: await hasPersonalOpenAiKey(viewer.ownerId),
    viewer_name: viewer.name || null,
  });
}
