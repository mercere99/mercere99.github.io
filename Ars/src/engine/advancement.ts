/**
 * Experience ↔ score. The tables come from the ruleset so a house rule that
 * changes the curve is a data change.
 */

import type { RuleSet } from "../data/ruleset";

export type Track = "ability" | "art";

/** Highest score whose cumulative cost is within `xp`. */
export function scoreFromXp(xp: number, track: Track, rules: RuleSet): number {
  const table = rules.creation.advancement[track];
  let score = 0;
  for (let s = 1; s < table.length; s++) {
    if ((table[s] ?? Infinity) <= xp) score = s;
    else break;
  }
  // Beyond the table, extend the closed form. Abilities: 5·n(n+1)/2. Arts: n(n+1)/2.
  if (score === table.length - 1) {
    const unit = track === "ability" ? 5 : 1;
    while (unit * ((score + 1) * (score + 2)) / 2 <= xp) score++;
  }
  return score;
}

/** Cumulative XP needed to hold `score` exactly. */
export function xpForScore(score: number, track: Track, rules: RuleSet): number {
  const table = rules.creation.advancement[track];
  if (score < table.length) return table[score] ?? 0;
  const unit = track === "ability" ? 5 : 1;
  return (unit * score * (score + 1)) / 2;
}

/** XP left over after reaching the current score — progress toward the next. */
export function surplusXp(xp: number, track: Track, rules: RuleSet): number {
  return xp - xpForScore(scoreFromXp(xp, track, rules), track, rules);
}
