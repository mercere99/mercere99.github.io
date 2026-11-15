import { describe, expect, it } from "vitest";
import { displaySeverity, resolveOverrides, type Finding, type Override } from "../src/model/findings";
import { definitiveEdition as rules } from "../src/data/ruleset";
import { validate } from "../src/engine/validate";
import { newCharacter, type Character } from "../src/model/character";

const grog = (over: Partial<Character> = {}): Character => ({
  ...newCharacter("grog", "definitive"),
  virtuesFlaws: [{ key: "s", id: "virtue.covenfolk" }],
  ...over,
});
const accessFindings = (c: Character) =>
  validate(c, rules).findings.filter((f) => f.id.startsWith("ability-access:"));

describe("ability access", () => {
  it("allows General Abilities to anyone", () => {
    const c = grog({ abilities: [{ key: "a", id: "ability.awareness", xp: 15 }] });
    expect(accessFindings(c)).toHaveLength(0);
  });

  it("flags an Academic Ability with no granting Virtue", () => {
    const c = grog({ abilities: [{ key: "a", id: "ability.artes-liberales", xp: 5 }] });
    const f = accessFindings(c);
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("error");
    expect(f[0]!.id).toBe("ability-access:ability.artes-liberales");
  });

  it("allows it once a Virtue grants access (Educated, auto-derived from text)", () => {
    const c = grog({
      abilities: [{ key: "a", id: "ability.artes-liberales", xp: 5 }],
      virtuesFlaws: [{ key: "s", id: "virtue.covenfolk" }, { key: "e", id: "virtue.educated" }],
    });
    expect(accessFindings(c)).toHaveLength(0);
  });

  it("keys the finding on the ability, not its position", () => {
    const one = grog({ abilities: [
      { key: "a", id: "ability.awareness", xp: 15 }, { key: "b", id: "ability.artes-liberales", xp: 5 }] });
    const two = grog({ abilities: [
      { key: "b", id: "ability.artes-liberales", xp: 5 }, { key: "a", id: "ability.awareness", xp: 15 }] });
    expect(accessFindings(one)[0]!.id).toBe(accessFindings(two)[0]!.id);
  });
});

describe("overrides", () => {
  const finding: Finding = {
    id: "ability-access:ability.artes-liberales",
    rule: "ability-access",
    severity: "error",
    message: "…",
    path: "abilities[0]",
  };
  const override: Override = {
    findingId: "ability-access:ability.artes-liberales",
    reason: "Raised in the covenant scriptorium; the SG allowed it.",
    accepted: "2026-09-03",
  };

  it("annotates rather than suppresses", () => {
    const state = resolveOverrides([finding], [override])[0]!;
    expect(state.kind).toBe("overridden");
    // The finding survives so it can still be printed on the sheet.
    expect(state.kind === "overridden" ? state.finding.severity : null).toBe("error");
    // …but it displays as info, not as an error.
    expect(displaySeverity(state)).toBe("info");
  });

  it("reports an override whose finding no longer occurs as stale", () => {
    // The character later took Educated, so access is legitimate now.
    const state = resolveOverrides([], [override])[0]!;
    expect(state.kind).toBe("stale");
    // Stale overrides are surfaced for removal, never dropped silently.
    expect(displaySeverity(state)).toBe("warning");
  });

  it("leaves unrelated findings active", () => {
    const other: Finding = { ...finding, id: "ability-access:ability.bows" };
    const states = resolveOverrides([finding, other], [override]);
    expect(states.filter((s) => s.kind === "active")).toHaveLength(1);
    expect(states.filter((s) => s.kind === "overridden")).toHaveLength(1);
  });

  it("round-trips: overriding then removing restores the error", () => {
    const withOverride = resolveOverrides([finding], [override]);
    const without = resolveOverrides([finding], []);
    expect(displaySeverity(withOverride[0]!)).toBe("info");
    expect(displaySeverity(without[0]!)).toBe("error");
  });
});
