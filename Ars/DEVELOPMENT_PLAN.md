# Development plan: from character builder to campaign manager

Updated: November 14, 2026. Status: proposed implementation sequence.

## Intended result

A troupe can create a campaign, optionally describe one or more covenants,
and maintain magi, companions, grogs, and other NPCs. Human-readable Google
Sheets remain useful independently of the website. Members edit the campaign
records directly in Sheets; the website creates new records and then reads
them to provide campaign views, searches, reminders, and session tools.

The first practical milestone is two people using the same campaign: a
companion Sheet, a library and vis ledger, a shared story/party view, and shared
dice history. Full magus creation and comprehensive covenant generation follow.
These are separate deliverables; a shared-session prototype does not establish
that the whole game system is implemented.

## Decisions already made

- Keep the application static where possible. Explore Google Drive/Sheets
  before committing to Firebase or an operated backend. Free software and no
  required additional hosting subscription remain design goals.
- Use ordinary shared My Drive folders; do not require an organizational
  Google Workspace Shared Drive subscription.
- Sheets are authoritative for campaign records and their critical formulas.
  After initial creation, the website must not silently rewrite them. An
  explicit future template upgrade would be a separately reviewed operation.
- Everyone in a campaign can edit its shared records. Storyguide/player roles
  do not form an authorization hierarchy. Character ownership is optional
  descriptive metadata, not an exclusive editing right.
- App state lives separately in ordinary Drive files, separated by writer.
  It includes storyguide workspaces, selections, preferences, and session events.
- Storyguides may hand over freely. Each person's workspace survives handover.
- Keep independent browsing available alongside following the storyguide.
- No unattended notifications. Seasonal reminders appear while using the app.
- Critical calculations should work inside the generated Sheets, without the
  website running. Manual overrides and narrative adjudication remain possible.
- Treat the current format as pre-release. No backward-compatibility project.
- Keep game-content attribution and licenses separate from eligible code's
  optional MIT license. Do not alter the user's example character files.

## Current foundation and gaps

Available now: local grog/companion creation, character validation and overrides,
grog generation, birth/creation years, a locally saved campaign year, optional
details and timelines, ability browsing, specialty suggestions, printable
sheets, and equipment with manual effect reminders. The last development pass
passed 28 tests and the production build. This campaign batch passes 48 tests;
its remaining Google acceptance checks are listed below.

This batch adds independent local campaign entities, Google authorization and
Drive transport code, native companion/grog workbook generation/read contracts,
and per-session test events with polling and an outbox. Setup and verification
are documented in `docs/GOOGLE_SETUP.md` and `docs/GOOGLE_TEST_RESULTS.md`.
Synthetic native Sheet calculations have been checked. The app's OAuth setup,
two-account access test, and cross-file calendar refresh remain pending; task
2's feasibility gate has not passed.

Not available yet: complete shared session state, shared dice, covenant
creation, complete magus creation, or full advancement/combat calculations.
Virtue/Flaw mechanics are only partially implemented; an extracted effect is
not proof that every consumer actually applies it correctly.

## Record boundaries

| Record | Authoritative location | Writes after creation |
| --- | --- | --- |
| Campaign identity and current game year/season | Campaign index Sheet | Direct editing in Sheets |
| Member and character file registrations | App-owned registry metadata, separated by writer | The registering member's active app session |
| Characters and their permanent progress | Individual character Sheets | Direct editing in Sheets |
| Covenant descriptions, library, vis, finances, seasonal records | Covenant Sheets and linked narrative Docs | Direct editing in Google editors |
| A storyguide's selected story and party | That storyguide's app-state files | Their active app session |
| Personal preferences | That person's app-state files | Their active app session |
| Dice and explicit storyguide takeover events | Per-writer session event history | The originating app session |

Each campaign, character, covenant, story, member, session, and event needs a
stable ID. File names and display names can change. App-owned per-writer
registrations combine into the campaign registry, so adding a new character
does not require rewriting an established campaign Sheet. A registry contains
file IDs and readable links; it is not a second copy of every character's data.
Use named ranges or suitable metadata for the Sheet/app contract, with clear
input and calculated regions. Do not require opaque JSON as the sole source
behind an otherwise decorative human-readable sheet.

The campaign index owns the game calendar. Character creation year fixes the
creation budget, birth year determines age, and recorded activities determine
earned XP. App-state files must not create a competing campaign calendar.

## Next development tasks

### 1. Define the campaign and Sheet contracts

Deliverables:

- [x] Add campaign/member/registry models without replacing the working local
  builder. Multiple campaigns must not share one accidental global calendar.
- [x] Separate build rules from narrative role: an NPC may be a magus,
  companion, grog, or a lightweight custom record. Allow incomplete NPCs without
  making the campaign unusable. Do not require a covenant or a player owner.
- [x] Define the companion/grog workbook layout and a versioned read contract:
  identity, ability IDs and subjects, XP, Virtues/Flaws, personality, equipment,
  current condition, timeline, advancement, and notes.
- [x] Define the initial campaign index, library, and vis ledger columns.
- [x] Specify which values are entered, calculated, overridden, or narrative.
  Distinguish creation allocations from later earned experience.
- [x] Define minimal app-state and event envelopes: stable actor/session/event
  IDs, event type, ordering information, and payload. Avoid a shared mutable
  last-roll field or a campaign-wide file that everyone rewrites.

Acceptance: one concrete example of every initial record can be read without
the app, and every displayed dashboard value has one documented source.

Dependency: none. Keep this small enough to revise after the Drive prototype.

### 2. Prove Drive access and synchronization with two accounts

This is an early feasibility gate, before a large cloud integration.

- [x] Add browser authorization and a campaign-file selection flow. Document
  the developer's one-time OAuth setup and the ordinary player's onboarding.
  Keep credentials and tokens out of saved campaign files and source control.
- [ ] Start with narrowly scoped access to selected/app-created files. Test
  what a second user must select or authorize to read files created by the
  first user. Folder sharing and app authorization are separate concerns;
  do not assume selecting a folder authorizes every referenced file.
- [ ] Verify reading a small Sheet and creating/updating an app-state JSON
  file under the correct signed-in user.
- [ ] Verify folder provisioning: broadly editable campaign records plus an
  app-state hierarchy with shared read access and per-writer editing, if
  enforcing that distinction through Drive permissions. Do not inherit broad
  editor access accidentally from the campaign-record folder.
- [ ] Poll for relevant changes while the app is open; fetch changed content
  and retain a cursor. Handle missing access, expiring authorization, reconnects,
  rate limiting, hidden tabs, and an explicit refresh command.
- [x] Choose a multiple-tab/device strategy. Prefer separate event streams per
  browser session; do not assume one Google account implies one writer.
- [ ] Measure update delays and request volume in a representative session.
  Initial usability target: most remote updates visible within roughly five
  seconds in active foreground tabs under normal connectivity. Record observed
  results; this is a test target, not a delivery guarantee.

Acceptance: two distinct Google accounts can publish independently, read each
other's retained test events, reconnect without duplicating them, and clearly
see pending/stale/connected status. Account access must be tested, not simulated
by two tabs signed into the same account.

Decision gate: if onboarding or latency is unacceptable, compare explicit
per-file selection, a simpler campaign container, or an optional small real-time
transport. Do not silently switch to Firebase or add paid infrastructure.

Dependencies: minimal record IDs/envelopes from task 1. No full character engine
or complete workbook generator required.

### 3. Generate a self-contained companion/grog Sheet

- [x] Use the supplied mage and companion sheets as read-only references.
  Create disposable copies or new workbooks for development and verification.
- [x] Build one readable summary with supporting tabs for XP, advancement,
  equipment, optional timeline, and reference/formula data as needed.
- [x] Make XP authoritative: creation allocations plus subsequent awards feed
  totals, base scores, and progress toward the next level. Preserve XP between
  score thresholds. Identify restricted XP pools and visible allocation checks.
- [x] Keep permanent and situational bonuses separate from base scores. List
  supported effects explicitly; do not mark an effect fully automated merely
  because it has been extracted from the book text.
- [x] Put critical formulas in Sheets, including age, ability advancement,
  totals, and the supported condition/equipment calculations. Make unsupported
  effects and manual overrides visible rather than silently ignoring them.
- [ ] Link age/calendar calculations to the campaign's game year using native
  Sheet references with the necessary access established during setup. Do not
  depend on the website writing a new year into every character file. Test
  cross-file refresh behavior and make any stale/fallback value explicit.
- [x] Add editable condition, reputation, Confidence, and narrative fields
  needed for ordinary companion play. Avoid duplicating inputs across tabs.
- [x] Provide warnings/help around formula cells while leaving the troupe in
  control. Deleting or moving a required range must produce a useful app error.
- [ ] Create the Sheet from the builder, place/link it in the chosen campaign,
  preserve attribution notices, and open it for direct editing. Retrying a
  creation operation must not produce unexplained duplicate character files.
- [ ] Read it back through the declared contract. Sheet formulas, not an
  unsaved browser character, determine the connected dashboard's values.

Acceptance: create a companion, close the website, add XP directly in Sheets,
and reopen the website to see the correct score and surplus XP. Renaming the
file does not break the link. Changing campaign year changes age without
granting XP. The untouched reference characters remain unchanged.

Verification: exercise actual calculated values in a native Google Sheet for
representative thresholds, restrictions, bonuses, and manual overrides; do not
test only formula strings. Compare supported calculations against the engine
and book-derived fixtures. Existing tests/build must continue to pass.

Dependencies: task 1 and successful access/create/read findings from task 2.

### 4. Make the campaign dashboard useful between sessions

- [ ] Create/open a campaign and register existing compatible character files.
  Support creating a campaign without creating any covenant.
- [ ] Show the full troupe, with filters for character kind and narrative role.
  A member may have several characters; shared grogs need no exclusive owner.
- [ ] Search the troupe by ability, specialty, Virtue/Flaw, or name. Ability
  results should include score and subject, not merely whether a word occurs.
- [ ] Provide a readable character view with direct links to its Sheet.
- [ ] Cache reads for usability, refresh when needed, and show when a value was
  fetched. Treat missing/inaccessible characters as partial failures instead
  of losing the whole campaign or displaying missing values as zero.
- [ ] Keep local creation drafts distinct from linked canonical characters.
  Do not offer an ambiguous Save button that overwrites an established Sheet.

Acceptance: another member can open the campaign, find a character with a
particular ability, inspect the current calculated score, and open its source
Sheet. A direct Sheet edit becomes visible after refresh. Connected reading
does not mutate the campaign records.

Dependencies: tasks 2 and 3.

### 5. Add covenant records and seasonal views

- [ ] Provide an optional covenant workbook set with location, aura,
  description, residents, shared resources, and links to narrative material.
- [ ] Create a library Sheet with stable book IDs, Arts/abilities covered,
  book type, level/quality where applicable, availability, and notes.
- [ ] Create vis and financial ledgers with dated transactions and calculated
  balances. Keep stock types explicit. Prefer a transaction history to repeatedly
  replacing an untraceable total.
- [ ] Provide seasonal activity records tied to character/book/resource IDs.
  Display double-booked resources or incompatible assignments for adjudication.
- [ ] Read upcoming game-calendar events and show due aging rolls and other
  supported reminders while the campaign is open. Document the supported rules
  and allow recorded exceptions. Do not schedule unattended messages.
- [ ] Add full covenant-creation support in a following slice: boons/hooks,
  laboratories, sites, income sources, assets, custom entries, and relevant
  source/rule data. Separate this from the smaller library/vis deliverable.

Acceptance: the group can independently edit library entries and vis
transactions in Sheets, see updated balances/details in the dashboard, and
inspect a season's activities and conflicts. None of this requires creating a
covenant for a campaign that does not use one.

Dependencies: tasks 1–4. Covenant creation rules can expand after the initial
shared-session milestone.

### 6. Persist storyguide workspaces and handovers

- [ ] Save each storyguide's selected story, active party, and shared view in
  that person's app-state files. Save personal browsing preferences separately.
- [ ] Add explicit Take over as storyguide and Follow storyguide controls.
  Returning to an old workspace must not itself publish a takeover.
- [ ] Define deterministic takeover ordering that does not rely solely on
  potentially incorrect computer clocks. Resolve simultaneous claims consistently.
  Reconcile from the available event histories before publishing a takeover;
  disable takeover while disconnected. This is eventual coordination, not a
  distributed hard lock.
- [ ] Notify other open interfaces of a handover. Restore the last selected
  storyguide and workspace when the campaign is reopened; show stale state if
  reconnection has not completed.
- [ ] Allow independent browsing without altering the shared party view.

Acceptance: A selects a party, B takes over with a different party, and A can
later resume A's previous workspace. After reload, participants converge on
the same current storyguide. Nearly simultaneous takeovers have a tested winner.

Dependencies: tasks 2 and 4. Can be completed before the larger covenant work.

### 7. Add shared Ars Magica dice

- [ ] Implement simple and stress rolls, the applicable exploding/botch
  sequences, modifiers, and an explicit full breakdown using the licensed
  rules as the source. Keep uncertain variants configurable or manual.
- [ ] Optionally associate a roll with a character and ability read from its
  Sheet. Allow situational modifiers without writing back to the character.
- [ ] Generate a roll once, give it an event ID, and retain the same result
  when retrying an upload. Display local pending/failed/shared status.
- [ ] Keep session history in per-writer streams. Polling may discover several
  rolls together; show all unseen events rather than only the latest result.
- [ ] Deduplicate deliveries and distinguish restored history from genuinely
  new rolls. Preserve the actor, character, context, and raw dice breakdown.
- [ ] Define a modest history retention/archive policy; do not grow one JSON
  file forever or erase still-needed session events without an archive.

Acceptance: two accounts can roll repeatedly and at the same time, see matching
results remotely, and reload/reconnect without losing or duplicating retained
rolls. No claim of tamper-proof dice is needed for this trusted troupe.

Dependencies: task 2 and campaign membership from task 4. Storyguide status
must not be a requirement to roll dice.

## First shared-session release checkpoint

Tasks 1–4, the initial library/vis portion of 5, and tasks 6–7 form a usable
campaign/session prototype. Demonstrate this complete workflow:

1. Create a campaign and a new companion Sheet; join from another account.
2. Edit character XP, a book, and a vis transaction directly in Sheets.
3. Refresh the website and see the corresponding calculated results.
4. Select a story and party, hand over storyguiding, and reopen the campaign.
5. Make concurrent rolls and inspect the same retained roll history.
6. Interrupt connectivity and restore it without overwriting campaign records.

The prototype is not a complete Ars Magica campaign manager until magus and
broader covenant support below are delivered.

## Following development tasks

### 8. Complete magus creation and its Sheet template

- Audit the available rules/spell corpus; the existing data is not a complete
  modeled spell catalog. Extend the extraction/curation pipeline with provenance.
- Add Hermetic identity, apprenticeship/gauntlet dates, creation XP pools,
  Arts, spells, requisites, mastery, and supported casting/laboratory totals.
- Extend the common Sheet contract with magic-specific tabs while retaining
  the same campaign registry and read-only dashboard architecture.
- Carry supported calculations into Sheets and verify a newly generated magus
  against representative licensed examples and independently checked totals.
  Preserve manual treatment of effects not yet modeled.

### 9. Broaden mechanical coverage and seasonal play

- Complete prioritized companion Virtue/Flaw effects, restricted XP checks,
  Confidence/reputation/condition tracking, and seasonal advancement rules.
- Add structured equipment catalogs and modifiers with source provenance;
  implement combat/armor/encumbrance totals without parsing free-form effect
  notes as executable formulas or instructions.
- Expand full covenant creation and management, including laboratories and
  shared resources, with warnings and troupe overrides where needed.
- Maintain a tested distinction between creation budgets and subsequent play.
  XP gained in Sheets must not be rejected as overspending creation XP.

### 10. Optional content and release polish

- Regional medieval name generation, after checking reusable sources by region,
  period, and license. Retain custom names and avoid destructive replacements.
- Searchable ready-made characters, grogs, beasts, and covenant examples.
- Export/backups and recovery from inaccessible or structurally damaged files;
  document clearly what is backed up and what relies on Google file history.
- Review Google authorization/scopes and any applicable public-app review before
  a public release. Test real onboarding on consumer Google accounts.
- Verify static deployment, content notices, responsive layouts, accessible
  controls, and a short first-campaign guide. Publishing is a separate task.

## Implementation discipline

- Keep each numbered task reviewable; avoid a simultaneous UI rewrite, rules
  rewrite, and storage-provider replacement.
- Google connection work is an application feature, not a dependency on the
  developer's Codex connector. Players use their own Google accounts.
- Keep pure rules/calculations, Sheet generation/reading, and Drive transport
  separate. Maintain a read-only path for established campaign records.
- Reuse the original game-data pipeline; do not hand-edit generated records.
- Test behavior: calculation boundaries, independent users, ownership, retries,
  multiple sessions, partial failures, event ordering, and stale displays.
- Run relevant tests and the production build for code changes; verify formula
  behavior in native Sheets and important multi-user flows in two real accounts.
- Template versions detect unsupported structures. No legacy-format migration
  work is required before the format has actual users.
- No dated schedule is promised. The next implementation batch is tasks 1–3,
  split into the early Drive feasibility gate and one complete companion Sheet.

## Technical references to check during implementation

- [Drive authorization scopes](https://developers.google.com/workspace/drive/api/guides/api-specific-auth)
- [Google Picker](https://developers.google.com/workspace/drive/picker/guides/web-picker)
- [Drive change tracking](https://developers.google.com/workspace/drive/api/guides/manage-changes)
- [Drive push receiver requirements](https://developers.google.com/workspace/drive/api/guides/push)
- [Sheets named ranges and concepts](https://developers.google.com/workspace/sheets/api/guides/concepts)
- [Sheets developer metadata](https://developers.google.com/workspace/sheets/api/guides/metadata)
- [Ars Magica licensing and released material](https://atlas-games.com/arsmagica/openars)
