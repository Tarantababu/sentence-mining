import { z } from "zod";
import { requireViewer } from "../../../../lib/auth";
import { errorJson, json } from "../../../../lib/http";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { seedIfNeeded, submitReview } from "../../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  card_id: z.number().int().positive(),
  result: z.enum(["knew_it", "shaky", "missed"]),
});

export async function POST(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const limited = await enforceRateLimit(viewer.ownerId, "review", 120, 3600);
  if (limited) return limited;
  await seedIfNeeded(viewer.ownerId);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorJson("invalid json", 400);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return errorJson("invalid review", 400);
  const review = await submitReview(viewer.ownerId, parsed.data.card_id, parsed.data.result);
  if (!review) return errorJson("card not found", 404);
  return json(review);
}
