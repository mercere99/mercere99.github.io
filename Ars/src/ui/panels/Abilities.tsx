import { useMemo, useState } from "react";
import type { AbilityCategory } from "../../model/findings";
import { newKey } from "../../model/character";
import { surplusXp, xpForScore } from "../../engine/advancement";
import { investedXpForTotal } from "../../engine/ability-effects";
import { Picker, type PickerItem } from "../Picker";
import { findingsAt, type PanelProps } from "../Workbench";
import { RuleTerm } from "../RuleTerm";

export function Abilities({ character: c, rules, validation, onChange }: PanelProps) {
  const [category, setCategory] = useState<AbilityCategory | "">("");
  const { xp, access, abilityCap } = validation.resolved;

  const items = useMemo<PickerItem[]>(
    () =>
      [...rules.abilities.values()].filter((a) => !category || a.type === category).map((a) => ({
        id: a.id,
        label: a.name,
        description: a.text,
        meta: a.type,
        // Not blocked — access is enforced as a finding so it can be overridden.
        // The meta text tells the user before they pick.
        ...(access.has(a.type) ? {} : { meta: `${a.type} — needs a Virtue, or an override` }),
        search: `${a.name} ${a.type} ${a.specialties.join(" ")}`.toLowerCase(),
      })),
    [rules, access, category],
  );

  const add = (id: string) =>
    onChange({ ...c, abilities: [...c.abilities, { key: newKey(), id, xp: xpForScore(1, "ability", rules) }] });
  const drop = (key: string) => onChange({ ...c, abilities: c.abilities.filter((a) => a.key !== key) });
  const patch = (key: string, p: Partial<(typeof c.abilities)[number]>) =>
    onChange({ ...c, abilities: c.abilities.map((a) => (a.key === key ? { ...a, ...p } : a)) });

  const setScore = (key: string, score: number) =>
    patch(key, { xp: investedXpForTotal(xpForScore(Math.max(0, score), "ability", rules), validation.resolved.abilities.find(a=>a.key===key)?.xpFactor??1) });

  const hasNative = c.abilities.some((a) => a.native);

  return (
    <div className="panel">
      <header>
        <h2>Abilities</h2>
        <span className={`tally ${xp.spent > xp.budget ? "over" : xp.spent < xp.budget ? "under" : ""}`}>
          {xp.spent} of {xp.budget} xp
        </span>
      </header>
      <p className="help">
        {xp.earlyChildhood} from early childhood, {xp.laterLife} from {Math.max(0, validation.resolved.creationAge - rules.creation.experience.earlyChildhood.years)} later years
        {xp.budget - xp.earlyChildhood - xp.laterLife > 0 ? `, ${xp.budget - xp.earlyChildhood - xp.laterLife} from Virtues` : ""}.
        Native language gets {xp.nativeLanguage} free. Creation scores cap at {abilityCap}.
      </p>
      <p className="help">Hover over or focus an ability name for its full description. Starter rows at 0 are suggestions; allocate childhood and later-life XP to suit this character.</p>
      {validation.resolved.effects.some((effect) => effect.type === "xp-grant" && effect.restrictedTo) && <p className="help">
        Restricted Virtue XP: {validation.resolved.effects.flatMap((effect) => effect.type === "xp-grant" && effect.restrictedTo
          ? [`${effect.amount} for ${effect.restrictedTo.name ?? `${effect.restrictedTo.category ?? "eligible"} abilities`}`] : []).join("; ")}.
        {" "}Check these allocations manually; only the total budget is validated.
      </p>}
      <ul className="ledger ability-ledger">
        {c.abilities.map((a) => {
          const def = rules.abilities.get(a.id);
          if (!def) return null;
          const resolved = validation.resolved.abilities.find(r=>r.key===a.key)!;
          const score = resolved.score;
          const surplus = surplusXp(resolved.adjustedXp, "ability", rules);
          const f = findingsAt(validation, `abilities.${a.key}`);
          const cls = f.some((s) => s.kind === "active" && s.finding.severity === "error") ? "flagged" : undefined;
          return (
            <li key={a.key} className={cls}>
              <span>
                <RuleTerm label={def.name} text={def.text} />
                {def.parameterized && (
                  <span className="row-actions" style={{ marginLeft: "0.5rem" }}>
                  <input aria-label={`${def.name} subject`} value={a.parameter ?? ""} placeholder={def.name.match(/\(([^)]+)\)/)?.[1] ?? "which"} onChange={(e) => patch(a.key, { parameter: e.target.value })} />
                  </span>
                )}
                <span className="row-actions" style={{ marginLeft: "0.5rem" }}>
                  <input aria-label={`${def.name} specialty`} value={a.specialty ?? ""} placeholder="Your specialty" list={`spec-${a.key}`} onChange={(e) => patch(a.key, { specialty: e.target.value })} />
                  <datalist id={`spec-${a.key}`}>{def.specialties.map((s) => <option key={s} value={s} />)}</datalist>
                  {def.specialties.length > 0 && <select aria-label={`${def.name} suggested specialties`} value="" onChange={(e) => { if (e.target.value) patch(a.key, { specialty: e.target.value }); }}>
                    <option value="">Suggested specialties…</option>
                    {def.specialties.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>}
                </span>
                {def.id === "ability.living-language" && (
                  <label className="meta" style={{ marginLeft: "0.5rem" }}>
                    <input type="checkbox" checked={!!a.native} disabled={hasNative && !a.native}
                      onChange={(e) => patch(a.key, { native: e.target.checked, xp: e.target.checked ? Math.max(a.xp, xp.nativeLanguage) : a.xp })} /> native
                  </label>
                )}
                {resolved.annotations.map(note=><span className="help ability-annotation" key={note.key}><RuleTerm label={note.name} text={rules.virtuesFlaws.get(c.virtuesFlaws.find(v=>v.key===note.key)!.id)?.text??""} />: {note.note}</span>)}
              </span>
              <span className="row-actions">
                <span className="meta">Learned</span>
                <span className="stepper">
                  <button aria-label="lower score" disabled={score<=0} onClick={() => setScore(a.key, score - 1)}>−</button>
                  <output title="Learned score from XP">{score}</output>
                  <button aria-label="raise score" onClick={() => setScore(a.key, score + 1)}>+</button>
                </span>
                {resolved.scoreBonus!==0 && <strong className="ability-total" title="Total when using the Ability; the stepper changes the learned score">{score} {resolved.scoreBonus>0?"+":"−"} {Math.abs(resolved.scoreBonus)} = {resolved.effectiveScore} in use</strong>}
                {resolved.xpFactor!==1 && <span className="meta">{a.xp} spent → {resolved.adjustedXp} XP</span>}
                <input className="narrow" type="number" min={0} value={a.xp} aria-label="experience points" onChange={(e) => patch(a.key, { xp: Number(e.target.value) || 0 })} />
                <span className="meta">XP spent</span>
                <span className="meta" title="experience beyond the current score">{surplus > 0 ? `+${surplus}` : ""}</span>
                <button className="btn bare small" onClick={() => drop(a.key)}>remove</button>
              </span>
            </li>
          );
        })}
      </ul>
      <div className="ability-browser">
        <label htmlFor="ability-category">Ability type</label>
        <select id="ability-category" value={category} onChange={(e) => setCategory(e.target.value as AbilityCategory | "")}>
          <option value="">All types</option>
          {[...new Set([...rules.abilities.values()].map((a) => a.type))].sort().map((type) => <option key={type} value={type}>{type}</option>)}
        </select>
        <label htmlFor="ability-choice">Browse abilities</label>
        <select id="ability-choice" value="" onChange={(e) => { if (e.target.value) add(e.target.value); }}>
          <option value="">Choose an ability…</option>
          {[...items].sort((a, b) => a.label.localeCompare(b.label)).map((item) => <option key={item.id} value={item.id}>{item.label}{item.meta?.includes("needs") ? " — needs access or override" : ""}</option>)}
        </select>
      </div>
      <Picker placeholder="Add an Ability — type to search" items={items} onPick={add} />
    </div>
  );
}
