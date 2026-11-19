import { HelpButton } from "./Help.jsx";
import { useT, errorText } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import { fmtInt, fmtPct } from "../model.js";

// The two questions: chance from a budget, or pulls for a chance.
// Input on the left, answer on the right, both the same height with their units inside.
// Several banners in one plan: stacked shows how the pulls are spent (one budget, or each banner its
// own). With each banner plan on its own pulls there's no "pulls needed": the field is the pulls of the
// selected banner (stage: { index, view, update }) and the answer is the chance for the whole plan.
export default function TargetSection({ state, update, engine, stacked = false, stage = null }) {
  const T = useT();
  const L = T.target;
  const r = engine.result;
  const busy = engine.status === "busy";
  const fixed = stacked && state.spend === "fixed";
  const budgetMode = fixed || state.mode === "budget";
  const setMode = (mode) => update((s) => ({ ...s, mode }));
  const G = T.stages;

  let answer = "-", unit = null;
  if (r && budgetMode && r.budget) answer = fmtPct(r.budget.chanceGoal);
  if (r && fixed && r.spend === "fixed") answer = fmtPct(r.chanceAll);
  if (r && !budgetMode) {
    if (r.requiredPulls != null) { answer = fmtInt(r.requiredPulls); unit = L.pullsWord(r.requiredPulls); }
    else if (state.desired >= 100) answer = L.never;
  }

  return (
    <section className="target-section" aria-label={L.label}>
      {stacked && (
        <div className="target-spend">
          <div className="s-eyebrow-row">
            <span className="field-label" id="t-spend">{G.spendLabel}</span>
            <HelpButton label={G.spendLabel} text={G.spendHelp} />
          </div>
          <div className="mode-toggle" role="group" aria-labelledby="t-spend">
            {[["shared", G.spendShared], ["fixed", G.spendFixed]].map(([v, label]) => (
              <button key={v} type="button" aria-pressed={(state.spend ?? "shared") === v} className={`mode-tab ${(state.spend ?? "shared") === v ? "is-active" : ""}`}
                onClick={() => update((s) => ({ ...s, spend: v, ...(v === "fixed" ? { mode: "budget" } : {}) }))}>{label}</button>
            ))}
          </div>
        </div>
      )}
      {!fixed && <div className="target-header">
        <div className="mode-toggle" role="tablist" aria-label={L.modes}>
          <button type="button" role="tab" aria-selected={budgetMode} className={`mode-tab ${budgetMode ? "is-active" : ""}`} onClick={() => setMode("budget")}>
            {L.budgetMode}
          </button>
          <button type="button" role="tab" aria-selected={!budgetMode} className={`mode-tab ${!budgetMode ? "is-active" : ""}`} onClick={() => setMode("pulls")}>
            {L.pullsMode}
          </button>
        </div>
        <HelpButton label={L.helpLabel} text={L.help} />
      </div>}

      <div className="target-body">
        <label className="target-cell">
          <span className="field-label">{fixed && stage ? G.pullsOnBanner(stage.index + 1) : budgetMode ? L.pullsYouHave : L.desired}</span>
          <span className="affix-box">
            {fixed && stage
              ? <NumberInput className="affix-input" min={0} placeholder="0" value={stage.view.budget ?? 0} onChange={(v) => stage.update((s) => ({ ...s, budget: v }))} />
              : budgetMode
              ? <NumberInput className="affix-input" min={0} placeholder="0" value={state.budget ?? 0} onChange={(v) => update((s) => ({ ...s, budget: v }))} />
              : <NumberInput className="affix-input" min={1} max={100} fallback={90} integer={false} value={state.desired} onChange={(v) => update((s) => ({ ...s, desired: v }))} />}
            <span className="affix">{fixed && stage ? L.pullsWord(stage.view.budget ?? 0) : budgetMode ? L.pullsWord(state.budget ?? 0) : "%"}</span>
          </span>
        </label>
        <span className="target-arrow" aria-hidden="true">→</span>
        <div className={`target-cell ${busy ? "is-busy" : ""}`}>
          <span className="field-label">{budgetMode ? L.chanceAll : L.required}</span>
          <output className="answer-box">
            <span className="answer-value">{answer}</span>
            {unit && <span className="affix">{unit}</span>}
          </output>
        </div>
      </div>
      {r && budgetMode && !fixed && r.min != null && (state.budget ?? 0) < r.min && engine.status !== "busy" && (
        <p className="note-box" role="status">{L.notPossible(fmtInt(r.min))}</p>
      )}
      {engine.status === "error" && <p className="error-box" role="alert">{errorText(T, engine)}</p>}
      {engine.status === "cancelled" && <p className="note-box" role="status">{T.progress.cancelled}</p>}
    </section>
  );
}
