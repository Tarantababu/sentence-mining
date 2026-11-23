export function tokenize(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/^(complete:|fix:|rewrite[^:]*:)\s*/i, "")
    .replace(/[^\w\s']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function wordCount(text: string): number {
  return tokenize(text).length;
}

export function isCompleteSentence(text: string): boolean {
  const words = wordCount(text);
  return words >= 8 || (words >= 6 && /[.?!]/.test(text));
}

export function isDistinctPair(raw: string, correct: string): boolean {
  const left = normalize(raw);
  const right = normalize(correct);
  return Boolean(left && right && left !== right);
}

export function tokenOverlap(left: string, right: string): number {
  const a = new Set(tokenize(normalize(left)).filter((word) => word.length > 1));
  const b = tokenize(normalize(right)).filter((word) => word.length > 1);
  if (!a.size || !b.length) return 0;
  const hits = b.filter((word) => a.has(word)).length;
  return hits / Math.max(b.length, 1);
}

const DUMMY_CARRIER =
  /in a short everyday sentence|\bi will mention\b|\bi'll mention\b|keep the surrounding english simple|before dinner/i;

export function isDummyCarrier(text: string): boolean {
  return DUMMY_CARRIER.test(text);
}

export function isWrappedSentence(text: string, inner: string): boolean {
  const clause = normalize(inner);
  const haystack = normalize(text);
  if (!clause || wordCount(clause) < 6 || !haystack.includes(clause)) return false;
  const extra = haystack.replace(clause, " ").trim();
  return tokenize(extra).length >= 3;
}

export function blankFromPair(
  raw: string,
  correct: string,
): { prompt: string; answer: string } {
  const original = tokenize(raw);
  const target = tokenize(correct);
  if (!target.length) return { prompt: `${correct} _____`.trim(), answer: correct };
  let start = 0;
  while (start < original.length && start < target.length && same(original[start], target[start])) {
    start += 1;
  }
  let origEnd = original.length;
  let tgtEnd = target.length;
  while (origEnd > start && tgtEnd > start && same(original[origEnd - 1], target[tgtEnd - 1])) {
    origEnd -= 1;
    tgtEnd -= 1;
  }
  if (tgtEnd <= start) {
    start = start > 0 ? start - 1 : 0;
    tgtEnd = Math.min(target.length, start + 1);
  }
  if (start === 0 && tgtEnd === target.length && target.length >= 4) {
    start = Math.max(1, Math.floor(target.length / 3));
    tgtEnd = Math.min(target.length - 1, start + 2);
  }
  if (tgtEnd - start > 3) {
    tgtEnd = start + 2;
  }
  const answer = target.slice(start, tgtEnd).join(" ").trim() || target[target.length - 1];
  const before = target.slice(0, start).join(" ");
  const after = target.slice(tgtEnd).join(" ");
  const prompt = `${before} _____ ${after}`.replace(/\s+/g, " ").trim();
  return { prompt, answer };
}

function same(left: string, right: string): boolean {
  return left.replace(/[^\w']+/g, "").toLowerCase() === right.replace(/[^\w']+/g, "").toLowerCase();
}

export type PracticeSource = {
  you_said?: string;
  correct?: string;
  why?: string;
  label: string;
  key: string;
};

export function canPractice(unit: PracticeSource, hasCatalogTemplate: boolean): boolean {
  const raw = (unit.you_said || "").trim();
  const correct = (unit.correct || unit.label || "").trim();
  if (isDistinctPair(raw, correct)) return true;
  if (hasCatalogTemplate && !isCompleteSentence(unit.label)) return true;
  const phrase = correct || unit.label;
  return wordCount(phrase) > 0 && wordCount(phrase) <= 6 && !isCompleteSentence(phrase);
}

export function isValidIPlus1Card(
  card: { card_type: string; prompt: string; answer: string; why: string; unit_keys: string[] },
  source: PracticeSource | undefined,
): boolean {
  const prompt = card.prompt.trim();
  const answer = card.answer.trim();
  const why = card.why.trim();
  if (!prompt || !answer) return false;
  if (isDummyCarrier(prompt) || isDummyCarrier(answer) || isDummyCarrier(why)) return false;
  const inner = (source?.correct || source?.you_said || source?.label || "").trim();
  if (inner && (isWrappedSentence(prompt, inner) || isWrappedSentence(answer, inner))) return false;
  if (source?.label && isWrappedSentence(prompt, source.label)) return false;
  if (card.card_type === "fill_in_blank") {
    if (!/_{3,}|_____/.test(prompt)) return false;
    if (wordCount(answer) > 6) return false;
    return true;
  }
  if (normalize(prompt) === normalize(answer)) return false;
  if (wordCount(answer) < 2) return false;
  const raw = (source?.you_said || "").trim();
  const correct = (source?.correct || "").trim();
  if (raw && correct && isDistinctPair(raw, correct)) {
    if (tokenOverlap(answer, correct) < 0.35) return false;
    const promptLooksLikeError = tokenOverlap(prompt, raw) >= 0.3;
    const promptLooksLikeBlank = /_{3,}|_____/.test(prompt);
    if (!promptLooksLikeError && !promptLooksLikeBlank) return false;
  }
  return true;
}
