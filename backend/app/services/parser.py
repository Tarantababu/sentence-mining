from __future__ import annotations

import re
from dataclasses import dataclass, field

from app.schemas.openai_payloads import ParsedLogLLM
from app.services.unit_catalog import (
    keys_for_line,
    match_focus_keys,
    match_tracking_keys,
    match_unit_key,
    phrase_unit_key,
    slug_from_phrase,
)

_SECTION_SPLIT = re.compile(
    r"(?=^\s*(?:VOCABULARY(?: OF THE DAY)?|TRACKING LIST|FOCUS FOR NEXT LESSON)\b)",
    re.I | re.M,
)
_SAID_START = re.compile(
    r"^\s*(?:\d+[.)]\s*)?(?:You said|I said|Student(?: said)?|Incorrect|Wrong)\s*:",
    re.I | re.M,
)
_USED_WELL = re.compile(r"used well!", re.I)
_PERFECT_RE = re.compile(
    r'^\s*(?:\d+[.)]\s*)?["“”\']?(.+?)["“”\']?\s*\(PERFECT!?\)\s*$',
    re.I | re.M,
)
_VOCAB_LINE = re.compile(
    r"^\s*[-*•]?\s*(.+?)(?:\s*[:—–-]\s*|\s{2,})(.+)?$",
)
_FIELD_STOP = r"(?:\n\s*(?:Correct(?:ion)?|C1 upgrade|Should be|Why|Note|Explanation)\s*:|$)"

LOG_ENRICH_SYSTEM = (
    "Extract language-session notes as JSON with keys errors, vocab, tracking, focus. "
    "The log may be numbered You said / Correct / Why blocks, with quotes, "
    "C1 upgrade instead of Correct, optional Why, multiple corrects split by /, "
    "and (PERFECT!) lines. errors: [{raw_utterance, corrected_utterance, explanation, is_recurring}]. "
    "Use the first alternative as corrected_utterance. vocab: [{item, example_usage, used_well}]. "
    "tracking and focus are string arrays. Mark is_recurring when the note says RECURRING."
)


@dataclass
class ParsedError:
    raw_utterance: str
    corrected_utterance: str
    explanation: str
    is_recurring: bool
    unit_key: str


@dataclass
class ParsedVocab:
    item: str
    example_usage: str
    used_well: bool
    unit_key: str


@dataclass
class ParsedTracking:
    text: str
    unit_keys: list[str]


@dataclass
class ParsedSession:
    errors: list[ParsedError] = field(default_factory=list)
    vocab: list[ParsedVocab] = field(default_factory=list)
    tracking: list[ParsedTracking] = field(default_factory=list)
    focus_lines: list[str] = field(default_factory=list)
    focus_unit_keys: list[str] = field(default_factory=list)
    parser: str = "rules"


def _clean(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def _strip_quotes(text: str) -> str:
    return _clean(text).strip("\"“”'")


def _strip_used_well(text: str) -> str:
    return _USED_WELL.sub("", text).strip(" ()[]-—–:")


def _primary_correct(text: str) -> str:
    first = re.split(r"\s+/\s+", text, maxsplit=1)[0]
    return _strip_quotes(first)


def _unit_for_error(raw: str, correct: str, why: str) -> str:
    mapped = match_unit_key(raw, correct, why)
    if mapped:
        return mapped
    return f"misc_{slug_from_phrase(correct or raw)}"


def _field(block: str, names: list[str]) -> str:
    name = "|".join(re.escape(item) for item in names)
    match = re.search(rf"(?:{name})\s*:\s*([\s\S]*?)(?={_FIELD_STOP})", block, re.I)
    return match.group(1) if match else ""


def _parse_error_block(block: str) -> ParsedError | None:
    raw = _strip_quotes(
        _field(block, ["You said", "I said", "Student said", "Student", "Incorrect", "Wrong"])
    )
    correct = _primary_correct(
        _field(block, ["Correct", "Correction", "C1 upgrade", "Should be"]) or raw
    )
    why_text = _field(block, ["Why", "Note", "Explanation"])
    if not raw:
        return None
    is_recurring = bool(re.search(r"\bRECURRING\b", block, re.I))
    why_text = re.sub(r"\bRECURRING\b", "", why_text, flags=re.I)
    answer = correct or raw
    return ParsedError(
        raw_utterance=raw,
        corrected_utterance=answer,
        explanation=_clean(why_text),
        is_recurring=is_recurring,
        unit_key=_unit_for_error(raw, answer, why_text),
    )


def _parse_errors(body: str) -> list[ParsedError]:
    starts = [match.start() for match in _SAID_START.finditer(body)]
    items: list[ParsedError] = []
    counts: dict[str, int] = {}
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(body)
        item = _parse_error_block(body[start:end])
        if item is None:
            continue
        counts[item.unit_key] = counts.get(item.unit_key, 0) + 1
        items.append(item)
    for item in items:
        if counts.get(item.unit_key, 0) > 1:
            item.is_recurring = True
    return items


def _parse_perfect(text: str) -> list[ParsedVocab]:
    items: list[ParsedVocab] = []
    for match in _PERFECT_RE.finditer(text):
        phrase = _strip_quotes(match.group(1) or "")
        if not phrase:
            continue
        items.append(
            ParsedVocab(
                item=phrase,
                example_usage=phrase,
                used_well=True,
                unit_key=phrase_unit_key(phrase),
            )
        )
    return items


def _parse_vocab(section: str) -> list[ParsedVocab]:
    items: list[ParsedVocab] = []
    for raw_line in section.splitlines()[1:]:
        line = raw_line.strip()
        if not line or re.match(r"^(TRACKING LIST|FOCUS FOR NEXT LESSON)\b", line, re.I):
            break
        used_well = bool(_USED_WELL.search(line) or re.search(r"\(PERFECT!?\)", line, re.I))
        line = _strip_used_well(re.sub(r"\(PERFECT!?\)", "", line, flags=re.I))
        match = _VOCAB_LINE.match(line)
        if not match:
            continue
        item = _clean(match.group(1) or "")
        example = _clean(_strip_used_well(match.group(2) or ""))
        if not item or re.match(r"^bonus$", item, re.I):
            continue
        items.append(
            ParsedVocab(
                item=item,
                example_usage=example,
                used_well=used_well,
                unit_key=phrase_unit_key(item, example),
            )
        )
    return items


def _parse_list_section(section: str) -> list[str]:
    lines: list[str] = []
    for raw_line in section.splitlines()[1:]:
        line = raw_line.strip().lstrip("-*•").strip()
        if not line:
            continue
        if re.match(
            r"^(VOCABULARY(?: OF THE DAY)?|TRACKING LIST|FOCUS FOR NEXT LESSON)\b",
            line,
            re.I,
        ):
            break
        lines.append(line)
    return lines


def parse_session_log(raw_log: str) -> ParsedSession:
    text = raw_log.replace("\r\n", "\n")
    chunks = _SECTION_SPLIT.split(text)
    preamble = chunks[0] if chunks else text
    vocab_section = ""
    tracking_section = ""
    focus_section = ""
    for chunk in chunks[1:]:
        head = chunk.strip().splitlines()[0].strip().upper() if chunk.strip() else ""
        if head.startswith("VOCABULARY"):
            vocab_section = chunk
        elif head.startswith("TRACKING"):
            tracking_section = chunk
        elif head.startswith("FOCUS"):
            focus_section = chunk

    errors = _parse_errors(preamble)
    vocab = (_parse_vocab(vocab_section) if vocab_section else []) + _parse_perfect(text)
    tracking_lines = _parse_list_section(tracking_section) if tracking_section else []
    focus_lines = _parse_list_section(focus_section) if focus_section else []

    tracking = [
        ParsedTracking(text=line, unit_keys=keys_for_line(line, match_tracking_keys(line)))
        for line in tracking_lines
    ]
    focus_keys: list[str] = []
    for line in focus_lines:
        for key in keys_for_line(line, match_focus_keys(line)):
            if key not in focus_keys:
                focus_keys.append(key)

    return ParsedSession(
        errors=errors,
        vocab=vocab,
        tracking=tracking,
        focus_lines=focus_lines,
        focus_unit_keys=focus_keys,
        parser="rules",
    )


def parsed_session_from_llm(payload: ParsedLogLLM) -> ParsedSession:
    errors: list[ParsedError] = []
    counts: dict[str, int] = {}
    for item in payload.errors:
        raw = _strip_quotes(item.raw_utterance)
        correct = _primary_correct(item.corrected_utterance or raw)
        why = _clean(item.explanation)
        key = _unit_for_error(raw, correct, why)
        counts[key] = counts.get(key, 0) + 1
        errors.append(
            ParsedError(
                raw_utterance=raw,
                corrected_utterance=correct,
                explanation=why,
                is_recurring=item.is_recurring
                or bool(re.search(r"\bRECURRING\b", item.explanation or "", re.I)),
                unit_key=key,
            )
        )
    for item in errors:
        if counts.get(item.unit_key, 0) > 1:
            item.is_recurring = True

    vocab = [
        ParsedVocab(
            item=_strip_quotes(row.item),
            example_usage=_clean(row.example_usage),
            used_well=row.used_well,
            unit_key=phrase_unit_key(row.item, row.example_usage),
        )
        for row in payload.vocab
        if row.item.strip()
    ]
    tracking = [
        ParsedTracking(text=_clean(line), unit_keys=keys_for_line(_clean(line), match_tracking_keys(line)))
        for line in payload.tracking
        if line.strip()
    ]
    focus_lines = [_clean(line) for line in payload.focus if line.strip()]
    focus_keys: list[str] = []
    for line in focus_lines:
        for key in keys_for_line(line, match_focus_keys(line)):
            if key not in focus_keys:
                focus_keys.append(key)
    return ParsedSession(
        errors=errors,
        vocab=vocab,
        tracking=tracking,
        focus_lines=focus_lines,
        focus_unit_keys=focus_keys,
        parser="openai",
    )


def merge_parsed_sessions(base: ParsedSession, extra: ParsedSession) -> ParsedSession:
    error_seen = {item.raw_utterance.lower() for item in base.errors}
    errors = list(base.errors)
    for item in extra.errors:
        if item.raw_utterance.lower() not in error_seen:
            errors.append(item)
            error_seen.add(item.raw_utterance.lower())
    vocab_seen = {item.item.lower() for item in base.vocab}
    vocab = list(base.vocab)
    for item in extra.vocab:
        if item.item.lower() not in vocab_seen:
            vocab.append(item)
            vocab_seen.add(item.item.lower())
    tracking_seen = {item.text.lower() for item in base.tracking}
    tracking = list(base.tracking)
    for item in extra.tracking:
        if item.text.lower() not in tracking_seen:
            tracking.append(item)
            tracking_seen.add(item.text.lower())
    focus_lines = list(base.focus_lines)
    for line in extra.focus_lines:
        if line.lower() not in {existing.lower() for existing in focus_lines}:
            focus_lines.append(line)
    focus_keys = list(base.focus_unit_keys)
    for key in extra.focus_unit_keys:
        if key not in focus_keys:
            focus_keys.append(key)
    return ParsedSession(
        errors=errors,
        vocab=vocab,
        tracking=tracking,
        focus_lines=focus_lines,
        focus_unit_keys=focus_keys,
        parser="openai" if extra.parser == "openai" else base.parser,
    )


def needs_enrichment(parsed: ParsedSession, raw_log: str) -> bool:
    return len(raw_log.strip()) >= 40
