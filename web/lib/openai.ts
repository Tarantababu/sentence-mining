import "server-only";

import { z } from "zod";
import { openaiCallsInWindow, recordOpenAiCall } from "./rate-limit";
import { resolveOpenAiKey } from "./secrets";

const OPENAI_MAX_PER_HOUR = 20;
const DEFAULT_TIMEOUT_MS = 12_000;

export const generatedPackSchema = z.object({
  cards: z.array(
    z.object({
      card_type: z.enum(["fill_in_blank", "fix_error", "transform_sentence"]),
      prompt: z.string().min(1),
      answer: z.string().min(1),
      why: z.string(),
      unit_keys: z.array(z.string()).min(1).max(2),
    }),
  ),
  speaking_prompts: z
    .array(
      z.object({
        prompt: z.string().min(1),
        unit_keys: z.array(z.string()).min(1),
        why: z.string().optional().default(""),
      }),
    )
    .optional()
    .default([]),
});

export const parsedLogSchema = z.object({
  errors: z
    .array(
      z.object({
        raw_utterance: z.string(),
        corrected_utterance: z.string(),
        explanation: z.string().optional().default(""),
        is_recurring: z.boolean().optional().default(false),
      }),
    )
    .optional()
    .default([]),
  vocab: z
    .array(
      z.object({
        item: z.string(),
        example_usage: z.string().optional().default(""),
        used_well: z.boolean().optional().default(false),
      }),
    )
    .optional()
    .default([]),
  tracking: z.array(z.string()).optional().default([]),
  focus: z.array(z.string()).optional().default([]),
});

export function envOpenAiConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY?.trim());
}

export async function openaiConfigured(ownerId: string): Promise<boolean> {
  return Boolean(await resolveOpenAiKey(ownerId));
}

export function openaiModel(): string {
  return process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini";
}

function timeoutMs(): number {
  const seconds = Number(process.env.OPENAI_TIMEOUT_SECONDS || 12);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_TIMEOUT_MS;
  return Math.min(seconds, 30) * 1000;
}

export async function completeJson<S extends z.ZodTypeAny>(
  ownerId: string,
  system: string,
  user: string,
  schema: S,
  opts?: { timeoutMs?: number },
): Promise<z.output<S> | null> {
  const apiKey = await resolveOpenAiKey(ownerId);
  if (!apiKey) return null;
  if ((await openaiCallsInWindow(ownerId, 3600)) >= OPENAI_MAX_PER_HOUR) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts?.timeoutMs ?? timeoutMs());
  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: openaiModel(),
        temperature: 0.3,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!response.ok) return null;
    await recordOpenAiCall(ownerId);
    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content;
    if (!content) return null;
    return schema.parse(JSON.parse(content));
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
