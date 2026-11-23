import {
  keysForLine,
  matchFocusKeys,
  matchTrackingKeys,
  matchUnitKey,
  phraseUnitKey,
  slugFromPhrase,
} from "./catalog";

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
  unit_key: string;
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

const SECTION_SPLIT =
  /(?=^\s*(?:VOCABULARY(?: OF THE DAY)?|TRACKING LIST|FOCUS FOR NEXT LESSON)\b)/gim;
const SAID_START =
  /^\s*(?:\d+[.)]\s*)?(?:You said|I said|Student(?: said)?|Incorrect|Wrong)\s*:/gim;
const USED_WELL = /used well!/i;
const PERFECT_RE = /^\s*(?:\d+[.)]\s*)?["“”']?(.+?)["“”']?\s*\(PERFECT!?\)\s*$/gim;
const VOCAB_LINE = /^\s*[-*•]?\s*(.+?)(?:\s*[:—–-]\s*|\s{2,})(.+)?$/;

export const LOG_ENRICH_SYSTEM =
  "Extract language-session notes as JSON with keys errors, vocab, tracking, focus. " +
  "The log may be numbered You said / Correct / Why blocks, with quotes, " +
  "C1 upgrade instead of Correct, optional Why, multiple corrects split by /, " +
  "and (PERFECT!) lines. errors: [{raw_utterance, corrected_utterance, explanation, is_recurring}]. " +
  "Use the first alternative as corrected_utterance. vocab: [{item, example_usage, used_well}]. " +
  "tracking and focus are string arrays. Mark is_recurring when the note says RECURRING.";

function clean(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function stripQuotes(text: string): string {
  return clean(text).replace(/^["“”']+|["“”']+$/g, "").trim();
}

function stripUsedWell(text: string): string {
  return text.replace(USED_WELL, "").replace(/^[ ()[\]\-—–:]+|[ ()[\]\-—–:]+$/g, "").trim();
}

function primaryCorrect(text: string): string {
  const first = text.split(/\s+\/\s+/)[0] || text;
  return stripQuotes(first);
}

function unitForError(raw: string, correct: string, why: string): string {
  return matchUnitKey(raw, correct, why) ?? `misc_${slugFromPhrase(correct || raw)}`;
}

function field(block: string, names: string[]): string {
  const name = names.map((item) => item.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|");
  const match = block.match(
    new RegExp(`(?:${name})\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*(?:Correct(?:ion)?|C1 upgrade|Should be|Why|Note|Explanation)\\s*:|$)`, "i"),
  );
  return match?.[1] ?? "";
}

function parseErrorBlock(block: string): ParsedError | null {
  const raw = stripQuotes(field(block, ["You said", "I said", "Student said", "Student", "Incorrect", "Wrong"]));
  const correct = primaryCorrect(
    field(block, ["Correct", "Correction", "C1 upgrade", "Should be"]) || raw,
  );
  let whyText = field(block, ["Why", "Note", "Explanation"]);
  if (!raw && !correct) return null;
  if (!raw) return null;
  const isRecurring = /\bRECURRING\b/i.test(block);
  whyText = whyText.replace(/\bRECURRING\b/gi, "");
  const utterance = raw;
  const answer = correct || utterance;
  return {
    raw_utterance: utterance,
    corrected_utterance: answer,
    explanation: clean(whyText),
    is_recurring: isRecurring,
    unit_key: unitForError(utterance, answer, whyText),
  };
}

function parseErrors(body: string): ParsedError[] {
  const starts: number[] = [];
  SAID_START.lastIndex = 0;
  let found: RegExpExecArray | null;
  while ((found = SAID_START.exec(body))) starts.push(found.index);
  const items: ParsedError[] = [];
  const counts: Record<string, number> = {};
  for (let index = 0; index < starts.length; index++) {
    const block = body.slice(starts[index], starts[index + 1]);
    const item = parseErrorBlock(block);
    if (!item) continue;
    counts[item.unit_key] = (counts[item.unit_key] || 0) + 1;
    items.push(item);
  }
  for (const item of items) {
    if ((counts[item.unit_key] || 0) > 1) item.is_recurring = true;
  }
  return items;
}

function parsePerfect(text: string): ParsedVocab[] {
  const items: ParsedVocab[] = [];
  PERFECT_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PERFECT_RE.exec(text))) {
    const phrase = stripQuotes(match[1] || "");
    if (!phrase) continue;
    items.push({
      item: phrase,
      example_usage: phrase,
      used_well: true,
      unit_key: phraseUnitKey(phrase),
    });
  }
  return items;
}

function parseVocab(section: string): ParsedVocab[] {
  const items: ParsedVocab[] = [];
  const lines = section.split("\n").slice(1);
  for (const rawLine of lines) {
    const line0 = rawLine.trim();
    if (!line0 || /^TRACKING LIST\b|^FOCUS FOR NEXT LESSON\b/i.test(line0)) break;
    const usedWell = USED_WELL.test(line0) || /\(PERFECT!?\)/i.test(line0);
    const line = stripUsedWell(line0.replace(/\(PERFECT!?\)/gi, ""));
    const match = line.match(VOCAB_LINE);
    if (!match) continue;
    const item = clean(match[1] || "");
    const example = clean(stripUsedWell(match[2] || ""));
    if (!item || /^bonus$/i.test(item)) continue;
    items.push({
      item,
      example_usage: example,
      used_well: usedWell,
      unit_key: phraseUnitKey(item, example),
    });
  }
  return items;
}

function parseListSection(section: string): string[] {
  const lines: string[] = [];
  for (const rawLine of section.split("\n").slice(1)) {
    const line = rawLine.trim().replace(/^[-*•]\s*/, "").trim();
    if (!line) continue;
    if (/^(VOCABULARY(?: OF THE DAY)?|TRACKING LIST|FOCUS FOR NEXT LESSON)\b/i.test(line)) break;
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
  const vocab = [
    ...(vocabSection ? parseVocab(vocabSection) : []),
    ...parsePerfect(text),
  ];
  const trackingLines = trackingSection ? parseListSection(trackingSection) : [];
  const focusLines = focusSection ? parseListSection(focusSection) : [];
  const tracking = trackingLines.map((line) => ({
    text: line,
    unit_keys: keysForLine(line, matchTrackingKeys(line)),
  }));
  const focusKeys: string[] = [];
  for (const line of focusLines) {
    for (const key of keysForLine(line, matchFocusKeys(line))) {
      if (!focusKeys.includes(key)) focusKeys.push(key);
    }
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
    const raw = stripQuotes(item.raw_utterance);
    const correct = primaryCorrect(item.corrected_utterance || raw);
    const why = clean(item.explanation || "");
    const key = unitForError(raw, correct, why);
    counts[key] = (counts[key] || 0) + 1;
    errors.push({
      raw_utterance: raw,
      corrected_utterance: correct,
      explanation: why,
      is_recurring: !!item.is_recurring || /\bRECURRING\b/i.test(item.explanation || ""),
      unit_key: key,
    });
  }
  for (const item of errors) {
    if ((counts[item.unit_key] || 0) > 1) item.is_recurring = true;
  }
  const vocab = payload.vocab
    .filter((row) => row.item.trim())
    .map((row) => ({
      item: stripQuotes(row.item),
      example_usage: clean(row.example_usage || ""),
      used_well: !!row.used_well,
      unit_key: phraseUnitKey(row.item, row.example_usage || ""),
    }));
  const tracking = payload.tracking
    .filter((line) => line.trim())
    .map((line) => ({ text: clean(line), unit_keys: keysForLine(clean(line), matchTrackingKeys(line)) }));
  const focusLines = payload.focus.filter((line) => line.trim()).map(clean);
  const focusKeys: string[] = [];
  for (const line of focusLines) {
    for (const key of keysForLine(line, matchFocusKeys(line))) {
      if (!focusKeys.includes(key)) focusKeys.push(key);
    }
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

export function mergeParsedSessions(base: ParsedSession, extra: ParsedSession): ParsedSession {
  const errorSeen = new Set(base.errors.map((item) => item.raw_utterance.toLowerCase()));
  const errors = [...base.errors];
  for (const item of extra.errors) {
    if (!errorSeen.has(item.raw_utterance.toLowerCase())) {
      errors.push(item);
      errorSeen.add(item.raw_utterance.toLowerCase());
    }
  }
  const vocabSeen = new Set(base.vocab.map((item) => item.item.toLowerCase()));
  const vocab = [...base.vocab];
  for (const item of extra.vocab) {
    if (!vocabSeen.has(item.item.toLowerCase())) {
      vocab.push(item);
      vocabSeen.add(item.item.toLowerCase());
    }
  }
  const trackingSeen = new Set(base.tracking.map((item) => item.text.toLowerCase()));
  const tracking = [...base.tracking];
  for (const item of extra.tracking) {
    if (!trackingSeen.has(item.text.toLowerCase())) {
      tracking.push(item);
      trackingSeen.add(item.text.toLowerCase());
    }
  }
  const focusLines = [...base.focus_lines];
  for (const line of extra.focus_lines) {
    if (!focusLines.some((existing) => existing.toLowerCase() === line.toLowerCase())) {
      focusLines.push(line);
    }
  }
  const focusKeys = [...base.focus_unit_keys];
  for (const key of extra.focus_unit_keys) {
    if (!focusKeys.includes(key)) focusKeys.push(key);
  }
  return {
    errors,
    vocab,
    tracking,
    focus_lines: focusLines,
    focus_unit_keys: focusKeys,
    parser: extra.parser === "openai" ? "openai" : base.parser,
  };
}

export function needsEnrichment(parsed: ParsedSession, rawLog: string): boolean {
  if (parsed.errors.length >= 2 || parsed.vocab.length) return false;
  return rawLog.trim().length >= 80;
}
