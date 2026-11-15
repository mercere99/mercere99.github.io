import { DETAIL_LABELS, type Character } from "../model/character";
import type { RuleSet } from "../data/ruleset";
import type { Campaign } from "../campaign/model";
import { SEASONS } from "../campaign/model";
import { CAMPAIGN_CONTRACT, CHARACTER_CONTRACT, SHEET_RANGES, type Cell, type WorkbookPlan, type WorkbookTab } from "./contract";
import { abilityEffectNote, choosesAbility } from "../engine/ability-effects";
import { resolveCharacteristics } from "../engine/characteristics";

const f = (formula: string): Cell => ({ formula });
const tab = (id: number, title: string, rows: Cell[][], widths: number[], headerRow = 5, inputs: WorkbookTab["inputs"] = []): WorkbookTab => ({ id, title, rows, widths, headerRow, inputs, rowCount: Math.max(220, rows.length + 10) });
const input = (r1: number, r2: number, c1: number, c2 = c1 + 1) => ({ startRow: r1 - 1, endRow: r2, startColumn: c1, endColumn: c2 });
export const FORMULA_ROWS = 200;
export const LEDGER_ROWS = 500;

export function buildCampaignWorkbook(campaign: Campaign): WorkbookPlan {
  return {
    title: `${campaign.name} — Campaign`,
    tabs: [tab(0, "Campaign", [
      [campaign.name], ["Edit the year and season here. Character Sheets read this calendar."],
      ["Contract", CAMPAIGN_CONTRACT], ["Campaign ID", campaign.id], ["Name", campaign.name],
      ["Year", campaign.year], ["Season", campaign.season], ["Notes", campaign.notes],
      ["Location", campaign.location??""], ["Default language", campaign.defaultLanguage??""],
      [], ["Character files are registered in the website's app-owned metadata."],
      ["All members may edit campaign records directly. Storyguide status is a session role."],
    ], [250, 500], 1, [input(5, 10, 1)])],
    ranges: [
      { name: SHEET_RANGES.campaign, tabId: 0, startRow: 2, endRow: 10, startColumn: 0, endColumn: 2 },
      { name: SHEET_RANGES.year, tabId: 0, startRow: 5, endRow: 6, startColumn: 1, endColumn: 2 },
      { name: SHEET_RANGES.season, tabId: 0, startRow: 6, endRow: 7, startColumn: 1, endColumn: 2 },
    ],
    validations: [{ tabId: 0, column: 1, startRow: 6, endRow: 7, values: [...SEASONS] }],
  };
}

export function buildCharacterWorkbook(c: Character, rules: RuleSet, campaign?: Campaign): WorkbookPlan {
  if (c.type === "magus") throw new Error("The magus Sheet template is not ready yet. Use a companion or grog.");
  if (c.abilities.length > FORMULA_ROWS || c.equipment.length > FORMULA_ROWS || c.virtuesFlaws.length > FORMULA_ROWS) throw new Error("This character exceeds the current template capacity.");
  const identity: Cell[][] = [
    ["Identity & calendar"], ["Blue cells are inputs. Blank optional details are welcome. Keep IDs unchanged."],
    ["Contract", CHARACTER_CONTRACT], ["Character ID", c.id], ["Name", c.name], ["Kind", c.type],
    ["Birth year", c.birthYear], ["Creation year", c.creationYear],
    ["Campaign year", f('=IF(B11="",B10,IMPORTRANGE(B11,"ars_campaign_year"))')],
    ["Standalone year", campaign?.year ?? c.creationYear], ["Campaign Sheet", campaign?.google?.indexId ?? ""],
    ["Campaign ID", campaign?.id ?? ""], ["Role", c.role ?? "player-character"],
    ["Concept", c.concept], ["Notes", c.notes], [],
    ...Object.entries(DETAIL_LABELS).map(([key, label]) => [label, c.details[key as keyof typeof DETAIL_LABELS] ?? ""] as Cell[]),
    [], ["Linked calendar setup", "If Campaign year shows #REF!, open that cell and choose Allow access. No silent fallback is used for an inaccessible linked calendar."],
  ];
  const abilities: Cell[][] = [
    ["Abilities"], ["Add abilities here using stable keys. Enter creation XP in Creation XP and later awards in Advancement. Puissant and Affinity use the chosen Ability key in Virtues & Flaws. Blue extra bonus/override cells are manual."], [], [],
    ["Ability key", "Rules ID", "Ability", "Subject", "Specialty", "Creation XP", "Earned XP", "Total XP", "Base score", "Extra use bonus", "Score override", "Effective score", "Surplus XP", "XP to next", "Virtue use bonus", "Affinity multiplier", "Ability effect reminders"],
  ];
  const allocations: Cell[][] = [
    ["Creation XP allocations"], ["Split allocations into their allowed pools. Native language has its own allowance. Later awards belong in Advancement."],
    ["Available (excl. native)", f('=Rules!B5+MAX(0,Identity!B8-Identity!B7-Rules!B6)*Rules!B8+Rules!B9'), "Allocated (excl. native)", f('=SUM(D6:D505)-MIN(Rules!B7,SUMIF(C6:C505,"Native language",D6:D505))')],
    ["Unspent creation XP", f("=B3-D3"), "Negative means creation overspending; later earned XP does not count here."],
    ["Ability key", "Ability (calculated)", "Pool", "XP", "Notes"],
  ];
  const allocationData: [string, string, number][] = [];
  for (const a of c.abilities) {
    if (a.native) {
      allocationData.push([a.key, "Native language", Math.min(a.xp, rules.creation.experience.earlyChildhood.nativeLanguage)]);
      if (a.xp > rules.creation.experience.earlyChildhood.nativeLanguage) allocationData.push([a.key, "General creation", a.xp - rules.creation.experience.earlyChildhood.nativeLanguage]);
    } else allocationData.push([a.key, "General creation", a.xp]);
  }
  for (let i = 0; i < LEDGER_ROWS; i++) {
    const n = i + 6;
    const a = allocationData[i];
    allocations.push([a?.[0] ?? "", f(`=IF(A${n}="","",IFERROR(VLOOKUP(A${n},Abilities!A6:C205,3,FALSE),"Unknown ability key"))`), a?.[1] ?? "", a?.[2] ?? "", ""]);
  }
  for (let i = 0; i < FORMULA_ROWS; i++) {
    const n = i + 6;
    const a = c.abilities[i];
    const def = a ? rules.abilities.get(a.id) : undefined;
    abilities.push([
      a?.key ?? "", a?.id ?? "", def?.name ?? "", a?.parameter ?? "", a?.specialty ?? "",
      f(`=IF(A${n}="","",SUMIF('Creation XP'!A6:A505,A${n},'Creation XP'!D6:D505))`),
      f(`=IF(A${n}="","",SUMIF(Advancement!D6:D505,A${n},Advancement!G6:G505))`),
      f(`=IF(A${n}="","",ROUNDUP(F${n}*P${n},0)+G${n})`),
      f(`=IF(A${n}="","",INT((SQRT(1+8*H${n}/Rules!$B$4)-1)/2))`), 0, "",
      f(`=IF(A${n}="","",IF(ISNUMBER(K${n}),K${n},I${n}+J${n}+O${n}))`),
      f(`=IF(A${n}="","",H${n}-Rules!$B$4*I${n}*(I${n}+1)/2)`),
      f(`=IF(A${n}="","",Rules!$B$4*(I${n}+1)*(I${n}+2)/2-H${n})`),
      f(`=IF(A${n}="","",IF(COUNTIFS('Virtues & Flaws'!L6:L205,A${n},'Virtues & Flaws'!B6:B205,"virtue.puissant-ability")>0,2,0))`),
      f(`=IF(A${n}="","",IF(COUNTIFS('Virtues & Flaws'!L6:L205,A${n},'Virtues & Flaws'!B6:B205,"virtue.affinity-with-ability")>0,1.5,1))`),
      f(`=IF(A${n}="","",IFERROR(TEXTJOIN("; ",TRUE,FILTER('Virtues & Flaws'!M6:M205,'Virtues & Flaws'!L6:L205=A${n})),""))`),
    ]);
  }
  const virtues: Cell[][] = [
    ["Virtues & Flaws"], ["Select an Ability key for targeted entries. Puissant and Affinity recalculate automatically by Rules ID; other effects are reminders. Extra creation XP and later-life rates are editable rule inputs."], [], [],
    ["Entry key", "Rules ID", "Name", "Kind", "Size", "Subject / realm", "Description", "Creation XP grant", "Later-life XP/year override", "Treatment", "Source", "Chosen Ability key", "Ability effect reminder"],
  ];
  for (let i = 0; i < FORMULA_ROWS; i++) {
    const a = c.virtuesFlaws[i];
    const def = a ? rules.virtuesFlaws.get(a.id) : undefined;
    const rate = rules.creation.experience.laterLife.modifiers.find(m => ("virtue" in m ? m.virtue : m.flaw) === a?.id)?.perYear;
    const n=i+6;
    const realm=def?.id==="flaw.necessary-realm-aura-for-ability";
    const subject: Cell = def && choosesAbility(def) && !realm
      ? f(`=IF(L${n}="","",IFERROR(VLOOKUP(L${n},Abilities!A6:D205,3,FALSE)&IF(VLOOKUP(L${n},Abilities!A6:D205,4,FALSE)="",""," — "&VLOOKUP(L${n},Abilities!A6:D205,4,FALSE)),"Choose an existing Ability key"))`)
      : a?.parameter ?? "";
    const note=def?abilityEffectNote(def.id)??"":"";
    const reminder:Cell=realm?f(`="${note.replaceAll('"','""')}"&IF(F${n}="",""," Realm: "&F${n}&".")`):note;
    virtues.push([a?.key ?? "", a?.id ?? "", def?.name ?? "", def?.kind ?? "", def ? (Array.isArray(def.size) ? a?.size ?? def.size[0]! : def.size) : "", subject, def?.text ?? "", def?.effects.reduce((sum, e) => sum + (e.type === "xp-grant" ? e.amount : 0), 0) ?? "", rate ?? "", def ? (choosesAbility(def) ? "Puissant/Affinity automated; conditional effects manual" : "XP grant/rate included; other effects manual") : "", def ? `${def.source.book} (${def.source.year})` : "", a?.abilityKey ?? "", reminder]);
  }
  const equipment: Cell[][] = [
    ["Equipment"], ["All listed items are carried. Equipped items contribute ONLY their numeric Soak bonus; free-form effects remain reminders."], [], [],
    ["Item key", "Name", "Type", "Load", "Description", "Equipped", "Effect reminder", "Soak bonus (manual input)"],
    ...Array.from({length: FORMULA_ROWS}, (_, i) => {
      const item = c.equipment[i];
      return [item?.key ?? "", item?.name ?? "", item?.type ?? "", item?.load ?? "", item?.description ?? "", item?.equipped ?? false, item?.effects ?? "", item ? 0 : ""] as Cell[];
    }),
  ];
  const characteristics: Cell[][] = [
    ["Characteristics & personality"], ["Scores include supported creation Virtue/Flaw adjustments at export. Later changes and other permanent effects must be entered here explicitly."], [], [],
    ["Rules ID", "Characteristic", "Score", "", "Personality trait", "Score"],
    ...rules.characteristics.map((ch, i) => [ch.id, ch.name, resolveCharacteristics(c,rules).scores[ch.id] ?? 0, "", c.personality[i]?.name ?? "", c.personality[i]?.score ?? ""] as Cell[]),
    ...c.personality.slice(rules.characteristics.length).map(p => ["", "", "", "", p.name, p.score] as Cell[]),
  ];
  const confidence = rules.characterTypes[c.type].confidence;
  const condition: Cell[][] = [
    ["Condition & reputation"], ["Update condition here during play. Wound and Soak totals are calculated. Adjust Confidence for Virtues manually."], [], [],
    ["Confidence score", confidence?.score ?? 0], ["Confidence points", confidence?.points ?? 0],
    ["Fatigue penalty", 0], ["Light wounds", 0], ["Medium wounds", 0], ["Heavy wounds", 0],
    ["Incapacitating wounds", 0], ["Warping points", 0], ["Decrepitude", 0], ["Other Soak modifier", 0], ["Action status", "Able to act"],
    ["Wound penalty", f("=-SUM(B8,3*B9,5*B10)")],
    ["Soak", f('=SUMIF(Characteristics!A6:A13,"characteristic.stamina",Characteristics!C6:C13)+SUMIF(Equipment!F6:F205,TRUE,Equipment!H6:H205)+B14')],
    [], ["Reputation", "Audience / location", "Score", "Notes"],
  ];
  const rulesTab: Cell[][] = [
    ["Rules & attribution"], ["Formula parameters come from the selected ruleset. Blue rate/grant cells in Virtues & Flaws are manual inputs for later changes."], [],
    ["Ability XP multiplier", 5], ["Childhood XP", rules.creation.experience.earlyChildhood.points], ["Childhood years", rules.creation.experience.earlyChildhood.years],
    ["Native language XP", rules.creation.experience.earlyChildhood.nativeLanguage],
    ["Later-life XP/year", f("=IF(COUNT('Virtues & Flaws'!I6:I205)=0,15,MIN('Virtues & Flaws'!I6:I205))")],
    ["Virtue creation XP", f("=SUM('Virtues & Flaws'!H6:H205)")],
    ["Creation score cap", f('=IF(Identity!B8-Identity!B7<=29,5,IF(Identity!B8-Identity!B7<=35,6,IF(Identity!B8-Identity!B7<=40,7,IF(Identity!B8-Identity!B7<=45,8,9))))')],
    ["Allocation checks", "Restricted grants must be spent on their permitted abilities. Pool labels preserve the decision; source eligibility and all Virtue effects are not fully automated. Affinity increases the chosen Ability creation cap by 2; Puissant does not change its learned score."],
    ["Supported calculations", "Age, XP totals/scores/progress, Puissant use bonuses, Affinity XP (rounded per advancement award), explicit bonuses/overrides, wound penalty, carried load, equipped numeric Soak bonuses. Incapacitation and other combat effects require adjudication."],
    ["Attribution", "Based on the material for Ars Magica, ©1993–2024, licensed by Trident, Inc. d/b/a Atlas Games®, under Creative Commons Attribution-ShareAlike 4.0 International license 4.0 (CC-BY-SA 4.0). Game content selected and restructured; formulas and layout added."],
    ["License", "https://creativecommons.org/licenses/by-sa/4.0/"],
    ["Trademarks", "Ars Magica Open License Logo ©2024 Trident, Inc. The Ars Magica Open License Logo, Ars Magica, and Mythic Europe are trademarks of Trident, Inc., and are used with permission."],
    ["Trademarks", "Order of Hermes, Tremere, Doissetep, and Grimgroth are trademarks of Paradox Interactive AB and are used with permission."],
    ["Disclaimer", "Not affiliated with or endorsed by Atlas Games or Paradox Interactive AB. Code's optional MIT license does not relicense game content or players' original contributions."], [],
    ["Ability rules ID", "Name", "Type", "Suggested specialties"],
    ...[...rules.abilities.values()].map(a => [a.id, a.name, a.type, a.specialties.join(", ")] as Cell[]),
  ];
  const summary: Cell[][] = [
    [f("=Identity!B5")], [f('=Identity!B6&" · "&Identity!B14')],
    ["Age", f("=Identity!B9-Identity!B7"), "", "Campaign year", f("=Identity!B9")],
    ["Birth year", f("=Identity!B7"), "", "Creation year", f("=Identity!B8")],
    ["Confidence", f("=Condition!B5"), "", "Confidence points", f("=Condition!B6")],
    ["Wound penalty", f("=Condition!B16"), "", "Fatigue penalty", f("=Condition!B7")],
    ["Soak", f("=Condition!B17"), "", "Carried load", f("=SUM(Equipment!D6:D205)")],
    ["Condition", f('=IF(Condition!B11>0,"Incapacitated — adjudicate",Condition!B15)')], [],
    ["Ability", "Base", "Bonus / override", "Effective", "Specialty", "XP to next", "Ability effect reminders"],
  ];
  for (let i = 0; i < FORMULA_ROWS; i++) {
    const n = i + 6;
    summary.push([
      f(`=IF(Abilities!A${n}="","",Abilities!C${n}&IF(Abilities!D${n}="",""," — "&Abilities!D${n}))`),
      f(`=IF(Abilities!A${n}="","",Abilities!I${n})`),
      f(`=IF(Abilities!A${n}="","",IF(ISNUMBER(Abilities!K${n}),"override: "&Abilities!K${n},Abilities!J${n}+Abilities!O${n}))`),
      f(`=IF(Abilities!A${n}="","",Abilities!L${n})`),
      f(`=IF(Abilities!A${n}="","",Abilities!E${n})`), f(`=IF(Abilities!A${n}="","",Abilities!N${n})`), f(`=IF(Abilities!A${n}="","",Abilities!Q${n})`),
    ]);
  }
  const tabs = [
    tab(0, "Summary", summary, [250, 75, 145, 160, 190, 100, 550], 10),
    tab(1, "Identity", identity, [230, 570], 1, [input(5, 8, 1), input(10, 11, 1), input(13, 26, 1)]),
    tab(2, "Abilities", abilities, [130, 210, 220, 160, 180, 100, 100, 100, 100, 120, 120, 120, 100, 100, 120, 120, 550], 5, [input(6, 205, 0, 5), input(6, 205, 9, 11)]),
    tab(3, "Creation XP", allocations, [135, 240, 190, 110, 400], 5, [input(6, 505, 0), input(6, 505, 2, 5)]),
    tab(4, "Advancement", [["Seasonal advancement"], ["One award per row. Enter XP before Affinity; calculated XP rounds each award separately. Several awards may use the same stable Ability key."], [], [], ["Year", "Season", "Activity", "Ability key", "XP", "Notes", "Calculated XP"],
      ...Array.from({length:LEDGER_ROWS},(_,i)=>{const n=i+6;return ["","","","","","",f(`=IF(D${n}="","",ROUNDUP(E${n}*IF(COUNTIF(Abilities!A6:A205,D${n})=0,1,SUMIF(Abilities!A6:A205,D${n},Abilities!P6:P205)),0))`)] as Cell[];})], [90, 120, 230, 140, 90, 400, 110], 5, [input(6, 505, 0, 6)]),
    tab(5, "Virtues & Flaws", virtues, [130, 220, 230, 100, 100, 250, 600, 150, 180, 300, 300, 180, 550], 5, [input(6, 205, 0, 13)]),
    tab(6, "Equipment", equipment, [130, 240, 110, 80, 350, 110, 450, 190], 5, [input(6, 205, 0, 8)]),
    tab(7, "Characteristics", characteristics, [260, 220, 110, 30, 230, 110], 5, [input(6, 205, 2), input(6, 205, 4, 6)]),
    tab(8, "Condition", condition, [250, 300, 110, 400], 1, [input(5, 15, 1), input(20, 205, 0, 4)]),
    tab(9, "Timeline", [["Timeline"], ["Dates may describe past events or plans; the campaign calendar stays in the campaign index."], [], [], ["Event ID", "Year", "Event", "Notes"], ...c.timeline.map(e => [e.key, e.year, e.label, e.notes])], [150, 100, 300, 500], 5, [input(6, 205, 0, 4)]),
    tab(10, "Rules", rulesTab, [300, 650, 140, 550], 1),
  ];
  for (const t of tabs) if (t.title === "Creation XP" || t.title === "Advancement") t.rowCount = 520;
  return {
    title: `${c.name || "Unnamed " + c.type} — Character`, tabs,
    ranges: [
      { name: SHEET_RANGES.identity, tabId: 1, startRow: 2, endRow: 26, startColumn: 0, endColumn: 2 },
      { name: SHEET_RANGES.age, tabId: 0, startRow: 2, endRow: 3, startColumn: 1, endColumn: 2 },
      { name: SHEET_RANGES.abilities, tabId: 2, startRow: 4, endRow: 205, startColumn: 0, endColumn: 17 },
      { name: SHEET_RANGES.condition, tabId: 8, startRow: 4, endRow: 17, startColumn: 0, endColumn: 2 },
    ],
    validations: [
      { tabId: 1, column: 1, startRow: 5, endRow: 6, values: ["grog", "companion"] },
      { tabId: 1, column: 1, startRow: 12, endRow: 13, values: ["player-character", "shared", "npc"] },
      { tabId: 3, column: 0, startRow: 5, endRow: 505, range: "=Abilities!$A$6:$A$205" },
      { tabId: 3, column: 2, startRow: 5, endRow: 505, values: ["General creation", "Native language", "Educated", "Arcane Lore", "Warrior", "Other grant"] },
      { tabId: 4, column: 1, startRow: 5, endRow: 505, values: [...SEASONS] },
      { tabId: 4, column: 3, startRow: 5, endRow: 505, range: "=Abilities!$A$6:$A$205" },
      { tabId: 5, column: 11, startRow: 5, endRow: 205, range: "=Abilities!$A$6:$A$205" },
      { tabId: 6, column: 2, startRow: 5, endRow: 205, values: ["item", "weapon", "armor"] },
      { tabId: 6, column: 5, startRow: 5, endRow: 205, checkbox: true },
    ],
  };
}

export function nativeRequests(plan: WorkbookPlan): Record<string, unknown>[] {
  const color = { red: 0.92, green: 0.93, blue: 0.94 };
  const requests: Record<string, unknown>[] = [];
  for (const t of plan.tabs) {
    requests.push({ addSheet: { properties: { sheetId: t.id, title: t.title, gridProperties: { rowCount: t.rowCount, columnCount: Math.max(6, t.widths.length), frozenRowCount: t.headerRow, hideGridlines: true } } } });
    requests.push({ updateCells: { start: { sheetId: t.id, rowIndex: 0, columnIndex: 0 }, rows: t.rows.map(row => ({ values: row.map(cell => ({ userEnteredValue: typeof cell === "object" ? { formulaValue: cell.formula } : typeof cell === "number" ? { numberValue: cell } : typeof cell === "boolean" ? { boolValue: cell } : { stringValue: cell } })) })), fields: "userEnteredValue" } });
    requests.push({ repeatCell: { range: { sheetId: t.id, startRowIndex:0, endRowIndex:Math.max(t.rows.length,...t.inputs.map(i=>i.endRow)), startColumnIndex:0,endColumnIndex:t.widths.length }, cell: { userEnteredFormat: { textFormat: { fontFamily: "Arial", fontSize: 11 }, verticalAlignment: "TOP", wrapStrategy: "WRAP", backgroundColor: { red: 1, green: 1, blue: 1 } } }, fields: "userEnteredFormat" } });
    for (const region of t.inputs) requests.push({ repeatCell: { range: { sheetId: t.id, startRowIndex: region.startRow, endRowIndex: region.endRow, startColumnIndex: region.startColumn, endColumnIndex: region.endColumn }, cell: { userEnteredFormat: { backgroundColor: { red: 1, green: 1, blue: 1 }, textFormat: { foregroundColor: { red: 0.1, green: 0.25, blue: 0.65 } } } }, fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat.foregroundColor" } });
    for (const row of [...new Set([0, t.headerRow - 1])]) requests.push({ repeatCell: { range: { sheetId: t.id, startRowIndex: row, endRowIndex: row + 1,startColumnIndex:0,endColumnIndex:t.widths.length }, cell: { userEnteredFormat: { backgroundColor: row === 0 ? {red:1,green:1,blue:1} : color, textFormat: { bold: true, foregroundColor: { red: 0, green: 0, blue: 0 }, fontSize: row === 0 ? 16 : 11 } } }, fields: "userEnteredFormat.backgroundColor,userEnteredFormat.textFormat" } });
    requests.push({ updateDimensionProperties: { range: { sheetId: t.id, dimension: "ROWS", startIndex: 0, endIndex: 1 }, properties: { pixelSize: 38 }, fields: "pixelSize" } });
    t.widths.forEach((width, column) => requests.push({ updateDimensionProperties: { range: { sheetId: t.id, dimension: "COLUMNS", startIndex: column, endIndex: column + 1 }, properties: { pixelSize: width }, fields: "pixelSize" } }));
    requests.push({ mergeCells: { range: { sheetId: t.id, startRowIndex: 0, endRowIndex: 1, startColumnIndex: 0, endColumnIndex: Math.min(6, t.widths.length) }, mergeType: "MERGE_ALL" } });
    if(t.rows[1]?.length===1) {
      requests.push({mergeCells:{range:{sheetId:t.id,startRowIndex:1,endRowIndex:2,startColumnIndex:0,endColumnIndex:t.widths.length},mergeType:"MERGE_ALL"}});
      requests.push({updateDimensionProperties:{range:{sheetId:t.id,dimension:"ROWS",startIndex:1,endIndex:2},properties:{pixelSize:56},fields:"pixelSize"}});
    }
  }
  for (const r of plan.ranges) requests.push({ addNamedRange: { namedRange: { name: r.name, range: { sheetId: r.tabId, startRowIndex: r.startRow, endRowIndex: r.endRow, startColumnIndex: r.startColumn, endColumnIndex: r.endColumn } } } });
  for (const t of plan.tabs) {
    const finiteColumns = plan.validations.filter(v=>v.tabId===t.id && v.values && v.startRow===t.headerRow);
    if (!finiteColumns.length) continue;
    requests.push({ addTable: { table: {
      name: `ArsTable${t.id}`, range: {sheetId:t.id,startRowIndex:t.headerRow-1,endRowIndex:Math.max(...finiteColumns.map(v=>v.endRow)),startColumnIndex:0,endColumnIndex:t.widths.length},
      columnProperties: finiteColumns.map(dropdown=>({columnIndex:dropdown.column,columnType:"DROPDOWN",dataValidationRule:{condition:{type:"ONE_OF_LIST",values:dropdown.values!.map(value=>({userEnteredValue:value}))}}})),
    } } });
    // Preserve the declared headers after Google's table inference/normalization.
    requests.push({updateCells:{start:{sheetId:t.id,rowIndex:t.headerRow-1,columnIndex:0},rows:[{values:t.rows[t.headerRow-1]!.map(label=>({userEnteredValue:{stringValue:String(label)}}))}],fields:"userEnteredValue"}});
    for(const region of t.inputs)requests.push({repeatCell:{range:{sheetId:t.id,startRowIndex:region.startRow,endRowIndex:region.endRow,startColumnIndex:region.startColumn,endColumnIndex:region.endColumn},cell:{userEnteredFormat:{textFormat:{foregroundColor:{red:0.1,green:0.25,blue:0.65}}}},fields:"userEnteredFormat.textFormat.foregroundColor"}});
  }
  for (const v of plan.validations) {
    // Typed dropdown columns own their validation. Google rejects cell-level
    // validation on those columns; ordinary cells/checkboxes are applied last.
    const t=plan.tabs.find(tab=>tab.id===v.tabId)!;
    if(v.values && v.startRow===t.headerRow)continue;
    requests.push({ setDataValidation: { range: { sheetId: v.tabId, startRowIndex: v.startRow, endRowIndex: v.endRow, startColumnIndex: v.column, endColumnIndex: v.column + 1 }, rule: { condition: v.checkbox ? { type: "BOOLEAN" } : v.range ? { type: "ONE_OF_RANGE", values: [{ userEnteredValue: v.range }] } : { type: "ONE_OF_LIST", values: v.values!.map(value => ({ userEnteredValue: value })) }, strict: false, showCustomUi: true } } });
  }
  return requests;
}
