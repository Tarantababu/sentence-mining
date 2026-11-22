import { requireViewer } from "../../../lib/auth";
import { json } from "../../../lib/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  return json({ name: viewer.name, kind: viewer.kind });
}
