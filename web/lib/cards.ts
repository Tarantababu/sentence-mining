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

function tokenize(text: string): string[] {
  return text.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

function same(left: string, right: string): boolean {
  return left.replace(/[^\w']+/g, "").toLowerCase() === right.replace(/[^\w']+/g, "").toLowerCase();
}
