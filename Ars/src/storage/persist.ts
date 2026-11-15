/**
 * Local-first persistence. The browser keeps a roster; JSON export is the
 * sharing and backup mechanism. Swapping this for IndexedDB or a sync layer
 * later touches nothing outside this file.
 */
import { DEFAULT_CAMPAIGN_YEAR, migrate, type Character } from "../model/character";

const KEY = "ars-ratiocinandi:roster:v2";
const YEAR_KEY = "ars-ratiocinandi:campaign-year";

export function loadCampaignYear(): number {
  const year = Number(localStorage.getItem(YEAR_KEY));
  return Number.isInteger(year) && year > 0 && year < 10000 ? year : DEFAULT_CAMPAIGN_YEAR;
}

export function saveCampaignYear(year: number): void {
  localStorage.setItem(YEAR_KEY, String(year));
}

export function loadRoster(): Character[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(migrate) : [];
  } catch {
    return [];
  }
}

export function saveRoster(roster: Character[]): void {
  localStorage.setItem(KEY, JSON.stringify(roster));
}

export function exportJson(character: Character): void {
  const blob = new Blob([JSON.stringify(character, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(character.name || "character").replace(/[^\w-]+/g, "-").toLowerCase()}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importJson(file: File): Promise<Character> {
  return file.text().then((t) => migrate(JSON.parse(t)));
}
