/** Emit the production workbook plan/requests for independent native verification. */
import { writeFileSync } from "node:fs";
import { newCharacter } from "../../src/model/character";
import { definitiveEdition } from "../../src/data/ruleset";
import { buildCharacterWorkbook, nativeRequests } from "../../src/sheets/workbook";
const c=newCharacter("companion",definitiveEdition.id);
c.id="prototype-companion";c.name="Companion template prototype";c.birthYear=1192;
c.concept="A calculation and layout example";
c.abilities=[{key:"awareness",id:"ability.awareness",xp:15,specialty:"Ambushes"},{key:"native",id:"ability.living-language",parameter:"Catalan",xp:75,native:true}];
c.virtuesFlaws=[{key:"status",id:"virtue.covenfolk"}];
c.characteristics={"characteristic.intelligence":2,"characteristic.stamina":1};
c.equipment=[{key:"cloak",name:"Travel cloak",type:"item",load:1,equipped:true,description:"Wool",effects:"Keep dry"}];
const plan=buildCharacterWorkbook(c,definitiveEdition);
writeFileSync(process.argv[2]??"/private/tmp/ars-workbook-plan.json",JSON.stringify({plan,requests:nativeRequests(plan)}));
