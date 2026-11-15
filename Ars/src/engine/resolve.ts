/**
 * Resolution: everything derived from a Character and a RuleSet.
 *
 * Pure. No findings here — those live in rules/. This module answers "what
 * does this character actually have" so that rules and the sheet both read
 * from one place. Adding a new derived quantity means adding a field to
 * `Resolved` and computing it here; nothing else changes.
 */

import { ageInYear, DEFAULT_CAMPAIGN_YEAR, type Character, type TakenVirtueFlaw } from "../model/character";
import type { Effect, AbilityCategory } from "../model/findings";
import {
  pointsFor,
  type RuleSet,
  type VFSize,
  type VirtueFlaw,
} from "../data/ruleset";
import { scoreFromXp } from "./advancement";
import { resolveCharacteristics } from "./characteristics";
import { abilityEffects, abilityName } from "./ability-effects";

export interface ResolvedVF {
  taken: TakenVirtueFlaw;
  entry: VirtueFlaw;
  size: VFSize;
  points: number;
}

export interface ResolvedAbility {
  key: string;
  id: string;
  name: string;
  displayName: string;
  type: AbilityCategory;
  score: number;
  effectiveScore: number;
  scoreBonus: number;
  adjustedXp: number;
  xpFactor: number;
  capBonus: number;
  annotations: { key: string; name: string; note: string }[];
  xp: number;
  specialty?: string;
  native: boolean;
}

export interface Resolved {
  age: number;
  creationAge: number;
  virtues: ResolvedVF[];
  flaws: ResolvedVF[];
  virtuePoints: number;
  flawPoints: number;
  effects: Effect[];
  abilities: ResolvedAbility[];
  /** Ability categories this character may buy at creation. */
  access: Set<AbilityCategory>;

  characteristicPointsSpent: number;
  characteristicPointBudget: number;
  characteristics: Record<string, number>;
  characteristicModifiers: Record<string, number>;
  size: number;
  soak: number;
  woundBands: { penalty: string; from: number; to: number }[];
  fatigueLevels: string[];

  xp: {
    earlyChildhood: number;
    laterLife: number;
    nativeLanguage: number;
    /** Total available for non-native Abilities. */
    budget: number;
    spent: number;
    /** Spent on the native language beyond the free allowance. */
    nativeOverflow: number;
  };
  abilityCap: number;
}

export function resolveSize(vf: ResolvedVF, size: VFSize | VFSize[]): VFSize {
  if (Array.isArray(size)) return vf.taken.size ?? size[0]!;
  return size;
}

export function resolve(c: Character, rules: RuleSet, campaignYear = DEFAULT_CAMPAIGN_YEAR): Resolved {
  const age = ageInYear(c, campaignYear);
  const creationAge = ageInYear(c, c.creationYear);
  // ---- Virtues and Flaws
  const virtues: ResolvedVF[] = [];
  const flaws: ResolvedVF[] = [];
  for (const taken of c.virtuesFlaws) {
    const entry = rules.virtuesFlaws.get(taken.id);
    if (!entry) continue;
    const size = Array.isArray(entry.size)
      ? (taken.size ?? entry.size[0]!)
      : entry.size;
    const rvf: ResolvedVF = { taken, entry, size, points: pointsFor(size, rules) };
    (entry.kind === "virtue" ? virtues : flaws).push(rvf);
  }
  const virtuePoints = virtues.reduce((n, v) => n + v.points, 0);
  const flawPoints = flaws.reduce((n, f) => n + f.points, 0);
  const effects = [...virtues, ...flaws].flatMap((v) => v.entry.effects);

  // ---- Access
  const access = new Set<AbilityCategory>(["general"]);
  if (c.type === "magus") {
    for (const cat of ["academic", "arcane", "martial", "spell-mastery"] as const) {
      access.add(cat);
    }
  }
  for (const e of effects) {
    if (e.type === "ability-access") e.categories.forEach((cat) => access.add(cat));
  }

  // ---- Abilities
  const abilities: ResolvedAbility[] = c.abilities.flatMap((a) => {
    const def = rules.abilities.get(a.id);
    if (!def) return [];
    const displayName = abilityName(a, def);
    const modifiers = abilityEffects(c, rules, a);
    const adjustedXp = Math.ceil(a.xp * modifiers.factor);
    const score = scoreFromXp(adjustedXp, "ability", rules);
    return [
      {
        key: a.key,
        id: a.id,
        name: def.name,
        displayName: a.native ? `${a.parameter ?? "Native Language"} (native)` : displayName,
        type: def.type,
        score,
        effectiveScore: score + modifiers.bonus,
        scoreBonus: modifiers.bonus,
        adjustedXp,
        xpFactor: modifiers.factor,
        capBonus: modifiers.capBonus,
        annotations: modifiers.annotations,
        xp: a.xp,
        specialty: a.specialty,
        native: !!a.native,
      },
    ];
  });

  // ---- Characteristics
  const characteristicResult=resolveCharacteristics(c,rules);
  const cost = rules.creation.characteristics.cost as Record<string, number>;
  const characteristicPointsSpent = rules.characteristics.reduce(
    (n, ch) => n + (cost[String(c.characteristics[ch.id] ?? 0)] ?? 0),
    0,
  );

  // ---- Size, Soak, wounds
  let size = 0;
  for (const s of rules.creation.derived.sizeVirtues) {
    const id = "virtue" in s ? s.virtue : s.flaw;
    if (c.virtuesFlaws.some((v) => v.id === id)) size += s.size;
  }
  const stamina = characteristicResult.scores["characteristic.stamina"] ?? 0;
  const soak = stamina; // armor is Phase 2
  const step = 5 + size;
  const bands = rules.creation.derived.woundPenalties.bands;
  const woundBands = [
    ...bands.map((p, i) => ({ penalty: String(p), from: i * step + 1, to: (i + 1) * step })),
    { penalty: "Incapacitated", from: bands.length * step + 1, to: (bands.length + 1) * step },
  ];

  // ---- Experience budget
  const ex = rules.creation.experience;
  const earlyChildhood = ex.earlyChildhood.points;
  let perYear = ex.laterLife.perYear;
  for (const m of ex.laterLife.modifiers) {
    const id = "virtue" in m ? m.virtue : m.flaw;
    if (c.virtuesFlaws.some((v) => v.id === id)) perYear = m.perYear;
  }
  const laterYears = Math.max(0, creationAge - ex.earlyChildhood.years);
  const laterLife = laterYears * perYear;
  const nativeLanguage = ex.earlyChildhood.nativeLanguage;

  let spent = 0;
  let nativeOverflow = 0;
  for (const a of c.abilities) {
    if (a.native) nativeOverflow += Math.max(0, a.xp - nativeLanguage);
    else spent += a.xp;
  }
  spent += nativeOverflow;
  // Virtue-granted XP (e.g. Warrior's 50 on Martial) adds to the budget.
  const granted = effects.reduce((n, e) => n + (e.type === "xp-grant" ? e.amount : 0), 0);

  const cap =
    rules.creation.abilityCapByAge.find((r) => r.maxAge === null || creationAge <= r.maxAge)
      ?.cap ?? 9;

  return {
    age,
    creationAge,
    virtues,
    flaws,
    virtuePoints,
    flawPoints,
    effects,
    abilities,
    access,
    characteristicPointsSpent,
    characteristicPointBudget: characteristicResult.budget,
    characteristics: characteristicResult.scores,
    characteristicModifiers: characteristicResult.modifiers,
    size,
    soak,
    woundBands,
    fatigueLevels: rules.creation.derived.fatigueLevels,
    xp: {
      earlyChildhood,
      laterLife,
      nativeLanguage,
      budget: earlyChildhood + laterLife + granted,
      spent,
      nativeOverflow,
    },
    abilityCap: cap,
  };
}
