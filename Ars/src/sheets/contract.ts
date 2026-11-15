export const CHARACTER_CONTRACT = "ars.character.v1";
export const CAMPAIGN_CONTRACT = "ars.campaign.v1";
export const SHEET_RANGES = {
  identity: "ars_identity", abilities: "ars_abilities", condition: "ars_condition",
  age: "ars_age",
  campaign: "ars_campaign", year: "ars_campaign_year", season: "ars_campaign_season",
} as const;
export type Cell = string | number | boolean | { formula: string };
export interface WorkbookTab {
  id: number;
  title: string;
  rows: Cell[][];
  rowCount: number;
  widths: number[];
  headerRow: number; // one-based
  inputs: { startRow: number; endRow: number; startColumn: number; endColumn: number }[];
}
export interface WorkbookRange { name: string; tabId: number; startRow: number; endRow: number; startColumn: number; endColumn: number }
export interface WorkbookPlan {
  title: string;
  tabs: WorkbookTab[];
  ranges: WorkbookRange[];
  validations: { tabId: number; column: number; startRow: number; endRow: number; values?: string[]; range?: string; checkbox?: boolean }[];
}
export interface CharacterSnapshot {
  fileId: string;
  id: string;
  name: string;
  kind: string;
  role: string;
  birthYear: number;
  creationYear: number;
  campaignYear: number;
  age: number;
  campaignId: string;
  abilities: { key: string; name: string; subject: string; specialty: string; xp: number; base: number; effective: number; surplus: number; next: number }[];
  fetchedAt: string;
}
