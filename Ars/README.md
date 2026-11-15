# Ars Ratiocinandi

Web-based tools for playing and running **Ars Magica**: character creation,
covenant creation, a searchable library of ready-made characters and beasts,
and saga management.

Built on the [Ars Magica Open License](https://atlas-games.com/arsmagica/openars).
Not affiliated with, endorsed by, or sponsored by Atlas Games.

**Status: Campaign and Google Sheets prototype.** Grog and companion builders with live validation,
overrides, a printable sheet, a grog generator, and a local roster with JSON
export/import. The campaign year defaults to 1220 and is saved locally. Birth
year determines current age; creation year fixes creation XP and score caps.
Optional identity details and timelines print only when filled in. Abilities
can be searched or browsed by type, with suggested or custom specialties.
Ability-targeted Virtues/Flaws select a specific Ability instance. Puissant adds
its use bonus to the displayed total; Affinity multiplies XP and raises the
creation cap. Botch/aura effects appear as reminders beside the chosen Ability.
New Google Sheets carry these choices and formulas into ongoing direct editing.
Equipment records include type, load, equipped status, descriptions, and manual
effect reminders. Magi remain incomplete: Arts, spells, apprenticeship XP, and
full combat/encumbrance calculations are not yet modeled.

## Running it

```sh
npm install
npm run dev        # local dev server
npm test           # engine tests, including golden characters
npm run build      # static site in dist/ — deploys anywhere, e.g. GitHub Pages
npm run prepare-pages # build and copy the live site into Ars/ for this Pages repo
```

From this checkout, run `cd /Users/charles/Sites/mercere99.github.io/Ars` first.
Open the local URL printed by `npm run dev`; Control-C stops the server.
Dependencies are already installed here. Run `npm install` for a fresh checkout.

### Publishing in the existing ofria.com repository

This project sits inside `mercere99.github.io/Ars`. Run `npm run prepare-pages`
before committing a website update. It builds the app, copies the production
`index.html` and `assets/` into this directory, and records generated assets in
`pages-assets.json` so obsolete bundles can be removed on the next preparation.
Commit these generated files together with the source. The existing Pages
publishing setup can serve them at `https://ofria.com/Ars/` after you push;
no new workflow or change to the rest of the site is required.

Edit `web/index.html` for the development entry; the root `index.html` is
generated and should not be edited by hand. Development still uses `npm run dev`
at the usual localhost URL. `.env.local`, dependencies, and temporary `dist/`
are ignored. Only the three public Google browser identifiers are embedded in
the compiled app; never add an OAuth client secret. The live hostname must be
authorized in Google; see [setup](docs/GOOGLE_SETUP.md).

No application backend. Local drafts and separate campaign calendars/rosters
live in the browser and export characters as JSON. The optional Google prototype
creates a campaign calendar and companion/grog Sheets, reads their calculated
values, and exchanges test events through separate session files. Established
game Sheets are edited directly in Google, not overwritten by the builder.

Google connection requires the developer's one-time setup in
[docs/GOOGLE_SETUP.md](docs/GOOGLE_SETUP.md). This checkout has no OAuth
configuration yet. Local tests and native synthetic Sheet calculations pass;
actual app authorization, two-account sharing, calendar linking, and latency
remain unverified. See [verification results](docs/GOOGLE_TEST_RESULTS.md),
[record contracts](docs/SHEET_CONTRACT.md), and the remaining
[development plan](DEVELOPMENT_PLAN.md).

---

## What is here

```
data/          Extracted game content (CC BY-SA 4.0)
  arts.json              15   Techniques and Forms
  characteristics.json    8
  abilities.json         78
  virtues.json          318
  flaws.json            308
  rdt.json               25   Range/Duration/Target magnitude costs
  effects-manual.json         Hand-curated effects overlay
  errata.json                 Corrections and observations against the source
  rules/                      Numeric rules and constraints as data
  schema/                     JSON Schema for each data file
  library/                    Ready-made characters, beasts, covenants (Phase 2)
src/
  data/ruleset.ts             The one place game data is loaded
  model/                      Character document (versioned) and findings/overrides
  engine/
    resolve.ts                Everything derived from a character
    rules/                    One file per rule; index.ts is the registry
    validate.ts               Runs the registry, joins overrides
    generate.ts               Random grogs from archetypes, seedable
  ui/
    Workbench.tsx             Composes the editing panels
    panels/                   One file per panel
    Findings.tsx              Findings list with accept/revoke
    Sheet.tsx                 The printable fair copy
  storage/persist.ts          Local roster, JSON export/import
  campaign/                   Campaign IDs/calendars, per-session event contracts
  sheets/                     Native workbook plans, formulas, read contracts
  google/                     Browser authorization, Drive transport, polling/outbox
test/
  golden/                     Published characters as fixtures
tools/ingest/  Markdown -> JSON extractors
tools/attribution/          Generates ATTRIBUTION.md from record provenance
tools/errata/               Generates ERRATA.md from data/errata.json
```

## Extending it

The seams are deliberate. Each of these is a "write one file and list it"
change with no other code touched:

| To add… | Write | List it in |
| --- | --- | --- |
| a validation rule | `src/engine/rules/<name>.ts` exporting a `Rule` | `src/engine/rules/index.ts` |
| a workbench panel | `src/ui/panels/<Name>.tsx` taking `PanelProps` | `src/ui/Workbench.tsx` |
| a derived quantity | a field on `Resolved`, computed in `resolve.ts` | — |
| a Virtue/Flaw effect type | a variant on `Effect`, handled in `resolve.ts` | `effects.py` if auto-derivable |
| a grog archetype | an entry in `ARCHETYPES` | — |
| a constraint for a character type | an entry in `data/rules/character-creation.json` | a check in `rules/virtues-flaws.ts` |
| a character schema field | the field and `SCHEMA_VERSION++`; update fixtures | — |

The format is pre-release: schema v2 replaces age with birth/creation years and
adds structured equipment. Older character exports and the v1 browser roster
are not loaded. Compatibility is not a current requirement.

A constraint listed in the data with no matching check is reported as an
info finding rather than silently ignored, so the two cannot drift apart
unnoticed.

Persistence is behind `storage/persist.ts`; swapping localStorage for
IndexedDB or a sync service touches nothing else. The ruleset is one object
(`src/data/ruleset.ts`); supporting ArM5 alongside the Definitive Edition, or
a troupe's house rules, means constructing a second one.

## Rebuilding the data

The corpus is the community transcription of the licensed text:
<https://github.com/OriginalMadman/Ars-Magica-Open-License>. It is not vendored
here; clone it alongside this repository.

```sh
git clone --depth 1 https://github.com/OriginalMadman/Ars-Magica-Open-License.git ../corpus
./build.sh ../corpus/reviewed
```

`build.sh` extracts, applies errata, and regenerates `ATTRIBUTION.md` and
`ERRATA.md`. Run it as a unit — `tools/ingest/errata.py` expects freshly
extracted data and will report already-applied corrections as stale if run on
its own twice.

Each extractor writes an `ingest-warnings-*.txt` beside its output listing
headings it could not parse and inline markers that disagree with the
authoritative index. **A clean run should produce a short, explainable warning
list** — treat new warnings as either a parser bug or a source erratum, not as
noise. Warnings are not checked in.

## Fixing errors in the source

**Never hand-edit `data/*.json`.** Those files are regenerated from the corpus
on every build, so an edit made there is silently reverted on the next run.

Corrections go in `data/errata.json` and are applied as a patch layer after
extraction. Two kinds:

- **correction** — patches a field. States the value it expects to find, so if
  the source is fixed upstream the build reports the entry as *stale* rather
  than applying it twice or masking the fix. Patched records gain an `errata`
  array naming the corrections applied to them, so every departure from the
  printed text is traceable.
- **observation** — worth reporting upstream but patches nothing here: a
  formatting inconsistency the parser already handles, or an ambiguity resolved
  by convention.

Each item carries a `destination` saying where it should be filed, which is the
distinction that matters when you come to submit:

| destination | meaning |
| --- | --- |
| `corpus` | The markdown differs from the printed book. File with the transcription maintainers. |
| `publisher` | The printed book itself is wrong or inconsistent. A candidate for official Atlas errata. |
| `project` | Not an error — a normalization choice we made, recorded so it is visible. |

`ERRATA.md` is generated from this file, grouped by destination and ready to
submit. A parser bug is never an erratum: fix the extractor.

## Effects and overrides

Most Virtues and Flaws are narrative. Of 626 entries, **47 carry machine-
applicable `effects`**; the other 93% print as text for the storyguide to
adjudicate. That ratio is deliberate — the engine models what it can model
cleanly and stays out of the way otherwise.

Effects come from two places. Regular phrasings are parsed automatically
(`"derivation": "auto"`) and regenerated on every build. Entries the parser
cannot reach are curated by hand in `data/effects-manual.json`
(`"derivation": "manual"`), which wins on conflict and lives outside the
regenerated files. `data/effects-review.txt` lists every entry that mentions a
mechanic but received no effect — that file is the curation worklist, and an
entry sitting on it should be a deliberate "narrative only" call rather than an
oversight.

**Every rule can be overridden.** The engine reports findings and never refuses
to produce a character. If a storyguide wants a literate grog, they get one.
The design goal is that overriding is easy but deliberate and permanent:

- An override is **recorded, not dismissed**. It travels with the character,
  carries a reason and a date, and prints on the sheet — so a storyguide
  reading someone else's character can see which rules were set aside and why.
- Findings are **annotated, not suppressed**. An overridden error still exists
  at its original severity and merely displays as info, so "show me everything
  I've overridden" and "show me what would break without my overrides" are both
  answerable.
- Finding ids are keyed on **what the rule is about**, never on position or
  message text, so an override survives reordering the sheet, rewording the
  message, or reimplementing the rule.
- An override whose finding no longer occurs is reported as **stale** and
  offered for removal, never dropped silently. (Same discipline as errata: when
  the world changes underneath a recorded decision, say so.)

See `src/model/findings.ts` and `test/overrides.test.ts`.

## Provenance and attribution

Every record carries `source` (book and year) and `adaptation` (how the text was
changed). `ATTRIBUTION.md` is generated from those fields, so the credit list
cannot silently drift from what is actually in the data. The same fields drive
the in-app filter that restricts a saga to a chosen set of books.

Do not hand-edit `ATTRIBUTION.md`.

## Licensing

Game content and project prose: CC BY-SA 4.0. Original application code:
CC BY-SA 4.0 **or** MIT, at your option. [LICENSE](LICENSE) maps the scope;
[LICENSE-MIT](LICENSE-MIT) contains the standard MIT terms for eligible code.
Published fixtures in `test/golden/` and any copied/adapted game text remain
CC BY-SA 4.0 regardless of their location. Dependencies retain their own licenses.

Generated sheets preserve game-content notices. Using the application does not
by itself license or publish players' original contributions. See LICENSE for
output guidance and the required Atlas and Paradox statements.

Contributions are accepted on the same terms; see CONTRIBUTING.md.

See [ROADMAP.md](ROADMAP.md) for the agreed campaign-manager direction and
[DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md) for the next tasks, dependencies, and
acceptance criteria.
