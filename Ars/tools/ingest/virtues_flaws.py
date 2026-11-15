"""Extract Virtues and Flaws from the Definitive Edition core rules.

Entry shape in the source:

    #### Affinity with Art
    *Minor, Hermetic*<br>
    Your Advancement Totals for one Hermetic Art are increased by...
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

from common import (
    CORE,
    Entry,
    clean_text,
    load,
    section,
    slug,
    source,
    split_entries,
    warn,
    write_json,
    write_warnings,
)

SIZES = {"free", "minor", "major"}

# `*Minor, Hermetic*<br>`, `*Major or Minor, Supernatural, Tainted*<br>`,
# `*Free, Social Status, animals only*<br>` — a size followed by one or more
# categories and/or restriction tags.
QUALIFIER = re.compile(r"^\*([^*]+?)\*")

# Parameterized entries: "Puissant (Art)", "Alluring to (Beings)".
PARAMETER = re.compile(r"\(([^)]+)\)\s*$")

CATEGORY_MAP = {
    "general": "general",
    "hermetic": "hermetic",
    "supernatural": "supernatural",
    "social status": "social-status",
    "personality": "personality",
    "story": "story",
    "child": "child",
    "heroic": "heroic",
    "mythic": "mythic",
    "mythic companion": "mythic-companion",
    "special": "special",
}

# "General and Hermetic", "Hermetic or General", "Story and Hermetic"
CONJUNCTION = re.compile(r"\s+(?:and|or)\s+")


def parse_entry(entry: Entry, kind: str) -> dict | None:
    body = [b for b in entry.body if b.strip()]
    if not body:
        return None

    match = QUALIFIER.match(body[0].strip())
    if not match:
        # Not a Virtue/Flaw entry — almost always a stray discussion heading.
        return None

    fields = [f.strip() for f in match.group(1).split(",") if f.strip()]
    if len(fields) < 2:
        return None

    # A handful of source entries reverse the order ("*General, Minor*").
    size_index = next(
        (
            i
            for i, f in enumerate(fields)
            if all(p in SIZES for p in CONJUNCTION.split(f.lower()))
        ),
        None,
    )
    if size_index is None:
        return None
    if size_index != 0:
        warn(f"{kind} {entry.name!r}: size/category order reversed in source")

    # Size may be a disjunction: "Major or Minor" means the player chooses.
    sizes = CONJUNCTION.split(fields.pop(size_index).lower())

    categories, tags = [], []
    for raw in fields:
        # Compound categories: "General and Hermetic" is both, not a tag.
        parts = CONJUNCTION.split(raw)
        if all(p.lower() in CATEGORY_MAP for p in parts):
            categories.extend(CATEGORY_MAP[p.lower()] for p in parts)
        else:
            tags.append(slug(raw))
    if not categories:
        return None

    param = PARAMETER.search(entry.name)

    record = {
        "id": f"{kind}.{slug(entry.name)}",
        "name": entry.name,
        "kind": kind,
        "size": sizes[0] if len(sizes) == 1 else sizes,
        "categories": categories,
        "tags": tags,
        "parameterized": param.group(1) if param else None,
        "effects": [],  # populated by hand for mechanically load-bearing entries
        "requires": [],
        "excludes": [],
        "text": clean_text(body[1:]),
        "source": source(),
        "adaptation": "verbatim",
        "ruleset": ["definitive"],
    }
    if not record["parameterized"]:
        del record["parameterized"]
    return record


def main(corpus: Path, out: Path) -> None:
    core = corpus / f"{CORE.replace(': ', ' - ')} (Core Rules).md"
    lines = load(core)

    for kind, start, end in [
        ("virtue", "## Virtues", "## List of Flaws"),
        ("flaw", "## Flaws", "# Chapter 5: Abilities"),
    ]:
        entries = split_entries(section(lines, start, end))
        records = []
        for entry in entries:
            record = parse_entry(entry, kind)
            if record is None:
                warn(f"{kind}: unparsed heading {entry.name!r}")
            else:
                records.append(record)
        write_json(
            out / f"{kind}s.json",
            records,
            description=f"{kind.title()}s from the Ars Magica core rules.",
        )
    write_warnings(out / "ingest-warnings.txt")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
