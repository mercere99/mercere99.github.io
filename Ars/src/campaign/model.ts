import type { Character } from "../model/character";

export const SEASONS = ["Spring", "Summer", "Autumn", "Winter"] as const;
export type Season = typeof SEASONS[number];
export type NarrativeRole = "player-character" | "shared" | "npc";
export interface RecordReference {
  id: string;
  fileId: string;
  label: string;
  kind: "character" | "covenant" | "library" | "vis-ledger";
}
export interface GoogleCampaign {
  indexId: string;
  creationFolder?: { id: string; name: string };
  recordsFolderId?: string;
  writerFolderId?: string;
  sharedFolderIds: string[];
  selectedStreamIds: string[];
}
export interface Campaign {
  schemaVersion: 1;
  id: string;
  name: string;
  year: number;
  season: Season;
  notes: string;
  location?: string;
  defaultLanguage?: string;
  records: RecordReference[];
  google?: GoogleCampaign;
}
export function newCampaign(name: string, year = 1220): Campaign {
  return { schemaVersion: 1, id: crypto.randomUUID(), name: name.trim() || "New campaign", year, season: "Spring", notes: "", location: "", defaultLanguage: "", records: [] };
}
export interface Member {
  id: string; // Google's Drive permission ID when connected; never an email-derived key.
  displayName: string;
}
export interface CustomNpc {
  id: string;
  campaignId: string;
  role: "npc";
  kind: "custom";
  name: string;
  description: string;
  ownerId?: string;
}
export type TroupeCharacter = Character | CustomNpc;

export const RECORD_COLUMNS = {
  library: ["Book ID", "Title", "Subject", "Type", "Level", "Quality", "Available", "Notes"],
  vis: ["Transaction ID", "Year", "Season", "Art", "Amount (+/-)", "Reason", "Notes"],
} as const;
