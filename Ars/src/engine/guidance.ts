import type { VirtueFlaw } from "../data/ruleset";
import type { Finding, FindingGuidance } from "../model/findings";
import type { RuleContext } from "./rules/types";

/** Suggestions must not recommend obviously forbidden build choices. Other
 * background prerequisites remain visible in the entry's full description. */
function available(entry: VirtueFlaw, {character}: RuleContext) {
  const sizes=Array.isArray(entry.size)?entry.size:[entry.size];
  const gifted=character.virtuesFlaws.some(v=>v.id==="virtue.the-gift");
  if(character.type==="grog" && (sizes.every(s=>s==="major")||entry.categories.includes("hermetic")||entry.id==="virtue.the-gift"||entry.id==="flaw.outlaw-leader"||entry.categories.includes("story")))return false;
  if(entry.id==="virtue.hermetic-magus" && character.type!=="magus")return false;
  if(entry.id==="virtue.failed-apprentice" && gifted)return false;
  if(character.type==="magus" && ["virtue.wealthy","flaw.poor"].includes(entry.id))return false;
  if(entry.id==="flaw.branded-criminal" && character.virtuesFlaws.some(v=>v.id==="virtue.wealthy"))return false;
  if(["virtue.almogavar","virtue.turb-trained","virtue.mendicant-friar"].includes(entry.id)&&character.virtuesFlaws.some(v=>["virtue.wealthy","flaw.poor"].includes(v.id)))return false;
  if(entry.id==="virtue.perfectus"&&character.virtuesFlaws.some(v=>v.id==="virtue.wealthy"))return false;
  if(entry.categories.includes("hermetic") && character.type!=="magus" && !gifted)return false;
  return true;
}

function optionsFor(ids: string[], ctx: RuleContext) {
  return ids.filter(id=>{
    const entry=ctx.rules.virtuesFlaws.get(id);
    return entry&&available(entry,ctx);
  }).map(id=>({id}));
}

/** Attach advice to stable rule IDs, never to the wording of a message. */
export function guidanceFor(f: Finding, ctx: RuleContext): FindingGuidance {
  const {character:c,rules,resolved:r}=ctx;
  const taken=(id:string)=>c.virtuesFlaws.some(v=>v.id===id);
  if(f.id.startsWith("virtues-flaws:ability-choice:"))return {steps:["In this Virtue or Flaw, choose a specific Ability from the dropdown. You can select an existing row or add an Ability at 0 XP, then allocate XP in Abilities if appropriate.","If the selected Ability was removed, choose it again. Languages, Area Lores, and other subjects have separate choices; select the actual subject this entry affects."]};
  if(f.id.startsWith("virtues-flaws:ability-subject:"))return {steps:["In Abilities, fill in the chosen row's subject, such as Latin, Occitan, Provence, or Blacksmithing. The Virtue or Flaw stays linked to that row when its subject changes."]};
  if(f.id.startsWith("virtues-flaws:ability-realm:"))return {steps:["Fill in the realm field beside the Ability choice, for example Magic or Faerie. The −3 penalty applies only outside that realm's aura, so it is shown as a reminder rather than subtracted from every total."]};
  if(f.id.startsWith("ability-access:")){
    const ability=c.abilities.find(a=>`abilities.${a.key}`===f.path);
    const def=ability?rules.abilities.get(ability.id):undefined;
    const category=def?.type;
    const candidates=[...rules.virtuesFlaws.values()].filter(v=>available(v,ctx)&&!taken(v.id)&&v.effects.some(e=>e.type==="ability-access"&&category&&e.categories.includes(category)));
    candidates.sort((a,b)=>Number(a.categories.includes("social-status"))-Number(b.categories.includes("social-status"))||a.name.localeCompare(b.name));
    const options=candidates.map(v=>({id:v.id}));
    const steps=[`Add an appropriate Virtue or Flaw that grants ${category??"this type of"} Ability access, or remove this Ability / set its creation XP to 0.`];
    if(options.length)steps.push("The entries below grant this category in the current rules data. Check their descriptions for background requirements, restrictions on bonus XP, and consequences for your Social Status or Virtue/Flaw balance.");
    else steps.push("Check the Ability's description for its specific enabling Virtue or training requirements. If the printed rule grants access that this prototype does not model, record that justification with Accept anyway.");
    if(ability?.id==="ability.parma-magica")steps.push("Arcane access alone does not permit Parma Magica without The Gift; its Order of Hermes restrictions also need to be respected. That special eligibility is not fully automated.");
    return {steps,options,optionsLabel:`Entries granting ${category??"Ability"} access`};
  }
  if(f.id==="calendar:birth-year")return {steps:[`In Identity, correct Birth year so it is no later than ${c.birthYear+r.age}, and at least 5 years before Creation year (${c.creationYear}). If Creation year is wrong, correct that too.`,"Change dates to reflect the character's history. Advancing the campaign year does not change the original creation XP budget."]};
  if(f.id==="characteristics:budget")return {steps:[`Lower base Characteristics until their total cost is at most ${r.characteristicPointBudget}. A +3 costs 6 points, +2 costs 3, and +1 costs 1; negative bases refund points.`,"Improved Characteristics adds 3 allocation points per taking, but does not raise the −3 to +3 base-score limits. Balance any added Virtues with the appropriate Flaws."],options:optionsFor(["virtue.improved-characteristics"],ctx)};
  if(f.id==="characteristics:unspent")return {steps:[`You have ${r.characteristicPointBudget-r.characteristicPointsSpent} allocation point(s) left. Raise base Characteristics while watching the total cost. This is information, not a requirement to change the character.`]};
  if(f.id.startsWith("characteristics:range:"))return {steps:["Bring the stored base score back into the −3 to +3 range. Add Great/Poor Characteristic for the chosen Characteristic, or an applicable size Virtue/Flaw, to change its final score instead.","Supported adjustments are applied separately: do not include the same bonus twice in the base score."],options:optionsFor(["virtue.great-characteristic","flaw.poor-characteristic",...(/strength|stamina/.test(f.path)?["virtue.giant-blood","flaw.dwarf"]:[])],ctx)};
  if(f.id.startsWith("characteristics:adjustment:")){
    const entry=c.virtuesFlaws.find(v=>`virtuesFlaws.${v.key}`===f.path);
    const great=entry?.id==="virtue.great-characteristic";
    return {steps:[`In the ${great?"Great":"Poor"} Characteristic entry, choose a Characteristic and set its base to ${great?"+3":"−3"}. The adjustment is then added automatically.`,"Keep at most two takings for the same Characteristic. Remove extra takings or choose a different Characteristic that meets the prerequisite; keep the point budget and Virtue/Flaw balance in view."]};
  }
  if(f.id==="characteristics:incompatible-size")return {steps:["Keep only one of Giant Blood, Large, Dwarf, and Small Frame. Remove the conflicting entries in Virtues & Flaws; final scores and wound ranges will recalculate."]};
  if(f.id==="abilities:budget"){
    const extra=r.xp.spent-r.xp.budget;
    const steps=[`Remove at least ${extra} XP from creation allocations, or correct the character's Birth year / Creation year if they are wrong. Lower a score with its minus button or edit the XP field directly; check the tally afterward.`];
    if(taken("flaw.poor"))steps.push("Poor reduces later-life XP to 10 per year. Removing it, if appropriate to the character, restores the normal rate; rebalance Virtues and Flaws afterward.");
    steps.push(c.type==="magus"?"Magus apprenticeship and later study budgets are not fully implemented. Review that creation calculation with the troupe; Wealthy is not a permitted way to increase a magus's budget.":"Wealthy increases later-life XP to 20 per year. Other training Virtues may grant extra XP with restrictions on where it can be spent; those restrictions still need manual checking.");
    return {steps,options:!taken("flaw.poor")&&!taken("virtue.wealthy")?optionsFor(["virtue.wealthy"],ctx):undefined};
  }
  if(f.id==="abilities:unspent")return {steps:[`Allocate the remaining ${r.xp.budget-r.xp.spent} XP in Abilities by raising scores or editing XP. Native language has its own ${r.xp.nativeLanguage} free XP allowance; only XP above that allowance uses this pool.`,"Choose abilities appropriate to the character's childhood and later life, respecting access and creation score caps. Zero-score starter rows are suggestions and can be removed."]};
  if(f.id.startsWith("abilities:cap:")){
    const a=r.abilities.find(a=>`abilities.${a.key}`===f.path);
    return {steps:[`Lower this Ability to ${r.abilityCap+(a?.capBonus??0)} or below (learned score), and reassign freed XP. If creation age is incorrect, fix Birth year or Creation year in Identity.`,"The cap uses age at creation, not the current campaign year. Affinity with Ability raises the chosen Ability's cap by 2 and multiplies its XP by 1.5, rounded up. Puissant's +2 in use does not count toward the learned-score cap."],options:optionsFor(["virtue.affinity-with-ability"],ctx)};
  }
  if(f.id==="abilities:no-native-language")return {steps:[`Add (Living Language), fill in the language subject, and check native. Give it ${r.xp.nativeLanguage} free XP (normally score 5).`,"Mark only one language as native. Additional languages use the ordinary XP pool unless another specific rule grants them."]};
  if(f.id==="abilities:multiple-native")return {steps:["Choose the one native Living Language and uncheck native on the other entries. Their XP will then count toward the ordinary pool, so check and adjust the XP tally afterward."]};
  if(f.id==="personality:grog-loyal")return {steps:["In Personality, add a trait named Loyal and choose a score appropriate to this grog's relationship with the covenant. This is a grog guideline rather than a hard restriction."]};
  if(f.id.startsWith("virtues-flaws:unimplemented:"))return {steps:["This check is not automated yet. Review the relevant character-type rule and entry descriptions with the troupe before treating the character as complete."]};
  const id=f.id.split(":")[1];
  const limit=rules.characterTypes[c.type].constraints.find(rule=>rule.id===id)?.value;
  switch(id){
    case "social-status-required":return {steps:["In Virtues & Flaws, set Virtue or Flaw to Both, type to social-status, and size to All sizes. Choose an appropriate Social Status Virtue or Flaw; Free entries count too.","You do not need to spend points to meet this requirement. Read the chosen status's description for background requirements and combinations it allows."]};
    case "vf-balance":return {steps:[`Remove or replace enough Virtues to fit ${r.flawPoints*rules.characterTypes[c.type].virtuePointsPerFlawPoint+(rules.characterTypes[c.type].freeMinorVirtueFromHouse?1:0)} available Virtue point(s), or add suitable Flaws within this build's limits. Free entries cost no points; Minor entries cost 1 and Major entries cost 3.`,"Choose Flaws that fit the character, then recheck the total Flaw budget and limits on Story and Personality Flaws."]};
    case "vf-unspent":return {steps:["You may add suitable Virtues up to the available allowance, or reduce Flaws you no longer want. You are not required to spend every available point; this is informational."]};
    case "flaw-budget":return {steps:[`Remove or replace Flaws until the total is at most ${rules.characterTypes[c.type].maxFlawPoints}. When an entry offers Minor and Major versions, choose the size matching its description and the character's story.`,"Reducing Flaws can also reduce the available Virtue allowance, so check both tallies afterward."]};
    case "no-major":return {steps:["Remove the Major entry, or choose its Minor version if the description offers one. If the concept depends on Major Virtues or Flaws, consider building a Companion instead of a grog."]};
    case "no-hermetic":return {steps:["Remove Hermetic entries from this grog and choose appropriate General or other permitted entries. A character whose concept depends on Hermetic magic needs a different build."]};
    case "no-gift":return {steps:["Remove The Gift from the grog. If being Gifted is central to the concept, change the build to Companion or, when supported, Magus, and review the applicable requirements."]};
    case "no-story-flaws":return {steps:["Remove or replace the Story Flaw with an appropriate permitted category. If the character is intended to be a focus of ongoing stories, consider a Companion build. This is a grog guideline, so a deliberate troupe exception can also be recorded."]};
    case "max-minor-flaws":return {steps:[`Keep at most ${limit??5} Minor Flaws. Remove or replace excess entries; select a Major version only when the entry actually offers one and that version fits the concept.`,"Stay within the total Flaw-point allowance and recheck Virtue balance after changing entries."]};
    case "max-personality-flaws":return {steps:[`Use the personality type filter to review the entries. Keep at most ${limit??(c.type==="grog"?1:2)} Personality Flaw(s) for this build, or record a deliberate troupe exception to this guideline. Ordinary Personality Traits can describe other tendencies without taking more Flaws.`]};
    case "max-major-personality-flaws":return {steps:[`Keep at most ${limit??1} Major Personality Flaw. Remove excess entries, or choose Minor versions where those versions exist and fit the descriptions. Check the overall Personality Flaw limit too.`]};
    case "max-story-flaws":return {steps:[`Use the story type filter and keep at most ${limit??1} Story Flaw. Other story ideas can remain in Notes or the Timeline without buying extra Story Flaws, or the troupe can record a deliberate exception to this guideline.`]};
    case "hermetic-requires-gift":return {steps:["Either remove the Hermetic entries or add The Gift if the Companion really is Gifted. Taking The Gift changes the character's concept and does not by itself make them a trained Hermetic magus."],options:optionsFor(["virtue.the-gift"],ctx)};
    case "required-virtues":return {steps:["Add the missing required entries below. Hermetic Magus is the Magus Social Status and is Free; The Gift is also Free. Magus creation is still incomplete in this prototype."],options:optionsFor((rules.characterTypes[c.type].required??[]).filter(id=>!taken(id)),ctx)};
    case "max-major-hermetic-virtues":return {steps:[`Keep at most ${limit??1} Major Hermetic Virtue. Remove excess entries or select Minor versions only where the descriptions offer them, then check point balance.`]};
    case "hermetic-flaw-recommended":return {steps:["In Virtues & Flaws, select Flaws and type hermetic, then choose an appropriate entry within the Flaw-point allowance. This is a recommendation; a different deliberate concept can be recorded as an exception."]};
    case "single-take":return {steps:["Read the duplicated entry's description. Remove an extra taking if repetition is not allowed. For entries that apply to different subjects, fill in distinct parameters; repeat the same subject only when the description explicitly permits it."]};
    default:return {steps:["Review the highlighted value or Virtue/Flaw entry and its description, then adjust the character to meet the rule. If the troupe intentionally makes an exception, use Accept anyway and record the reason."]};
  }
}
