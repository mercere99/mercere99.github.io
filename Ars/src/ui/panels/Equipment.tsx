import { newKey, type EquipmentItem } from "../../model/character";
import type { PanelProps } from "../Workbench";

export function Equipment({ character: c, onChange }: PanelProps) {
  const patch = (key: string, changes: Partial<EquipmentItem>) =>
    onChange({ ...c, equipment: c.equipment.map((item) => item.key === key ? { ...item, ...changes } : item) });
  const load = c.equipment.reduce((total, item) => total + item.load, 0);
  return <div className="panel">
    <header><h2>Equipment</h2><span className="tally">Carried load {load}</span></header>
    <p className="help">All listed items are carried. Mark items equipped by default to show their effect reminders prominently. Combat modifiers and encumbrance are adjudicated manually.</p>
    {c.equipment.map((item) => <div className="equipment-entry" key={item.key}>
      <div className="field"><label htmlFor={`item-name-${item.key}`}>Item</label>
        <input id={`item-name-${item.key}`} value={item.name} onChange={(e) => patch(item.key, { name: e.target.value })} /></div>
      <div className="field"><label htmlFor={`item-type-${item.key}`}>Type</label>
        <select id={`item-type-${item.key}`} value={item.type} onChange={(e) => patch(item.key, { type: e.target.value as EquipmentItem["type"] })}>
          <option value="item">Item</option><option value="weapon">Weapon</option><option value="armor">Armor</option>
        </select></div>
      <div className="field"><label htmlFor={`item-load-${item.key}`}>Load</label>
        <input id={`item-load-${item.key}`} type="number" min={0} step="any" value={item.load}
          onChange={(e) => patch(item.key, { load: Math.max(0, e.target.valueAsNumber || 0) })} /></div>
      <div className="field"><label htmlFor={`item-equipped-${item.key}`}>Equipped by default</label>
        <input id={`item-equipped-${item.key}`} type="checkbox" checked={item.equipped} onChange={(e) => patch(item.key, { equipped: e.target.checked })} /></div>
      <div className="field"><label htmlFor={`item-description-${item.key}`}>Description</label>
        <textarea id={`item-description-${item.key}`} rows={2} value={item.description} onChange={(e) => patch(item.key, { description: e.target.value })} /></div>
      <div className="field"><label htmlFor={`item-effects-${item.key}`}>Effects when equipped</label>
        <textarea id={`item-effects-${item.key}`} rows={2} value={item.effects} placeholder="e.g. +3 Soak; remember the armor's combat effects"
          onChange={(e) => patch(item.key, { effects: e.target.value })} /></div>
      <button className="btn bare small" onClick={() => onChange({ ...c, equipment: c.equipment.filter((i) => i.key !== item.key) })}>Remove item</button>
    </div>)}
    <button className="btn small" onClick={() => onChange({ ...c, equipment: [...c.equipment, {
      key: newKey(), name: "", type: "item", load: 0, equipped: false, description: "", effects: "",
    }] })}>Add equipment</button>
  </div>;
}
