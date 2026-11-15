/**
 * Generate a plausible grog. Not a balance engine — a starting point that
 * passes validation and that a storyguide can edit. Archetypes are data so
 * new ones are a list entry, and the generator never reaches into the
 * ruleset for anything it could get from `resolve`.
 */

import { newCharacter, type Character } from "../model/character";
import type { RuleSet, VirtueFlaw } from "../data/ruleset";
import { resolve } from "./resolve";
import { xpForScore } from "./advancement";
import { choosesAbility } from "./ability-effects";

export interface Archetype {
  id: string;
  label: string;
  /** Virtue that grants the archetype's defining access, if any. */
  keyVirtue?: string;
  /** Abilities to favor, most important first. */
  favored: string[];
  /** Characteristic ids to push positive. */
  strong: string[];
  weak: string[];
  personality: string[];
}

export const ARCHETYPES: Archetype[] = [
  { id: "shield-grog", label: "Shield grog", keyVirtue: "virtue.warrior",
    favored: ["ability.single-weapon", "ability.brawl", "ability.awareness", "ability.athletics"],
    strong: ["characteristic.strength", "characteristic.stamina"], weak: ["characteristic.communication"],
    personality: ["Brave", "Stubborn", "Cheerful"] },
  { id: "archer", label: "Archer", keyVirtue: "virtue.warrior",
    favored: ["ability.bows", "ability.hunt", "ability.awareness", "ability.stealth"],
    strong: ["characteristic.perception", "characteristic.dexterity"], weak: ["characteristic.presence"],
    personality: ["Patient", "Quiet", "Wary"] },
  { id: "hunter", label: "Hunter",
    favored: ["ability.hunt", "ability.survival", "ability.awareness", "ability.animal-handling", "ability.stealth"],
    strong: ["characteristic.perception"], weak: ["characteristic.communication"],
    personality: ["Solitary", "Patient", "Superstitious"] },
  { id: "servant", label: "Servant",
    favored: ["ability.profession", "ability.etiquette", "ability.folk-ken", "ability.awareness"],
    strong: ["characteristic.communication"], weak: ["characteristic.strength"],
    personality: ["Discreet", "Loyal", "Curious"] },
  { id: "craftsman", label: "Craftsman",
    favored: ["ability.craft", "ability.bargain", "ability.folk-ken", "ability.athletics"],
    strong: ["characteristic.dexterity"], weak: ["characteristic.quickness"],
    personality: ["Proud", "Careful", "Grumpy"] },
  { id: "clerk", label: "Clerk", keyVirtue: "virtue.educated",
    favored: ["ability.artes-liberales", "ability.dead-language", "ability.folk-ken", "ability.etiquette"],
    strong: ["characteristic.intelligence"], weak: ["characteristic.strength"],
    personality: ["Fussy", "Pious", "Timid"] },
];

const NAMES = ["Aldo", "Berta", "Cuno", "Dietlinde", "Eudes", "Fulk", "Gisela", "Hamo", "Ida", "Jordan", "Katrin", "Lambert", "Mechthild", "Odo", "Perrin", "Radegund", "Sigfrid", "Tilda", "Ulf", "Walburg"];
const AREAS = ["the valley", "the covenant", "the market town", "the coast", "the forest"];
const LANGUAGES = ["Occitan", "German", "French", "Italian", "English", "Castilian"];

function rnd<T>(xs: readonly T[], r: () => number): T { return xs[Math.floor(r() * xs.length)]!; }
function shuffle<T>(xs: T[], r: () => number): T[] {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j]!, a[i]!]; }
  return a;
}

/** Deterministic PRNG so a seed reproduces a grog exactly. */
export function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function generateGrog(rules: RuleSet, opts: { archetype?: string; seed?: number; campaignYear?: number; defaultLanguage?: string; location?: string } = {}): Character {
  const seed = opts.seed ?? Math.floor(Math.random() * 2 ** 31);
  const r = mulberry32(seed);
  const newKey = () => Math.floor(r() * 2 ** 40).toString(36);
  const arch = ARCHETYPES.find((a) => a.id === opts.archetype) ?? rnd(ARCHETYPES, r);
  const c = newCharacter("grog", rules.id, opts.campaignYear);
  c.name = rnd(NAMES, r);
  c.birthYear = c.creationYear - (18 + Math.floor(r() * 20));
  c.concept = `${arch.label}, seed ${seed}`;

  // ---- Characteristics: spend exactly the budget by point-buy.
  const cost = rules.creation.characteristics.cost as Record<string, number>;
  const ids = rules.characteristics.map((ch) => ch.id);
  for (const id of ids) c.characteristics[id] = 0;
  const budget = rules.creation.characteristics.points;
  let spent = 0;
  const bump = (id: string, dir: 1 | -1): boolean => {
    const cur = c.characteristics[id] ?? 0;
    const next = cur + dir;
    if (next > 3 || next < -3) return false;
    const delta = (cost[String(next)] ?? 0) - (cost[String(cur)] ?? 0);
    if (spent + delta > budget) return false;
    c.characteristics[id] = next; spent += delta; return true;
  };
  for (const id of arch.weak) if (r() < 0.7) bump(id, -1);
  for (const id of arch.strong) bump(id, 1), r() < 0.5 && bump(id, 1);
  for (let guard = 0; spent < budget && guard < 40; guard++) bump(rnd(ids, r), 1);

  // ---- Virtues and Flaws
  const all = [...rules.virtuesFlaws.values()];
  const grogOk = (v: VirtueFlaw) =>
    (v.size === "minor" || (Array.isArray(v.size) && v.size.includes("minor"))) &&
    !v.categories.includes("hermetic") && !v.categories.includes("story") &&
    !v.categories.includes("social-status") && !v.categories.includes("special") &&
    !v.categories.includes("mythic-companion") && !v.categories.includes("heroic") &&
    !v.categories.includes("supernatural") &&
    !v.parameterized && !v.tags.includes("tainted") && !v.tags.includes("animals-only");
  const flawPool = shuffle(all.filter((v) => v.kind === "flaw" && grogOk(v)), r);
  const virtuePool = shuffle(all.filter((v) => v.kind === "virtue" && grogOk(v) && v.id !== arch.keyVirtue), r);

  c.virtuesFlaws.push({ key: newKey(), id: "virtue.covenfolk" });
  const nFlaws = 1 + Math.floor(r() * 3);
  const personalityTaken = { n: 0 };
  const flaws: VirtueFlaw[] = [];
  for (const f of flawPool) {
    if (flaws.length >= nFlaws) break;
    const isPers = f.categories.includes("personality");
    if (isPers && personalityTaken.n >= 1) continue;
    if (isPers) personalityTaken.n++;
    flaws.push(f);
  }
  for (const f of flaws) c.virtuesFlaws.push({ key: newKey(), id: f.id, size: "minor" });
  let virtueBudget = flaws.length;
  if (arch.keyVirtue && virtueBudget > 0) { c.virtuesFlaws.push({ key: newKey(), id: arch.keyVirtue }); virtueBudget--; }
  for (const v of virtuePool) { if (virtueBudget <= 0) break; c.virtuesFlaws.push({ key: newKey(), id: v.id, size: "minor" }); virtueBudget--; }

  // ---- Abilities
  c.abilities.push({ key: newKey(), id: "ability.living-language", parameter: opts.defaultLanguage?.trim() || rnd(LANGUAGES, r), native: true, xp: 75 });
  const access = resolve(c, rules).access;
  const early = rules.creation.experience.earlyChildhood;
  const add = (id: string, xp: number, parameter?: string) => {
    const existing = c.abilities.find((a) => a.id === id && !a.native && a.parameter === parameter);
    if (existing) existing.xp += xp;
    else c.abilities.push({ key: newKey(), id, xp, parameter });
  };
  // Early childhood: 45 points across the childhood list.
  const childhood = shuffle(early.abilities.filter((id) => id !== "ability.living-language"), r).slice(0, 3);
  const chunks = [xpForScore(2, "ability", rules), xpForScore(2, "ability", rules), xpForScore(2, "ability", rules)]; // 15×3 = 45
  childhood.forEach((id, i) => add(id, chunks[i]!, id === "ability.area-lore" ? opts.location?.trim() || rnd(AREAS, r) : undefined));

  // Later life: favored first, then fill.
  const { budget: total } = resolve(c, rules).xp;
  let remaining = total - early.points;
  const favored = arch.favored.filter((id) => { const d = rules.abilities.get(id); return d && access.has(d.type); });
  const fillers = shuffle([...rules.abilities.values()].filter((a) => a.type === "general" && !a.parameterized && !favored.includes(a.id)), r).map((a) => a.id);
  const targets = [...favored, ...fillers.slice(0, 4)];
  const cap = resolve(c, rules).abilityCap;
  for (let round = 0; remaining > 0 && round < 12; round++) {
    for (const id of targets) {
      if (remaining <= 0) break;
      const def = rules.abilities.get(id)!;
      const cur = c.abilities.find((a) => a.id === id && !a.native);
      const curScore = cur ? scoreOf(cur.xp, rules) : 0;
      const wantScore = Math.min(cap, curScore + 1);
      if (wantScore <= curScore) continue;
      const need = xpForScore(wantScore, "ability", rules) - xpForScore(curScore, "ability", rules);
      const weight = favored.includes(id) ? 0.8 : 0.35;
      if (r() > weight) continue;
      const grant = Math.min(need, remaining);
      add(id, grant, def.parameterized ? rnd(AREAS, r) : undefined);
      remaining -= grant;
    }
  }
  if (remaining > 0) add(favored[0] ?? "ability.awareness", remaining);

  for (const a of c.abilities) {
    const def = rules.abilities.get(a.id);
    if (def && def.specialties.length && r() < 0.6) a.specialty = rnd(def.specialties, r);
  }

  // Targeted Virtues need a real instance, not an unbound descriptive string.
  for (const taken of c.virtuesFlaws) {
    const entry=rules.virtuesFlaws.get(taken.id);
    if (entry && choosesAbility(entry)) taken.abilityKey=(c.abilities.find(a=>a.id===arch.favored[0])??c.abilities[0])?.key;
  }

  // ---- Personality
  c.personality = [
    { name: "Loyal", score: 1 + Math.floor(r() * 3) },
    { name: rnd(arch.personality, r), score: 1 + Math.floor(r() * 3) },
  ];
  return c;
}

function scoreOf(xp: number, rules: RuleSet): number {
  const t = rules.creation.advancement.ability;
  let s = 0; for (let i = 1; i < t.length; i++) if ((t[i] ?? Infinity) <= xp) s = i; else break;
  return s;
}
