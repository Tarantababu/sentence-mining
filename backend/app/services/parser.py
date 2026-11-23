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
    r"(?=^\s*(?:VOCABULARY OF THE DAY|TRACKING LIST|FOCUS FOR NEXT LESSON)\s*$)",
    re.I | re.M,
)
_ERROR_RE = re.compile(
    r"(?:You said|I said|Student(?: said)?|Incorrect|Wrong)\s*:\s*(.*?)\s*"
    r"(?:Correct(?:ion)?|Should be)\s*:\s*(.*?)\s*"
    r"(?:Why|Note|Explanation)\s*:\s*(.*?)(?=(?:\n\s*(?:You said|I said|Student|Incorrect|Wrong)\s*:)|$)",
    re.I | re.S,
)
_VOCAB_LINE = re.compile(
    r"^\s*[-*•]?\s*(.+?)(?:\s*[:—–-]\s*|\s{2,})(.+)?$",
)
_USED_WELL = re.compile(r"used well!", re.I)


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


def _strip_used_well(text: str) -> str:
    return _USED_WELL.sub("", text).strip(" ()[]-—–:")


def _unit_for_error(raw: str, correct: str, why: str) -> str:
    mapped = match_unit_key(raw, correct, why)
    if mapped:
        return mapped
    return f"misc_{slug_from_phrase(correct or raw)}"


def _parse_errors(body: str) -> list[ParsedError]:
    items: list[ParsedError] = []
    counts: dict[str, int] = {}
    for match in _ERROR_RE.finditer(body):
        raw, correct, why_block = match.group(1), match.group(2), match.group(3)
        why_text = why_block
        is_recurring = bool(re.search(r"\bRECURRING\b", why_text, re.I))
        why_text = re.sub(r"\bRECURRING\b", "", why_text, flags=re.I)
        raw_u = _clean(raw)
        correct_u = _clean(correct)
        why_u = _clean(why_text)
        key = _unit_for_error(raw_u, correct_u, why_u)
        counts[key] = counts.get(key, 0) + 1
        items.append(
            ParsedError(
                raw_utterance=raw_u,
                corrected_utterance=correct_u,
                explanation=why_u,
                is_recurring=is_recurring,
                unit_key=key,
            )
        )
    for item in items:
        if counts.get(item.unit_key, 0) > 1:
            item.is_recurring = True
    return items


def _parse_vocab(section: str) -> list[ParsedVocab]:
    items: list[ParsedVocab] = []
    for raw_line in section.splitlines()[1:]:
        line = raw_line.strip()
        if not line or re.match(r"^(TRACKING LIST|FOCUS FOR NEXT LESSON)$", line, re.I):
            break
        used_well = bool(_USED_WELL.search(line))
        line = _strip_used_well(line)
        match = _VOCAB_LINE.match(line)
        if not match:
            continue
        item = _clean(match.group(1) or "")
        example = _clean(_strip_used_well(match.group(2) or ""))
        if not item:
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
        if re.match(r"^(VOCABULARY OF THE DAY|TRACKING LIST|FOCUS FOR NEXT LESSON)$", line, re.I):
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
    vocab = _parse_vocab(vocab_section) if vocab_section else []
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
        key = _unit_for_error(item.raw_utterance, item.corrected_utterance, item.explanation)
        counts[key] = counts.get(key, 0) + 1
        errors.append(
            ParsedError(
                raw_utterance=_clean(item.raw_utterance),
                corrected_utterance=_clean(item.corrected_utterance),
                explanation=_clean(item.explanation),
                is_recurring=item.is_recurring,
                unit_key=key,
            )
        )
    for item in errors:
        if counts.get(item.unit_key, 0) > 1:
            item.is_recurring = True

    vocab = [
        ParsedVocab(
            item=_clean(row.item),
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


def needs_enrichment(parsed: ParsedSession, raw_log: str) -> bool:
    if parsed.errors or parsed.vocab:
        return False
    return len(raw_log.strip()) >= 80
