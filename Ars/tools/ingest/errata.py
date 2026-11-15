"""Apply the errata patch layer to extracted data.

Errata are *not* applied by hand-editing the JSON in `data/`. Those files are
regenerated from the corpus on every ingest, so a hand edit would be silently
reverted. Instead corrections live in `data/errata.json` and are applied here,
after extraction, leaving an audit trail on each patched record.

Every erratum states the value it expects to find. If that value no longer
matches — because the upstream corpus fixed it, or because our parser changed —
the erratum is reported as stale rather than applied. Nothing is patched
blind.

Run:  python3 tools/ingest/errata.py data
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

# Where a correction should be submitted. This distinction matters: a
# transcription error is the corpus maintainer's to fix, a rules error is
# Atlas's, and a parser bug is ours and should never be filed as an erratum.
DESTINATIONS = {
    "corpus": "Transcription differs from the printed book.",
    "publisher": "The printed book itself is wrong, inconsistent, or ambiguous.",
    "project": "Our own normalization choice, recorded for transparency.",
}

STATUSES = ("unreported", "submitted", "accepted", "rejected", "stale")

# A "correction" patches the extracted data. An "observation" is worth
# reporting upstream but changes nothing here -- a formatting inconsistency
# the parser already handles, or an ambiguity we resolved by convention.
KINDS = ("correction", "observation")


def load_errata(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))["records"]


def find_record(payload: dict, record_id: str) -> dict | None:
    return next((r for r in payload["records"] if r.get("id") == record_id), None)


def apply_all(data_dir: Path) -> tuple[int, list[str]]:
    """Apply every applicable erratum. Returns (applied count, problems)."""
    errata = load_errata(data_dir / "errata.json")
    problems: list[str] = []
    applied = 0
    by_file: dict[str, list[dict]] = {}
    for e in errata:
        if e.get("kind", "correction") == "correction":
            by_file.setdefault(e["file"], []).append(e)

    for filename, items in by_file.items():
        path = data_dir / filename
        if not path.exists():
            problems.append(f"{filename}: file not found (errata: {len(items)})")
            continue
        payload = json.loads(path.read_text(encoding="utf-8"))
        dirty = False

        for e in items:
            if e.get("kind", "correction") != "correction":
                # An observation is reported upstream but patches nothing.
                continue
            record = find_record(payload, e["record"])
            if record is None:
                problems.append(
                    f"{e['id']}: no record {e['record']!r} in {filename} "
                    f"(renamed upstream?)"
                )
                continue

            field = e["field"]
            actual = record.get(field)
            if actual == e["corrected"]:
                problems.append(
                    f"{e['id']}: STALE — {e['record']}.{field} already reads the "
                    f"corrected value. Upstream may have fixed this; mark the "
                    f"erratum accepted and remove it."
                )
                continue
            if actual != e["original"]:
                problems.append(
                    f"{e['id']}: SKIPPED — {e['record']}.{field} is "
                    f"{actual!r}, expected {e['original']!r}. Re-check by hand."
                )
                continue

            record[field] = e["corrected"]
            record.setdefault("errata", []).append(e["id"])
            applied += 1
            dirty = True

        if dirty:
            path.write_text(
                json.dumps(payload, indent=2, ensure_ascii=False) + "\n",
                encoding="utf-8",
            )

    return applied, problems


def main(data_dir: Path) -> None:
    applied, problems = apply_all(data_dir)
    print(f"  errata applied: {applied}")
    for p in problems:
        print(f"    ! {p}")
    if problems:
        sys.exit(1)


if __name__ == "__main__":
    main(Path(sys.argv[1] if len(sys.argv) > 1 else "data"))
