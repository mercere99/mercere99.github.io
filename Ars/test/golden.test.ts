import { describe, expect, it } from "vitest";
import berserker from "./golden/the-berserker.json";
import { definitiveEdition as rules } from "../src/data/ruleset";
import { validate } from "../src/engine/validate";
import { migrate } from "../src/model/character";

/**
 * Golden characters: published templates with printed derived totals. If the
 * engine disagrees with the book, either the engine or the data is wrong —
 * and the data is the more likely culprit.
 */
describe("golden: The Berserker", () => {
  const c = migrate(berserker);
  const { resolved, states, counts } = validate(c, rules);
  const x = berserker._expected;

  it("spends exactly the Characteristic budget", () => {
    expect(resolved.characteristicPointsSpent).toBe(x.characteristicPointsSpent);
  });
  it("is Size +1 from Large, with wound bands of 6", () => {
    expect(resolved.size).toBe(x.size);
    expect(resolved.woundBands.map((b) => [b.from, b.to])).toEqual(x.woundBands);
  });
  it("balances Virtue and Flaw points", () => {
    expect(resolved.virtuePoints).toBe(x.virtuePoints);
    expect(resolved.flawPoints).toBe(x.flawPoints);
  });
  it("spends exactly the experience budget for age 15", () => {
    expect(resolved.xp.budget).toBe(x.xpBudget);
    expect(resolved.xp.spent).toBe(x.xpSpent);
  });
  it("derives the printed Ability scores", () => {
    for (const [id, score] of Object.entries(x.scores)) {
      expect(resolved.abilities.find((a) => a.id === id)?.score, id).toBe(score);
    }
  });
  it("has Martial access via Berserk", () => {
    expect(resolved.access.has("martial")).toBe(true);
  });
  it("produces no errors", () => {
    const errors = states.filter((s) => s.kind === "active" && s.finding.severity === "error");
    expect(errors.map((s) => s.kind === "active" && s.finding.message)).toEqual([]);
    expect(counts.error).toBe(x.errors);
  });
  it("flags the second Personality Flaw as a guideline warning", () => {
    // The published template takes two Personality Flaws; the text says
    // grogs *should not* take more than one. A warning, not an error.
    const w = states.find((s) => s.kind === "active" && s.finding.id.includes("max-personality-flaws"));
    expect(w?.kind).toBe("active");
    expect(w?.kind === "active" && w.finding.severity).toBe("warning");
  });
});
