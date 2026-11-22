import { requireViewer } from "../../../lib/auth";
import { json } from "../../../lib/http";
import { listSessionLogs, seedIfNeeded } from "../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  await seedIfNeeded(viewer.ownerId);
  return json({ sessions: await listSessionLogs(viewer.ownerId) });
}
