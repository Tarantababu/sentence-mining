export type ReviewResult = "knew_it" | "shaky" | "missed";

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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json", ...(init?.headers || {}) },
    ...init,
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || response.statusText);
  }
  return response.json() as Promise<T>;
}

export const api = {
  health: () => request<{ status: string; openai_configured: boolean }>("/api/health"),
  ingest: (raw_log: string) =>
    request<{ session_id: number; error_count: number; parser: string }>("/api/sessions/ingest", {
      method: "POST",
      body: JSON.stringify({ raw_log }),
    }),
  latestPack: () => request<StudyPack>("/api/study-pack/latest"),
  generatePack: () =>
    request<StudyPack>("/api/study-pack/generate", {
      method: "POST",
      body: JSON.stringify({ budget_cards: 8, budget_prompts: 3 }),
    }),
  submitReview: (card_id: number, result: ReviewResult) =>
    request("/api/reviews/submit", {
      method: "POST",
      body: JSON.stringify({ card_id, result }),
    }),
  units: () => request<{ units: UnitRow[] }>("/api/units"),
};
