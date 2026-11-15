/**
 * The RuleSet is the one object the engine and UI read game data from.
 *
 * Everything under `data/` is loaded here and nowhere else. This is the seam
 * for supporting multiple rulesets later (Definitive Edition vs ArM5, house
 * rules, a troupe's chosen sourcebooks): swap the object, nothing else changes.
 */

import abilitiesJson from "../../data/abilities.json";
import artsJson from "../../data/arts.json";
import characteristicsJson from "../../data/characteristics.json";
import flawsJson from "../../data/flaws.json";
import virtuesJson from "../../data/virtues.json";
import creationJson from "../../data/rules/character-creation.json";
import type { AbilityCategory, Effect, Severity } from "../model/findings";

export type VFSize = "free" | "minor" | "major";
export type VFCategory =
  | "general" | "hermetic" | "supernatural" | "social-status"
  | "personality" | "story" | "child" | "heroic" | "mythic"
  | "mythic-companion" | "special";

export interface VirtueFlaw {
  id: string;
  name: string;
  kind: "virtue" | "flaw";
  /** A list means the player chooses (e.g. "Major or Minor"). */
  size: VFSize | VFSize[];
  categories: VFCategory[];
  tags: string[];
  parameterized?: string;
  effects: Effect[];
  text: string;
  source: { book: string; year: number };
}

export interface Ability {
  id: string;
  name: string;
  type: AbilityCategory;
  restricted: boolean;
  parameterized: boolean;
  specialties: string[];
  text: string;
}

export interface Art {
  id: string;
  name: string;
  abbreviation: string;
  kind: "technique" | "form";
}

export interface Characteristic {
  id: string;
  name: string;
  abbreviation: string;
}

export interface Constraint {
  id: string;
  severity: Severity;
  message: string;
  value?: number;
}

export interface CharacterTypeRules {
  label: string;
  maxFlawPoints: number;
  virtuePointsPerFlawPoint: number;
  confidence: { score: number; points: number } | null;
  required?: string[];
  freeMinorVirtueFromHouse?: boolean;
  constraints: Constraint[];
}

export type CharacterType = "grog" | "companion" | "magus";

export interface RuleSet {
  id: string;
  label: string;
  abilities: Map<string, Ability>;
  arts: Map<string, Art>;
  characteristics: Characteristic[];
  virtuesFlaws: Map<string, VirtueFlaw>;
  creation: typeof creationJson;
  characterTypes: Record<CharacterType, CharacterTypeRules>;
}

function indexById<T extends { id: string }>(records: T[]): Map<string, T> {
  return new Map(records.map((r) => [r.id, r]));
}

export const definitiveEdition: RuleSet = {
  id: "definitive",
  label: "Ars Magica: Definitive Edition",
  abilities: indexById(abilitiesJson.records as unknown as Ability[]),
  arts: indexById(artsJson.records as unknown as Art[]),
  characteristics: characteristicsJson.records as unknown as Characteristic[],
  virtuesFlaws: indexById([
    ...(virtuesJson.records as unknown as VirtueFlaw[]),
    ...(flawsJson.records as unknown as VirtueFlaw[]),
  ]),
  creation: creationJson,
  characterTypes: creationJson.characterTypes as unknown as Record<
    CharacterType,
    CharacterTypeRules
  >,
};

/** Point value of a Virtue or Flaw at a given size. */
export function pointsFor(size: VFSize, rules: RuleSet): number {
  return rules.creation.virtueFlawPoints[size];
}
