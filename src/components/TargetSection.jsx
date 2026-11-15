import { HelpButton } from "./Help.jsx";
import { useT, errorText } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import { fmtInt, fmtPct } from "../model.js";

// The two questions: chance from a budget, or pulls for a chance.
// Input on the left, answer on the right, both the same height with their units inside.
export default function TargetSection({ state, update, engine }) {
  const T = useT();
  const L = T.target;
  const r = engine.result;
  const busy = engine.status === "busy";
  const budgetMode = state.mode === "budget";
  const setMode = (mode) => update((s) => ({ ...s, mode }));

  let answer = "-", unit = null;
  if (r && budgetMode && r.budget) answer = fmtPct(r.budget.chanceGoal);
  if (r && !budgetMode) {
    if (r.requiredPulls != null) { answer = fmtInt(r.requiredPulls); unit = L.pullsWord(r.requiredPulls); }
    else if (state.desired >= 100) answer = L.never;
  }

  return (
    <section className="target-section" aria-label={L.label}>
      <div className="target-header">
        <div className="mode-toggle" role="tablist" aria-label={L.modes}>
          <button type="button" role="tab" aria-selected={budgetMode} className={`mode-tab ${budgetMode ? "is-active" : ""}`} onClick={() => setMode("budget")}>
            {L.budgetMode}
          </button>
          <button type="button" role="tab" aria-selected={!budgetMode} className={`mode-tab ${!budgetMode ? "is-active" : ""}`} onClick={() => setMode("pulls")}>
            {L.pullsMode}
          </button>
        </div>
        <HelpButton label={L.helpLabel} text={L.help} />
      </div>

      <div className="target-body">
        <label className="target-cell">
          <span className="field-label">{budgetMode ? L.pullsYouHave : L.desired}</span>
          <span className="affix-box">
            {budgetMode
              ? <NumberInput className="affix-input" min={0} placeholder="0" value={state.budget ?? 0} onChange={(v) => update((s) => ({ ...s, budget: v }))} />
              : <NumberInput className="affix-input" min={1} max={100} fallback={90} integer={false} value={state.desired} onChange={(v) => update((s) => ({ ...s, desired: v }))} />}
            <span className="affix">{budgetMode ? L.pullsWord(state.budget ?? 0) : "%"}</span>
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
      {r && budgetMode && r.min != null && (state.budget ?? 0) < r.min && engine.status !== "busy" && (
        <p className="note-box" role="status">{L.notPossible(fmtInt(r.min))}</p>
      )}
      {engine.status === "error" && <p className="error-box" role="alert">{errorText(T, engine)}</p>}
      {engine.status === "cancelled" && <p className="note-box" role="status">{T.progress.cancelled}</p>}
    </section>
  );
}
