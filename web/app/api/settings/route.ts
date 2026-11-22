import { requireViewer } from "../../../lib/auth";
import { json } from "../../../lib/http";
import { openaiConfigured } from "../../../lib/openai";
import { hasPersonalOpenAiKey } from "../../../lib/secrets";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const hasPersonal = await hasPersonalOpenAiKey(viewer.ownerId);
  return json({
    openai_configured: await openaiConfigured(viewer.ownerId),
    has_personal_key: hasPersonal,
  });
}
