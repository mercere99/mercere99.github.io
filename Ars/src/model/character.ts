/**
 * The Character document.
 *
 * This is what gets saved, exported, and shared, so it is versioned. Every
 * shape change bumps SCHEMA_VERSION. This pre-release format may change.
 * Fields the engine derives
 * (findings, totals, wound ranges) are never stored; they are recomputed.
 */

import type { Override } from "./findings";
import type { CharacterType } from "../data/ruleset";

export const SCHEMA_VERSION = 2;
export const DEFAULT_CAMPAIGN_YEAR = 1220;

export const DETAIL_LABELS = {
  birthplace: "Birthplace", religion: "Religion", gender: "Gender",
  height: "Height", weight: "Weight", hairColor: "Hair color", eyeColor: "Eye color",
  appearance: "Appearance", handedness: "Handedness", occupation: "Occupation",
} as const;

export interface TimelineEvent {
  key: string;
  year: number;
  label: string;
  notes: string;
}

export interface EquipmentItem {
  key: string;
  name: string;
  type: "weapon" | "armor" | "item";
  load: number;
  equipped: boolean;
  description: string;
  /** A reminder shown prominently when equipped; never executed as code. */
  effects: string;
}

export interface CharacteristicScores {
  [characteristicId: string]: number;
}

export interface TakenVirtueFlaw {
  /** A stable key for this particular taking, so duplicates are addressable. */
  key: string;
  id: string;
  /** Resolved size when the entry offers a choice. */
  size?: "free" | "minor" | "major";
  /** e.g. the Art for Puissant (Art), the Area for Area Lore. */
  parameter?: string;
  /** Stable key of the chosen Ability instance (including its language/subject). */
  abilityKey?: string;
}

export interface TakenAbility {
  key: string;
  id: string;
  /** The subject for parameterized Abilities: "Provence" for Area Lore. */
  parameter?: string;
  specialty?: string;
  /** Experience invested. Score is derived from this, never stored. */
  xp: number;
  /** The character's native tongue; gets the free 75 XP. */
  native?: boolean;
}

export interface PersonalityTrait {
  name: string;
  score: number;
}

export interface Character {
  schemaVersion: typeof SCHEMA_VERSION;
  id: string;
  ruleset: string;
  type: CharacterType;
  campaignId?: string;
  role?: "player-character" | "shared" | "npc";
  ownerId?: string;

  name: string;
  concept: string;
  birthYear: number;
  /** Fixes the creation XP budget as the campaign calendar advances. */
  creationYear: number;
  details: Partial<Record<keyof typeof DETAIL_LABELS, string>>;
  timeline: TimelineEvent[];

  characteristics: CharacteristicScores;
  virtuesFlaws: TakenVirtueFlaw[];
  abilities: TakenAbility[];
  personality: PersonalityTrait[];
  equipment: EquipmentItem[];
  notes: string;

  /** Deliberate decisions to accept rule findings. See model/findings.ts. */
  overrides: Override[];

  created: string;
  modified: string;

  /** Where this came from, if it started life as a library entry. */
  derivedFrom?: { libraryId: string; book: string };
}

export function newCharacter(type: CharacterType, ruleset: string, campaignYear = DEFAULT_CAMPAIGN_YEAR): Character {
  const now = new Date().toISOString();
  return {
    schemaVersion: SCHEMA_VERSION,
    id: crypto.randomUUID(),
    ruleset,
    type,
    role: type === "grog" ? "shared" : "player-character",
    name: "",
    concept: "",
    birthYear: campaignYear - (type === "magus" ? 25 : 20),
    creationYear: campaignYear,
    details: {},
    timeline: [],
    characteristics: {},
    virtuesFlaws: [],
    abilities: [],
    personality: type === "grog" ? [{ name: "Loyal", score: 1 }] : [],
    equipment: [],
    notes: "",
    overrides: [],
    created: now,
    modified: now,
  };
}

/** Read the current pre-release format; older schemas are not supported. */
export function migrate(raw: unknown): Character {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Not a character document.");
  }
  const doc = { ...(raw as Record<string, unknown>) };
  if (doc.schemaVersion !== SCHEMA_VERSION) {
    throw new Error("This file uses a different pre-release character format.");
  }
  if (!["grog", "companion", "magus"].includes(String(doc.type)) ||
      !Number.isInteger(doc.birthYear) || !Number.isInteger(doc.creationYear) ||
      !Array.isArray(doc.abilities) || !Array.isArray(doc.virtuesFlaws) ||
      !Array.isArray(doc.equipment) || !Array.isArray(doc.timeline) ||
      typeof doc.details !== "object" || doc.details === null) {
    throw new Error("Incomplete character document.");
  }
  return doc as unknown as Character;
}

export function ageInYear(c: Pick<Character, "birthYear">, year: number): number {
  return year - c.birthYear;
}

export function touch(c: Character): Character {
  return { ...c, modified: new Date().toISOString() };
}

export function newKey(): string {
  return Math.random().toString(36).slice(2, 10);
}
