import { DETAIL_LABELS, type Character } from "../model/character";
import type { RuleSet } from "../data/ruleset";
import type { Validation } from "../engine/validate";
import { Fragment } from "react";
import { RuleTerm } from "./RuleTerm";
import { virtueFlawName } from "../engine/ability-effects";

/**
 * The fair copy. Read-only, always current, printable. Its layout follows
 * the template format in the core rules (a labeled line per section) so a
 * player who knows the books reads it without instruction.
 */
export function Sheet({ character: c, rules, validation }: { character: Character; rules: RuleSet; validation: Validation }) {
  const r = validation.resolved;
  const typeLabel = rules.characterTypes[c.type].label;
  const fmt = (n: number) => (n > 0 ? `+${n}` : String(n));

  const chars = rules.characteristics
    .map((ch) => `${ch.abbreviation} ${fmt(r.characteristics[ch.id] ?? 0)}`)
    .join(", ");

  const vfLine = (() => {
    const social = r.virtues.filter((v) => v.entry.categories.includes("social-status"));
    const rest = (xs: typeof r.virtues) => xs.filter((v) => !v.entry.categories.includes("social-status"));
    const name = (v: (typeof r.virtues)[number]) => virtueFlawName(v.taken,v.entry,c,rules) + (Array.isArray(v.entry.size) ? ` (${v.size[0]!.toUpperCase()}${v.size.slice(1)})` : "");
    const groups = [
      social,
      rest(r.virtues).filter((v) => v.size === "major"),
      rest(r.virtues).filter((v) => v.size !== "major"),
      r.flaws.filter((f) => f.size === "major"),
      r.flaws.filter((f) => f.size !== "major"),
    ].filter((g) => g.length);
    return groups.map((g,i) => <Fragment key={i}>{i>0?"; ":""}{[...g].sort((a,b)=>name(a).localeCompare(name(b))).map((v,j)=><Fragment key={v.taken.key}>{j>0?", ":""}<RuleTerm label={name(v)} text={v.entry.text} /></Fragment>)}</Fragment>);
  })();

  const abilities = [...r.abilities]
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .map((a,i) => <Fragment key={a.key}>{i>0?", ":""}<RuleTerm label={a.displayName} text={rules.abilities.get(a.id)?.text??""} /> <b>{a.effectiveScore}</b>{a.scoreBonus!==0?` (${a.score} ${a.scoreBonus>0?"+":"−"} ${Math.abs(a.scoreBonus)} in use)`:""}{a.specialty ? ` (${a.specialty})` : ""}</Fragment>);

  const wounds = r.woundBands.map((b) => `${b.penalty} (${b.from}–${b.to})`).join(", ");
  const accepted = validation.states.filter((s) => s.kind === "overridden");
  const activeEquipment = c.equipment.filter((item) => item.equipped && item.effects.trim());
  const timeline = c.timeline.filter((event) => event.label.trim()).sort((a, b) => a.year - b.year);
  const books = new Set<string>();
  for (const v of [...r.virtues, ...r.flaws]) books.add(`${v.entry.source.book} (${v.entry.source.year})`);
  if (books.size === 0) books.add(`${rules.label} (2024)`);

  return (
    <article className="sheet">
      <div className="titling">
        <h2>{c.name || <span className="placeholder">Unnamed {typeLabel.toLowerCase()}</span>}</h2>
        <span className="kind">{typeLabel}{c.concept ? ` · ${c.concept}` : ""}</span>
      </div>

      {activeEquipment.length > 0 && <aside className="equipment-effects" aria-label="Equipped effects">
        <b>Equipped effects · apply manually</b>
        {activeEquipment.map((item) => <p key={item.key}><strong>{item.name || "Unnamed item"}:</strong> {item.effects}</p>)}
      </aside>}

      <div className="line"><b>Characteristics</b><span>{chars}{r.size !== 0 ? <><span className="sep">·</span>Size {fmt(r.size)}</> : null}</span></div>
      <div className="line"><b>Age</b><span>{r.age} in {c.birthYear + r.age} · born {c.birthYear}</span></div>
      {Object.entries(DETAIL_LABELS).map(([key, label]) => {
        const value = c.details[key as keyof typeof DETAIL_LABELS];
        return value?.trim() ? <div className="line" key={key}><b>{label}</b><span>{value}</span></div> : null;
      })}
      <div className="line"><b>Decrepitude</b><span>0</span></div>
      <div className="line"><b>Warping Score</b><span>0 (0)</span></div>
      {rules.characterTypes[c.type].confidence && (
        <div className="line"><b>Confidence</b><span>{rules.characterTypes[c.type].confidence!.score} ({rules.characterTypes[c.type].confidence!.points})</span></div>
      )}
      <div className="line dense"><b>Virtues and Flaws</b><span>{vfLine.length?vfLine:<i className="placeholder">none</i>}</span></div>
      <div className="line"><b>Personality Traits</b><span>{c.personality.filter((p) => p.name).map((p) => `${p.name} ${fmt(p.score)}`).join(", ") || "—"}</span></div>
      <div className="line"><b>Soak</b><span>{fmt(r.soak)} (Stamina)</span></div>
      <div className="line"><b>Fatigue Levels</b><span>{r.fatigueLevels.join(", ")}</span></div>
      <div className="line"><b>Wound Penalties</b><span>{wounds}</span></div>
      <div className="line dense"><b>Abilities</b><span>{abilities.length?abilities:<i className="placeholder">none</i>}</span></div>
      {r.abilities.filter(a=>a.annotations.length).map(a=><div className="line dense" key={`effects-${a.key}`}><b>{a.displayName}</b><span>{a.annotations.map(note=><span className="help ability-annotation" key={note.key}><strong>{note.name}:</strong> {note.note}</span>)}</span></div>)}
      {c.equipment.length > 0 && <>
        <div className="rubric">Equipment · carried load {c.equipment.reduce((sum, item) => sum + item.load, 0)}</div>
        {c.equipment.map((item) => <div className="line dense" key={item.key}>
          <b>{item.name || "Unnamed item"}</b><span>{item.type} · load {item.load}{item.equipped ? " · equipped" : ""}{item.description ? ` — ${item.description}` : ""}</span>
        </div>)}
      </>}
      {timeline.length > 0 && <>
        <div className="rubric">Timeline</div>
        {timeline.map((event) => <div className="line" key={event.key}><b>{event.year}</b><span>{event.label}{event.notes ? ` — ${event.notes}` : ""}</span></div>)}
      </>}
      {c.notes && <div className="line dense"><b>Notes</b><span>{c.notes}</span></div>}

      {accepted.length > 0 && (
        <>
          <div className="rubric">Exceptions accepted by the troupe</div>
          <ul className="exceptions">
            {accepted.map((s) => s.kind === "overridden" && (
              <li key={s.finding.id}>
                {s.finding.message}
                {s.override.reason && <span className="reason"> — {s.override.reason}</span>}
                <span className="help"> ({s.override.accepted})</span>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="colophon">
        <p>Based on the material for Ars Magica, ©1993–2024, licensed by Trident, Inc. d/b/a Atlas Games®, under <a href="https://creativecommons.org/licenses/by-sa/4.0/">Creative Commons Attribution-ShareAlike 4.0 International license 4.0 ("CC-BY-SA 4.0")</a>. Sources: {[...books].join("; ")}. Game content has been selected and restructured into this character sheet.</p>
        <p>Ars Magica Open License Logo ©2024 Trident, Inc. The Ars Magica Open License Logo, Ars Magica, and Mythic Europe are trademarks of Trident, Inc., and are used with permission.</p>
        <p>Order of Hermes, Tremere, Doissetep, and Grimgroth are trademarks of Paradox Interactive AB and are used with permission.</p>
        <p>Ars Ratiocinandi is not affiliated with or endorsed by Atlas Games or Paradox Interactive AB. The application's optional MIT code license does not relicense the game content or players' original contributions.</p>
      </div>
    </article>
  );
}
