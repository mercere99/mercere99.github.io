import type { Rule } from "./types";
import type { Finding } from "../../model/findings";
import { chosenCharacteristic } from "../characteristics";

export const characteristicsRule: Rule = {
  id: "characteristics",
  check({ character, rules, resolved }) {
    const { min, max } = rules.creation.characteristics;
    const points=resolved.characteristicPointBudget;
    const findings: Finding[] = [];

    if (resolved.characteristicPointsSpent > points) {
      findings.push({
        id: "characteristics:budget",
        rule: this.id,
        severity: "error" as const,
        message: `Characteristics cost ${resolved.characteristicPointsSpent} points; ${points} are available.`,
        path: "characteristics",
      });
    } else if (resolved.characteristicPointsSpent < points) {
      findings.push({
        id: "characteristics:unspent",
        rule: this.id,
        severity: "info" as const,
        message: `${points - resolved.characteristicPointsSpent} Characteristic point(s) unspent.`,
        path: "characteristics",
      });
    }

    for (const ch of rules.characteristics) {
      const v = character.characteristics[ch.id] ?? 0;
      if (v < min || v > max) {
        findings.push({
          id: `characteristics:range:${ch.id}`,
          rule: this.id,
          severity: "error" as const,
          message: `${ch.name} has base score ${v}; allocate base scores from ${min} to +${max}. Supported Virtue and Flaw adjustments are added separately.`,
          path: `characteristics.${ch.id}`,
        });
      }
    }
    for(const taken of character.virtuesFlaws){
      if(!["virtue.great-characteristic","flaw.poor-characteristic"].includes(taken.id))continue;
      const id=chosenCharacteristic(taken.parameter,rules);
      const great=taken.id==="virtue.great-characteristic";
      const base=id?character.characteristics[id]??0:0;
      const count=character.virtuesFlaws.filter(v=>v.id===taken.id&&chosenCharacteristic(v.parameter,rules)===id).length;
      if(!id || (great?base<3:base>-3) || count>2)findings.push({
        id:`characteristics:adjustment:${taken.key}`,rule:this.id,severity:"error",
        message:`${great?"Great":"Poor"} Characteristic needs a chosen Characteristic with base ${great?"+3":"−3"}; it can be taken at most twice per Characteristic.`,path:`virtuesFlaws.${taken.key}`,
      });
    }
    const sizeIds=["virtue.giant-blood","virtue.large","flaw.dwarf","flaw.small-frame"].filter(id=>character.virtuesFlaws.some(v=>v.id===id));
    if(sizeIds.length>1)findings.push({id:"characteristics:incompatible-size",rule:this.id,severity:"error",message:"Giant Blood, Large, Dwarf, and Small Frame cannot be combined.",path:"virtuesFlaws"});
    return findings;
  },
};
