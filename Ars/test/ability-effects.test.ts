import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { definitiveEdition as rules } from "../src/data/ruleset";
import { newCharacter } from "../src/model/character";
import { validate } from "../src/engine/validate";
import { resolve } from "../src/engine/resolve";
import { abilityEffects, choosesAbility, investedXpForTotal, virtueFlawName } from "../src/engine/ability-effects";
import { scoreFromXp, xpForScore } from "../src/engine/advancement";
import { buildCharacterWorkbook } from "../src/sheets/workbook";
import { Sheet } from "../src/ui/Sheet";

function hero() {
  const c=newCharacter("companion",rules.id);
  c.abilities=[{key:"awareness",id:"ability.awareness",xp:15},{key:"occitan",id:"ability.living-language",parameter:"Occitan",xp:75,native:true},{key:"latin",id:"ability.dead-language",parameter:"Latin",xp:15}];
  return c;
}

describe("Ability-targeted Virtues and Flaws",()=>{
  it("detects choices even when imported metadata omits parameterized",()=>{
    for(const id of ["virtue.puissant-ability","virtue.affinity-with-ability","virtue.cautious-with-ability","flaw.careless-with-ability","flaw.necessary-realm-aura-for-ability"])expect(choosesAbility(rules.virtuesFlaws.get(id)!)).toBe(true);
    expect(choosesAbility(rules.virtuesFlaws.get("virtue.great-characteristic")!)).toBe(false);
  });
  it("adds Puissant to the use total, leaving learned score, XP, and creation spending alone",()=>{
    const c=hero();c.abilities[0]!.xp=75;
    c.virtuesFlaws=[{key:"puissant",id:"virtue.puissant-ability",abilityKey:"awareness"}];
    const v=validate(c,rules);
    expect(v.resolved.abilities[0]).toMatchObject({score:5,effectiveScore:7,scoreBonus:2,xp:75,adjustedXp:75});
    expect(v.resolved.abilities[0]!.annotations[0]!.note).toMatch(/excluded from learning, writing, and teaching/);
    expect(v.resolved.xp.spent).toBe(90);
    expect(v.findings.some(f=>f.id.startsWith("abilities:cap:"))).toBe(false);
  });
  it("applies Affinity before computing learned score, rounds up, and increases the chosen cap",()=>{
    const c=hero();c.abilities[0]!.xp=70;
    c.virtuesFlaws=[{key:"affinity",id:"virtue.affinity-with-ability",abilityKey:"awareness"},{key:"puissant",id:"virtue.puissant-ability",abilityKey:"awareness"}];
    let v=validate(c,rules);
    expect(v.resolved.abilities[0]).toMatchObject({score:6,effectiveScore:8,xp:70,adjustedXp:105,xpFactor:1.5,capBonus:2});
    expect(v.resolved.xp.spent).toBe(85);
    expect(v.findings.some(f=>f.id.startsWith("abilities:cap:"))).toBe(false);
    c.abilities[0]!.xp=120;
    v=validate(c,rules);expect(v.findings.find(f=>f.id==="abilities:cap:ability.awareness")?.message).toContain("maximum of 7");
    c.abilities[0]!.xp=3;expect(resolve(c,rules).abilities[0]!.adjustedXp).toBe(5);
  });
  it("score stepping finds minimum spent XP without paying for the Affinity twice",()=>{
    for(let score=1;score<10;score++){
      const spent=investedXpForTotal(xpForScore(score,"ability",rules),1.5);
      expect(scoreFromXp(Math.ceil(spent*1.5),"ability",rules)).toBe(score);
      expect(scoreFromXp(Math.ceil((spent-1)*1.5),"ability",rules)).toBeLessThan(score);
    }
    expect(investedXpForTotal(0,1.5)).toBe(0);
  });
  it("keeps language subjects separate, follows renames, and survives JSON round trips",()=>{
    const c=hero();c.virtuesFlaws=[{key:"p",id:"virtue.puissant-ability",abilityKey:"latin"}];
    const saved=JSON.parse(JSON.stringify(c)) as typeof c;
    saved.abilities[2]!.parameter="Greek";
    const r=resolve(saved,rules);
    expect(r.abilities[1]!.effectiveScore).toBe(5);expect(r.abilities[2]!.effectiveScore).toBe(4);
    expect(virtueFlawName(saved.virtuesFlaws[0]!,rules.virtuesFlaws.get("virtue.puissant-ability")!,saved,rules)).toContain("Greek");
    saved.virtuesFlaws[0]!.abilityKey="occitan";
    expect(resolve(saved,rules).abilities[2]!.effectiveScore).toBe(2);
    expect(resolve(saved,rules).abilities[1]!.effectiveScore).toBe(7);
  });
  it("reports missing, removed, and unqualified choices with repair instructions",()=>{
    const c=hero();c.virtuesFlaws=[{key:"p",id:"virtue.puissant-ability"}];
    expect(validate(c,rules).findings.find(f=>f.id==="virtues-flaws:ability-choice:p")?.guidance?.steps.join(" ")).toContain("dropdown");
    c.virtuesFlaws[0]!.abilityKey="removed";expect(resolve(c,rules).abilities[0]!.scoreBonus).toBe(0);
    c.virtuesFlaws[0]!.abilityKey="latin";c.abilities[2]!.parameter="";
    expect(validate(c,rules).findings.some(f=>f.id==="virtues-flaws:ability-subject:p")).toBe(true);
  });
  it("permits different targets but never stacks duplicate takings of the same target",()=>{
    const c=hero();c.virtuesFlaws=[{key:"p1",id:"virtue.puissant-ability",abilityKey:"awareness"},{key:"p2",id:"virtue.puissant-ability",abilityKey:"latin"}];
    expect(validate(c,rules).findings.some(f=>f.id.includes("single-take"))).toBe(false);
    c.abilities.push({...c.abilities[0]!,key:"duplicate-row"});c.virtuesFlaws[1]!.abilityKey="duplicate-row";
    expect(validate(c,rules).findings.some(f=>f.id.includes("single-take"))).toBe(true);
    expect(abilityEffects(c,rules,c.abilities[0]!).bonus).toBe(2);
    c.virtuesFlaws=[{key:"a1",id:"virtue.affinity-with-ability",abilityKey:"awareness"},{key:"a2",id:"virtue.affinity-with-ability",abilityKey:"awareness"}];
    expect(abilityEffects(c,rules,c.abilities[0]!).factor).toBe(1.5);
  });
  it("annotates botch and aura effects without pretending they always alter a score",()=>{
    const c=hero();c.virtuesFlaws=[{key:"c",id:"virtue.cautious-with-ability",abilityKey:"awareness"},{key:"r",id:"flaw.necessary-realm-aura-for-ability",abilityKey:"latin",parameter:"Magic"},{key:"f",id:"flaw.careless-with-ability",abilityKey:"occitan"}];
    const r=resolve(c,rules);expect(r.abilities.map(a=>a.effectiveScore)).toEqual([2,5,2]);
    expect(r.abilities[0]!.annotations[0]!.note).toContain("2 fewer botch dice");
    expect(r.abilities[2]!.annotations[0]!.note).toContain("Realm: Magic");
    c.virtuesFlaws[1]!.parameter="";
    expect(validate(c,rules).findings.some(f=>f.id==="virtues-flaws:ability-realm:r")).toBe(true);
  });
  it("prints the selected Ability and the total with its breakdown",()=>{
    const c=hero();c.virtuesFlaws=[{key:"p",id:"virtue.puissant-ability",abilityKey:"awareness"}];
    const html=renderToStaticMarkup(createElement(Sheet,{character:c,rules,validation:validate(c,rules)}));
    expect(html).toContain("Puissant Ability — Awareness");expect(html).toContain("<b>4</b> (2 + 2 in use)");
  });
  it("exports native Sheet formulas that keep bonuses out of training and round each later award",()=>{
    const c=hero();c.virtuesFlaws=[{key:"p",id:"virtue.puissant-ability",abilityKey:"awareness"},{key:"a",id:"virtue.affinity-with-ability",abilityKey:"awareness"}];
    const plan=buildCharacterWorkbook(c,rules);
    const abilities=plan.tabs.find(t=>t.title==="Abilities")!;
    const row=abilities.rows[5]!;
    expect(row[7]).toEqual({formula:'=IF(A6="","",ROUNDUP(F6*P6,0)+G6)'});
    expect(row[11]).toEqual({formula:'=IF(A6="","",IF(ISNUMBER(K6),K6,I6+J6+O6))'});
    expect(JSON.stringify(row[14])).toContain("virtue.puissant-ability");expect(JSON.stringify(row[15])).toContain("virtue.affinity-with-ability");
    const virtues=plan.tabs.find(t=>t.title==="Virtues & Flaws")!;
    expect(virtues.rows[5]![11]).toBe("awareness");expect(virtues.rows[6]![11]).toBe("awareness");
    expect(virtues.rows[5]![12]).toContain("+2 when using");
    const advancement=plan.tabs.find(t=>t.title==="Advancement")!;
    expect(JSON.stringify(advancement.rows[5]![6])).toContain("ROUNDUP(E6*");
    expect(JSON.stringify(advancement.rows[5]![6])).toContain("Abilities!P6:P205");
    expect(advancement.rows).toHaveLength(505);
  });
});
