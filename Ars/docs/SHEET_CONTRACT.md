# Campaign and workbook contracts

This is a pre-release format. Stable IDs identify records; names and Drive file
titles may change. Campaigns do not require covenants, owners, or a fixed GM.

## Authority and writes

| Displayed value | Authoritative input/calculation | Website writes |
| --- | --- | --- |
| Connected campaign name, year, season, location, default language | Campaign index Sheet, `ars_campaign` | Initial creation only |
| Character name, type, role, birth/creation dates | Character Identity tab, `ars_identity` | Initial creation only |
| Current age | Summary B3, `ars_age`, from campaign year minus birth year | Initial formula only |
| Ability XP / scores / progress | Abilities formulas over Creation XP and Advancement | Initial inputs/formulas only |
| Confidence, wounds, fatigue, reputation | Condition inputs; Summary links to their totals | Initial inputs/formulas only |
| Equipment load, equipped reminder, numeric Soak | Equipment inputs; Summary/Condition formulas | Initial inputs/formulas only |
| Character file registrations | Union of each member's `register-record` events | Originating app session |
| Local drafts and campaign selection | Browser storage, separate from canonical Sheets | Local browser only |

The browser stores no OAuth token in these records. Connected snapshots contain
calculated Sheet values and a fetch timestamp. They do not pass through creation
validation: earned XP in an established character is not creation overspending.

## Campaign and initial records

The campaign index uses `ars.campaign.v1`, with the `ars_campaign` named range
covering these two-column rows in the Campaign tab:

| Field | Example | Treatment |
| --- | --- | --- |
| Contract | ars.campaign.v1 | Preserve |
| Campaign ID | saga-example | Preserve |
| Name | The Winter Covenant | Entered |
| Year | 1220 | Entered, integer |
| Season | Spring | Entered, one of four seasons |
| Notes | A troupe exploring the Pyrenees | Narrative |
| Location | Provence | Starting Area Lore subject for new characters |
| Default language | Occitan | Starting native tongue for new characters |

`ars_campaign_year` points to B6 and `ars_campaign_season` to B7. One campaign
has one calendar. A new local campaign defaults independently to Spring 1220.
Location and default language occupy A9:B10; the reader includes these rows
even if an earlier named range stopped at row 8. Existing Sheets are never
rewritten automatically. To add defaults there, enter `Location` in A9 and
`Default language` in A10, with the values beside them, then refresh the website.

The following are initial column contracts for later covenant work; library
and vis workbook creation are **not implemented** in this batch:

| Record | Columns | Example |
| --- | --- | --- |
| Library | Book ID, Title, Subject, Type, Level, Quality, Available, Notes | book-01; The Living Earth; Terram; Summa; 6; 12; TRUE; Latin |
| Vis ledger | Transaction ID, Year, Season, Art, Amount (+/-), Reason, Notes | vis-01; 1220; Spring; Vim; +3; Spring harvest; Delivered to stores |

Balances will be calculated from transactions, with stable IDs for later activity
links. The current model also allows a lightweight custom NPC, for example:

```json
{"id":"npc-01","campaignId":"saga-example","role":"npc","kind":"custom","name":"The ferryman","description":"Knows the river crossings"}
```

This has no owner or build requirements. The lightweight NPC editor remains a
later UI task. Full characters independently choose build kind (grog, companion,
eventually magus) and narrative role (`player-character`, `shared`, `npc`).

## Companion and grog workbook

Contract: `ars.character.v1`. Each generated workbook is editable without the
website. Its native formulas are not a hidden JSON mirror.

| Tab | Purpose and editable values |
| --- | --- |
| Summary | Readable calculated age, condition, Soak, load and ability scores |
| Identity | Name, kind, birth/creation year, campaign Sheet link, narrative role, concept, notes and optional details |
| Abilities | Stable per-ability key, rules ID, name, subject, specialty, calculated Virtue use bonus, Affinity multiplier, reminders, extra manual use bonus and optional score override |
| Creation XP | One row per ability/pool allocation; native language has its own allowance |
| Advancement | One row per later award: year, season, activity, ability key, XP before Affinity, notes, calculated XP |
| Virtues & Flaws | Entries, text, source, explicit creation-XP grant and later-life rate inputs, chosen Ability key and effect reminder |
| Equipment | Type, load, description, equipped checkbox, effect reminder, explicitly entered numeric Soak bonus |
| Characteristics | Final scores including supported builder adjustments at export; later edits entered manually, alongside personality traits |
| Condition | Confidence, fatigue penalty, wounds, Warping, Decrepitude, action status, other Soak modifier and reputations |
| Timeline | Stable event ID, year, event, notes; no duplicate calendar |
| Rules | Formula parameters, supported/manual mechanics, attribution and ability reference |

Named ranges are `ars_identity` (Identity A3:B26), `ars_abilities` (Abilities
A5:Q205), `ars_age` (Summary B3), and `ars_condition` (Condition A5:B17).
Readers find the named ranges and verify the contract, identity fields and
ability headers. Missing ranges, duplicate ability keys, and nonnumeric formula
results produce repair guidance. A calendar `#REF!` points to Google's Allow
access step. File renaming preserves its Drive ID and these ranges.

An ability key distinguishes multiple instances of the same rules ID, such as
`language-catalan` and `language-latin`. Ledger rows refer to that key, so changing
a displayed name does not reassign XP. Keep keys unique and unchanged once used.

### Calculations and manual decisions

Creation XP (rounded up after applying Affinity) plus calculated earned XP determines total XP. Advancement applies Affinity and rounds up **each award separately**. Creation budget spending still uses the original, unmultiplied allocations. For multiplier 5, base score
`s` is the largest integer with `5*s*(s+1)/2 <= XP`. Surplus is XP above that
threshold; XP to next is the next threshold minus total XP. Puissant Ability adds 2 to the effective score **in use**, without changing the learned score or XP; learning, writing and teaching use the learned score. The extra manual use bonus also changes the effective score without changing the base/XP. A numeric override,
including **zero**, replaces the effective score. Blank means use base + Virtue use bonus + extra manual use bonus.

Targeted entries refer to the stable Ability key in Virtues & Flaws column L.
Puissant and Affinity formulas match both this key and the entry's Rules ID;
duplicate takings do not stack. The chosen subject label follows the Ability
row, so languages and Craft subjects remain distinct. Retargeting or removing
a taking recalculates the corresponding bonus/multiplier. The formulas treat
Affinity as present throughout the recorded XP history; acquiring it during
play and preserving earlier unmodified awards requires manual adjudication.
Botch rules and the conditional −3 outside a required realm aura are reminders,
not unconditional score changes. The realm is entered in Subject / realm.
Enchanting (Ability)'s granted supernatural Ability still needs to be added
separately. Existing Google files are never rewritten by these template changes.

Creation budget uses creation year minus birth year, not today's campaign year.
The supported initial budget is childhood XP plus later-life years times the
selected rate plus explicit grants. Native-language allocations consume their
separate allowance up to 75; excess XP counts against the main budget. Available,
allocated and unspent main creation XP remain visible. Pool labels record
restricted awards, but eligibility, spending restrictions, creation score-cap
enforcement and other Virtue effects still require manual checking in Sheets.
This is a partial rules implementation, not complete automated legality checking.

Current year reads the campaign index through native `IMPORTRANGE`. With no
linked campaign, it reads the clearly labelled standalone year input. An
inaccessible **linked** calendar never silently falls back to a local year.
Changing either current year changes age without granting XP.

Wound penalty is `-light -3*medium -5*heavy`. Soak includes entered Stamina,
equipped items' **numeric** Soak bonuses and an explicit other modifier. All
listed equipment contributes carried load. Free-form effect descriptions are
reminders; they are never parsed as formulas. Combat, encumbrance, incapacitation,
seasonal eligibility, aging and most Virtue effects need adjudication. Confidence
starts at the build kind's default; Virtue changes are entered manually.

Capacities: 200 abilities, Virtues/Flaws and equipment rows; 500 creation
allocations and advancement awards. Prepared formulas and contracts cover those
bounds. Adding rows beyond them requires a future template expansion. The app
rejects an over-capacity builder export and does not claim a magus template.

## Per-writer state and events

The signed-in member ID is Google's Drive permission ID, not an email-derived
name. Example member: `{"id":"drive-permission-alpha","displayName":"Alex"}`.
Example registered file:

```json
{"id":"character-01","fileId":"google-file-id","label":"Elena","kind":"character"}
```

Each mounted browser workspace creates its own random session ID and event file;
two tabs of the same account do not share a mutable stream. An example envelope:

```json
{
  "schemaVersion": 1,
  "campaignId": "saga-example",
  "actorId": "drive-permission-alpha",
  "sessionId": "session-example",
  "events": [{
    "id": "event-example",
    "campaignId": "saga-example",
    "actorId": "drive-permission-alpha",
    "sessionId": "session-example",
    "sequence": 1,
    "logicalTime": 1,
    "createdAt": "2026-11-14T12:00:00Z",
    "type": "register-record",
    "payload": {"record":{"id":"character-01","fileId":"google-file-id","label":"Elena","kind":"character"}}
  }]
}
```

Readers validate ownership/envelope consistency, sequence, unique event IDs and
increasing logical time. Merging deduplicates event IDs and orders by logical
time, actor, session, sequence and ID. Wall-clock timestamps are descriptive;
they do not elect the storyguide. Publishing advances logical time above the
observed histories. Actual takeover reconciliation/UI and dice are later tasks.

Pending uploads retain the generated event and original destination in browser
storage. Reconnect as that member to retry an earlier upload. Before replacement,
the writer checks file ownership and the retained remote event prefix; a newer
acknowledged history is preserved. Streams are limited to 5,000 events. No
tamper-proof audit or distributed hard-lock claim is made for this trusted troupe.

Registrations combine across streams instead of rewriting the campaign index.
Drive sharing enforces who can edit each file; selecting a folder in the app
does not itself configure permissions. See [GOOGLE_SETUP.md](GOOGLE_SETUP.md).
