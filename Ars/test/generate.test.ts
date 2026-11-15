import { describe, expect, it } from "vitest";
import { definitiveEdition as rules } from "../src/data/ruleset";
import { ARCHETYPES, generateGrog } from "../src/engine/generate";
import { validate } from "../src/engine/validate";

describe("grog generator", () => {
  it("produces error-free grogs for every archetype across many seeds", () => {
    const problems: string[] = [];
    for (const a of ARCHETYPES) {
      for (let seed = 1; seed <= 40; seed++) {
        const c = generateGrog(rules, { archetype: a.id, seed });
        const { counts, findings, resolved } = validate(c, rules);
        if (counts.error > 0) {
          problems.push(`${a.id}#${seed}: ${findings.filter((f) => f.severity === "error").map((f) => f.message).join(" | ")}`);
        }
        if (resolved.xp.spent !== resolved.xp.budget) problems.push(`${a.id}#${seed}: xp ${resolved.xp.spent}/${resolved.xp.budget}`);
        if (resolved.characteristicPointsSpent !== 7) problems.push(`${a.id}#${seed}: characteristics ${resolved.characteristicPointsSpent}`);
      }
    }
    expect(problems.slice(0, 5)).toEqual([]);
    expect(problems).toHaveLength(0);
  });

  it("is deterministic for a given seed", () => {
    const a = generateGrog(rules, { archetype: "hunter", seed: 7 });
    const b = generateGrog(rules, { archetype: "hunter", seed: 7 });
    expect({ ...a, id: "", created: "", modified: "" }).toEqual({ ...b, id: "", created: "", modified: "" });
  });
});
