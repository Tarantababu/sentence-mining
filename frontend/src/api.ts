export type ReviewResult = "knew_it" | "shaky" | "missed";

const API_BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, "") ?? "";

export type StudyCard = {
  id: number;
  card_type: string;
  prompt: string;
  answer: string;
  why: string;
  unit_keys?: string[];
  skill_tags?: string[];
  queue?: "due" | "stretch";
  order_index: number;
};

export type SpeakingPrompt = {
  prompt: string;
  unit_keys?: string[];
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

export type DeckStats = {
  total_items: number;
  learning_now: number;
  waiting: number;
  learnt: number;
  due: number;
  new: number;
  learning: number;
  review: number;
  stretch: number;
  reps_today: number;
  reps_total: number;
  knew_it_today: number;
  shaky_today: number;
  missed_today: number;
  daily_limit: number | null;
  remaining_today: number | null;
};

export type UnitRow = {
  key?: string;
  label: string;
  kind: string;
  skill_tags?: string[];
  stability_days: number;
  last_seen_at: string | null;
  next_review_at: string;
  p_k: number;
  urgency?: number;
  due: boolean;
  queue: "due" | "stretch" | "upcoming";
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
  units_touched?: string[];
  parser?: string;
};

export type SessionLog = {
  id: number;
  ingested_at: string;
  source: string;
  error_count: number;
  preview: string;
  raw_log?: string;
};

export type ReviewResponse = {
  review_id: number;
  card_id: number;
  result: ReviewResult;
  p_before?: Record<string, number>;
  s_before?: Record<string, number>;
  s_after?: Record<string, number>;
  units?: string[];
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
  sessions: () => request<{ sessions: SessionLog[] }>("/api/sessions"),
  session: (id: number) => request<SessionLog>(`/api/sessions/${id}`),
  latestPack: async () => {
    const response = await fetch(`${API_BASE}/api/study-pack/latest`, {
      headers: { "Content-Type": "application/json" },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(await response.text());
    return response.json() as Promise<StudyPack>;
  },
  settings: () =>
    request<{
      openai_configured: boolean;
      has_personal_key: boolean;
      has_hosted_key: boolean;
      api_key_set: boolean;
      daily_limit: number | null;
      remaining_today: number | null;
    }>("/api/settings"),
  saveDailyLimit: (daily_limit: number | null) =>
    request<{ daily_limit: number | null; remaining_today: number | null; api_key_set: boolean }>(
      "/api/settings",
      { method: "PUT", body: JSON.stringify({ daily_limit }) },
    ),
  generatePack: (opts?: {
    budget_cards?: number;
    budget_prompts?: number;
    due_only?: boolean;
    stretch_only?: boolean;
  }) =>
    request<StudyPack>("/api/study-pack/generate", {
      method: "POST",
      body: JSON.stringify({
        ...(opts?.budget_cards != null ? { budget_cards: opts.budget_cards } : {}),
        budget_prompts: opts?.budget_prompts ?? 3,
        due_only: opts?.due_only === true,
        stretch_only: opts?.stretch_only === true,
      }),
    }),
  submitReview: (card_id: number, result: ReviewResult) =>
    request<ReviewResponse>("/api/reviews/submit", {
      method: "POST",
      body: JSON.stringify({ card_id, result }),
    }),
  units: () => request<{ units: UnitRow[]; now: string; due_count: number; stats: DeckStats }>("/api/units"),
};
