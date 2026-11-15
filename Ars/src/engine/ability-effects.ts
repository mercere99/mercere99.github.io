import type { Ability, RuleSet, VirtueFlaw } from "../data/ruleset";
import type { Character, TakenAbility, TakenVirtueFlaw } from "../model/character";

export function choosesAbility(entry: VirtueFlaw): boolean {
  return entry.parameterized === "Ability" || entry.effects.some(e =>
    (e.type === "score-bonus" || e.type === "advancement-multiplier" || e.type === "starting-score") && e.target.kind === "ability" && e.target.chosen);
}

export function abilityName(a: TakenAbility, def: Ability): string {
  return def.parameterized && a.parameter?.trim()
    ? def.name.replace(/\(([^)]+)\)/, a.parameter.trim()) : def.name;
}

/** Separate rows for the same subject are still the same Ability under the rules. */
export function abilityIdentity(a: TakenAbility): string {
  return `${a.id}:${(a.parameter ?? "").trim().toLocaleLowerCase()}`;
}

export function abilityEffectNote(id: string): string | undefined {
  switch (id) {
    case "virtue.puissant-ability": return "+2 when using this Ability; excluded from learning, writing, and teaching.";
    case "virtue.affinity-with-ability": return "Affinity: ×1.5 creation XP and each advancement award, rounded up; creation score cap +2.";
    case "virtue.cautious-with-ability": return "Roll 2 fewer botch dice for this Ability (minimum 0).";
    case "flaw.careless-with-ability": return "A rolled zero with this Ability always botches; extra botch dice may still apply.";
    case "flaw.necessary-realm-aura-for-ability": return "−3 to totals outside the chosen realm's aura; apply this conditional penalty manually.";
    case "virtue.enchanting-ability": return "Grants Enchanting (Ability) 1 for this artistic medium; add that supernatural Ability separately and adjudicate its effects.";
    default: return undefined;
  }
}

export function abilityEffects(c: Character, rules: RuleSet, ability: TakenAbility) {
  let bonus = 0;
  let factor = 1;
  let capBonus = 0;
  const annotations: { key: string; name: string; note: string }[] = [];
  const seen = new Set<string>();
  for (const taken of c.virtuesFlaws) {
    const entry = rules.virtuesFlaws.get(taken.id);
    const target = c.abilities.find(a => a.key === taken.abilityKey);
    if (!entry || !choosesAbility(entry) || !target || target.key !== ability.key || seen.has(entry.id)) continue;
    seen.add(entry.id); // Invalid duplicate takings never stack silently.
    for (const effect of entry.effects) {
      if (effect.type === "score-bonus" && effect.target.kind === "ability" && effect.target.chosen) bonus += effect.value;
      if (effect.type === "advancement-multiplier" && effect.target.kind === "ability" && effect.target.chosen) factor *= effect.factor;
    }
    if (entry.id === "virtue.affinity-with-ability") capBonus = 2;
    const note = abilityEffectNote(entry.id) ?? "Read this entry's description for its effects; apply them manually.";
    annotations.push({ key: taken.key, name: entry.name, note: `${note}${entry.id === "flaw.necessary-realm-aura-for-ability" && taken.parameter ? ` Realm: ${taken.parameter}.` : ""}` });
  }
  return { bonus, factor, capBonus, annotations };
}

/** Minimum spent XP that reaches this learned-score threshold after rounding. */
export function investedXpForTotal(total: number, factor: number): number {
  return total <= 0 ? 0 : Math.floor((total - 1) / factor) + 1;
}

export function virtueFlawName(taken: TakenVirtueFlaw, entry: VirtueFlaw, c: Character, rules: RuleSet): string {
  if (choosesAbility(entry)) {
    const a = c.abilities.find(a => a.key === taken.abilityKey);
    const def = a && rules.abilities.get(a.id);
    const label = a && def ? abilityName(a, def) : "choose Ability";
    return `${entry.name} — ${label}${entry.id === "flaw.necessary-realm-aura-for-ability" && taken.parameter ? ` (${taken.parameter})` : ""}`;
  }
  return entry.name.replace(/\(([^)]+)\)/, taken.parameter ?? "($1)");
}
