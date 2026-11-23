import { requireViewer } from "../../../../lib/auth";
import { errorJson, json } from "../../../../lib/http";
import { getSessionLog } from "../../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const { id } = await context.params;
  const sessionId = Number(id);
  if (!Number.isInteger(sessionId) || sessionId < 1) return errorJson("not found", 404);
  const session = await getSessionLog(viewer.ownerId, sessionId);
  if (!session) return errorJson("not found", 404);
  return json(session);
}
