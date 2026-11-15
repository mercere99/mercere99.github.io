import type { PanelProps } from "../Workbench";
import { characteristicLimitHint } from "../../engine/characteristics";

export function Characteristics({ character: c, rules, validation, onChange }: PanelProps) {
  const { min, max } = rules.creation.characteristics;
  const points=validation.resolved.characteristicPointBudget;
  const cost = rules.creation.characteristics.cost as Record<string, number>;
  const spent = validation.resolved.characteristicPointsSpent;
  const set = (id: string, v: number) =>
    onChange({ ...c, characteristics: { ...c.characteristics, [id]: Math.max(min, Math.min(max, v)) } });

  return (
    <div className="panel">
      <header>
        <h2>Characteristics</h2>
        <span className={`tally ${spent > points ? "over" : spent < points ? "under" : ""}`}>{spent} of {points} points</span>
      </header>
      <p className="help">Allocate base scores from −3 to +3. Great/Poor Characteristic, Giant Blood, and Dwarf adjust the final scores separately. Hover over a limit button for options.</p>
      <div className="chars">
        {rules.characteristics.map((ch) => {
          const v = c.characteristics[ch.id] ?? 0;
          return (
            <div className="char" key={ch.id}>
              <span>{ch.name}<span className="abbr">{ch.abbreviation}</span></span>
              <span className="stepper">
                <span className="limit-control" tabIndex={v<=min?0:undefined} title={characteristicLimitHint(ch.id,"lower",rules,c.type)}>
                  <button disabled={v<=min} aria-label={`lower ${ch.name}`} onClick={() => set(ch.id, v - 1)}>−</button>
                </span>
                <output>{v > 0 ? `+${v}` : v}</output>
                <span className="limit-control" tabIndex={v>=max?0:undefined} title={characteristicLimitHint(ch.id,"raise",rules,c.type)}>
                  <button disabled={v>=max} aria-label={`raise ${ch.name}`} onClick={() => set(ch.id, v + 1)}>+</button>
                </span>
              </span>
              <span className="cost">{cost[String(v)] ?? 0}</span>
              {!!validation.resolved.characteristicModifiers[ch.id] && <span className="characteristic-final">Final {validation.resolved.characteristics[ch.id]!>0?"+":""}{validation.resolved.characteristics[ch.id]} after Virtues / Flaws</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
