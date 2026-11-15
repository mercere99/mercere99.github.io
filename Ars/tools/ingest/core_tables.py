"""Extract Arts, Characteristics, Abilities, and the Range/Duration/Target
tables from the Definitive Edition core rules."""

from __future__ import annotations

import re
import sys
from pathlib import Path

from common import (
    CORE,
    clean_name,
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

# `#### Creo (Cr) "I Create"` / `#### Animal (An) "animal"` / `#### Quickness (Qik)`
ART_HEADING = re.compile(r'^(.+?)\s*\(([A-Za-z]{2,3})\)\s*(?:[""](.+?)[""])?$')
PRONUNCIATION = re.compile(r"Pronounced\s+'(.+?)\.?'")
FORM_BONUS = re.compile(r"\*Form Bonus:\*\s*(.+)")
SPECIALTIES = re.compile(r"\*Specialt(?:ies|y)\*?:?\*?\s*(.+?)\s*\(([A-Za-z ]+)\)\s*$")

ABILITY_TYPES = {
    "general": "general",
    "academic": "academic",
    "arcane": "arcane",
    "martial": "martial",
    "supernatural": "supernatural",
    "spell mastery": "spell-mastery",
}


def arts(lines: list[str], out: Path) -> None:
    records = []
    for kind, start, end in [
        ("technique", "### Techniques", "### Forms"),
        ("form", "### Forms", "## Limits of Magic"),
    ]:
        for entry in split_entries(section(lines, start, end)):
            match = ART_HEADING.match(entry.name)
            if not match:
                warn(f"art: unparsed heading {entry.name!r}")
                continue
            name, abbrev, latin = match.groups()
            body = "\n".join(entry.body)
            pron = PRONUNCIATION.search(body)
            bonus = FORM_BONUS.search(body)
            text = clean_text(
                [
                    b
                    for b in entry.body
                    if b.strip()
                    and not PRONUNCIATION.search(b)
                    and not FORM_BONUS.search(b)
                ]
            )
            records.append(
                {
                    "id": f"art.{slug(name)}",
                    "name": name.strip(),
                    "abbreviation": abbrev,
                    "kind": kind,
                    "latin": latin.strip() if latin else None,
                    "pronunciation": pron.group(1) if pron else None,
                    "formBonus": bonus.group(1).strip() if bonus else None,
                    "text": text,
                    "source": source(),
                    "adaptation": "abridged",
                    "ruleset": ["definitive"],
                }
            )
    write_json(
        out / "arts.json", records, description="The five Techniques and ten Forms."
    )


def characteristics(lines: list[str], out: Path) -> None:
    records = []
    for entry in split_entries(
        section(lines, "### Characteristic Descriptions", "### Abilities")
    ):
        match = ART_HEADING.match(entry.name)
        if not match:
            warn(f"characteristic: unparsed heading {entry.name!r}")
            continue
        name, abbrev, _ = match.groups()
        records.append(
            {
                "id": f"characteristic.{slug(name)}",
                "name": name.strip(),
                "abbreviation": abbrev,
                "text": clean_text(entry.body),
                "source": source(),
                "adaptation": "verbatim",
                "ruleset": ["definitive"],
            }
        )
    write_json(
        out / "characteristics.json",
        records,
        description="The eight Characteristics.",
    )


INDEX_LINK = re.compile(r"^\[(.+?)\]\(#.+?\)")


def ability_type_index(lines: list[str]) -> dict[str, str]:
    """The 'Abilities by Type' cross-reference is the authoritative typing.

    The inline '(General)' marker on each description is a convenience repeat
    and is missing on some Supernatural entries, so we index on this instead
    and use the inline marker only to cross-check.
    """
    index: dict[str, str] = {}
    current = None
    for line in section(lines, "## Abilities by Type", "## Ability List"):
        stripped = line.strip()
        if stripped.startswith("####"):
            label = stripped.lstrip("#").strip().removesuffix("Abilities").strip()
            current = ABILITY_TYPES.get(label.lower())
            if current is None:
                warn(f"ability index: unknown type heading {label!r}")
        elif current and (match := INDEX_LINK.match(stripped)):
            name, _ = clean_name(match.group(1))
            index[name] = current
    return index


def abilities(lines: list[str], out: Path) -> None:
    index = ability_type_index(lines)
    described: set[str] = set()
    records = []

    for entry in split_entries(
        section(lines, "## Ability List", "# Chapter 6: Covenants")
    ):
        name, pronunciation = entry.name, None
        if name not in index:
            # A few headings carry a pronunciation gloss: 'Chirurgy (kie-RUHR-gee)'.
            # Parameterized names like 'Craft (Type)' match the index directly,
            # so this fallback only fires on genuine glosses.
            stripped = re.sub(r"\s*\(([^)]+)\)\s*$", "", name)
            if stripped in index:
                pronunciation = re.search(r"\(([^)]+)\)\s*$", name).group(1)
                name = stripped
            else:
                # Sub-headings such as 'Hex Effects' expand the preceding entry.
                continue
        described.add(name)
        body = [b for b in entry.body if b.strip()]
        spec_line = next(
            (m for b in reversed(body) if (m := SPECIALTIES.search(b.strip()))), None
        )

        specialties: list[str] = []
        if spec_line:
            specialties = [
                s.strip(" .")
                for s in re.split(r",\s*", spec_line.group(1))
                if s.strip(" .")
            ]
            inline = spec_line.group(2).strip().lower()
            if ABILITY_TYPES.get(inline) not in (None, index[name]):
                warn(
                    f"ability {name!r}: index says {index[name]!r}, "
                    f"inline marker says {inline!r}"
                )

        records.append(
            {
                "id": f"ability.{slug(name)}",
                "name": name,
                "pronunciation": pronunciation,
                "type": index[name],
                # The source marks entries with a usage restriction by asterisk.
                "restricted": entry.asterisk,
                # "(Area) Lore", "Craft (Type)" — the player names the subject.
                "parameterized": "(" in name,
                "specialties": specialties,
                "text": clean_text([b for b in body if not SPECIALTIES.search(b)]),
                "source": source(),
                "adaptation": "verbatim",
                "ruleset": ["definitive"],
            }
        )

    for missing in sorted(set(index) - described):
        warn(f"ability {missing!r}: in the type index but has no description entry")

    write_json(out / "abilities.json", records, description="The Ability list.")


def rdt(lines: list[str], out: Path) -> None:
    """Parse the Ranges/Durations/Targets magnitude table out of its sidebar."""
    block = section(lines, "### Ranges, Durations, Targets", "#### Ranges")
    rows = [
        [c.strip() for c in line.lstrip("> ").strip().strip("|").split("|")]
        for line in block
        if line.lstrip().startswith(">") and line.count("|") >= 5
    ]
    rows = [r for r in rows if r and re.fullmatch(r"\d+", r[0])]
    if len(rows) != 5:
        warn(f"rdt: expected 5 magnitude rows, found {len(rows)}")

    header = ["magnitudes", "range", "duration", "object", "container", "sense"]
    records = []
    for row in rows:
        magnitude = int(row[0])
        for column, cell in zip(header[1:], row[1:]):
            if cell == "-":
                continue
            for option in cell.split("/"):
                option = option.strip()
                parameter = "target" if column in ("object", "container", "sense") else column
                records.append(
                    {
                        "id": f"rdt.{parameter}.{slug(option)}",
                        "name": option,
                        "parameter": parameter,
                        "targetType": column if parameter == "target" else None,
                        "magnitudes": magnitude,
                        "source": source(),
                        "adaptation": "restructured",
                        "ruleset": ["definitive"],
                    }
                )
    write_json(
        out / "rdt.json",
        records,
        description="Range, Duration, and Target options with their magnitude costs.",
    )


def main(corpus: Path, out: Path) -> None:
    lines = load(corpus / f"{CORE.replace(': ', ' - ')} (Core Rules).md")
    arts(lines, out)
    characteristics(lines, out)
    abilities(lines, out)
    rdt(lines, out)
    write_warnings(out / "ingest-warnings-core.txt")


if __name__ == "__main__":
    main(Path(sys.argv[1]), Path(sys.argv[2]))
