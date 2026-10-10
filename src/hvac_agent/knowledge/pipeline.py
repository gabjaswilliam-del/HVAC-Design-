"""Document pipeline: validate an upload, extract its text, split it into sections and
passages, find vocabulary mentions and derive relationships with their evidence.

Pure functions over bytes and text. Storage, embeddings and job state belong to the
service. Uploaded content is only ever decoded and read as text: markup is stripped,
nothing is rendered, run or followed.
"""

from __future__ import annotations

import bisect
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Callable

from ..core.errors import ServiceError
from . import vocabulary as vocab

PIPELINE_VERSION = "knowledge-pipeline-1"
MAX_DOCUMENT_BYTES = 20 * 1024 * 1024
MAX_TEXT_CHARS = 2_000_000
KINDS = ("manual", "standard", "procedure", "equipment", "reference")
FORMATS = {".md": "text/markdown", ".markdown": "text/markdown", ".txt": "text/plain", ".pdf": "application/pdf"}

# Passages of about 300 tokens (1,200 characters) with about 15% overlap, cut at sentence
# boundaries: the document-import guidance for technical text.
CHUNK_TARGET = 1200
CHUNK_MAX = 1600
OVERLAP = 180


class PipelineError(Exception):
    """A document that cannot be processed: shown on the document, with its stage."""

    def __init__(self, stage: str, message: str):
        super().__init__(message)
        self.stage = stage
        self.message = message


@dataclass
class Section:
    ordinal: int
    heading: str
    level: int
    parent: int | None
    start: int
    end: int
    heading_end: int  # end of the heading line; equals start for a preamble without one
    page: int | None = None
    procedure: bool = False


@dataclass
class Chunk:
    ordinal: int
    section: int
    start: int
    end: int
    page: int | None


@dataclass
class Extracted:
    text: str
    sections: list[Section]
    pages: int | None = None
    page_starts: list[int] = field(default_factory=list)

    def page_at(self, offset: int) -> int | None:
        return bisect.bisect_right(self.page_starts, offset) if self.page_starts else None


@dataclass
class Analysis:
    # (mention with absolute offsets, section ordinal)
    mentions: list[tuple[vocab.Mention, int]]
    # node reference -> (type, name). References: "doc", "sec:N", "proc:N" or an entity ID.
    entities: dict[str, tuple[str, str]]
    # (type, source reference, target reference) -> evidence [(start, end, rule)]
    relations: dict[tuple[str, str, str], list[tuple[int | None, int | None, str]]]


# --- Validation -----------------------------------------------------------------------


def validate_upload(name: str, data: bytes, pdf: tuple[bool, str | None]) -> tuple[str, str]:
    """The media type and a safe display name, or a ServiceError the uploader can act on.
    The type comes from the extension and the content, never from the client's claim."""
    safe = re.sub(r"[\x00-\x1f\x7f]", "", re.split(r"[\\/]", name or "")[-1]).strip()[:200]
    if not safe:
        raise ServiceError("INVALID_REQUEST", "The file needs a name.")
    ext = ("." + safe.rsplit(".", 1)[-1].lower()) if "." in safe else ""
    supported = "Markdown (.md), plain text (.txt)" + (" or PDF (.pdf)" if pdf[0] else "")
    if ext not in FORMATS:
        raise ServiceError("UNSUPPORTED", f"{ext or 'A file without an extension'} is not supported. Supported: {supported}.")
    if not data:
        raise ServiceError("INVALID_REQUEST", "The file is empty.")
    if len(data) > MAX_DOCUMENT_BYTES:
        raise ServiceError("TOO_LARGE", f"The file is {len(data) / 1048576:.1f} MB; the limit is {MAX_DOCUMENT_BYTES // 1048576} MB.")
    media = FORMATS[ext]
    if media == "application/pdf":
        if not pdf[0]:
            raise ServiceError("UNSUPPORTED", pdf[1] or "PDF text extraction is not available.")
        if not data.startswith(b"%PDF-"):
            raise ServiceError("INVALID_REQUEST", "The file is named .pdf but is not a PDF.")
        return media, safe
    if b"\x00" in data:
        raise ServiceError("UNSUPPORTED", "The file contains binary data, not text.")
    try:
        data.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise ServiceError("UNSUPPORTED", "The file is not UTF-8 text.") from None
    return media, safe


# --- Extraction ------------------------------------------------------------------------

_CONTROL = re.compile(r"[\x00-\x08\x0b-\x1f\x7f]")
_BLOCKS = re.compile(r"<!--.*?-->|<(script|style|iframe|object)\b.*?</\1\s*>", re.S | re.I)
_TAG = re.compile(r"</?[A-Za-z][^>\n]*>")
_INLINE = [
    (re.compile(r"!\[([^\]]*)\]\([^)]*\)"), r"\1"),  # image -> its alt text
    (re.compile(r"\[([^\]]+)\]\([^)]*\)"), r"\1"),  # link -> its text
    (re.compile(r"(\*\*|__)(.+?)\1"), r"\2"),
    (re.compile(r"(?<!\w)\*(\S[^*\n]*?)\*(?!\w)"), r"\1"),
    (re.compile(r"`([^`\n]*)`"), r"\1"),
]
_ATX = re.compile(r"^\s{0,3}(#{1,6})\s+(.+?)\s*#*\s*$")
_FENCE = re.compile(r"^\s{0,3}(```|~~~)")
_REF_DEF = re.compile(r"^\s{0,3}\[[^\]]+\]:\s*\S+.*$")
# Plain-text headings: multi-level numbers ("3.2 Condenser"), Section/Chapter N, or a
# short line in capitals. Single numbers are list steps, not headings.
_PLAIN_HEADING = re.compile(r"^(\d{1,2}(?:\.\d{1,2}){1,3})\.?\s+(\S.{1,100})$|^((?:Section|Chapter|Part)\s+\d+\b.{0,100})$")


def _normalise(s: str) -> str:
    s = unicodedata.normalize("NFC", s.replace("\r\n", "\n").replace("\r", "\n"))
    return _CONTROL.sub("", s)


def _inline(line: str) -> str:
    line = _TAG.sub("", line)
    for pattern, repl in _INLINE:
        line = pattern.sub(repl, line)
    return line


def _caps_heading(line: str) -> bool:
    letters = [c for c in line if c.isalpha()]
    return 3 <= len(line.strip()) <= 80 and len(letters) >= 3 and all(c.isupper() for c in letters) and not line.rstrip().endswith(".")


def _parse_lines(raw: str, markdown: bool) -> tuple[str, list[tuple[int, int, int, str]]]:
    """Cleaned text and its headings as (offset, line end, level, text)."""
    out: list[str] = []
    headings: list[tuple[int, int, int, str]] = []
    pos = 0
    fenced = False
    for line in raw.split("\n"):
        level, heading = 0, ""
        if markdown and _FENCE.match(line):
            fenced = not fenced
            continue
        if markdown and not fenced:
            if _REF_DEF.match(line):
                continue
            m = _ATX.match(line)
            if m:
                level, heading = len(m.group(1)), _inline(m.group(2)).strip()
                line = heading
            else:
                line = _inline(line)
        elif not markdown:
            line = line.rstrip()
            m = _PLAIN_HEADING.match(line.strip())
            if m:
                level = m.group(1).count(".") + 1 if m.group(1) else 1
                heading = line.strip()
            elif _caps_heading(line):
                level, heading = 1, line.strip()
        if heading:
            headings.append((pos, pos + len(line), level, heading[:200]))
        out.append(line)
        pos += len(line) + 1
    return "\n".join(out), headings


def extract(media_type: str, data: bytes, title: str, pdf_pages: Callable[[bytes], list[str]] | None = None) -> Extracted:
    page_starts: list[int] = []
    if media_type == "application/pdf":
        if pdf_pages is None:
            raise PipelineError("extract", "PDF text extraction is not available.")
        try:
            pages = pdf_pages(data)
        except Exception as e:  # a damaged or encrypted PDF
            raise PipelineError("extract", f"The PDF could not be read ({type(e).__name__}).") from None
        parts: list[str] = []
        for page in pages:
            page = re.sub(r"(\w)-\n(\w)", r"\1\2", _normalise(page or ""))
            page = "\n".join(line.rstrip() for line in re.sub(r"[ \t]{2,}", " ", page).strip().split("\n"))
            page_starts.append(sum(len(p) + 2 for p in parts))
            parts.append(page)
        # Lines are already trimmed, so parsing keeps every offset (and the page starts).
        text, headings = _parse_lines("\n\n".join(parts), markdown=False)
        if not text.strip():
            raise PipelineError("extract", "The PDF has no extractable text; it may be scanned images, which need OCR.")
    else:
        raw = _normalise(data.decode("utf-8-sig"))
        markdown = media_type == "text/markdown"
        if markdown:
            raw = _BLOCKS.sub("", raw)
        text, headings = _parse_lines(raw, markdown)
    if not text.strip():
        raise PipelineError("extract", "The file has no text to index.")
    if len(text) > MAX_TEXT_CHARS:
        raise PipelineError("extract", f"The extracted text is longer than {MAX_TEXT_CHARS:,} characters.")
    doc = Extracted(text=text, sections=[], pages=len(page_starts) or None, page_starts=page_starts)
    doc.sections = _sections(doc, headings, title)
    return doc


def _sections(doc: Extracted, headings: list[tuple[int, int, int, str]], title: str) -> list[Section]:
    text = doc.text
    sections: list[Section] = []
    first = headings[0][0] if headings else len(text)
    if text[:first].strip():
        sections.append(Section(0, title, 1, None, 0, first, 0))
    stack: list[Section] = []
    for i, (start, line_end, level, heading) in enumerate(headings):
        end = headings[i + 1][0] if i + 1 < len(headings) else len(text)
        while stack and stack[-1].level >= level:
            stack.pop()
        s = Section(len(sections), heading, level, stack[-1].ordinal if stack else None, start, end, line_end)
        s.procedure = vocab.is_procedure_heading(heading)
        sections.append(s)
        stack.append(s)
    for s in sections:
        s.page = doc.page_at(s.start)
    return sections


# --- Sentences and passages -------------------------------------------------------------

_BOUNDARY = re.compile(r"[.!?](?=\s)|\n[ \t]*\n|\n(?=[ \t]*(?:[-*•]|\d+[.)])[ \t])|\n(?=[ \t]*\|)")


def _trim(text: str, a: int, b: int) -> tuple[int, int]:
    while a < b and text[a].isspace():
        a += 1
    while b > a and text[b - 1].isspace():
        b -= 1
    return a, b


def sentences(text: str, a: int, b: int) -> list[tuple[int, int]]:
    """Sentence-like spans in text[a:b]: sentences, list items and table rows."""
    spans, start = [], a
    for m in _BOUNDARY.finditer(text, a, b):
        if text[m.start()] in ".)":  # a list number ("1.") does not end a sentence
            line = text[max(text.rfind("\n", a, m.start()) + 1, a) : m.start()].strip()
            if line.isdigit():
                continue
        s, e = _trim(text, start, m.end())
        if e > s:
            spans.append((s, e))
        start = m.end()
    s, e = _trim(text, start, b)
    if e > s:
        spans.append((s, e))
    # A run-on span longer than a passage is cut at whitespace.
    out = []
    for s, e in spans:
        while e - s > CHUNK_MAX:
            cut = text.rfind(" ", s, s + CHUNK_MAX)
            cut = cut if cut > s else s + CHUNK_MAX
            out.append((s, cut))
            s, _ = _trim(text, cut, e)
        out.append((s, e))
    return out


def section_units(doc: Extracted, s: Section) -> list[tuple[int, int]]:
    units = [(s.start, s.heading_end)] if s.heading_end > s.start else []
    return units + sentences(doc.text, s.heading_end, s.end)


def chunk(doc: Extracted) -> list[Chunk]:
    """Passages packed from whole sentences, never across sections; each passage repeats
    the last sentences of the one before it (up to OVERLAP characters)."""
    chunks: list[Chunk] = []
    for s in doc.sections:
        units = section_units(doc, s)
        i = 0
        while i < len(units):
            j = i + 1
            while j < len(units) and units[j][1] - units[i][0] <= CHUNK_TARGET:
                j += 1
            start, end = units[i][0], units[j - 1][1]
            chunks.append(Chunk(len(chunks), s.ordinal, start, end, doc.page_at(start)))
            if j >= len(units):
                break
            back = j
            while back - 1 > i and end - units[back - 1][0] <= OVERLAP:
                back -= 1
            i = back
    return chunks


# --- Mentions and relationships -----------------------------------------------------------


def analyse(doc: Extracted, title: str, declared_equipment: list[str]) -> Analysis:
    text = doc.text
    result = Analysis(mentions=[], entities={}, relations={})

    def node(ref: str, type_: str, name: str) -> str:
        result.entities.setdefault(ref, (type_, name))
        return ref

    def relate(type_: str, source: str, target: str, start: int | None, end: int | None, rule: str) -> None:
        evidence = result.relations.setdefault((type_, source, target), [])
        if (start, end, rule) not in evidence:
            evidence.append((start, end, rule))

    for s in doc.sections:
        sec = f"sec:{s.ordinal}"
        relate("PART_OF", sec, f"sec:{s.parent}" if s.parent is not None else "doc", s.start, s.heading_end, "structure")
        found = [
            vocab.Mention(m.type, m.key, m.name, m.start + s.start, m.end + s.start, m.surface, m.equipment_class)
            for m in vocab.find_mentions(text[s.start : s.end])
        ]
        units = section_units(doc, s)
        proc = node(f"proc:{s.ordinal}", "procedure", s.heading) if s.procedure else None
        # What a procedure addresses: the faults and symptoms its heading or opening
        # sentence names (a later "once leaks are ruled out" is not what it is for).
        purpose_end = units[1][1] if len(units) > 1 and s.heading_end > s.start else (units[0][1] if units else s.start)
        if proc:
            relate("DESCRIBED_BY", proc, sec, s.start, s.heading_end, "heading")
        for m in found:
            result.mentions.append((m, s.ordinal))
            ent = node(m.entity_id, m.type, m.name)
            if m.type == "standard":
                relate("REFERENCES", sec, ent, m.start, m.end, "mention")
            else:
                relate("DESCRIBED_BY", ent, sec, m.start, m.end, "mention")
            if proc and m.type in ("fault", "symptom") and m.start < purpose_end:
                relate("ADDRESSES", proc, ent, m.start, m.end, "procedure-purpose")
        for a, b in units:
            here = [m for m in found if a <= m.start < b]
            equipment = [m for m in here if m.type == "equipment"]
            # A part belongs to the nearest equipment it can be part of ("the motor of CW pump 2").
            for c in (m for m in here if m.type == "component"):
                fits = [e for e in equipment if e.equipment_class in vocab.PART_OF.get(c.key, ())]
                if fits:
                    e = min(fits, key=lambda e: (min(abs(e.start - c.end), abs(c.start - e.end)), e.start < c.start))
                    relate("PART_OF", c.entity_id, e.entity_id, a, b, "part-in-sentence")
            # A connection is stated between two neighbouring equipment mentions.
            for e1, e2 in zip(equipment, equipment[1:]):
                if e1.key != e2.key and vocab.CONNECTION_CUE.search(text, e1.end, e2.start):
                    relate("CONNECTED_TO", e1.entity_id, e2.entity_id, a, b, "connection-wording")
            if vocab.CAUSE_CUE.search(text, a, b):
                for f in (m for m in here if m.type == "fault"):
                    for y in (m for m in here if m.type == "symptom"):
                        relate("ASSOCIATED_WITH", f.entity_id, y.entity_id, a, b, "cause-wording")

    node("doc", "document", title)
    for m in vocab.find_mentions(title):
        if m.type == "equipment":
            relate("DOCUMENTS", "doc", node(m.entity_id, m.type, m.name), None, None, "title")
    for eq in declared_equipment:
        relate("DOCUMENTS", "doc", node(vocab.entity_id("equipment", eq), "equipment", vocab.equipment_name(eq)), None, None, "metadata")
    return result


def chunk_at(chunks: list[Chunk], offset: int | None) -> Chunk | None:
    """The first passage containing `offset` (passages overlap; the earlier one wins)."""
    if offset is None or not chunks:
        return None
    i = bisect.bisect_right([c.start for c in chunks], offset) - 1
    while i > 0 and chunks[i - 1].end > offset:
        i -= 1
    return chunks[max(i, 0)]
