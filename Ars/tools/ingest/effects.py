"""Derive machine-applicable `effects` for Virtues and Flaws.

Two sources, applied in this order:

1. **Automatic.** Regular phrasings are parsed out of the text. Every auto
   effect is tagged `"derivation": "auto"` and is disposable — it is
   regenerated from scratch on every build.
2. **Manual.** `data/effects-manual.json` is a hand-curated overlay for entries
   the parser cannot reach. Tagged `"derivation": "manual"`, and it wins on
   conflict. It lives outside `data/*.json` for the same reason errata do:
   those files are regenerated and would lose the edits.

Everything the parser *declines* to interpret is listed in
`data/effects-review.txt`. That file is the curation worklist: an entry
appearing there either needs a manual effect or is genuinely narrative and
should be left alone. Silence is never the answer — an entry that mentions a
mechanic but gets no effect should be a deliberate call, not an oversight.

Run:  python3 tools/ingest/effects.py data
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ABILITY_TYPES = "Academic|Arcane|Martial|Supernatural|General"

# "You may purchase Academic Abilities during character generation."
# "Due to your training, you may take Martial Abilities at character creation."
# "You may take Academic and Arcane Abilities during character generation."
ACCESS = re.compile(
    rf"\bmay (?:purchase|take|learn|buy|acquire)\s+"
    rf"((?:(?:{ABILITY_TYPES})(?:,\s*|\s+and\s+|\s+or\s+)?)+)\s*Abilities"
    rf"(?:\s+(?:during|at)\s+character\s+(?:generation|creation))?",
    re.I,
)

# "You add 3 to the value of one Art whenever you use it." (Puissant Art)
# "adept with one Ability, and add 2 to its value"          (Puissant Ability)
SCORE_BONUS = re.compile(
    r"\badept with one (Art|Ability)\b[^.]*?\badds?\s+(\d+)\s+to\s+its\s+value"
    r"|\badds?\s+(\d+)\s+to\s+the\s+value\s+of\s+one\s+(Art|Ability)\b",
    re.I,
)

# "gain an additional 50 experience points which must be spent on Martial Abilities"
XP_GRANT = re.compile(
    rf"gain(?:s)?\s+an?\s+additional\s+(\d+)\s+experience\s+points?"
    rf"[^.]*?\bon\s+({ABILITY_TYPES})\s+Abilities",
    re.I,
)

# "Advancement Totals for one Hermetic Art are increased by one half" (Affinity)
AFFINITY = re.compile(
    r"Advancement Totals?\s+for\s+one\s+(?:Hermetic\s+)?(Art|Ability)\s+are\s+"
    r"increased\s+by\s+(?:one\s+)?half",
    re.I,
)

# "beginning score of 1 in Heartbeast"
STARTING_SCORE = re.compile(r"beginning score of\s+(\d+)\s+in\s+([A-Z][\w' ]+)", re.I)

# Entries that mention a mechanic but that we do not auto-interpret.
CANDIDATE = re.compile(
    r"\bAbilities\b|\bAdvancement Total|\bexperience points?\b|[+-]\d+\b", re.I
)


def derive(record: dict) -> list[dict]:
    text = record["text"]
    effects: list[dict] = []

    for match in ACCESS.finditer(text):
        types = [
            t.lower()
            for t in re.findall(ABILITY_TYPES, match.group(1), re.I)
        ]
        effects.append(
            {
                "type": "ability-access",
                "categories": sorted(set(types)),
                "scope": "creation",
                "derivation": "auto",
            }
        )

    if m := SCORE_BONUS.search(text):
        kind = (m.group(1) or m.group(4)).lower()
        value = int(m.group(2) or m.group(3))
        effects.append(
            {
                "type": "score-bonus",
                "target": {"kind": kind, "chosen": True},
                "value": value,
                "derivation": "auto",
            }
        )

    if m := XP_GRANT.search(text):
        effects.append(
            {
                "type": "xp-grant",
                "amount": int(m.group(1)),
                "restrictedTo": {"kind": "ability", "category": m.group(2).lower()},
                "derivation": "auto",
            }
        )

    if m := AFFINITY.search(text):
        effects.append(
            {
                "type": "advancement-multiplier",
                "target": {"kind": m.group(1).lower(), "chosen": True},
                "factor": 1.5,
                "rounding": "up",
                "derivation": "auto",
            }
        )

    if m := STARTING_SCORE.search(text):
        effects.append(
            {
                "type": "starting-score",
                "target": {"kind": "ability", "name": m.group(2).strip()},
                "value": int(m.group(1)),
                "derivation": "auto",
            }
        )

    # Deduplicate identical auto effects from repeated phrasings.
    seen, unique = set(), []
    for e in effects:
        key = json.dumps(e, sort_keys=True)
        if key not in seen:
            seen.add(key)
            unique.append(e)
    return unique


def main(data_dir: Path) -> None:
    manual_path = data_dir / "effects-manual.json"
    manual = {}
    if manual_path.exists():
        for r in json.loads(manual_path.read_text(encoding="utf-8"))["records"]:
            manual[r["record"]] = r["effects"]

    review: list[str] = []
    counts = {"auto": 0, "manual": 0, "entries": 0}

    for filename in ("virtues.json", "flaws.json"):
        path = data_dir / filename
        payload = json.loads(path.read_text(encoding="utf-8"))
        for record in payload["records"]:
            auto = derive(record)
            override = manual.get(record["id"])
            if override is not None:
                for e in override:
                    e.setdefault("derivation", "manual")
                record["effects"] = override
                counts["manual"] += len(override)
            else:
                record["effects"] = auto
                counts["auto"] += len(auto)
            if record["effects"]:
                counts["entries"] += 1
            elif CANDIDATE.search(record["text"]):
                review.append(f"{record['id']}\t{record['name']}")
        path.write_text(
            json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8"
        )

    (data_dir / "effects-review.txt").write_text(
        "# Entries mentioning a mechanic that received no effect.\n"
        "# Each needs either an entry in effects-manual.json or a deliberate\n"
        "# decision that it is narrative only.\n"
        + "\n".join(sorted(review))
        + "\n",
        encoding="utf-8",
    )

    print(
        f"  effects: {counts['entries']} entries "
        f"({counts['auto']} auto, {counts['manual']} manual), "
        f"{len(review)} awaiting review"
    )


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "data"))
