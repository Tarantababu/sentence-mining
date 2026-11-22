import type { ReviewResult } from "./api";

export function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const matrix: number[][] = Array.from({ length: rows }, () => Array(cols).fill(0));
  for (let i = 0; i < rows; i += 1) matrix[i][0] = i;
  for (let j = 0; j < cols; j += 1) matrix[0][j] = j;
  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < cols; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(
        matrix[i - 1][j] + 1,
        matrix[i][j - 1] + 1,
        matrix[i - 1][j - 1] + cost,
      );
    }
  }
  return matrix[a.length][b.length];
}

export function autoGrade(guess: string, answer: string): ReviewResult {
  const g = normalize(guess);
  const a = normalize(answer);
  if (!g) return "missed";
  if (g === a) return "knew_it";
  const longest = Math.max(g.length, a.length);
  const ratio = longest === 0 ? 1 : 1 - levenshtein(g, a) / longest;
  if (ratio >= 0.72 || a.includes(g) || g.includes(a)) return "shaky";
  return "missed";
}

export const GRADE_COPY: Record<ReviewResult, { label: string; hint: string }> = {
  knew_it: { label: "Correct", hint: "Memory lengthened" },
  shaky: { label: "Close", hint: "A light boost to memory" },
  missed: { label: "Not quite", hint: "Memory shortened — back on the due list" },
};

export const CARD_TYPE_LABEL: Record<string, string> = {
  fill_in_blank: "Fill the blank",
  fix_error: "Fix the error",
  transform_sentence: "Transform",
};
