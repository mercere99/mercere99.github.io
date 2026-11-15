import type { RuleSet } from "../data/ruleset";
import type { Character } from "../model/character";

export function chosenCharacteristic(parameter: string | undefined, rules: RuleSet) {
  const value=parameter?.trim().toLowerCase();
  return rules.characteristics.find(ch=>[ch.id,ch.name,ch.abbreviation].some(name=>name.toLowerCase()===value))?.id;
}

/** Curated from the named entries in the licensed rules data. Stored scores
 * remain point-buy bases; Great/Poor are applied before Giant Blood/Dwarf. */
export function resolveCharacteristics(c: Character, rules: RuleSet) {
  const scores: Record<string,number> = {};
  const modifiers: Record<string,number> = {};
  const taken=(id:string)=>c.virtuesFlaws.filter(v=>v.id===id);
  const budget=rules.creation.characteristics.points+3*taken("virtue.improved-characteristics").length;
  for(const ch of rules.characteristics){
    const base=c.characteristics[ch.id]??0;
    const selected=(id:string)=>taken(id).filter(v=>chosenCharacteristic(v.parameter,rules)===ch.id).length;
    const great=base>=3?Math.min(2,selected("virtue.great-characteristic")):0;
    const poor=base<=-3?Math.min(2,selected("flaw.poor-characteristic")):0;
    const physical=["characteristic.strength","characteristic.stamina"].includes(ch.id);
    const sizeBonus=physical?(Number(taken("virtue.giant-blood").length>0)-Number(taken("flaw.dwarf").length>0)):0;
    modifiers[ch.id]=great-poor+sizeBonus;
    scores[ch.id]=base+modifiers[ch.id]!;
  }
  return {scores,modifiers,budget};
}

export function characteristicLimitHint(id: string, direction: "raise" | "lower", rules: RuleSet, type: Character["type"]) {
  const name=rules.characteristics.find(ch=>ch.id===id)?.name??id;
  const physical=["characteristic.strength","characteristic.stamina"].includes(id);
  const parts=direction==="raise"
    ? [`Base allocation stops at +${rules.creation.characteristics.max}. Great (${name}) adds +1 when the base is +3; take it twice for +5.`]
    : [`Base allocation stops at ${rules.creation.characteristics.min}. Poor (${name}) subtracts 1 when the base is −3; take it twice for −5.`];
  if(physical)parts.push(direction==="raise"
    ? `Giant Blood also adds +1 to both Strength and Stamina, up to +6${type==="grog"?" (Major Virtue; unavailable to grogs)":""}.`
    : `Dwarf also subtracts 1 from both Strength and Stamina, down to −6${type==="grog"?" (Major Flaw; unavailable to grogs)":""}.`);
  if(direction==="raise")parts.push("Improved Characteristics gives 3 more allocation points, but does not raise the base-score limit.");
  parts.push("Supported adjustments appear in the final score automatically.");
  return parts.join(" ");
}
