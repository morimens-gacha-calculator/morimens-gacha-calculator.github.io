import { useState } from "react";
import Dialog from "./Dialog.jsx";
import { allAlts, applyNames, cleanItem, itemNames, namesDiff, presets } from "../model.js";
import { useT } from "../i18n/index.js";

const FIRST = 8; // item names shown before "Show all"

// Edit names (from a banner plan's "⋯" menu): the plan's own name, its outcomes' names (their
// chances beside them) and its items' names. Only names change. A built-in banner keeps being
// that banner: the names are kept as your own on top of its names (model.js, applyNames), so its
// pity still carries over and "Restore names" brings its own back. Nothing is saved until Done.
export default function NamesDialog({ view, index, onSave, onClose }) {
  const T = useT();
  const N = T.names;
  const preset = presets()[view.preset];
  const [title, setTitle] = useState(view.title ?? "");
  // what's typed, as typed (an emptied field keeps its old name when saved)
  const initial = (banner) => {
    const all = allAlts(banner);
    return {
      out: Object.fromEntries(all.map((a) => [a.key, a.alt.name ?? ""])),
      items: Object.fromEntries(all.filter((a) => a.isPool).map((a) => [a.key, itemNames(a.alt)])),
    };
  };
  const [draft, setDraft] = useState(() => initial(view.banner));
  const [open, setOpen] = useState({}); // pools showing every name

  const alts = allAlts(view.banner);
  const setName = (key, name) => setDraft((d) => ({ ...d, out: { ...d.out, [key]: name } }));
  const setItem = (key, k, name) => setDraft((d) => {
    const list = d.items[key].slice();
    list[k] = name.replace(/,/g, " ");
    return { ...d, items: { ...d.items, [key]: list } };
  });
  const finished = () => {
    const out = structuredClone(view.banner);
    allAlts(out).forEach((a) => {
      const nm = String(draft.out[a.key] ?? "").trim();
      if (nm) a.alt.name = nm;
      if (a.isPool) {
        const old = itemNames(a.alt);
        a.alt.items = old.map((x, j) => cleanItem(draft.items[a.key]?.[j]) || x).join(", ");
      }
    });
    return out;
  };
  const save = () => {
    const out = finished();
    if (preset) {
      const names = namesDiff(preset.banner, out);
      onSave({ ...view, title: title.trim(), names, banner: applyNames(preset.banner, names) });
    } else {
      onSave({ ...view, title: title.trim(), banner: out });
    }
  };
  const restore = () => { setTitle(""); setDraft(initial(preset.banner)); };
  const rate = (a) => {
    const p = String(a.alt.p ?? "").trim();
    const shown = p.toLowerCase() === "rest" ? N.rest : p;
    return a.parentName ? N.rateOf(shown, a.parentName) : shown;
  };

  return (
    <Dialog title={N.title(index + 1)} closeLabel={N.close} onClose={onClose} onSubmit={save}
      foot={<>
        {preset && <button type="button" className="btn btn--secondary" onClick={restore}>{N.restore}</button>}
        <button type="submit" className="btn btn--primary">{N.done}</button>
      </>}>
      <label className="names-field">
        <span className="names-label">{N.planName}</span>
        <input className="custom-input s-field" value={title} maxLength={80} autoFocus
          placeholder={preset?.title ?? T.app.customBanner} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <div className="names-field">
        <span className="names-label">{N.outcomes}</span>
        <div className="names-tree">
          {alts.map((a) => (
            <div key={a.key} className="names-out" style={{ "--depth": a.depth }}>
              <input className="custom-input s-field" value={draft.out[a.key] ?? ""} maxLength={60} aria-label={`${N.outcomes}: ${a.label}`}
                onChange={(e) => setName(a.key, e.target.value)} />
              <span className="names-rate">{rate(a)}</span>
            </div>
          ))}
        </div>
      </div>
      {alts.filter((a) => a.isPool).map((a) => {
        const list = draft.items[a.key] ?? itemNames(a.alt);
        const all = open[a.key] || list.length <= FIRST + 1;
        return (
          <div key={`i${a.key}`} className="names-field">
            <span className="names-label">{N.items(String(draft.out[a.key] ?? "").trim() || a.name, list.length)}</span>
            <div className="names-items">
              {(all ? list : list.slice(0, FIRST)).map((nm, k) => (
                <input key={k} className="custom-input s-field" value={nm} maxLength={60} aria-label={`${a.name} ${k + 1}`}
                  onChange={(e) => setItem(a.key, k, e.target.value)} />
              ))}
            </div>
            {list.length > FIRST + 1 && (
              <button type="button" className="btn btn--quiet btn--sm names-more" onClick={() => setOpen((o) => ({ ...o, [a.key]: !all }))}>
                {all ? N.showFewer : N.showAll(list.length)}
              </button>
            )}
          </div>
        );
      })}
      <p className="s-hint">{N.note}</p>
    </Dialog>
  );
}
