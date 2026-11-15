import { CAMPAIGN_CONTRACT, CHARACTER_CONTRACT, SHEET_RANGES, type CharacterSnapshot } from "./contract";
import { SEASONS, type Campaign, type Season } from "../campaign/model";
import type { GoogleDrive } from "../google/api";

function number(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label} is not a calculated number. Open the Sheet to check its formulas${String(value).startsWith("#REF") ? " and Allow access to the linked campaign calendar" : ""}.`);
  return value;
}
function fields(rows: unknown[][]) { return new Map(rows.filter(r => typeof r[0] === "string").map(r => [String(r[0]), r[1]])); }
function text(value: unknown): string { return value == null ? "" : String(value); }
async function readRanges(drive: GoogleDrive, id: string, ranges: string[], valueRanges=ranges) {
  const meta = await drive.spreadsheetMetadata(id);
  const available = new Set(meta.namedRanges?.map(r => r.name));
  const missing = ranges.filter(r => !available.has(r));
  if (missing.length) throw new Error(`This Sheet is missing required named ranges: ${missing.join(", ")}. It must use a compatible Ars template.`);
  const data = await drive.values(id, valueRanges);
  if (data.valueRanges?.length !== ranges.length) throw new Error("Google returned an incomplete workbook read.");
  return data.valueRanges.map(r => r.values ?? []);
}
export function parseCharacterValues(fileId: string, identityRows: unknown[][], abilityRows: unknown[][], ageValue: unknown): CharacterSnapshot {
  const identity = fields(identityRows);
  if (identity.get("Contract") !== CHARACTER_CONTRACT) throw new Error("Unsupported character Sheet format.");
  const id = text(identity.get("Character ID"));
  if (!id) throw new Error("The character's stable ID is missing.");
  const headers = abilityRows[0]?.map(String) ?? [];
  const columns = ["Ability key", "Ability", "Subject", "Specialty", "Total XP", "Base score", "Effective score", "Surplus XP", "XP to next"];
  const missing = columns.filter(c => !headers.includes(c));
  if (missing.length) throw new Error(`Ability columns are missing: ${missing.join(", ")}.`);
  const index = (column: string) => headers.indexOf(column);
  const keys = new Set<string>();
  const abilities = abilityRows.slice(1).filter(row => row[index("Ability key")] !== "" && row[index("Ability key")] != null).map(row => {
    const key = text(row[index("Ability key")]);
    if (keys.has(key)) throw new Error(`Duplicate ability key: ${key}. Give each ability its own stable key.`);
    keys.add(key);
    return {
      key, name: text(row[index("Ability")]), subject: text(row[index("Subject")]), specialty: text(row[index("Specialty")]),
      xp: number(row[index("Total XP")], "Total XP"), base: number(row[index("Base score")], "Base score"), effective: number(row[index("Effective score")], "Effective score"), surplus: number(row[index("Surplus XP")], "Surplus XP"), next: number(row[index("XP to next")], "XP to next"),
    };
  });
  return {
    fileId, id, name: text(identity.get("Name")) || "Unnamed character", kind: text(identity.get("Kind")), role: text(identity.get("Role")),
    birthYear: number(identity.get("Birth year"), "Birth year"), creationYear: number(identity.get("Creation year"), "Creation year"), campaignYear: number(identity.get("Campaign year"), "Campaign year"),
    age: number(ageValue, "Age"), campaignId: text(identity.get("Campaign ID")), abilities, fetchedAt: new Date().toISOString(),
  };
}
export async function readCharacter(drive: GoogleDrive, id: string) {
  const values = await readRanges(drive, id, [SHEET_RANGES.identity, SHEET_RANGES.abilities, SHEET_RANGES.age]);
  return parseCharacterValues(id, values[0]!, values[1]!, values[2]?.[0]?.[0]);
}
export async function readCampaign(drive: GoogleDrive, id: string): Promise<Campaign> {
  // Calendar cell positions are fixed by the campaign contract. Include the
  // defaults rows even for an earlier Sheet whose named range ended at row 8.
  const [rows] = await readRanges(drive, id, [SHEET_RANGES.campaign], ["'Campaign'!A3:B10"]);
  const values = fields(rows!);
  if (values.get("Contract") !== CAMPAIGN_CONTRACT || !values.get("Campaign ID")) throw new Error("This is not a supported campaign index Sheet.");
  const season = text(values.get("Season"));
  if (!SEASONS.includes(season as Season)) throw new Error("Choose Spring, Summer, Autumn, or Winter in the campaign Sheet.");
  const year = number(values.get("Year"), "Campaign year");
  if (!Number.isInteger(year)) throw new Error("Campaign year must be an integer.");
  return { schemaVersion: 1, id: text(values.get("Campaign ID")), name: text(values.get("Name")), year, season: season as Season, notes: text(values.get("Notes")), location:text(values.get("Location")), defaultLanguage:text(values.get("Default language")), records: [], google: { indexId:id,sharedFolderIds:[],selectedStreamIds:[] } };
}
