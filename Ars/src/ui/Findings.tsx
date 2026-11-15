import { useState } from "react";
import { displaySeverity } from "../model/findings";
import type { PanelProps } from "./Workbench";
import { RuleTerm } from "./RuleTerm";

/**
 * Every finding, with the override action beside it. Overriding asks for a
 * reason but does not require one — the point is that it is a recorded
 * decision, and the sheet prints it.
 */
export function Findings({ character: c, rules, validation, onChange }: PanelProps) {
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const { states, counts } = validation;

  const accept = (findingId: string) => {
    onChange({
      ...c,
      overrides: [...c.overrides, { findingId, reason: reason.trim() || undefined, accepted: new Date().toISOString().slice(0, 10) }],
    });
    setReasonFor(null);
    setReason("");
  };
  const revoke = (findingId: string) =>
    onChange({ ...c, overrides: c.overrides.filter((o) => o.findingId !== findingId) });

  const order = { error: 0, warning: 1, stale: 2, overridden: 3, info: 4 } as const;
  const sorted = [...states].sort((a, b) => {
    const ka = a.kind === "active" ? a.finding.severity : a.kind;
    const kb = b.kind === "active" ? b.finding.severity : b.kind;
    return order[ka] - order[kb];
  });

  return (
    <div className="panel">
      <header>
        <h2>Findings</h2>
        <span className="tally">
          {counts.error > 0 && <span style={{ color: "var(--madder)" }}>{counts.error} to fix</span>}
          {counts.error > 0 && (counts.warning > 0 || counts.overridden > 0) && " · "}
          {counts.warning > 0 && <span style={{ color: "var(--ochre)" }}>{counts.warning} to consider</span>}
          {counts.warning > 0 && counts.overridden > 0 && " · "}
          {counts.overridden > 0 && <span style={{ color: "var(--verdigris)" }}>{counts.overridden} accepted</span>}
          {counts.error + counts.warning + counts.overridden === 0 && <span className="ok">in order</span>}
        </span>
      </header>
      {sorted.length === 0 && <p className="help">Nothing to report.</p>}
      <ul className="findings">
        {sorted.map((s) => {
          const sev = displaySeverity(s);
          if (s.kind === "stale") {
            return (
              <li key={`stale:${s.override.findingId}`} className="finding stale">
                <span className="mark" />
                <span>
                  An exception was recorded for <code>{s.override.findingId}</code>, but the rule is now satisfied.
                  <span className="finding-guidance">Use Remove exception to clear the old decision, or keep it as part of the character's history. Removing a stale exception does not change the character's scores or entries.</span>
                  <span className="why stale">{s.override.reason ?? "no reason given"} — accepted {s.override.accepted}</span>
                </span>
                <button className="btn small" onClick={() => revoke(s.override.findingId)}>Remove exception</button>
              </li>
            );
          }
          const f = s.finding;
          const cls = s.kind === "overridden" ? "overridden" : sev;
          return (
            <li key={f.id} className={`finding ${cls}`}>
              <span className="mark" />
              <div className="finding-body">
                {f.message}
                {f.guidance && <div className="finding-guidance">
                  <strong>{s.kind==="overridden"?"To satisfy this rule":f.severity==="info"?"Next steps":"How to fix"}</strong>
                  {f.guidance.steps.map((step,i)=><p key={i}>{step}</p>)}
                  {!!f.guidance.options?.length && <details className="finding-options">
                    <summary>{f.guidance.optionsLabel??"Relevant Virtues / Flaws"} ({f.guidance.options.length})</summary>
                    <ul>{f.guidance.options.map(option=>{
                      const entry=rules.virtuesFlaws.get(option.id);if(!entry)return null;
                      return <li key={entry.id}><RuleTerm label={entry.name} text={entry.text} /> <span className="meta">({(Array.isArray(entry.size)?entry.size:[entry.size]).join(" / ")} {entry.kind})</span>{option.note?` — ${option.note}`:""}</li>;
                    })}</ul>
                  </details>}
                </div>}
                {s.kind === "overridden" && (
                  <span className="why">accepted {s.override.accepted}{s.override.reason ? ` — ${s.override.reason}` : ""}</span>
                )}
              </div>
              {s.kind === "overridden" ? (
                <button className="btn bare small" onClick={() => revoke(f.id)}>revoke</button>
              ) : f.severity === "info" ? null : reasonFor === f.id ? null : (
                <button className="btn small" onClick={() => setReasonFor(f.id)}>Accept anyway</button>
              )}
              {reasonFor === f.id && (
                <span className="override-form">
                  <input autoFocus value={reason} placeholder="why? (optional, but future you will want it)" onChange={(e) => setReason(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") accept(f.id); if (e.key === "Escape") setReasonFor(null); }} />
                  <button className="btn small primary" onClick={() => accept(f.id)}>Accept</button>
                  <button className="btn bare small" onClick={() => setReasonFor(null)}>cancel</button>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
