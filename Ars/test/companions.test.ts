import { describe, expect, it } from "vitest";
import { definitiveEdition as rules } from "../src/data/ruleset";
import { generateGrog } from "../src/engine/generate";
import { validate } from "../src/engine/validate";
import { ageInYear, migrate, newCharacter, type Character } from "../src/model/character";

const companion = (): Character => ({
  ...newCharacter("companion", rules.id),
  virtuesFlaws: [{ key: "status", id: "virtue.covenfolk" }],
});

describe("companion creation", () => {
  it("allows Major entries and ten Flaw points while grogs reject them", () => {
    const c = companion();
    c.virtuesFlaws.push(
      { key: "giant", id: "virtue.giant-blood" },
      { key: "enemies", id: "flaw.enemies" },
      { key: "poor", id: "flaw.poor" },
      { key: "driven", id: "flaw.driven", size: "major" },
      { key: "infamous", id: "flaw.infamous" },
    );
    const result = validate(c, rules);
    expect(result.resolved.flawPoints).toBe(10);
    expect(result.counts.error).toBe(0);
    expect(validate({ ...c, type: "grog" }, rules).findings.some((f) => f.id.includes("no-major"))).toBe(true);
  });

  it("enforces the companion's five-Minor-Flaws limit", () => {
    const c = companion();
    const flaws = [...rules.virtuesFlaws.values()].filter((v) =>
      v.kind === "flaw" && v.size === "minor" && !v.categories.includes("hermetic") && !v.categories.includes("personality"),
    ).slice(0, 6);
    c.virtuesFlaws.push(...flaws.map((v) => ({ key: v.id, id: v.id })));
    expect(validate(c, rules).findings.some((f) => f.id === "virtues-flaws:max-minor-flaws" && f.severity === "error")).toBe(true);
  });

  it("grants Academic access and creation XP through Educated", () => {
    const c = companion();
    c.abilities.push({ key: "academic", id: "ability.artes-liberales", xp: 5 });
    expect(validate(c, rules).findings.some((f) => f.id.startsWith("ability-access:"))).toBe(true);
    c.virtuesFlaws.push({ key: "educated", id: "virtue.educated" }, { key: "infamous", id: "flaw.infamous" });
    const result = validate(c, rules);
    expect(result.findings.some((f) => f.id.startsWith("ability-access:"))).toBe(false);
    expect(result.resolved.xp.budget).toBe(320);
  });
});

describe("campaign calendar", () => {
  it("updates age without increasing creation XP or relaxing creation score caps", () => {
    const c = companion();
    c.birthYear = 1192;
    const start = validate(c, rules, 1220).resolved;
    const later = validate(c, rules, 1230).resolved;
    expect([start.age, later.age]).toEqual([28, 38]);
    expect(later.xp.budget).toBe(start.xp.budget);
    expect(later.abilityCap).toBe(start.abilityCap);
  });

  it("uses the chosen campaign year for new characters and seeded grogs", () => {
    const defaultGrog = generateGrog(rules, { seed: 7 });
    const laterGrog = generateGrog(rules, { seed: 7, campaignYear: 1250 });
    expect(defaultGrog.creationYear).toBe(1220);
    expect(laterGrog.birthYear - defaultGrog.birthYear).toBe(30);
    expect(ageInYear(laterGrog, 1250)).toBe(ageInYear(defaultGrog, 1220));
    expect(validate(laterGrog, rules, 1250).counts.error).toBe(0);
    expect(newCharacter("companion", rules.id, 1250).birthYear).toBe(1230);
  });

  it("flags birth dates after the campaign year or a creation age below five", () => {
    const c = companion();
    c.birthYear = 1221;
    expect(validate(c, rules).findings.some((f) => f.id === "calendar:birth-year")).toBe(true);
  });

  it("preserves optional details, dated events, and equipment through JSON export/import", () => {
    const c = companion();
    c.details = { birthplace: "Toledo", gender: "Male" };
    c.timeline = [{ key: "join", year: 1219, label: "Joined the covenant", notes: "Winter" }];
    c.equipment = [{ key: "cloak", name: "Cloak", type: "item", load: 1, equipped: true, description: "Blue wool", effects: "Keep warm" }];
    expect(migrate(JSON.parse(JSON.stringify(c)))).toEqual(c);
  });
});
