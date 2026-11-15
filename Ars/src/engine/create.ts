import type { Campaign } from "../campaign/model";
import type { CharacterType, RuleSet } from "../data/ruleset";
import { DEFAULT_CAMPAIGN_YEAR, newCharacter, newKey } from "../model/character";
import { xpForScore } from "./advancement";

/** A starting checklist, not a compulsory allocation of non-native XP. */
export function createCharacter(type: CharacterType, rules: RuleSet, year = DEFAULT_CAMPAIGN_YEAR, campaign?: Campaign) {
  const c = newCharacter(type, rules.id, year);
  c.campaignId = campaign?.id;
  c.abilities = [{key:newKey(),id:"ability.living-language",parameter:campaign?.defaultLanguage?.trim()||undefined,native:true,xp:xpForScore(5,"ability",rules)}];
  const common = [
    ...rules.creation.experience.earlyChildhood.abilities,
    "ability.bargain", "ability.carouse", "ability.concentration", "ability.etiquette",
    "ability.music", "ability.ride", "ability.teaching",
    ...(type === "magus" ? ["ability.dead-language", "ability.artes-liberales", "ability.magic-theory", "ability.parma-magica", "ability.code-of-hermes", "ability.finesse", "ability.penetration"] : []),
  ];
  for (const id of new Set(common)) {
    if (id === "ability.living-language" || !rules.abilities.has(id)) continue;
    c.abilities.push({key:newKey(),id,xp:0,parameter:id==="ability.area-lore"?campaign?.location?.trim()||undefined:id==="ability.dead-language"?"Latin":undefined});
  }
  return c;
}
