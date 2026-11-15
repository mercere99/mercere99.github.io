# Campaign manager direction

The implementation sequence, dependencies, and acceptance criteria are in
[DEVELOPMENT_PLAN.md](DEVELOPMENT_PLAN.md). The next batch defines the campaign
and Sheet contracts, tests Drive access with two accounts, and generates one
complete companion/grog Sheet before expanding the dashboard.

## Agreed storage model

- Generate human-readable Google Sheets for characters and covenant records.
  Critical calculations belong in the sheets. Ongoing record edits happen
  directly in Sheets; the website reads their calculated results.
- Campaign members may edit the shared campaign records without a fixed
  GM/player permission hierarchy. Alpha and beta storyguides can take turns.
- Keep app-owned state separately in ordinary Drive files, with one writer per
  player (or browser session) and shared read access. Drive permissions need a
  separate folder hierarchy if writer ownership is to be enforced.
- Persist each storyguide's selected story and active party. Explicit takeover
  events determine the active storyguide with a consistent ordering/tie-break.
- Share dice rolls as uniquely identified events retained for the session,
  not a single last-roll value. Queue writes and avoid concurrent tabs writing
  the same file. Display sharing-pending status, deduplicate retries, and retain
  dice/modifier breakdowns.
- Start with polling while the app is open; Drive webhooks require a receiving
  server. Measure latency and authorization usability before choosing any
  additional real-time transport. Unattended notifications are not needed.

## This companion-creation increment

- Direct companion creation with existing companion-specific rules and
  Confidence defaults, alongside grogs and the grog generator.
- Campaign year (1220 by default), birth year, fixed creation year, and optional
  dated timeline entries. Creation XP must not grow merely as time passes.
- Optional birthplace, religion, gender, height, weight, hair/eye color,
  appearance, handedness, and occupation; hide blank fields by default.
- Ability browsing by type and a searchable picker that ranks name prefixes
  first. Suggested specialties remain editable free text.
- Structured equipment: type, carried load, equipped-by-default status,
  descriptions, and prominent manual effect reminders.
- Clarify code/content licensing and preserve notices in printable sheets.

## Following increments (see the development plan for execution order)

1. Google Sheets template prototype, drawing on the supplied examples without
   modifying them. Use XP-first ledgers, derive scores and surplus XP, and
   separate input values, permanent bonuses, and situational modifiers.
2. Read-only campaign dashboard and Drive app-state/dice prototype with two
   signed-in browsers. Use stable character/record IDs and named ranges.
3. Full seasonal advancement, reputation and Confidence tracking, and remaining
   companion effects and restricted XP checks. The current engine handles only
   some Virtue/Flaw mechanics; narrative effects still need adjudication.
4. Magus creation: apprenticeship, Arts, spells, mastery, and Hermetic details.
5. Equipment catalogs and structured modifiers for weapon/armor combat totals,
   encumbrance, and situational effects. Manual effect notes currently do not
   change totals automatically.
6. Regional medieval name generation. Research reusable, attributed sources
   by region and period; avoid presenting an unverified name pool as historical.

The data format may change during this pre-release work. Backward compatibility
is not required. No Firebase commitment, hosting deployment, or unattended
notification service is part of the current increment.
