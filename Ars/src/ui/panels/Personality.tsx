import type { PanelProps } from "../Workbench";

export function Personality({ character: c, onChange }: PanelProps) {
  const traits = c.personality;
  const update = (i: number, patch: Partial<(typeof traits)[number]>) =>
    onChange({ ...c, personality: traits.map((t, j) => (j === i ? { ...t, ...patch } : t)) });
  return (
    <div className="panel">
      <header><h2>Personality</h2><span className="tally">−3 to +3</span></header>
      <ul className="ledger">
        {traits.map((t, i) => (
          <li key={i}>
            <span className="row-actions">
              <input value={t.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="trait" />
              <input className="narrow" type="number" min={-3} max={3} value={t.score} onChange={(e) => update(i, { score: Number(e.target.value) || 0 })} />
            </span>
            <button className="btn bare small" onClick={() => onChange({ ...c, personality: traits.filter((_, j) => j !== i) })}>remove</button>
          </li>
        ))}
      </ul>
      <button className="btn small" style={{ marginTop: "0.5rem" }} onClick={() => onChange({ ...c, personality: [...traits, { name: "", score: 1 }] })}>Add trait</button>
    </div>
  );
}
