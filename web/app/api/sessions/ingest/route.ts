import { z } from "zod";
import { requireViewer } from "../../../../lib/auth";
import { errorJson, json } from "../../../../lib/http";
import { enforceRateLimit } from "../../../../lib/rate-limit";
import { ingestSession, seedIfNeeded } from "../../../../lib/store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const bodySchema = z.object({
  raw_log: z.string().min(1).max(20_000),
});

export async function POST(request: Request) {
  const viewer = await requireViewer(request);
  if (viewer instanceof Response) return viewer;
  const limited = await enforceRateLimit(viewer.ownerId, "ingest", 30, 3600);
  if (limited) return limited;
  await seedIfNeeded(viewer.ownerId);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorJson("invalid json", 400);
  }
  const parsedBody = bodySchema.safeParse(payload);
  if (!parsedBody.success) return errorJson("invalid log", 400);
  const { sessionId, parsed } = await ingestSession(viewer.ownerId, parsedBody.data.raw_log, "paste");
  return json({
    session_id: sessionId,
    error_count: parsed.errors.length,
    vocab_count: parsed.vocab.length,
    tracking_count: parsed.tracking.length,
    focus_next_lesson: parsed.focus_lines.join("\n") || null,
  });
}
