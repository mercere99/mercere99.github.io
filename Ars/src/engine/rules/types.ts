import type { Character } from "../../model/character";
import type { Finding } from "../../model/findings";
import type { RuleSet } from "../../data/ruleset";
import type { Resolved } from "../resolve";

export interface RuleContext {
  character: Character;
  rules: RuleSet;
  resolved: Resolved;
}

/**
 * A rule inspects a character and reports findings. Rules are pure and
 * independent; the registry runs them all. To add a rule: write a module
 * exporting one of these and add it to `rules/index.ts`.
 */
export interface Rule {
  id: string;
  /** Character types this rule applies to. Omit for all. */
  appliesTo?: readonly Character["type"][];
  check(ctx: RuleContext): Finding[];
}

/** Look up a constraint's declared severity/message for the character's type. */
export function constraint(ctx: RuleContext, id: string) {
  return ctx.rules.characterTypes[ctx.character.type].constraints.find((c) => c.id === id);
}
