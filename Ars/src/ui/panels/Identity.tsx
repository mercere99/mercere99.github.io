import { useState } from "react";
import { DETAIL_LABELS, newKey, type TimelineEvent } from "../../model/character";
import type { PanelProps } from "../Workbench";

export function Identity({ character: c, campaignYear, rules, validation, onChange }: PanelProps) {
  const [showAllDetails, setShowAllDetails] = useState(false);
  const set = <K extends keyof typeof c>(k: K, v: (typeof c)[K]) => onChange({ ...c, [k]: v });
  const patchEvent = (key: string, patch: Partial<TimelineEvent>) =>
    set("timeline", c.timeline.map((event) => event.key === key ? { ...event, ...patch } : event));
  return (
    <div className="panel">
      <header><h2>Identity</h2><span className="tally">Age {validation.resolved.age} in {campaignYear}</span></header>
      <div className="field"><label htmlFor="name">Name</label>
        <input id="name" value={c.name} onChange={(e) => set("name", e.target.value)} /></div>
      <div className="field"><label htmlFor="concept">Concept</label>
        <input id="concept" value={c.concept} onChange={(e) => set("concept", e.target.value)} placeholder="Who they are and what they do" /></div>
      <div className="field"><label htmlFor="type">Kind</label>
        <select id="type" value={c.type} onChange={(e) => set("type", e.target.value as typeof c.type)}>
          {Object.entries(rules.characterTypes).map(([id, t]) => <option key={id} value={id}>{t.label}{id === "magus" ? " (incomplete)" : ""}</option>)}
        </select></div>
      <div className="field"><label htmlFor="narrative-role">Role in the troupe</label>
        <select id="narrative-role" value={c.role ?? "player-character"} onChange={e=>set("role",e.target.value as NonNullable<typeof c.role>)}>
          <option value="player-character">Player character</option><option value="shared">Shared troupe character</option><option value="npc">NPC</option>
        </select></div>
      <div className="field"><label htmlFor="birth-year">Birth year</label>
        <input id="birth-year" type="number" step={1} value={c.birthYear} onChange={(e) => { if (Number.isInteger(e.target.valueAsNumber)) set("birthYear", e.target.valueAsNumber); }} /></div>
      <div className="field"><label htmlFor="creation-year">Creation year</label>
        <input id="creation-year" type="number" step={1} value={c.creationYear} onChange={(e) => { if (Number.isInteger(e.target.valueAsNumber)) set("creationYear", e.target.valueAsNumber); }} /></div>
      <p className="help">Creation XP is assessed in {c.creationYear}, at age {validation.resolved.creationAge}. Moving the campaign year changes age, not earned XP.</p>
      {c.type === "companion" && <p className="help">Companions can take Major Virtues and Flaws and up to 10 Flaw points. Confidence starts at 1 (3 points).</p>}
      {c.type === "magus" && <p className="help">Magus creation is incomplete: Arts, spells, and apprenticeship XP are not yet modeled.</p>}
      <div className="section-heading"><h3>Optional details</h3>
        <button className="btn bare small" aria-expanded={showAllDetails} onClick={() => setShowAllDetails(!showAllDetails)}>
          {showAllDetails ? "Hide blank details" : "Show all details"}
        </button>
      </div>
      {Object.entries(DETAIL_LABELS).map(([key, label]) => {
        const id = key as keyof typeof DETAIL_LABELS;
        if (!showAllDetails && !c.details[id]?.trim()) return null;
        return <div className="field" key={id}><label htmlFor={`detail-${id}`}>{label}</label>
          <input id={`detail-${id}`} value={c.details[id] ?? ""}
            onChange={(e) => set("details", { ...c.details, [id]: e.target.value })} />
        </div>;
      })}
      <details className="timeline-editor">
        <summary>Timeline{c.timeline.length > 0 ? ` (${c.timeline.length})` : " (optional)"}</summary>
        <datalist id="timeline-labels"><option value="Joined the covenant" /><option value="Gauntlet" /><option value="Apprenticeship began" /></datalist>
        {c.timeline.map((event) => <div className="timeline-entry" key={event.key}>
          <div className="field"><label htmlFor={`event-year-${event.key}`}>Year</label>
            <input id={`event-year-${event.key}`} type="number" value={event.year}
              onChange={(e) => { if (Number.isInteger(e.target.valueAsNumber)) patchEvent(event.key, { year: e.target.valueAsNumber }); }} /></div>
          <div className="field"><label htmlFor={`event-label-${event.key}`}>Event</label>
            <input id={`event-label-${event.key}`} list="timeline-labels" value={event.label} placeholder="Choose a suggestion or write your own"
              onChange={(e) => patchEvent(event.key, { label: e.target.value })} /></div>
          <div className="field"><label htmlFor={`event-notes-${event.key}`}>Details</label>
            <input id={`event-notes-${event.key}`} value={event.notes} onChange={(e) => patchEvent(event.key, { notes: e.target.value })} /></div>
          <button className="btn bare small" onClick={() => set("timeline", c.timeline.filter((t) => t.key !== event.key))}>Remove event</button>
        </div>)}
        <button className="btn small" onClick={() => set("timeline", [...c.timeline, { key: newKey(), year: campaignYear, label: "", notes: "" }])}>Add timeline event</button>
      </details>
      <div className="field"><label htmlFor="notes">Notes</label>
        <textarea id="notes" rows={3} value={c.notes} onChange={(e) => set("notes", e.target.value)} /></div>
    </div>
  );
}
