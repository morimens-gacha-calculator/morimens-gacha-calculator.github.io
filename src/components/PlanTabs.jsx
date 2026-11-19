import { useEffect, useRef, useState } from "react";
import { planTitle, presets } from "../model.js";
import { useT } from "../i18n/index.js";
import { HelpButton } from "./Help.jsx";
import { TrashIcon } from "./Icon.jsx";

// The plan's banner plans, the same in both views, at the top of the plan card: a switch
// (Banner plan 1 | Banner plan 2 | …, a plan you named shows its name) and "+ Add banner plan",
// then for the selected plan one row: its banner, a "?" with the banner's description and a "⋯"
// menu (Edit names, Reset this plan, Remove; the full view adds Banner rules, Import, Export).
// On phones the switch scrolls sideways.
//
// plans: { views, selected, select(i), add(), pick(i, key), reset(i), remove(i), editNames(i),
//          full, rules(i), importFile(), exportFile() }
export function PlanTabs({ plans }) {
  const G = useT().stages;
  const { views, selected } = plans;
  const tabsRef = useRef(null);
  // the selected tab stays in sight when the tabs scroll sideways (phones); only the tabs scroll
  useEffect(() => {
    const list = tabsRef.current?.querySelector(".bp-tabs-list");
    const el = list?.querySelector('[aria-selected="true"]');
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    const left = el.offsetLeft - list.offsetLeft, right = left + el.offsetWidth;
    if (left < list.scrollLeft) list.scrollLeft = left - 4;
    else if (right > list.scrollLeft + list.clientWidth) list.scrollLeft = right - list.clientWidth + 4;
  }, [selected, views.length]);
  return (
    <div className="bp-tabs" ref={tabsRef}>
      <div className="seg bp-tabs-list" role="tablist" aria-label={G.tabsLabel}>
        {views.map((v, i) => {
          const own = String(v.title ?? "").trim();
          return (
            <button key={i} type="button" role="tab" aria-selected={selected === i} className={`bp-tab ${selected === i ? "is-on" : ""}`}
              onClick={() => plans.select(i)} title={own ? `${G.banner(i + 1)}: ${own}` : planTitle(v)}>
              {own || G.banner(i + 1)}
            </button>
          );
        })}
      </div>
      <button type="button" className="btn btn--quiet btn--sm bp-add" onClick={plans.add} aria-label={G.addBanner}>
        +<span className="bp-add-long"> {G.addBanner}</span><span className="bp-add-short"> {G.addBannerShort}</span>
      </button>
    </div>
  );
}

export function PlanRow({ plans }) {
  const T = useT();
  const G = T.stages;
  const P = presets();
  const i = plans.selected;
  const v = plans.views[i];
  const n = i + 1;
  const hint = P[v.preset]?.hint ?? T.app.customHint;
  return (
    <div className="bp-row">
      <select className="select bp-select" value={P[v.preset] ? v.preset : "custom"} onChange={(e) => plans.pick(i, e.target.value)} aria-label={G.pickLabel(n)}>
        {Object.entries(P).map(([key, p]) => <option key={key} value={key}>{p.title}</option>)}
        <option value="custom">{T.app.customBanner}</option>
      </select>
      <HelpButton label={P[v.preset]?.title ?? T.app.customBanner} text={hint} />
      <PlanMenu label={G.menu(n)} items={[
        { key: "names", icon: "✎", label: G.editNames, onClick: () => plans.editNames(i) },
        ...(plans.full ? [
          { key: "rules", icon: "⚙", label: G.bannerRules, onClick: () => plans.rules(i) },
          { key: "import", icon: "↥", label: G.importData, onClick: plans.importFile },
          { key: "export", icon: "↧", label: G.exportData, onClick: plans.exportFile },
        ] : []),
        { key: "reset", icon: "↺", label: G.resetPlan, onClick: () => plans.reset(i) },
        ...(plans.views.length > 1 ? [{ key: "remove", icon: <TrashIcon size={15} />, label: G.removeBanner(n), onClick: () => plans.remove(i), danger: true }] : []),
      ]} />
    </div>
  );
}

// "⋯": a short menu; closes on a choice, a click outside or Escape
function PlanMenu({ label, items }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  const btnRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") { setOpen(false); btnRef.current?.focus(); } };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    boxRef.current?.querySelector('[role="menuitem"]')?.focus();
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);
  // arrow keys move between the choices
  const onKey = (e) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const all = [...boxRef.current.querySelectorAll('[role="menuitem"]')];
    const at = all.indexOf(document.activeElement);
    all[(at + (e.key === "ArrowDown" ? 1 : all.length - 1)) % all.length]?.focus();
  };
  return (
    <span className="bp-menu-box" ref={boxRef}>
      <button ref={btnRef} type="button" className="bp-more" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} onClick={() => setOpen((o) => !o)}>
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><circle cx="5" cy="12" r="2" fill="currentColor" /><circle cx="12" cy="12" r="2" fill="currentColor" /><circle cx="19" cy="12" r="2" fill="currentColor" /></svg>
      </button>
      {open && (
        <div className="bp-menu" role="menu" aria-label={label} onKeyDown={onKey}>
          {items.map((it) => (
            <button key={it.key} type="button" role="menuitem" className={`bp-menu-item ${it.danger ? "is-danger" : ""}`}
              onClick={() => { setOpen(false); it.onClick(); }}>
              <span className="bp-menu-icon" aria-hidden="true">{it.icon}</span>{it.label}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
