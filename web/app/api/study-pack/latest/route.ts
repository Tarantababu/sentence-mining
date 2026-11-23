import { requireViewer } from "../../../../lib/auth";
import { errorJson, json } from "../../../../lib/http";
import { latestStudyPack, seedIfNeeded } from "../../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  await seedIfNeeded(viewer.ownerId);
  const pack = await latestStudyPack(viewer.ownerId);
  if (!pack) return errorJson("no study pack yet", 404);
  return json(pack);
}
