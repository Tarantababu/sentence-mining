const KEY = "sentence-mining.streak";

type StreakState = {
  count: number;
  lastCompletedOn: string | null;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function yesterday(iso: string): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

export function readStreak(): StreakState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { count: 0, lastCompletedOn: null };
    const parsed = JSON.parse(raw) as StreakState;
    return {
      count: Number(parsed.count) || 0,
      lastCompletedOn: parsed.lastCompletedOn ?? null,
    };
  } catch {
    return { count: 0, lastCompletedOn: null };
  }
}

export function markSessionComplete(): StreakState {
  const current = readStreak();
  const day = today();
  if (current.lastCompletedOn === day) return current;
  const nextCount =
    current.lastCompletedOn && yesterday(day) === current.lastCompletedOn
      ? current.count + 1
      : current.count > 0
        ? 1
        : 1;
  const next = { count: Math.max(1, nextCount), lastCompletedOn: day };
  localStorage.setItem(KEY, JSON.stringify(next));
  return next;
}
