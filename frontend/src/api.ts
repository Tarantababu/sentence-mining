export type ReviewResult = "knew_it" | "shaky" | "missed";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

export type StudyCard = {
  id: number;
  card_type: string;
  prompt: string;
  answer: string;
  why: string;
  unit_keys: string[];
  skill_tags: string[];
  order_index: number;
};

export type SpeakingPrompt = {
  prompt: string;
  unit_keys: string[];
  why: string;
};

export type StudyPack = {
  id: number;
  generated_at: string;
  budget_cards: number;
  budget_prompts: number;
  generator: string;
  cards: StudyCard[];
  speaking_prompts: SpeakingPrompt[];
};

export type UnitRow = {
  key: string;
  label: string;
  kind: string;
  skill_tags: string[];
  stability_days: number;
  p_k: number;
  urgency: number;
  error_count: number;
  success_count: number;
  is_recurring: boolean;
  is_focus: boolean;
  is_tracking: boolean;
};

export type IngestResponse = {
  session_id: number;
  error_count: number;
  vocab_count: number;
  tracking_count: number;
  focus_next_lesson: string | null;
  units_touched: string[];
  parser: string;
};

export type ReviewResponse = {
  review_id: number;
  card_id: number;
  result: ReviewResult;
  p_before: Record<string, number>;
  s_before: Record<string, number>;
  s_after: Record<string, number>;
  units: string[];
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = await response.text();
      if (body) detail = body;
    } catch {
      /* keep statusText */
    }
    throw new Error(detail);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const api = {
  health: () =>
    request<{ status: string; openai_configured: boolean; viewer_name?: string | null }>("/api/health"),
  ingest: (raw_log: string) =>
    request<IngestResponse>("/api/sessions/ingest", {
      method: "POST",
      body: JSON.stringify({ raw_log }),
    }),
  latestPack: async () => {
    const response = await fetch(`${API_BASE}/api/study-pack/latest`, {
      headers: { "Content-Type": "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<StudyPack>;
  },
  generatePack: () =>
    request<StudyPack>("/api/study-pack/generate", {
      method: "POST",
      body: JSON.stringify({ budget_cards: 8, budget_prompts: 3 }),
    }),
  submitReview: (card_id: number, result: ReviewResult) =>
    request<ReviewResponse>("/api/reviews/submit", {
      method: "POST",
      body: JSON.stringify({ card_id, result }),
    }),
  units: () => request<{ units: UnitRow[]; now: string }>("/api/units"),
};
