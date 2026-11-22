import { matchFocusKeys, matchTrackingKeys, matchUnitKey, slugFromPhrase } from "./catalog";

export type ParsedError = {
  raw_utterance: string;
  corrected_utterance: string;
  explanation: string;
  is_recurring: boolean;
  unit_key: string;
};

export type ParsedVocab = {
  item: string;
  example_usage: string;
  used_well: boolean;
  unit_key: string | null;
};

export type ParsedTracking = {
  text: string;
  unit_keys: string[];
};

export type ParsedSession = {
  errors: ParsedError[];
  vocab: ParsedVocab[];
  tracking: ParsedTracking[];
  focus_lines: string[];
  focus_unit_keys: string[];
  parser: "rules" | "openai";
};

export type ParsedLogLLM = {
  errors: {
    raw_utterance: string;
    corrected_utterance: string;
    explanation: string;
    is_recurring: boolean;
  }[];
  vocab: { item: string; example_usage: string; used_well: boolean }[];
  tracking: string[];
  focus: string[];
};

const SECTION_SPLIT = /(?=^\s*(?:VOCABULARY OF THE DAY|TRACKING LIST|FOCUS FOR NEXT LESSON)\s*$)/gim;
const ERROR_RE = /You said:\s*(.*?)\s*Correct:\s*(.*?)\s*Why:\s*(.*?)(?=(?:\n\s*You said:)|$)/gis;
const VOCAB_LINE = /^\s*[-*•]?\s*(.+?)(?:\s*[:—–-]\s*|\s{2,})(.+)?$/;
const USED_WELL = /used well!/i;

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripUsedWell(text: string): string {
  return text.replace(USED_WELL, "").replace(/^[ ()[\]\-—–:]+|[ ()[\]\-—–:]+$/g, "").trim();
}

function unitForError(raw: string, correct: string, why: string): string {
  return matchUnitKey(raw, correct, why) ?? `misc_${slugFromPhrase(correct || raw)}`;
}

function parseErrors(body: string): ParsedError[] {
  const items: ParsedError[] = [];
  const counts: Record<string, number> = {};
  ERROR_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = ERROR_RE.exec(body))) {
    const raw = match[1];
    const correct = match[2];
    let whyText = match[3];
    const isRecurring = /\bRECURRING\b/i.test(whyText);
    whyText = whyText.replace(/\bRECURRING\b/gi, "");
    const key = unitForError(clean(raw), clean(correct), clean(whyText));
    counts[key] = (counts[key] || 0) + 1;
    items.push({
      raw_utterance: clean(raw),
      corrected_utterance: clean(correct),
      explanation: clean(whyText),
      is_recurring: isRecurring,
      unit_key: key,
    });
  }
  for (const item of items) {
    if ((counts[item.unit_key] || 0) > 1) item.is_recurring = true;
  }
  return items;
}

function parseVocab(section: string): ParsedVocab[] {
  const items: ParsedVocab[] = [];
  const lines = section.split("\n").slice(1);
  for (const rawLine of lines) {
    const line0 = rawLine.trim();
    if (!line0 || /^(TRACKING LIST|FOCUS FOR NEXT LESSON)$/i.test(line0)) break;
    const usedWell = USED_WELL.test(line0);
    const line = stripUsedWell(line0);
    const match = line.match(VOCAB_LINE);
    if (!match) continue;
    const item = clean(match[1] || "");
    const example = clean(stripUsedWell(match[2] || ""));
    if (!item) continue;
    items.push({
      item,
      example_usage: example,
      used_well: usedWell,
      unit_key: matchUnitKey(item, example),
    });
  }
  return items;
}

function parseListSection(section: string): string[] {
  const lines: string[] = [];
  for (const rawLine of section.split("\n").slice(1)) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, "").trim();
    if (!line) continue;
    if (/^(VOCABULARY OF THE DAY|TRACKING LIST|FOCUS FOR NEXT LESSON)$/i.test(line)) break;
    lines.push(line);
  }
  return lines;
}

export function parseSessionLog(rawLog: string): ParsedSession {
  const text = rawLog.replace(/\r\n/g, "\n");
  const chunks = text.split(SECTION_SPLIT);
  const preamble = chunks[0] ?? text;
  let vocabSection = "";
  let trackingSection = "";
  let focusSection = "";
  for (const chunk of chunks.slice(1)) {
    const head = chunk.trim().split("\n")[0]?.trim().toUpperCase() ?? "";
    if (head.startsWith("VOCABULARY")) vocabSection = chunk;
    else if (head.startsWith("TRACKING")) trackingSection = chunk;
    else if (head.startsWith("FOCUS")) focusSection = chunk;
  }

  const errors = parseErrors(preamble);
  const vocab = vocabSection ? parseVocab(vocabSection) : [];
  const trackingLines = trackingSection ? parseListSection(trackingSection) : [];
  const focusLines = focusSection ? parseListSection(focusSection) : [];
  const tracking = trackingLines.map((line) => ({
    text: line,
    unit_keys: matchTrackingKeys(line),
  }));
  const focusKeys: string[] = [];
  for (const line of focusLines) {
    for (const key of matchFocusKeys(line)) if (!focusKeys.includes(key)) focusKeys.push(key);
  }

  return {
    errors,
    vocab,
    tracking,
    focus_lines: focusLines,
    focus_unit_keys: focusKeys,
    parser: "rules",
  };
}

export function parsedSessionFromLlm(payload: ParsedLogLLM): ParsedSession {
  const errors: ParsedError[] = [];
  const counts: Record<string, number> = {};
  for (const item of payload.errors) {
    const key = unitForError(item.raw_utterance, item.corrected_utterance, item.explanation || "");
    counts[key] = (counts[key] || 0) + 1;
    errors.push({
      raw_utterance: clean(item.raw_utterance),
      corrected_utterance: clean(item.corrected_utterance),
      explanation: clean(item.explanation || ""),
      is_recurring: !!item.is_recurring,
      unit_key: key,
    });
  }
  for (const item of errors) {
    if ((counts[item.unit_key] || 0) > 1) item.is_recurring = true;
  }
  const vocab = payload.vocab
    .filter((row) => row.item.trim())
    .map((row) => ({
      item: clean(row.item),
      example_usage: clean(row.example_usage || ""),
      used_well: !!row.used_well,
      unit_key: matchUnitKey(row.item, row.example_usage || ""),
    }));
  const tracking = payload.tracking
    .filter((line) => line.trim())
    .map((line) => ({ text: clean(line), unit_keys: matchTrackingKeys(line) }));
  const focusLines = payload.focus.filter((line) => line.trim()).map(clean);
  const focusKeys: string[] = [];
  for (const line of focusLines) {
    for (const key of matchFocusKeys(line)) if (!focusKeys.includes(key)) focusKeys.push(key);
  }
  return {
    errors,
    vocab,
    tracking,
    focus_lines: focusLines,
    focus_unit_keys: focusKeys,
    parser: "openai",
  };
}

export function needsEnrichment(parsed: ParsedSession, rawLog: string): boolean {
  if (parsed.errors.length || parsed.vocab.length) return false;
  return rawLog.trim().length >= 80;
}
