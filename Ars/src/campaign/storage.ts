import type { Campaign } from "./model";
import type { Character } from "../model/character";
const KEY = "ars:campaigns:v1";
const ACTIVE = "ars:active-campaign";
export function loadCampaigns(): Campaign[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  const value = JSON.parse(raw) as Campaign[];
  if (!Array.isArray(value) || value.some(c => c.schemaVersion !== 1 || typeof c.id !== "string" || !Array.isArray(c.records))) throw new Error("Cannot read the saved campaigns. Export or repair local storage before saving.");
  return value;
}
export function saveCampaigns(value: Campaign[]) { localStorage.setItem(KEY, JSON.stringify(value)); }
export function loadActiveCampaign() { return localStorage.getItem(ACTIVE) ?? ""; }
export function saveActiveCampaign(id: string) { localStorage.setItem(ACTIVE, id); }

/** Only browser state is removed. Drafts survive and no Drive operation occurs. */
export function removeCampaignLocally(campaigns: Campaign[], roster: Character[], id: string) {
  return {
    campaigns: campaigns.filter(c=>c.id!==id),
    roster: roster.map(c=>c.campaignId===id?{...c,campaignId:undefined}:c),
  };
}
