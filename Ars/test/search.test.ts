import { describe, expect, it } from "vitest";
import { searchItems } from "../src/ui/search";

describe("picker search", () => {
  const items = [
    { label: "Awareness", search: "general eyesight" },
    { label: "Educated", search: "virtue academic" },
    { label: "Great Endurance", search: "virtue general" },
    { label: "Etiquette", search: "general society" },
  ];
  it("ranks name prefixes above word prefixes, substrings, and metadata", () => {
    expect(searchItems(items, "e").map((item) => item.label)).toEqual([
      "Educated", "Etiquette", "Great Endurance", "Awareness",
    ]);
  });
  it("still searches metadata and multiple words", () => {
    expect(searchItems(items, "academic virtue").map((item) => item.label)).toEqual(["Educated"]);
  });
  it("matches names without requiring accents or leading parentheses", () => {
    const names = [{ label: "Éloquence", search: "" }, { label: "(Area) Lore", search: "" }];
    expect(searchItems(names, "elo")[0]?.label).toBe("Éloquence");
    expect(searchItems(names, "area")[0]?.label).toBe("(Area) Lore");
    expect(searchItems(names, "absent")).toEqual([]);
  });
});
