# Google integration verification

## Current status

Local automated checks exercise campaign separation, event ordering, queued
upload recovery, file ownership guards, uncertain creation outcomes, read-only
Sheet reads, formula errors, and changed-file polling. These use synthetic data
and mocked transport. They do not prove Google account access or remote timing.

The project's own OAuth configuration is now supplied locally. The first
user-reported connection attempt reached the app's account lookup but failed
because its default transport invoked browser `fetch` with a `GoogleDrive`
receiver. The default transport now calls `globalThis.fetch` through a wrapper;
a regression test enforces the browser's receiver requirement and checks the
authenticated account lookup. The user subsequently confirmed that the Google
Drive connection works and campaign folders are created. Parent-folder selection
has since been added; it and moving folders still need a real-account check.
Campaign creation and joining now start from the top campaign selector; joining
no longer requires a placeholder. A local transport test checks that joining
retains the existing campaign ID/calendar and makes only read requests. The
two-account Picker and sharing workflow remains unverified.
Browser checks confirmed that the selector opens the creation form, submitting
selects a new Spring 1220 campaign, and reload retains it. The previous campaign
kept its separate year, season, and roster. The join screen opens from the same
selector, with Sheet selection disabled until connection. No browser errors were
observed. A synthetic "Campaign menu preview" remains in the local test browser.

## Campaign and builder usability checks, 2026-11-14

- Local tests cover browser-only campaign removal with draft retention; native
  language 5 and zero-XP starter rows; campaign defaults in the Sheet contract;
  Great/Poor Characteristic prerequisites, repeated-take caps, Giant Blood/Dwarf
  final scores, Improved Characteristics budgets, Soak, and exported scores.
- OAuth transport tests cover remembered reconnect preference without saved
  tokens, expiry, denied authorization, account-prompt reuse, and explicit
  Disconnect. Selecting a linked campaign or Join triggers the remembered
  reconnect directly in the selection gesture. Real Google popup behavior for
  this new shortcut still needs a user-account check.
- Browser verification created an isolated campaign with Provence/Occitan.
  A new companion had Occitan (native) 5, Provence Lore 0, and the common starter
  rows. Strength's base +3 disabled the increase control; Giant Blood produced
  final Strength +4, Stamina +1, and Soak +1. Filtering Virtues to general/Major
  and selecting Giant Blood worked. Ability and Virtue description popovers
  opened, and closing the character returned to the roster with edits intact.
- The deletion confirmation appeared with Cancel focused. Cancel retained the
  campaign and character; the confirmed removal transformation is covered by
  the local test. No real campaign or Google Drive file was deleted.
- "Defaults verification" and "Defaults companion verification" are synthetic
  local browser fixtures, not Google files. Their rules findings are deliberate
  because this was a UI check rather than a finished legal character.
These acceptance checks remain **not run**:

| Check | Result / observations |
| --- | --- |
| App sign-in from two different Google accounts | Not run |
| Picker-selected folder versus per-file access | Not run |
| Per-member writable folders with shared read access | Not run |
| Concurrent event uploads from different members | Not run |
| Two tabs of one account use separate streams | Not run in Google |
| Disconnect, retry, reload and queued event recovery | Not run in Google |
| Expired-token and revoked-sharing recovery | Not run in Google |
| App creates and reads its own companion Sheet | Not run in Google |
| Native cross-file calendar refresh and Allow access | Not run |
| Foreground event receipt delays and ten-minute request count | Not measured |

## Findings repair guidance, 2026-11-14

Guidance is derived from stable finding IDs and the current character, without
changing override IDs or validation severity. Tests cover all declared build
constraints, Martial-access options that actually remove the access finding,
restricted build choices, known incompatibilities, date/XP/native-language
repairs, characteristic prerequisites, and retained guidance on accepted
exceptions. Manual access metadata was added for Failed Apprentice and Turb
Trained from their existing licensed entry text; the latter's separate dead
language permission is not generalized to all Academic abilities.

Browser verification on the synthetic companion added Great Weapon, confirmed
its access finding showed an expandable list of 17 relevant entries (including
Virtues and Flaws), and opened Warrior's full description from that list. Escape
closed the description. Social Status advice included the type filter and Free
choices, and informational unspent-point findings showed next steps. No browser
errors were observed. No campaign or Google file was edited for this check.

## Native formula verification, 2026-11-14

A separate synthetic companion workbook was generated from the production
workbook plan and imported as a native Google Sheet through the developer's
connector. Neither supplied example character was copied or edited. This checks
Google's formula engine and the template; it does not verify the app's OAuth path.

Native file ID: `1ywQWIE8Kl-kVW1pvXsxMCpM03_Bj7jqCxYmD7SA4fx8`.

| Input or change | Calculated native result |
| --- | --- |
| Born 1192, current year 1220 | Age 28 |
| Awareness creation XP 15 | Base 2, surplus 0, next 15 |
| Add 7 Advancement XP and permanent bonus 1 | Total 22, base 2, effective 3, surplus 7, next 8 |
| Change earned XP to 15 | Total 30, base 3, surplus 0, next 20 |
| Enter numeric score override 0 | Effective score 0 |
| Change standalone year to 1230 | Age 38; creation year stays 1220; original creation budget remains 390 before the separate grant/rate test |
| Set explicit later-life rate 20 and grant 50 | Creation budget 555 |
| Native language allocation 80 with allowance 75, other allocations 15 | Main-pool allocation 20 |
| Light wounds 2, medium 1, heavy 1 | Wound penalty -10 |
| Stamina 1 and equipped numeric Soak bonus 3 | Soak 4 |

Temporary verification inputs were restored. Final native reads returned age
28, Awareness 2, native language 5, Soak 1, load 1, and main creation budget 390
with 15 allocated. Required named ranges and native Tables with dropdown column
metadata were created successfully. Table header inference changed some labels;
the generator now reapplies its declared headers after table creation.

All eleven tabs were rendered and inspected locally. An in-app browser attempt
reached Google's sign-in page, so direct native-browser visual review remains
pending. Native calculated values and formatting/table metadata were read via
the connector. The native workbook was also exported and all tabs rendered;
the export renderer mishandles empty shared strings and Google's exported
`IMPORTRANGE` placeholder, so those render-time errors were checked against the
native cells rather than treated as Google calculation failures. Native reads
confirmed the values above and actual blank overrides. The exported renderer's
table text colors also differ from native effective-format metadata. No claim
of full visual equivalence is made. Ordinary range validations/checkboxes are
applied after table creation; typed dropdowns use table validation because Google
rejects cell validation on typed columns. Cross-file calendar behavior and the
app's own create/read path still require the real-account test above.

Use the procedure in [GOOGLE_SETUP.md](GOOGLE_SETUP.md). Record the date,
browser, account distinction (A/B is sufficient; no email/token needed), file
selection steps, and observed results. Do not mark task 2's feasibility gate
complete based on local mocks or a developer connector's access.

## Ability-targeted entries (2026-11-14)

Local checks cover explicit choices, missing/removed/duplicate targets, separate
language subjects, Puissant use totals versus learned scores, Affinity creation
XP rounding and cap +2, combined effects, score stepping, JSON persistence,
conditional reminders, printable sheet output, and generated formula references.
Browser checks confirmed the dropdown, annotations, 2 + 2 = 4 in use,
15 spent → 23 XP with Affinity, raising learned score to 3 for 20 spent XP,
a targeted Careless Flaw, and persistence after reload/reopening the draft.
Selecting a new target created a zero-XP Chirurgy row; removing that row
flagged the missing target, and reselecting Awareness restored the bonus.
The updated Sheet template rounds each advancement award separately, carries
Ability keys and reminders, and preserves a numeric effective-score override.
These new formulas have not yet been retested in native Google Sheets; the
earlier native calculation results above apply to the earlier template.
