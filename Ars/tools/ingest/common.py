"""Shared helpers for ingesting Ars Magica Open License markdown into JSON.

Source corpus: https://github.com/OriginalMadman/Ars-Magica-Open-License
All extracted text is CC BY-SA 4.0; see LICENSE.
"""

from __future__ import annotations

import json
import re
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path

CORE = "Ars Magica: Definitive Edition"
CORE_YEAR = 2024

# ---------------------------------------------------------------- file loading


def load(path: Path) -> list[str]:
    """Read a corpus file as a list of lines with CRLF and NBSP normalized."""
    text = path.read_text(encoding="utf-8")
    text = text.replace("\r\n", "\n").replace("\u00a0", " ")
    return text.split("\n")


def section(lines: list[str], start_heading: str, end_heading: str) -> list[str]:
    """Return the lines strictly between two headings (exclusive of both)."""
    start = end = None
    for i, line in enumerate(lines):
        stripped = line.strip()
        if start is None and stripped == start_heading:
            start = i + 1
        elif start is not None and stripped == end_heading:
            end = i
            break
    if start is None:
        raise KeyError(f"start heading not found: {start_heading!r}")
    if end is None:
        raise KeyError(f"end heading not found: {end_heading!r}")
    return lines[start:end]


# ------------------------------------------------------------------- cleaning

FOOTNOTE_MARK = re.compile(r"\\\*")
BOLD_ITALIC = re.compile(r"\*{1,3}(.+?)\*{1,3}")
PAGE_REF = re.compile(r"\s*\(see page \d+\)|\s*\(page \d+\)")


def clean_name(raw: str) -> tuple[str, bool]:
    """Strip the markdown heading, escapes, and the restricted-Ability asterisk.

    Returns (name, had_asterisk). The asterisk in the source marks entries with
    a usage restriction; we keep it as a boolean rather than in the name.
    """
    name = raw.strip().lstrip("#").strip()
    had_star = bool(FOOTNOTE_MARK.search(name)) or name.endswith("*")
    name = FOOTNOTE_MARK.sub("", name).rstrip("*").strip()
    return unicodedata.normalize("NFC", name), had_star


def clean_text(paragraphs: list[str]) -> str:
    """Join body paragraphs into a single string, dropping markdown line breaks."""
    out = []
    for p in paragraphs:
        p = p.replace("<br>", " ").strip()
        if p:
            out.append(re.sub(r"\s+", " ", p))
    return "\n\n".join(out)


def slug(*parts: str) -> str:
    """Stable, URL-safe id fragment."""
    joined = " ".join(parts)
    joined = unicodedata.normalize("NFKD", joined)
    joined = joined.encode("ascii", "ignore").decode("ascii").lower()
    joined = re.sub(r"[^a-z0-9]+", "-", joined)
    return joined.strip("-")


def is_sidebar(line: str) -> bool:
    """Blockquotes in the corpus are sidebars and tables, not entry bodies."""
    return line.lstrip().startswith(">")


# -------------------------------------------------------------------- records


@dataclass
class Entry:
    """One `#### Heading` block: the heading plus its body paragraphs."""

    name: str
    asterisk: bool
    body: list[str] = field(default_factory=list)


def split_entries(lines: list[str], level: str = "#### ") -> list[Entry]:
    """Split a section into entries keyed on headings of the given level.

    Sidebar blockquotes are dropped, as are nested headings of other levels
    (which in this corpus are always sub-discussion, never new entries).
    """
    entries: list[Entry] = []
    current: Entry | None = None
    for line in lines:
        if is_sidebar(line):
            continue
        if line.startswith(level):
            name, star = clean_name(line)
            current = Entry(name=name, asterisk=star)
            entries.append(current)
        elif current is not None:
            current.body.append(line)
    return entries


def source(book: str = CORE, year: int = CORE_YEAR) -> dict:
    return {"book": book, "year": year}


def write_json(path: Path, records: list[dict], *, description: str) -> None:
    """Write a data file with its provenance header."""
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "$schema": f"./schema/{path.stem}.schema.json",
        "description": description,
        "license": "CC BY-SA 4.0",
        "attribution": (
            "Based on the material for Ars Magica, \u00a91993\u20132024, licensed by "
            "Trident, Inc. d/b/a Atlas Games\u00ae, under Creative Commons "
            "Attribution-ShareAlike 4.0 International license 4.0 (\"CC-BY-SA 4.0\")"
        ),
        "count": len(records),
        "records": records,
    }
    path.write_text(
        json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
    )
    print(f"  wrote {path.name}: {len(records)} records")


# ------------------------------------------------------------------- warnings

WARNINGS: list[str] = []


def warn(message: str) -> None:
    """Record a source-quirk warning for the ingest report."""
    WARNINGS.append(message)


def write_warnings(path: Path) -> None:
    path.write_text("\n".join(WARNINGS) + ("\n" if WARNINGS else ""), encoding="utf-8")
    print(f"  {len(WARNINGS)} source warning(s) -> {path.name}")
