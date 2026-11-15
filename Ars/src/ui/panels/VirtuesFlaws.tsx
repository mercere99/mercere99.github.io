import { useId, useMemo, useState } from "react";
import { newKey, type Character, type TakenVirtueFlaw } from "../../model/character";
import { abilityName, choosesAbility, abilityEffectNote } from "../../engine/ability-effects";
import type { VirtueFlaw } from "../../data/ruleset";
import { Picker, type PickerItem } from "../Picker";
import { findingsAt, type PanelProps } from "../Workbench";
import { RuleTerm } from "../RuleTerm";
import type { RuleSet } from "../../data/ruleset";

const SIZE_LABEL = { free: "Free", minor: "Minor", major: "Major" } as const;

/**
 * Which entries the picker should mark blocked for this character type.
 * Blocked items are still shown: the user can take one anyway by removing
 * the block reason (e.g. change type to Companion) or, after taking it via
 * JSON import, override the finding. Making the rule visible is the point.
 */
function blockReason(v: VirtueFlaw, type: string): string | undefined {
  if (type !== "grog") return undefined;
  if (v.id === "virtue.the-gift") return "grogs may not take The Gift";
  if (v.categories.includes("hermetic")) return "grogs may not take Hermetic entries";
  if (v.size === "major") return "grogs may not take Major entries";
  return undefined;
}


type Resolved = PanelProps["validation"]["resolved"];
type RowProps = {
  r: Resolved["virtues"][number];
  rowClass: (key: string) => string | undefined;
  patch: (key: string, p: Partial<TakenVirtueFlaw>) => void;
  drop: (key: string) => void;
  rules: RuleSet;
  character: Character;
  chooseAbility: (key: string, value: string) => void;
};

/** Top-level so React keeps it mounted across edits; inputs keep focus. */
function Row({ r, rowClass, patch, drop, rules, character, chooseAbility }: RowProps) {
  const included=r.entry.effects.some(e=>e.type==="ability-access"||e.type==="xp-grant")||[
    "virtue.great-characteristic","flaw.poor-characteristic","virtue.giant-blood","flaw.dwarf","virtue.improved-characteristics","virtue.wealthy","flaw.poor",
  ].includes(r.entry.id);
  return (
    <li className={rowClass(r.taken.key)}>
      <span>
        <RuleTerm label={r.entry.name} text={r.entry.text} />
        {choosesAbility(r.entry) && <span className="row-actions" style={{ marginLeft: "0.5rem" }}>
          <select aria-label={`${r.entry.name} ability`} value={r.taken.abilityKey ?? ""} onChange={e=>chooseAbility(r.taken.key,e.target.value)}>
            <option value="">Choose an Ability…</option>
            {r.taken.abilityKey && !character.abilities.some(a=>a.key===r.taken.abilityKey) && <option value={r.taken.abilityKey}>Ability removed — choose again</option>}
            <optgroup label="Abilities in this build">{character.abilities.map(a=>{
              const def=rules.abilities.get(a.id);
              return def?<option key={a.key} value={a.key}>{abilityName(a,def)}{a.native?" (native)":""}</option>:null;
            })}</optgroup>
            <optgroup label="Add another Ability (starts at 0)">{[...rules.abilities.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(a=><option key={a.id} value={`new:${a.id}`}>{a.name}</option>)}</optgroup>
          </select>
          {r.entry.id === "flaw.necessary-realm-aura-for-ability" && <input aria-label={`${r.entry.name} realm`} placeholder="Realm, e.g. Magic" value={r.taken.parameter??""} onChange={e=>patch(r.taken.key,{parameter:e.target.value})} />}
        </span>}
        {r.entry.parameterized && !choosesAbility(r.entry) && (
          <span className="row-actions" style={{ marginLeft: "0.5rem" }}>
            {r.entry.parameterized === "Characteristic" ? <select aria-label={`${r.entry.name} characteristic`} value={r.taken.parameter??""} onChange={e=>patch(r.taken.key,{parameter:e.target.value})}>
              <option value="">Choose a Characteristic…</option>{rules.characteristics.map(ch=><option key={ch.id} value={ch.name}>{ch.name}</option>)}
            </select> : <input aria-label={`${r.entry.name} ${r.entry.parameterized}`} value={r.taken.parameter ?? ""} placeholder={r.entry.parameterized} onChange={(e) => patch(r.taken.key, { parameter: e.target.value })} />}
          </span>
        )}
        <span className="meta" style={{ marginLeft: "0.5rem" }}>
          {Array.isArray(r.entry.size) ? (
            <select value={r.size} onChange={(e) => patch(r.taken.key, { size: e.target.value as typeof r.size })} style={{ border: 0, background: "transparent" }}>
              {r.entry.size.map((s) => <option key={s} value={s}>{SIZE_LABEL[s]}</option>)}
            </select>
          ) : SIZE_LABEL[r.size]}
          {" · "}<i>{r.entry.categories.join(", ")}</i>
          {included && <span title="Supported creation calculations are included. Read the description for other effects that need adjudication."> · creation effects included</span>}
        </span>
        {choosesAbility(r.entry) && <span className="help ability-annotation">{abilityEffectNote(r.entry.id)}</span>}
      </span>
      <button className="btn bare small" onClick={() => drop(r.taken.key)}>remove</button>
    </li>
  
  );
}

export function VirtuesFlaws({ character: c, rules, validation, onChange }: PanelProps) {
  const [kind,setKind]=useState("");
  const [category,setCategory]=useState("");
  const [size,setSize]=useState("");
  const browserId=useId();
  const { virtuePoints, flawPoints, virtues, flaws } = validation.resolved;
  const typeRules = rules.characterTypes[c.type];
  const allowance = flawPoints * typeRules.virtuePointsPerFlawPoint + (typeRules.freeMinorVirtueFromHouse ? 1 : 0);

  const items = useMemo<PickerItem[]>(
    () =>
      [...rules.virtuesFlaws.values()].filter(v=>(!kind||v.kind===kind)&&(!category||v.categories.some(c=>c===category))&&(!size||(Array.isArray(v.size)?v.size.includes(size as "minor"|"major"|"free"):v.size===size))).map((v) => ({
        id: v.id,
        label: v.name,
        description: v.text,
        meta: `${v.kind === "virtue" ? "Virtue" : "Flaw"} · ${Array.isArray(v.size) ? v.size.map((s) => SIZE_LABEL[s]).join(" or ") : SIZE_LABEL[v.size]} · ${v.categories.join(", ")}`,
        blocked: blockReason(v, c.type),
        search: `${v.name} ${v.kind} ${v.categories.join(" ")} ${v.tags.join(" ")}`.toLowerCase(),
      })),
    [rules, c.type,kind,category,size],
  );

  const take = (id: string) => {
    const v = rules.virtuesFlaws.get(id)!;
    if(blockReason(v,c.type))return;
    onChange({
      ...c,
      virtuesFlaws: [...c.virtuesFlaws, { key: newKey(), id, size: Array.isArray(v.size) ? "minor" : undefined }],
    });
  };
  const drop = (key: string) => onChange({ ...c, virtuesFlaws: c.virtuesFlaws.filter((v) => v.key !== key) });
  const patch = (key: string, p: Partial<(typeof c.virtuesFlaws)[number]>) =>
    onChange({ ...c, virtuesFlaws: c.virtuesFlaws.map((v) => (v.key === key ? { ...v, ...p } : v)) });
  const chooseAbility = (key: string, value: string) => {
    if (!value.startsWith("new:")) { patch(key,{abilityKey:value || undefined}); return; }
    const ability={key:newKey(),id:value.slice(4),xp:0};
    onChange({...c,abilities:[...c.abilities,ability],virtuesFlaws:c.virtuesFlaws.map(v=>v.key===key?{...v,abilityKey:ability.key}:v)});
  };

  const rowClass = (key: string) => {
    const f = findingsAt(validation, `virtuesFlaws.${key}`);
    if (f.some((s) => s.kind === "active" && s.finding.severity === "error")) return "flagged";
    if (f.some((s) => s.kind === "active" && s.finding.severity === "warning")) return "warned";
    return undefined;
  };

  return (
    <div className="panel">
      <header>
        <h2>Virtues &amp; Flaws</h2>
        <span className={`tally ${virtuePoints > allowance ? "over" : virtuePoints < allowance ? "under" : ""}`}>
          {virtuePoints} Virtue · {flawPoints} Flaw
          {flawPoints > typeRules.maxFlawPoints ? ` (max ${typeRules.maxFlawPoints})` : ""}
        </span>
      </header>
      {virtues.length > 0 && <h3>Virtues</h3>}
      <ul className="ledger">{virtues.map((r) => <Row key={r.taken.key} r={r} rowClass={rowClass} patch={patch} drop={drop} rules={rules} character={c} chooseAbility={chooseAbility} />)}</ul>
      {flaws.length > 0 && <h3 style={{ marginTop: "0.75rem" }}>Flaws</h3>}
      <ul className="ledger">{flaws.map((r) => <Row key={r.taken.key} r={r} rowClass={rowClass} patch={patch} drop={drop} rules={rules} character={c} chooseAbility={chooseAbility} />)}</ul>
      <div className="ability-browser">
        <label htmlFor={`${browserId}-kind`}>Virtue or Flaw</label><select id={`${browserId}-kind`} value={kind} onChange={e=>setKind(e.target.value)}><option value="">Both</option><option value="virtue">Virtues</option><option value="flaw">Flaws</option></select>
        <label htmlFor={`${browserId}-category`}>Virtue / Flaw type</label><select id={`${browserId}-category`} value={category} onChange={e=>setCategory(e.target.value)}><option value="">All types</option>{[...new Set([...rules.virtuesFlaws.values()].flatMap(v=>v.categories))].sort().map(type=><option key={type}>{type}</option>)}</select>
        <label htmlFor={`${browserId}-size`}>Virtue / Flaw size</label><select id={`${browserId}-size`} value={size} onChange={e=>setSize(e.target.value)}><option value="">All sizes</option>{Object.entries(SIZE_LABEL).map(([key,label])=><option key={key} value={key}>{label}</option>)}</select>
        <label htmlFor={`${browserId}-choice`}>Browse Virtues / Flaws</label><select id={`${browserId}-choice`} value="" onChange={e=>{if(e.target.value)take(e.target.value);}}>
          <option value="">Choose a Virtue or Flaw…</option>{[...items].sort((a,b)=>a.label.localeCompare(b.label)).map(item=><option key={item.id} value={item.id} disabled={!!item.blocked}>{item.label} · {item.meta}{item.blocked?` — ${item.blocked}`:""}</option>)}
        </select>
      </div>
      <Picker placeholder="Add a Virtue or Flaw — type to search" items={items} onPick={take} />
      <p className="help" style={{ marginTop: "0.5rem" }}>
        Hover over or focus a name to read its description. Only supported calculations are automatic; other effects still need adjudication.
      </p>
    </div>
  );
}
