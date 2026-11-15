import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.js";

// "From: All 15 ▾" — choose which items of a pool a row counts.
// value = array of item indices, or null for "all items".
export default function ItemPicker({ names, value, onChange }) {
  const L = useT().plan;
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);

  const all = value == null;
  const chosen = all ? names.map((_, i) => i) : value;
  const set = new Set(chosen);
  const summary = all ? L.allItems(names.length)
    : chosen.length === 0 ? L.noneChosen
    : chosen.length <= 2 ? chosen.map((i) => names[i]).join(", ")
    : L.chosen(chosen.length);
  const toggle = (i) => {
    const next = set.has(i) ? chosen.filter((x) => x !== i) : [...chosen, i].sort((a, b) => a - b);
    onChange(next.length === names.length ? null : next);
  };

  return (
    <div className="item-picker" ref={ref}>
      <button type="button" className={`select picker-btn ${!all && chosen.length === 0 ? "is-invalid" : ""}`} aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="picker-btn-text">{summary}</span>
      </button>
      {open && (
        <div className="lines-pop item-pop" role="dialog" aria-label={L.pickTitle}>
          <div className="item-pop-head">
            <span className="lines-title">{L.pickTitle}</span>
            <span className="row">
              <button type="button" className="btn btn--small" onClick={() => onChange(null)}>{L.pickAll}</button>
              <button type="button" className="btn btn--small" onClick={() => onChange([])}>{L.pickNone}</button>
            </span>
          </div>
          <div className="item-list">
            {names.map((n, i) => (
              <label className="check" key={i}>
                <input type="checkbox" checked={set.has(i)} onChange={() => toggle(i)} />
                {n}
              </label>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}