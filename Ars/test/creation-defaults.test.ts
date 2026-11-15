import { describe, expect, it } from "vitest";
import { newCampaign } from "../src/campaign/model";
import { definitiveEdition as rules } from "../src/data/ruleset";
import { createCharacter } from "../src/engine/create";
import { generateGrog } from "../src/engine/generate";
import { validate } from "../src/engine/validate";
import { buildCampaignWorkbook, buildCharacterWorkbook } from "../src/sheets/workbook";
import { newCharacter } from "../src/model/character";
import { resolveCharacteristics, characteristicLimitHint } from "../src/engine/characteristics";

describe("campaign character defaults",()=>{
  it("starts with native language 5 and unspent childhood/later-life XP",()=>{
    const campaign={...newCampaign("Provence",1230),location:"Provence",defaultLanguage:"Occitan"};
    const c=createCharacter("companion",rules,campaign.year,campaign);
    const r=validate(c,rules).resolved;
    expect(c.campaignId).toBe(campaign.id);
    expect(r.abilities.find(a=>a.native)).toMatchObject({score:5,xp:75,displayName:"Occitan (native)"});
    expect(c.abilities.find(a=>a.id==="ability.area-lore")).toMatchObject({parameter:"Provence",xp:0});
    expect(r.xp.spent).toBe(0);expect(r.xp.budget).toBe(270);
    for(const id of rules.creation.experience.earlyChildhood.abilities)expect(c.abilities.some(a=>a.id===id)).toBe(true);
    expect(new Set(c.abilities.map(a=>a.key)).size).toBe(c.abilities.length);
    campaign.defaultLanguage="Catalan";
    expect(c.abilities.find(a=>a.native)?.parameter).toBe("Occitan");
    expect(createCharacter("grog",rules,1230,campaign).abilities.find(a=>a.native)?.parameter).toBe("Catalan");
  });
  it("prepares zero-score magus study entries without granting restricted access to a companion",()=>{
    const c=createCharacter("magus",rules);
    expect(c.abilities.find(a=>a.id==="ability.dead-language")).toMatchObject({parameter:"Latin",xp:0});
    expect(c.abilities.find(a=>a.id==="ability.magic-theory")?.xp).toBe(0);
    c.type="companion";
    expect(validate(c,rules).findings.some(f=>f.id.startsWith("ability-access:"))).toBe(false);
    c.abilities.find(a=>a.id==="ability.magic-theory")!.xp=5;
    expect(validate(c,rules).findings.some(f=>f.id.startsWith("ability-access:"))).toBe(true);
  });
  it("uses campaign language and location for generated grogs",()=>{
    for(let seed=1;seed<=8;seed++){
      const c=generateGrog(rules,{seed,defaultLanguage:"Occitan",location:"Provence"});
      expect(c.abilities.find(a=>a.native)?.parameter).toBe("Occitan");
      for(const a of c.abilities.filter(a=>a.id==="ability.area-lore"))expect(a.parameter).toBe("Provence");
    }
  });
  it("exports campaign defaults without shifting the linked calendar's year cell",()=>{
    const plan=buildCampaignWorkbook({...newCampaign("Saga"),location:"Provence",defaultLanguage:"Occitan"});
    expect(plan.tabs[0]!.rows[5]).toEqual(["Year",1220]);
    expect(plan.tabs[0]!.rows[8]).toEqual(["Location","Provence"]);
    expect(plan.tabs[0]!.rows[9]).toEqual(["Default language","Occitan"]);
    expect(plan.ranges.find(r=>r.name==="ars_campaign")?.endRow).toBe(10);
  });
});

describe("base and final Characteristics",()=>{
  it("combines two Great Characteristics with Giant Blood without charging for the bonuses",()=>{
    const c=newCharacter("companion",rules.id);
    c.characteristics={"characteristic.strength":3,"characteristic.stamina":0};
    c.virtuesFlaws=[{key:"great1",id:"virtue.great-characteristic",parameter:"Strength"},{key:"great2",id:"virtue.great-characteristic",parameter:"Str"},{key:"giant",id:"virtue.giant-blood"}];
    const r=validate(c,rules).resolved;
    expect(r.characteristics["characteristic.strength"]).toBe(6);
    expect(r.characteristics["characteristic.stamina"]).toBe(1);
    expect(r.characteristicPointsSpent).toBe(6);expect(r.soak).toBe(1);
    expect(c.characteristics["characteristic.strength"]).toBe(3);
    expect(buildCharacterWorkbook(c,rules).tabs.find(t=>t.title==="Characteristics")!.rows.find(row=>row[0]==="characteristic.strength")?.[2]).toBe(6);
  });
  it("combines Poor Characteristic and Dwarf down to −6 and increases only the point budget for Improved Characteristics",()=>{
    const c=newCharacter("companion",rules.id);
    c.characteristics={"characteristic.stamina":-3};
    c.virtuesFlaws=[{key:"p1",id:"flaw.poor-characteristic",parameter:"Stamina"},{key:"p2",id:"flaw.poor-characteristic",parameter:"Stamina"},{key:"d",id:"flaw.dwarf"},{key:"i1",id:"virtue.improved-characteristics"},{key:"i2",id:"virtue.improved-characteristics"}];
    const r=resolveCharacteristics(c,rules);
    expect(r.scores["characteristic.stamina"]).toBe(-6);expect(r.budget).toBe(13);
    expect(r.scores["characteristic.intelligence"]).toBe(0);
  });
  it("flags unmet prerequisites, excessive repeated takes, and incompatible size entries",()=>{
    const c=newCharacter("companion",rules.id);
    c.virtuesFlaws=[{key:"g",id:"virtue.great-characteristic",parameter:"Strength"}];
    expect(validate(c,rules).findings.some(f=>f.id==="characteristics:adjustment:g")).toBe(true);
    c.characteristics={"characteristic.strength":3};
    c.virtuesFlaws.push({key:"g2",id:"virtue.great-characteristic",parameter:"Strength"},{key:"g3",id:"virtue.great-characteristic",parameter:"Strength"},{key:"giant",id:"virtue.giant-blood"},{key:"dwarf",id:"flaw.dwarf"});
    expect(validate(c,rules).findings.some(f=>f.id==="characteristics:adjustment:g3")).toBe(true);
    expect(validate(c,rules).findings.some(f=>f.id==="characteristics:incompatible-size")).toBe(true);
  });
  it("explains all supported limit options and grog restrictions",()=>{
    expect(characteristicLimitHint("characteristic.strength","raise",rules,"grog")).toMatch(/Great.*Giant Blood.*unavailable to grogs.*Improved Characteristics/);
    expect(characteristicLimitHint("characteristic.stamina","lower",rules,"companion")).toMatch(/Poor.*Dwarf/);
    expect(characteristicLimitHint("characteristic.intelligence","raise",rules,"companion")).not.toContain("Giant Blood");
  });
});
