import { z } from "zod";
import { requireViewer } from "../../../../lib/auth";
import { errorJson, json } from "../../../../lib/http";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { generateStudyPack, seedIfNeeded } from "../../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    budget_cards: z.number().int().min(1).max(200).optional(),
    budget_prompts: z.number().int().min(0).max(6).optional(),
    due_only: z.boolean().optional(),
    stretch_only: z.boolean().optional(),
  })
  .optional();

export async function POST(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const limited = await enforceRateLimit(viewer.ownerId, "generate", 20, 3600);
  if (limited) return limited;
  await seedIfNeeded(viewer.ownerId);
  let payload: unknown = {};
  const text = await request.text();
  if (text.trim()) {
    try {
      payload = JSON.parse(text);
    } catch {
      return errorJson("invalid json", 400);
    }
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return errorJson("invalid budget", 400);
  const pack = await generateStudyPack(
    viewer.ownerId,
    parsed.data?.budget_cards,
    parsed.data?.budget_prompts ?? 3,
    { dueOnly: parsed.data?.due_only === true, stretchOnly: parsed.data?.stretch_only === true },
  );
  return json(pack);
}
