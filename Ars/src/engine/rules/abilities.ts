import type { Finding } from "../../model/findings";
import type { Rule } from "./types";

/** Access, experience budget, and the age-based score cap. */
export const abilitiesRule: Rule = {
  id: "abilities",
  check({ character, rules, resolved }) {
    const findings: Finding[] = [];

    // ---- Access: the rule most likely to be overridden, so one finding per Ability.
    for (const a of resolved.abilities) {
      if(a.xp===0)continue; // Zero-score starter rows do not buy restricted access.
      if (resolved.access.has(a.type)) continue;
      findings.push({
        id: `ability-access:${a.id}${a.key ? "" : ""}`,
        rule: this.id,
        severity: "error",
        message: `${a.displayName} is ${/^[aeiou]/.test(a.type) ? "an" : "a"} ${a.type} Ability. Nothing this character has grants access to ${a.type} Abilities at creation.`,
        path: `abilities.${a.key}`,
        satisfiedBy: `ability-access:${a.type}`,
      });
    }

    // ---- Budget
    const { budget, spent } = resolved.xp;
    if (spent > budget) {
      findings.push({
        id: "abilities:budget",
        rule: this.id,
        severity: "error",
        message: `${spent} experience points spent; ${budget} available at creation age ${resolved.creationAge}.`,
        path: "abilities",
      });
    } else if (spent < budget) {
      findings.push({
        id: "abilities:unspent",
        rule: this.id,
        severity: "info",
        message: `${budget - spent} experience point(s) unspent.`,
        path: "abilities",
      });
    }

    // ---- Age cap
    for (const a of resolved.abilities) {
      if (a.native) continue;
      if (a.score > resolved.abilityCap + a.capBonus) {
        findings.push({
          id: `abilities:cap:${a.id}`,
          rule: this.id,
          severity: "error",
          message: `${a.displayName} ${a.score} exceeds the maximum of ${resolved.abilityCap + a.capBonus} at creation age ${resolved.creationAge}${a.capBonus?" (including Affinity)":""}.`,
          path: `abilities.${a.key}`,
        });
      }
    }

    // ---- Native language
    const natives = character.abilities.filter((a) => a.native);
    if (natives.length === 0) {
      findings.push({
        id: "abilities:no-native-language",
        rule: this.id,
        severity: "warning",
        message: "No native language. Every character gets 75 experience points in one.",
        path: "abilities",
      });
    } else if (natives.length > 1) {
      findings.push({
        id: "abilities:multiple-native",
        rule: this.id,
        severity: "warning",
        message: "More than one Ability is marked as the native language.",
        path: "abilities",
      });
    }

    // ---- Grog personality guideline
    if (character.type === "grog" && !character.personality.some((p) => p.name.toLowerCase() === "loyal")) {
      findings.push({
        id: "personality:grog-loyal",
        rule: this.id,
        severity: "info",
        message: "Grogs should all have a score in Loyal.",
        path: "personality",
      });
    }

    return findings;
  },
};
