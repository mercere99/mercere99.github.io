/**
 * Validation findings and the override mechanism.
 *
 * The engine never refuses to produce a character. It reports findings, and
 * the user may override any of them. The design goal is that overriding is
 * *easy but deliberate and permanent* — an override is a recorded decision
 * that travels with the character, not a dismissed dialog.
 */

export type Severity = "error" | "warning" | "info";

export interface FindingGuidance {
  steps: string[];
  options?: { id: string; note?: string }[];
  optionsLabel?: string;
}

/** A rule the character does not satisfy. Findings are derived, never stored. */
export interface Finding {
  /**
   * Stable identity for this finding on this character. Derived from the rule
   * and the thing it applies to, NOT from position or message text, so an
   * override survives rewording the message, reordering the sheet, or
   * changing the rule's implementation.
   *
   * e.g. "ability-access:ability.artes-liberales"
   */
  id: string;

  /** The rule that produced it, e.g. "ability-access". */
  rule: string;

  severity: Severity;

  /** Human-readable, for display only. Never parsed, never used as identity. */
  message: string;

  /** Where in the character to focus, e.g. "abilities[3]". */
  path: string;

  /**
   * What the engine would need to see for this finding to go away on its own.
   * Used to detect stale overrides (see `resolveOverrides`).
   */
  satisfiedBy?: string;
  /** Derived help; IDs and override matching remain independent of this text. */
  guidance?: FindingGuidance;
}

/**
 * A user's deliberate decision to accept a finding. Stored on the character.
 *
 * Overrides are additive and never delete anything: the finding is still
 * computed, still visible, and still printed on the sheet — it is annotated
 * as accepted rather than suppressed. A storyguide reading someone else's
 * character can always see which rules were set aside and why.
 */
export interface Override {
  /** Matches `Finding.id`. */
  findingId: string;

  /**
   * Why. Optional in the type, but the UI should ask for it — an override
   * with a reason is a design decision, one without is a shrug, and the
   * difference matters six months into a saga.
   */
  reason?: string;

  /** ISO date. Overrides are auditable events, not settings. */
  accepted: string;

  /** Who accepted it, in a shared saga. */
  acceptedBy?: string;
}

export type OverrideState =
  /** Finding stands; no override. */
  | { kind: "active"; finding: Finding }
  /** Finding stands but has been deliberately accepted. Shown as info. */
  | { kind: "overridden"; finding: Finding; override: Override }
  /**
   * The override refers to a finding that no longer occurs — the character
   * changed and now satisfies the rule legitimately. The override is dead
   * weight and should be offered for removal, NOT silently dropped: telling
   * the user "you no longer need the exception you took for Artes Liberales"
   * is useful, and silently deleting it is not.
   */
  | { kind: "stale"; override: Override };

/**
 * Join computed findings against stored overrides.
 *
 * Note the asymmetry with severity: an overridden `error` becomes `info` for
 * display, but the underlying finding keeps its original severity so that
 * "show me everything I've overridden" and "show me what would break if I
 * removed my overrides" are both answerable.
 */
export function resolveOverrides(
  findings: readonly Finding[],
  overrides: readonly Override[],
): OverrideState[] {
  const byId = new Map(findings.map((f) => [f.id, f]));
  const claimed = new Set<string>();

  const states: OverrideState[] = [];

  for (const override of overrides) {
    const finding = byId.get(override.findingId);
    if (finding) {
      claimed.add(finding.id);
      states.push({ kind: "overridden", finding, override });
    } else {
      states.push({ kind: "stale", override });
    }
  }

  for (const finding of findings) {
    if (!claimed.has(finding.id)) {
      states.push({ kind: "active", finding });
    }
  }

  return states;
}

/** Severity as displayed, after accounting for overrides. */
export function displaySeverity(state: OverrideState): Severity {
  switch (state.kind) {
    case "active":
      return state.finding.severity;
    case "overridden":
      return "info";
    case "stale":
      return "warning";
  }
}

// --------------------------------------------------------------------- effects

/**
 * The closed vocabulary of machine-applicable Virtue and Flaw effects.
 *
 * Deliberately small. Most Virtues and Flaws are narrative and carry no
 * effects at all; the engine applies what is here and prints the rest as
 * text for the storyguide to adjudicate. `derivation` records whether an
 * effect was parsed from the text automatically or curated by hand, which
 * matters because auto effects are regenerated on every build.
 */
export type Effect =
  | { type: "ability-access"; categories: AbilityCategory[]; scope: "creation" | "always" }
  | { type: "score-bonus"; target: EffectTarget; value: number }
  | { type: "advancement-multiplier"; target: EffectTarget; factor: number; rounding: "up" | "down" }
  | { type: "starting-score"; target: EffectTarget; value: number }
  | { type: "xp-grant"; amount: number; restrictedTo?: EffectTarget };

export type AbilityCategory =
  | "general"
  | "academic"
  | "arcane"
  | "martial"
  | "supernatural"
  | "spell-mastery";

export interface EffectTarget {
  kind: "art" | "ability" | "characteristic";
  /** Specific eligible abilities, including a subject for parameterized entries. */
  abilities?: { id: string; parameter?: string }[];
  /** A specific one, when the Virtue names it. */
  name?: string;
  /** The player picks, e.g. Puissant (Art). */
  chosen?: boolean;
  category?: AbilityCategory;
}

export type Derivation = "auto" | "manual";
