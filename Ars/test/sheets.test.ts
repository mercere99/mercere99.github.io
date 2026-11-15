import { describe, expect, it } from "vitest";
import { definitiveEdition as rules } from "../src/data/ruleset";
import { newCharacter } from "../src/model/character";
import { newCampaign } from "../src/campaign/model";
import { CHARACTER_CONTRACT, type WorkbookPlan } from "../src/sheets/contract";
import { buildCampaignWorkbook, buildCharacterWorkbook, nativeRequests } from "../src/sheets/workbook";
import { parseCharacterValues, readCharacter } from "../src/sheets/read";
import type { GoogleDrive } from "../src/google/api";

const identity=(year:unknown=1220)=>[["Contract",CHARACTER_CONTRACT],["Character ID","hero"],["Name","Elena"],["Kind","companion"],["Birth year",1192],["Creation year",1220],["Campaign year",year],["Campaign ID","saga"]];
const abilityRows:unknown[][]=[
  ["Ability key","Ability","Subject","Specialty","Total XP","Base score","Effective score","Surplus XP","XP to next"],
  ["language","Living Language","Catalan","Stories",82,5,6,7,23],
];
describe("Sheet contract",()=>{
  it("uses canonical calculated Sheet values, including earned XP beyond creation budgets",()=>{
    const result=parseCharacterValues("renamed-file",identity(1230),abilityRows,38);
    expect(result.age).toBe(38);expect(result.creationYear).toBe(1220);
    expect(result.abilities[0]).toMatchObject({xp:82,base:5,effective:6,surplus:7,next:23});
    expect(result.fileId).toBe("renamed-file");
  });
  it("does not treat formula errors or missing calculated values as zero",()=>{
    expect(()=>parseCharacterValues("file",identity("#REF!"),abilityRows,28)).toThrow("Allow access");
    const broken=[abilityRows[0]!,["language","Living Language","","",82,5,"#VALUE!",7,23]];
    expect(()=>parseCharacterValues("file",identity(),broken,28)).toThrow("Effective score");
  });
  it("rejects duplicate keys and missing columns with repair guidance",()=>{
    expect(()=>parseCharacterValues("file",identity(),[...abilityRows,abilityRows[1]!],28)).toThrow("Duplicate ability key");
    expect(()=>parseCharacterValues("file",identity(),[["Ability key"]],28)).toThrow("columns are missing");
  });
  it("checks named ranges before reading an incompatible workbook",async()=>{
    let read=false;
    const drive={spreadsheetMetadata:async()=>({namedRanges:[]}),values:async()=>{read=true;}} as unknown as GoogleDrive;
    await expect(readCharacter(drive,"file")).rejects.toThrow("required named ranges");expect(read).toBe(false);
  });
  it("keeps user text literal even when it starts with a formula",()=>{
    const c=newCharacter("companion",rules.id);c.name='=IMPORTXML("https://example.com","//x")';
    const plan=buildCharacterWorkbook(c,rules);
    const updates=nativeRequests(plan).filter(r=>r.updateCells).map(r=>r.updateCells as {rows:{values:{userEnteredValue:Record<string,unknown>}[]}[]});
    expect(updates[1]!.rows[4]!.values[1]!.userEnteredValue).toEqual({stringValue:c.name});
    expect(updates[0]!.rows[0]!.values[0]!.userEnteredValue).toEqual({formulaValue:"=Identity!B5"});
  });
  it("keeps formulas, validations, and edit regions inside their declared grids",()=>{
    const plans:WorkbookPlan[]=[buildCampaignWorkbook(newCampaign("Saga")),buildCharacterWorkbook(newCharacter("grog",rules.id),rules)];
    for(const plan of plans){
      for(const t of plan.tabs){
        const columns=Math.max(6,t.widths.length);
        expect(t.rows.length).toBeLessThanOrEqual(t.rowCount);
        for(const row of t.rows)expect(row.length).toBeLessThanOrEqual(columns);
        for(const region of t.inputs){expect(region.endRow).toBeLessThanOrEqual(t.rowCount);expect(region.endColumn).toBeLessThanOrEqual(columns);}
      }
      for(const v of plan.validations)expect(v.endRow).toBeLessThanOrEqual(plan.tabs.find(t=>t.id===v.tabId)!.rowCount);
    }
  });
  it("does not generate an incomplete magus template",()=>{
    expect(()=>buildCharacterWorkbook(newCharacter("magus",rules.id),rules)).toThrow("not ready");
  });
});
