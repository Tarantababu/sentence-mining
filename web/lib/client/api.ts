export type ReviewResult = "knew_it" | "shaky" | "missed";

export type StudyCard = {
  id: number;
  card_type: string;
  prompt: string;
  answer: string;
  why: string;
  queue?: "due" | "stretch";
  order_index: number;
};

export type SpeakingPrompt = {
  prompt: string;
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
  label: string;
  kind: string;
  stability_days: number;
  last_seen_at: string | null;
  next_review_at: string;
  p_k: number;
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
};

export type SessionLog = {
  id: number;
  ingested_at: string;
  source: string;
  error_count: number;
  preview: string;
  raw_log?: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    credentials: "same-origin",
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
  return response.json() as Promise<T>;
}

export const api = {
  health: () =>
    request<{
      status: string;
      openai_configured: boolean;
      has_personal_key?: boolean;
      viewer_name?: string | null;
    }>("/api/health"),
  ingest: (raw_log: string) =>
    request<IngestResponse>("/api/sessions/ingest", {
      method: "POST",
      body: JSON.stringify({ raw_log }),
    }),
  sessions: () => request<{ sessions: SessionLog[] }>("/api/sessions"),
  session: (id: number) => request<SessionLog>(`/api/sessions/${id}`),
  settings: () =>
    request<{ openai_configured: boolean; has_personal_key: boolean }>("/api/settings"),
  saveOpenAiKey: (api_key: string) =>
    request<{ saved: boolean; has_personal_key: boolean; openai_configured: boolean }>(
      "/api/settings/openai-key",
      { method: "PUT", body: JSON.stringify({ api_key }) },
    ),
  latestPack: async () => {
    const response = await fetch("/api/study-pack/latest", {
      credentials: "same-origin",
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
    request<{ review_id: number; card_id: number; result: ReviewResult }>("/api/reviews/submit", {
      method: "POST",
      body: JSON.stringify({ card_id, result }),
    }),
  units: () => request<{ units: UnitRow[]; now: string; due_count: number }>("/api/units"),
};
