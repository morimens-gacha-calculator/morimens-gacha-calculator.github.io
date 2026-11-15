import { HelpButton } from "./Help.jsx";
import { useT } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import Progress from "./Progress.jsx";
import { allAlts, itemNames, newId, num } from "../model.js";

// The pull plan: one row per thing you want
export default function PullPlan({ state, update, onCalculate, onAddCompare, note, engine }) {
  const T = useT();
  const L = T.plan;
  const TYPES = { total: L.typeTotal, specific: L.typeSpecific, distinct: L.typeDistinct };
  const alts = allAlts(state.banner);
  const setRow = (id, patch) => update((s) => ({ ...s, goal: s.goal.map((r) => (r.id === id ? fix({ ...r, ...patch }, alts) : r)) }));
  const removeRow = (id) => update((s) => ({ ...s, goal: s.goal.filter((r) => r.id !== id) }));
  const addRow = () => update((s) => {
    const last = s.goal[s.goal.length - 1];
    const next = last ? { ...last, id: newId(), from: "" } : { id: newId(), path: alts[0]?.key ?? "0", type: "total", item: 0, k: 1, copies: 1, from: "" };
    // A new "specific" row starts on the next item, so "7 of A, then 1 of B" is one click away
    if (next.type === "specific") {
      const a = alts.find((x) => x.key === next.path);
      const used = new Set(s.goal.filter((r) => r.path === next.path && r.type === "specific").map((r) => r.item ?? 0));
      const free = a ? itemNames(a.alt).findIndex((_, i) => !used.has(i)) : -1;
      if (free >= 0) next.item = free;
      next.copies = 1;
    }
    return { ...s, goal: [...s.goal, next] };
  });

  return (
    <div className="pull-plan-section">
      <div className="section-title">
        <h2>{L.title}</h2>
        <HelpButton label={L.title} text={L.help} />
      </div>
      <div className="rows-container">
        {state.goal.length === 0 && (
          <p className="empty-plan">{L.empty}</p>
        )}
        {state.goal.map((r) => {
          const a = alts.find((x) => x.key === r.path);
          const isPool = !!a?.isPool;
          const names = a ? itemNames(a.alt) : [];
          const dupItem = r.type === "specific" && state.goal.some((q) => q !== r && q.type === "specific" && q.path === r.path && (q.item ?? 0) === (r.item ?? 0));
          return (
            <div className="plan-row" key={r.id}>
              <label className="field grow">
                <span className="field-label">{L.outcome}</span>
                <select className="select" value={r.path} onChange={(e) => setRow(r.id, { path: e.target.value })}>
                  {alts.map((x) => (
                    <option key={x.key} value={x.key}>{"  ".repeat(x.depth)}{x.name}{x.isPool ? ` (${x.alt.count})` : ""}</option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span className="field-label">{L.what}</span>
                <select className="select" value={r.type} onChange={(e) => setRow(r.id, { type: e.target.value })}>
                  {Object.entries(TYPES).filter(([t]) => t !== "specific" || isPool).map(([t, txt]) => <option key={t} value={t}>{txt}</option>)}
                </select>
              </label>
              {r.type === "specific" && (
                <label className="field">
                  <span className="field-label">{L.item}</span>
                  <select className={`select ${dupItem ? "is-invalid" : ""}`} value={r.item ?? 0} onChange={(e) => setRow(r.id, { item: Number(e.target.value) })}>
                    {names.map((n, i) => <option key={i} value={i}>{n}</option>)}
                  </select>
                </label>
              )}
              {r.type === "distinct" && (
                <label className="field">
                  <span className="field-label">{L.howMany}</span>
                  <NumberInput min={1} className="custom-input w-xs" value={r.k} onChange={(v) => setRow(r.id, { k: v })} />
                </label>
              )}
              <div className="paths">
                <label className="field">
                  <span className="field-label">{r.type === "distinct" ? L.havePerItem : L.have}</span>
                  {r.type === "distinct" && isPool
                    ? <input type="text" className="custom-input w-m" placeholder={names.slice(0, 5).map(() => 0).join(",")} value={r.from} onChange={(e) => setRow(r.id, { from: e.target.value })} aria-label={L.havePerItemLabel} />
                    : <input type="number" min="0" className="custom-input w-xs" placeholder="0" value={r.from} onChange={(e) => setRow(r.id, { from: e.target.value })} />}
                </label>
                <span className="arrow" aria-hidden="true">→</span>
                <label className="field">
                  <span className="field-label">{r.type === "distinct" ? L.wantEach : L.want}</span>
                  <NumberInput min={1} className="custom-input w-xs" value={r.copies} onChange={(v) => setRow(r.id, { copies: v })} />
                </label>
              </div>
              <button type="button" className="btn btn--delete" onClick={() => removeRow(r.id)} aria-label={L.removeRow} disabled={state.goal.length <= 1}>×</button>
              {dupItem && <p className="row-note">{L.dupItem(names[r.item ?? 0])}</p>}
            </div>
          );
        })}
      </div>
      <button type="button" className="add-row-btn" onClick={addRow}>+ {L.addRow}</button>
      {state.goal.length > 1 && (
        <label className="inline-field plan-mode">
          {L.doneWhen}
          <select className="select" value={state.goalMode} onChange={(e) => update((s) => ({ ...s, goalMode: e.target.value }))}>
            <option value="all">{L.all}</option>
            <option value="any">{L.any}</option>
          </select>
        </label>
      )}
      <div className="plan-buttons">
        <button type="button" className="btn btn--soft" onClick={onAddCompare} disabled={!state.goal.length}>{L.addToCompare}</button>
        {engine.status === "busy"
          ? <button type="button" className="btn btn--calculate btn--cancel" onClick={engine.cancel}>{T.progress.cancel}</button>
          : <button type="button" className="btn btn--calculate" onClick={onCalculate}>{L.calculate}</button>}
      </div>
      {engine.status === "busy" && <Progress engine={engine} compact />}
      {note && <p className="muted small plan-note" role="status">{note}</p>}
    </div>
  );
}

// Keep a row consistent with what its outcome allows
function fix(r, alts) {
  const a = alts.find((x) => x.key === r.path);
  if (r.type === "specific" && !a?.isPool) r.type = "total";
  if (r.type === "specific" && a && (r.item ?? 0) >= num(a.alt.count, 1)) r.item = 0;
  return r;
}
