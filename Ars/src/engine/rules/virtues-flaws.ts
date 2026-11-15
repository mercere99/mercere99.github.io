import type { Finding, Severity } from "../../model/findings";
import type { Rule, RuleContext } from "./types";
import { constraint } from "./types";
import { abilityIdentity, choosesAbility } from "../ability-effects";

/**
 * Every constraint id in data/rules/character-creation.json maps to a check
 * here. The data supplies severity and message; the code supplies the test.
 * A constraint listed in the data with no check here is reported so the
 * mismatch is visible rather than silently unenforced.
 */
type Check = (ctx: RuleContext, value: number | undefined) => string[] | boolean;

const CHECKS: Record<string, Check> = {
  "social-status-required": ({ resolved }) =>
    resolved.virtues.some((v) => v.entry.categories.includes("social-status")) ||
    resolved.flaws.some((f) => f.entry.categories.includes("social-status")),

  "vf-balance": ({ character, rules, resolved }) => {
    const t = rules.characterTypes[character.type];
    const allowance = resolved.flawPoints * t.virtuePointsPerFlawPoint + (t.freeMinorVirtueFromHouse ? 1 : 0);
    return resolved.virtuePoints <= allowance;
  },

  "flaw-budget": ({ character, rules, resolved }) =>
    resolved.flawPoints <= rules.characterTypes[character.type].maxFlawPoints,

  "no-major": ({ resolved }) =>
    [...resolved.virtues, ...resolved.flaws]
      .filter((v) => v.size === "major")
      .map((v) => v.taken.key),

  "no-hermetic": ({ resolved }) =>
    [...resolved.virtues, ...resolved.flaws]
      .filter((v) => v.entry.categories.includes("hermetic"))
      .map((v) => v.taken.key),

  "no-gift": ({ character }) => !character.virtuesFlaws.some((v) => v.id === "virtue.the-gift"),

  "no-story-flaws": ({ resolved }) =>
    resolved.flaws.filter((f) => f.entry.categories.includes("story")).map((f) => f.taken.key),

  "max-story-flaws": ({ resolved }, value) =>
    resolved.flaws.filter((f) => f.entry.categories.includes("story")).length <= (value ?? 1),

  "max-personality-flaws": ({ resolved }, value) =>
    resolved.flaws.filter((f) => f.entry.categories.includes("personality")).length <= (value ?? 2),

  "max-major-personality-flaws": ({ resolved }, value) =>
    resolved.flaws.filter((f) => f.entry.categories.includes("personality") && f.size === "major")
      .length <= (value ?? 1),

  "max-minor-flaws": ({ resolved }, value) =>
    resolved.flaws.filter((f) => f.size === "minor").length <= (value ?? 5),

  "hermetic-requires-gift": ({ character, resolved }) =>
    character.virtuesFlaws.some((v) => v.id === "virtue.the-gift") ||
    [...resolved.virtues, ...resolved.flaws]
      .filter((v) => v.entry.categories.includes("hermetic"))
      .map((v) => v.taken.key),

  "required-virtues": ({ character, rules }) =>
    (rules.characterTypes[character.type].required ?? []).every((id) =>
      character.virtuesFlaws.some((v) => v.id === id),
    ),

  "max-major-hermetic-virtues": ({ resolved }, value) =>
    resolved.virtues.filter((v) => v.entry.categories.includes("hermetic") && v.size === "major")
      .length <= (value ?? 1),

  "hermetic-flaw-recommended": ({ resolved }) =>
    resolved.flaws.some((f) => f.entry.categories.includes("hermetic")),

  "single-take": ({ resolved, character }) => {
    const seen = new Map<string, number>();
    const offenders: string[] = [];
    for (const v of [...resolved.virtues, ...resolved.flaws]) {
      // Parameterized entries (Puissant (Art)) are distinct per parameter.
      const target = character.abilities.find(a=>a.key===v.taken.abilityKey);
      const abilityChoice = choosesAbility(v.entry);
      const k = abilityChoice ? `${v.entry.id}:${target?abilityIdentity(target):""}` : v.entry.parameterized ? `${v.entry.id}:${v.taken.parameter ?? ""}` : v.entry.id;
      const n = (seen.get(k) ?? 0) + 1;
      seen.set(k, n);
      if (n > 1 && (abilityChoice || !/may (?:be taken|take this (?:Virtue|Flaw)) (?:more than once|multiple times|twice|again)/i.test(v.entry.text))) {
        offenders.push(v.taken.key);
      }
    }
    return offenders;
  },
};

export const virtuesFlawsRule: Rule = {
  id: "virtues-flaws",
  check(ctx) {
    const findings: Finding[] = [];
    const type = ctx.rules.characterTypes[ctx.character.type];

    for (const v of [...ctx.resolved.virtues,...ctx.resolved.flaws]) {
      if (!choosesAbility(v.entry)) continue;
      const target=ctx.character.abilities.find(a=>a.key===v.taken.abilityKey);
      if (!target || !ctx.rules.abilities.has(target.id)) findings.push(finding(`ability-choice:${v.taken.key}`,"error",`${v.entry.name}: choose an Ability from this build.`, `virtuesFlaws.${v.taken.key}`,this.id));
      else if(ctx.rules.abilities.get(target.id)?.parameterized && !target.parameter?.trim()) findings.push(finding(`ability-subject:${v.taken.key}`,"error",`${v.entry.name}: specify the subject of ${ctx.rules.abilities.get(target.id)!.name} so the chosen Ability is unambiguous.`, `virtuesFlaws.${v.taken.key}`,this.id));
      if(v.entry.id==="flaw.necessary-realm-aura-for-ability" && !v.taken.parameter?.trim()) findings.push(finding(`ability-realm:${v.taken.key}`,"error","Necessary Realm Aura: choose the realm whose aura is required.",`virtuesFlaws.${v.taken.key}`,this.id));
    }

    for (const c of type.constraints) {
      const check = CHECKS[c.id];
      if (!check) {
        findings.push({
          id: `virtues-flaws:unimplemented:${c.id}`,
          rule: this.id,
          severity: "info",
          message: `Rule "${c.id}" is listed in the ruleset but not yet enforced.`,
          path: "virtuesFlaws",
        });
        continue;
      }
      const result = check(ctx, c.value);
      if (result === true) continue;

      const keys = Array.isArray(result) ? result : [];
      if (Array.isArray(result) && result.length === 0) continue;

      if (keys.length === 0) {
        findings.push(finding(c.id, c.severity, c.message, "virtuesFlaws", this.id));
      } else {
        // One finding per offending entry so each can be overridden separately.
        for (const key of keys) {
          const taken = ctx.character.virtuesFlaws.find((v) => v.key === key);
          const name = taken ? ctx.rules.virtuesFlaws.get(taken.id)?.name : undefined;
          findings.push(
            finding(`${c.id}:${taken?.id ?? key}`, c.severity, `${name ? name + ": " : ""}${c.message}`, `virtuesFlaws.${key}`, this.id),
          );
        }
      }
    }

    // Unspent Flaw points are worth mentioning, never an error.
    const allowance = ctx.resolved.flawPoints * type.virtuePointsPerFlawPoint;
    if (ctx.resolved.virtuePoints < allowance) {
      findings.push(
        finding("vf-unspent", "info", `${allowance - ctx.resolved.virtuePoints} Virtue point(s) available from Flaws taken.`, "virtuesFlaws", this.id),
      );
    }
    return findings;
  },
};

function finding(id: string, severity: Severity, message: string, path: string, rule: string): Finding {
  return { id: `virtues-flaws:${id}`, rule, severity, message, path };
}

export { constraint };
