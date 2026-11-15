import { describe, expect, it } from "vitest";
import { definitiveEdition as rules } from "../src/data/ruleset";
import { newCharacter, type Character } from "../src/model/character";
import { validate } from "../src/engine/validate";
import { guidanceFor } from "../src/engine/guidance";
import { resolve } from "../src/engine/resolve";

function martial(type:Character["type"]="grog") {
  const c=newCharacter(type,rules.id);
  c.virtuesFlaws=[{key:"status",id:"virtue.covenfolk"}];
  c.abilities=[{key:"weapon",id:"ability.great-weapon",xp:5}];
  return c;
}
const ids=(c:Character)=>validate(c,rules).findings.find(f=>f.id==="ability-access:ability.great-weapon")!.guidance!.options!.map(o=>o.id);

describe("finding fix guidance",()=>{
  it("lists applicable Martial Virtues and Flaws while excluding forbidden build options",()=>{
    const c=martial();
    const options=ids(c);
    expect(options).toEqual(expect.arrayContaining(["virtue.warrior","virtue.berserk","virtue.turb-trained","virtue.failed-apprentice","flaw.branded-criminal"]));
    expect(options).not.toContain("virtue.hermetic-magus");
    expect(options).not.toContain("flaw.outlaw");
    expect(options).not.toContain("flaw.outlaw-leader");
    for(const id of options){
      const entry=rules.virtuesFlaws.get(id)!;
      expect(entry.categories).not.toContain("hermetic");
      expect(entry.size).not.toBe("major");
      const trial={...c,virtuesFlaws:[...c.virtuesFlaws,{id,key:"suggested"}]};
      expect(validate(trial,rules).findings.some(f=>f.id==="ability-access:ability.great-weapon"),id).toBe(false);
    }
    expect(ids(martial("companion"))).toContain("flaw.outlaw");
    expect(ids(martial("companion"))).toContain("flaw.outlaw-leader");
  });
  it("does not offer a known incompatible option or a special Magus status to a Companion",()=>{
    const c=martial("companion");
    c.virtuesFlaws.push({key:"gift",id:"virtue.the-gift"},{key:"money",id:"virtue.wealthy"});
    expect(ids(c)).not.toContain("virtue.failed-apprentice");
    expect(ids(c)).not.toContain("flaw.branded-criminal");
    expect(ids(c)).not.toContain("virtue.hermetic-magus");
  });
  it("includes the academic-access Flaw as well as educational Virtues",()=>{
    const c=martial();c.abilities=[{key:"study",id:"ability.artes-liberales",xp:5}];
    const f=validate(c,rules).findings.find(f=>f.id==="ability-access:ability.artes-liberales")!;
    expect(f.guidance!.options!.map(o=>o.id)).toEqual(expect.arrayContaining(["virtue.educated","flaw.failed-monk"]));
    c.virtuesFlaws.push({key:"monk",id:"flaw.failed-monk"});
    expect(validate(c,rules).findings.some(f=>f.id==="ability-access:ability.artes-liberales")).toBe(false);
  });
  it("explains Social Status filters and Free choices without listing every status",()=>{
    const c=newCharacter("companion",rules.id);
    const f=validate(c,rules).findings.find(f=>f.id==="virtues-flaws:social-status-required")!;
    expect(f.guidance!.steps.join(" ")).toMatch(/Both.*social-status.*All sizes.*Free/);
    expect(f.guidance!.options).toBeUndefined();
  });
  it("gives specific budget, score cap, native language, and date repairs",()=>{
    const c=martial();c.abilities[0]!.xp=300;c.birthYear=1221;
    const findings=validate(c,rules).findings;
    expect(findings.find(f=>f.id==="calendar:birth-year")!.guidance!.steps.join(" ")).toMatch(/Identity.*Birth year.*Creation year/);
    expect(findings.find(f=>f.id==="abilities:budget")!.guidance!.steps.join(" ")).toMatch(/Remove at least \d+ XP/);
    expect(findings.find(f=>f.id==="abilities:cap:ability.great-weapon")!.guidance!.steps.join(" ")).toMatch(/Lower this Ability to 5.*creation.*campaign/);
    expect(findings.find(f=>f.id==="abilities:no-native-language")!.guidance!.steps.join(" ")).toMatch(/Living Language.*native.*75/);
    expect(findings.every(f=>f.guidance?.steps.length)).toBe(true);
  });
  it("identifies missing Great/Poor Characteristic parameters and does not recommend Wealthy for magi",()=>{
    const c=newCharacter("companion",rules.id);
    c.virtuesFlaws=[{key:"poor",id:"flaw.poor-characteristic"}];
    expect(validate(c,rules).findings.find(f=>f.id==="characteristics:adjustment:poor")!.guidance!.steps.join(" ")).toMatch(/Poor.*choose a Characteristic.*−3/);
    c.type="magus";c.abilities=[{key:"b",id:"ability.awareness",xp:1000}];
    const f=validate(c,rules).findings.find(f=>f.id==="abilities:budget")!;
    expect(f.guidance!.options).toEqual([]);
    expect(f.guidance!.steps.join(" ")).toContain("Wealthy is not a permitted way");
  });
  it("provides dedicated help for every declared character-type constraint",()=>{
    for(const type of ["grog","companion","magus"] as const){
      const c=newCharacter(type,rules.id);
      const ctx={character:c,rules,resolved:resolve(c,rules)};
      for(const constraint of rules.characterTypes[type].constraints){
        const guide=guidanceFor({id:`virtues-flaws:${constraint.id}`,rule:"virtues-flaws",severity:constraint.severity,message:"unrelated wording",path:"virtuesFlaws"},ctx);
        expect(guide.steps.length,constraint.id).toBeGreaterThan(0);
        expect(guide.steps.join(" "),constraint.id).not.toContain("Review the highlighted value");
      }
    }
  });
  it("keeps fix guidance and override identity stable when the message wording changes",()=>{
    const c=martial();const f=validate(c,rules).findings.find(f=>f.id.startsWith("ability-access:"))!;
    expect(guidanceFor({...f,message:"New wording"},{character:c,rules,resolved:resolve(c,rules)})).toEqual(f.guidance);
    c.overrides=[{findingId:f.id,reason:"Troupe-approved background",accepted:"2026-11-14"}];
    const state=validate(c,rules).states.find(s=>s.kind==="overridden"&&s.finding.id===f.id)!;
    expect(state.kind).toBe("overridden");
    if(state.kind==="overridden")expect(state.finding.guidance).toEqual(f.guidance);
  });
});
