import { useEffect, useId, useMemo, useRef, useState } from "react";
import { searchItems } from "./search";

export interface PickerItem {
  id: string;
  label: string;
  meta?: string;
  description?: string;
  /** Shown but not selectable, with a reason. Used for entries the rules forbid. */
  blocked?: string;
  search: string;
}

/**
 * Type-to-search over a list. Blocked items stay visible with their reason —
 * hiding them would make the rules invisible, and the user may want to take
 * one deliberately and then override the finding.
 */
export function Picker(props: {
  placeholder: string;
  items: PickerItem[];
  onPick: (id: string) => void;
}) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  const listId = useId();

  const results = useMemo(() => {
    return searchItems(props.items, q).slice(0, 40);
  }, [q, props.items]);

  useEffect(() => setCursor(0), [q, props.items]);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  function pick(it: PickerItem) {
    if (it.blocked) return;
    props.onPick(it.id);
    setQ("");
    setOpen(false);
  }

  return (
    <div className="picker" ref={box}>
      <input
        value={q}
        placeholder={props.placeholder}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor((c) => Math.max(0, Math.min(c + 1, results.length - 1))); }
          if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
          if (e.key === "Enter" && open && results[cursor]) { e.preventDefault(); pick(results[cursor]!); }
          if (e.key === "Escape") setOpen(false);
        }}
        aria-autocomplete="list"
        role="combobox"
        aria-label={props.placeholder}
        aria-expanded={open && results.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && results[cursor] ? `${listId}-${cursor}` : undefined}
      />
      {open && results.length > 0 && (
        <ul id={listId} className="results" role="listbox">
          {results.map((it, i) => (
            <li
              key={it.id}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === cursor}
              aria-disabled={!!it.blocked}
              className={it.blocked ? "blocked" : undefined}
              onMouseEnter={() => setCursor(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(it); }}
              title={[it.blocked,it.description].filter(Boolean).join("\n\n")||undefined}
            >
              <span>{it.label}</span>
              <span className="meta">{it.blocked ?? it.meta}</span>
            </li>
          ))}
        </ul>
      )}
      {open && q.trim() && results.length === 0 && <p className="help" role="status">No matching entries.</p>}
    </div>
  );
}
