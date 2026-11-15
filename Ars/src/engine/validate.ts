import { DEFAULT_CAMPAIGN_YEAR, type Character } from "../model/character";
import type { Finding, OverrideState } from "../model/findings";
import { resolveOverrides } from "../model/findings";
import type { RuleSet } from "../data/ruleset";
import { resolve, type Resolved } from "./resolve";
import { RULES } from "./rules";
import { guidanceFor } from "./guidance";

export interface Validation {
  resolved: Resolved;
  findings: Finding[];
  states: OverrideState[];
  counts: { error: number; warning: number; info: number; overridden: number; stale: number };
}

export function validate(character: Character, rules: RuleSet, campaignYear = DEFAULT_CAMPAIGN_YEAR): Validation {
  const resolved = resolve(character, rules, campaignYear);
  const ctx = { character, rules, resolved };
  const findings = RULES.filter((r) => !r.appliesTo || r.appliesTo.includes(character.type))
    .flatMap((r) => r.check(ctx)).map(f=>({...f,guidance:guidanceFor(f,ctx)}));
  const states = resolveOverrides(findings, character.overrides);

  const counts = { error: 0, warning: 0, info: 0, overridden: 0, stale: 0 };
  for (const s of states) {
    if (s.kind === "active") counts[s.finding.severity]++;
    else counts[s.kind]++;
  }
  return { resolved, findings, states, counts };
}
