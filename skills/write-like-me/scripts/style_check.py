#!/usr/bin/env python3
"""Deterministic checks for the write-like-me skill.

The checker enforces textual invariants and flags likely style problems. It does
not verify facts, judge source quality, or prove semantic uniqueness.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import asdict, dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Sequence


EM_DASH = "\u2014"

STOCK_PHRASES = (
    "delve into",
    "deep dive",
    "in today's rapidly evolving landscape",
    "in today’s rapidly evolving landscape",
    "in today's fast-paced world",
    "in today’s fast-paced world",
    "ever-evolving landscape",
    "ever evolving landscape",
    "it is important to note",
    "it is worth noting",
    "it should be noted",
    "cannot be overstated",
    "stands as a testament",
    "serves as a testament",
    "at the forefront of",
    "paves the way",
    "unlock the potential",
    "harness the power",
    "navigate the complexities",
    "in the realm of",
    "a myriad of",
    "game changer",
    "game-changing",
    "transformative journey",
    "this underscores the importance",
    "this highlights the importance",
    "plays a crucial role",
    "when it comes to",
    "moving forward",
    "key takeaways",
    "as an ai",
    "in conclusion",
)

BANNED_SENTENCE_STARTERS = (
    "moreover",
    "furthermore",
    "additionally",
    "ultimately",
)

GENERIC_TERMS = (
    "significant",
    "robust",
    "comprehensive",
    "seamless",
    "seamlessly",
    "holistic",
    "pivotal",
    "multifaceted",
    "transformative",
    "unprecedented",
    "profound",
    "crucial",
    "vital",
    "actionable",
    "leverage",
    "leveraging",
    "utilize",
    "utilizing",
)

STOPWORDS = frozenset(
    "a an and are as at be because been being but by can could did do does for "
    "from had has have he her hers him his how i if in into is it its itself may "
    "might more most must my no not of on or our ours should so than that the "
    "their theirs them themselves then there these they this those through to too "
    "under very was we were what when where which while who why will with would "
    "you your yours".split()
)

WORD_RE = re.compile(r"[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)?")
HTML_EM_DASH_RE = re.compile(r"&(?:mdash|#0*8212|#x0*2014);|\\u2014", re.IGNORECASE)
REPEATED_WORD_RE = re.compile(r"\b([A-Za-z][A-Za-z0-9'’_-]*)\s+\1\b", re.IGNORECASE)
PLACEHOLDER_RE = re.compile(
    r"\[\s*SOURCE\s+NEEDED\s*\]|\b(?:TODO|TBD)\b|\{\{[^{}]+\}\}",
    re.IGNORECASE,
)
SPACED_DASH_RE = re.compile(r"(?<=\S)[ \t]+--+[ \t]+(?=\S)")
REFERENCE_HEADING_RE = re.compile(
    r"(?im)^[ \t]*(?:#{1,6}[ \t]+)?(?:[A-Z][0-9]*\.[ \t]+)?references[ \t]*:?[ \t]*$"
)
FENCED_CODE_RE = re.compile(r"(?ms)^\s*(```|~~~).*?^\s*\1\s*$")
INLINE_CODE_RE = re.compile(r"`[^`\n]+`")
URL_RE = re.compile(r"https?://\S+", re.IGNORECASE)
SENTENCE_END_RE = re.compile(r"[.!?]+(?:[\"')\]]+)?(?=\s|$)")


@dataclass(frozen=True)
class Finding:
    line: int
    column: int
    severity: str
    code: str
    message: str


@dataclass(frozen=True)
class SpanText:
    start: int
    end: int
    text: str


def _line_column(text: str, index: int) -> tuple[int, int]:
    line = text.count("\n", 0, index) + 1
    previous_newline = text.rfind("\n", 0, index)
    column = index + 1 if previous_newline < 0 else index - previous_newline
    return line, column


def _finding(text: str, index: int, severity: str, code: str, message: str) -> Finding:
    line, column = _line_column(text, index)
    return Finding(line, column, severity, code, message)


def _mask_match(text: str, match: re.Match[str]) -> str:
    segment = match.group(0)
    return "".join("\n" if char == "\n" else " " for char in segment)


def _analysis_text(text: str) -> str:
    masked = FENCED_CODE_RE.sub(lambda match: _mask_match(text, match), text)
    masked = INLINE_CODE_RE.sub(lambda match: " " * len(match.group(0)), masked)
    masked = URL_RE.sub(lambda match: " " * len(match.group(0)), masked)

    reference_heading = REFERENCE_HEADING_RE.search(masked)
    if reference_heading:
        suffix = masked[reference_heading.start() :]
        masked = masked[: reference_heading.start()] + "".join(
            "\n" if char == "\n" else " " for char in suffix
        )
    return masked


def _trimmed_span(text: str, start: int, end: int) -> SpanText | None:
    raw = text[start:end]
    left = len(raw) - len(raw.lstrip())
    right = len(raw.rstrip())
    if right <= left:
        return None
    actual_start = start + left
    actual_end = start + right
    return SpanText(actual_start, actual_end, text[actual_start:actual_end])


def _sentences(text: str) -> list[SpanText]:
    sentences: list[SpanText] = []
    start = 0
    for match in SENTENCE_END_RE.finditer(text):
        span = _trimmed_span(text, start, match.end())
        if span and len(WORD_RE.findall(span.text)) >= 3:
            sentences.append(span)
        start = match.end()
    return sentences


def _paragraphs(text: str) -> list[SpanText]:
    paragraphs: list[SpanText] = []
    start = 0
    for match in re.finditer(r"\n[ \t]*\n", text):
        span = _trimmed_span(text, start, match.start())
        if span:
            paragraphs.append(span)
        start = match.end()
    span = _trimmed_span(text, start, len(text))
    if span:
        paragraphs.append(span)
    return paragraphs


def _words(text: str) -> list[str]:
    return [word.lower().replace("’", "'") for word in WORD_RE.findall(text)]


def _normalized(text: str) -> str:
    return " ".join(_words(text))


def _content_words(text: str) -> list[str]:
    return [word for word in _words(text) if word not in STOPWORDS and len(word) > 2]


def _is_structural_paragraph(paragraph: SpanText) -> bool:
    stripped = paragraph.text.strip()
    if stripped.startswith("#"):
        return True
    if len(_words(stripped)) < 8:
        return True
    if all(
        not line.rstrip().endswith((".", "?", "!"))
        for line in stripped.splitlines()
        if line.strip()
    ):
        return True
    return False


def check_text(text: str, mode: str = "final") -> list[Finding]:
    findings: list[Finding] = []
    analysis = _analysis_text(text)

    for match in re.finditer(re.escape(EM_DASH), text):
        findings.append(
            _finding(text, match.start(), "error", "EMD001", "forbidden em dash character")
        )

    for match in HTML_EM_DASH_RE.finditer(text):
        findings.append(
            _finding(text, match.start(), "error", "EMD002", "encoded em dash is forbidden")
        )

    for match in SPACED_DASH_RE.finditer(analysis):
        findings.append(
            _finding(
                text,
                match.start(),
                "error",
                "EMD003",
                "spaced double hyphens cannot substitute for an em dash",
            )
        )

    for phrase in STOCK_PHRASES:
        pattern = re.compile(r"(?<![A-Za-z0-9])" + re.escape(phrase) + r"(?![A-Za-z0-9])", re.IGNORECASE)
        for match in pattern.finditer(analysis):
            findings.append(
                _finding(
                    text,
                    match.start(),
                    "error",
                    "PHR001",
                    f"prohibited generic phrase: {match.group(0)!r}",
                )
            )

    sentences = _sentences(analysis)
    for sentence in sentences:
        stripped = sentence.text.lstrip(" \t\n\"'(")
        for starter in BANNED_SENTENCE_STARTERS:
            if re.match(rf"{re.escape(starter)}\b", stripped, re.IGNORECASE):
                offset = sentence.text.lower().find(starter)
                findings.append(
                    _finding(
                        text,
                        sentence.start + max(offset, 0),
                        "error",
                        "PHR002",
                        f"generic sentence transition is prohibited: {starter!r}",
                    )
                )
                break

    for match in REPEATED_WORD_RE.finditer(analysis):
        findings.append(
            _finding(
                text,
                match.start(),
                "error",
                "MEC001",
                f"adjacent repeated word: {match.group(1)!r}",
            )
        )

    if mode == "final":
        for match in PLACEHOLDER_RE.finditer(text):
            findings.append(
                _finding(
                    text,
                    match.start(),
                    "error",
                    "FIN001",
                    f"draft placeholder remains in final text: {match.group(0)!r}",
                )
            )

    seen_sentences: dict[str, SpanText] = {}
    for sentence in sentences:
        normalized = _normalized(sentence.text)
        if len(normalized.split()) < 8:
            continue
        previous = seen_sentences.get(normalized)
        if previous:
            previous_line, _ = _line_column(text, previous.start)
            findings.append(
                _finding(
                    text,
                    sentence.start,
                    "error",
                    "DUP001",
                    f"sentence duplicates the sentence at line {previous_line}",
                )
            )
        else:
            seen_sentences[normalized] = sentence

    prose_paragraphs = [paragraph for paragraph in _paragraphs(analysis) if not _is_structural_paragraph(paragraph)]
    seen_paragraphs: dict[str, SpanText] = {}
    for paragraph in prose_paragraphs:
        normalized = _normalized(paragraph.text)
        if len(normalized.split()) < 12:
            continue
        previous = seen_paragraphs.get(normalized)
        if previous:
            previous_line, _ = _line_column(text, previous.start)
            findings.append(
                _finding(
                    text,
                    paragraph.start,
                    "error",
                    "DUP002",
                    f"paragraph duplicates the paragraph at line {previous_line}",
                )
            )
        else:
            seen_paragraphs[normalized] = paragraph

    near_duplicate_count = 0
    comparable = [
        (paragraph, _content_words(paragraph.text), _normalized(paragraph.text))
        for paragraph in prose_paragraphs
        if len(_content_words(paragraph.text)) >= 8
    ]
    for index, (left, left_words, left_normalized) in enumerate(comparable):
        left_set = set(left_words)
        for right, right_words, right_normalized in comparable[index + 1 :]:
            if left_normalized == right_normalized:
                continue
            length_ratio = min(len(left_words), len(right_words)) / max(len(left_words), len(right_words))
            if length_ratio < 0.65:
                continue
            right_set = set(right_words)
            union = left_set | right_set
            jaccard = len(left_set & right_set) / len(union) if union else 0.0
            sequence_ratio = SequenceMatcher(None, left_words, right_words, autojunk=False).ratio()
            if jaccard >= 0.62 or sequence_ratio >= 0.75:
                left_line, _ = _line_column(text, left.start)
                findings.append(
                    _finding(
                        text,
                        right.start,
                        "warning",
                        "DUP101",
                        f"paragraph may repeat the idea at line {left_line}",
                    )
                )
                near_duplicate_count += 1
                if near_duplicate_count >= 25:
                    break
        if near_duplicate_count >= 25:
            break

    for sentence in sentences:
        count = len(_words(sentence.text))
        if count > 40:
            findings.append(
                _finding(
                    text,
                    sentence.start,
                    "warning",
                    "RHY101",
                    f"sentence has {count} words; check for multiple causal chains",
                )
            )

    for first, second, third in zip(sentences, sentences[1:], sentences[2:]):
        first_words = _words(first.text)
        second_words = _words(second.text)
        third_words = _words(third.text)
        if not first_words or not second_words or not third_words:
            continue
        if first_words[0] == second_words[0] == third_words[0]:
            findings.append(
                _finding(
                    text,
                    third.start,
                    "warning",
                    "RHY102",
                    f"three consecutive sentences begin with {third_words[0]!r}",
                )
            )

    for paragraph in prose_paragraphs:
        word_count = len(_words(paragraph.text))
        sentence_count = len(_sentences(paragraph.text))
        if word_count > 140:
            findings.append(
                _finding(
                    text,
                    paragraph.start,
                    "warning",
                    "RHY103",
                    f"analytical paragraph has {word_count} words; verify it contains one proposition",
                )
            )
        elif sentence_count == 1 and word_count > 35:
            findings.append(
                _finding(
                    text,
                    paragraph.start,
                    "warning",
                    "RHY104",
                    "long one-sentence paragraph may contain an overloaded claim",
                )
            )

    for term in GENERIC_TERMS:
        pattern = re.compile(rf"\b{re.escape(term)}\b", re.IGNORECASE)
        matches = list(pattern.finditer(analysis))
        if matches:
            findings.append(
                _finding(
                    text,
                    matches[0].start(),
                    "warning",
                    "DIC101",
                    f"verify that {term!r} names a concrete property; occurrences: {len(matches)}",
                )
            )

    for match in re.finditer(r"[!?]", analysis):
        message = "question mark requires a non-rhetorical purpose" if match.group(0) == "?" else "exclamation point conflicts with the dry voice"
        findings.append(_finding(text, match.start(), "warning", "TON101", message))

    findings.sort(key=lambda item: (item.line, item.column, item.severity, item.code, item.message))
    return findings


def _read_input(input_name: str) -> tuple[str, str]:
    if input_name == "-":
        return sys.stdin.read(), "<stdin>"
    path = Path(input_name)
    return path.read_text(encoding="utf-8"), str(path)


def _print_text(findings: Sequence[Finding], source: str) -> None:
    for finding in findings:
        print(
            f"{source}:{finding.line}:{finding.column}: "
            f"{finding.severity} {finding.code}: {finding.message}"
        )
    errors = sum(finding.severity == "error" for finding in findings)
    warnings = sum(finding.severity == "warning" for finding in findings)
    print(f"{source}: {errors} error(s), {warnings} warning(s)")


def _print_json(findings: Sequence[Finding], source: str) -> None:
    payload = {
        "source": source,
        "errors": sum(finding.severity == "error" for finding in findings),
        "warnings": sum(finding.severity == "warning" for finding in findings),
        "findings": [asdict(finding) for finding in findings],
    }
    print(json.dumps(payload, indent=2, sort_keys=True))


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--mode", choices=("draft", "final"), default="final")
    parser.add_argument("--format", choices=("text", "json"), default="text")
    parser.add_argument("input", help="UTF-8 file to check, or - for standard input")
    args = parser.parse_args(argv)

    try:
        text, source = _read_input(args.input)
    except (OSError, UnicodeError) as error:
        print(f"style_check.py: {error}", file=sys.stderr)
        return 2

    findings = check_text(text, mode=args.mode)
    if args.format == "json":
        _print_json(findings, source)
    else:
        _print_text(findings, source)
    return 1 if any(finding.severity == "error" for finding in findings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
