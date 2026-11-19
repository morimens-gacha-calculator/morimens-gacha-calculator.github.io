import { useEffect, useState } from "react";
import { allAlts, allNodes, num, sharesPity, stageUpdate } from "../model.js";
import { useT } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import { HelpButton } from "./Help.jsx";
import { PlanRow, PlanTabs } from "./PlanTabs.jsx";
import { Goals, StartQuestions, examplesFor } from "./Goals.jsx";
import PullPlan from "./PullPlan.jsx";
import { PityPanel } from "./PlanParts.jsx";

// The plan card, the same in both views: the banner plan switch and "+ Add banner plan", the
// selected plan's banner row, then I want · Pity · Your pulls. The simple view asks in sentences
// and questions; the full view shows the plan rows and the pity table in the same places, and
// a switch between "chance from my pulls" and "pulls needed".
export default function PlanCard({ state, update, plans, full, firstVisit, onExampleDone }) {
  const T = useT();
  const S = T.simple, G = T.stages;
  const views = plans.views;
  const sel = plans.selected;
  const view = views[sel];
  const su = stageUpdate(update, sel);
  const stacked = views.length > 1;
  const fixed = stacked && state.spend === "fixed";
  const carries = sel > 0 && sharesPity(views[sel - 1], view);
  const hasPity = allAlts(view.banner).some((a) => num(a.alt.pity) > 0) || allNodes(view.banner).some((n) => n.node.streak > 0);

  // the pulls field: empty = "how many do I need" (pulls mode), a number = "do I have enough"
  const [pullsText, setPullsText] = useState(state.mode === "budget" ? String(state.budget) : "");
  useEffect(() => { setPullsText(state.mode === "budget" ? String(state.budget) : ""); }, [state.mode, state.budget]);
  const onPulls = (text) => {
    setPullsText(text);
    if (text.trim() === "") { update((s) => ({ ...s, mode: "pulls" })); return; }
    const v = Math.floor(Number(text));
    if (Number.isFinite(v) && v >= 0) update((s) => ({ ...s, mode: "budget", budget: v }));
  };
  const examples = firstVisit && !full ? examplesFor(view.banner, S) : [];
  const pick = (ex) => {
    su((s) => ({ ...s, goal: ex.goal, goalMode: "all" }));
    update((s) => ({ ...s, mode: ex.mode, budget: ex.budget ?? s.budget }));
    onExampleDone();
  };

  return (
    <section className="s-card s-plan" aria-label={S.planLabel}>
      <PlanTabs plans={plans} />
      <PlanRow plans={plans} />
      {examples.length > 0 && (
        <div className="s-examples">
          <p className="s-examples-title">{S.tryOne}</p>
          {examples.map((ex) => <button key={ex.label} type="button" className="s-example" onClick={() => pick(ex)}>{ex.label}</button>)}
          <button type="button" className="btn btn--link" onClick={onExampleDone}>{S.ownQuestion}</button>
        </div>
      )}

      <div className="s-divider" />
      <h2 className="s-lead">{S.iWant}{full && <HelpButton label={T.plan.title} text={T.plan.help} />}</h2>
      {full ? <PullPlan key={sel} state={view} update={su} /> : <Goals key={sel} state={view} update={su} />}

      <div className="s-divider" />
      <h2 className="s-lead">{S.pityTitle}</h2>
      {carries ? (
        <p className="s-carry">
          <span>{G.carries(sel)}</span>
          <HelpButton label={G.carries(sel)} text={G.carriesHelp(sel)} />
        </p>
      ) : !hasPity ? (
        <p className="s-hint">{T.pity.none}</p>
      ) : full ? <PityPanel state={view} update={su} /> : <StartQuestions state={view} update={su} />}

      <div className="s-divider" />
      <div className="s-spend">
        <div className="s-eyebrow-row">
          <span className="s-eyebrow" id="s-spend">{G.spendLabel}</span>
          {stacked && <HelpButton label={G.spendLabel} text={G.spendHelp} />}
        </div>
        {stacked && (
          <span className="seg seg--full" role="group" aria-labelledby="s-spend">
            {[["shared", G.spendShared], ["fixed", G.spendFixed]].map(([v, label]) => (
              <button key={v} type="button" aria-pressed={(state.spend ?? "shared") === v} className={(state.spend ?? "shared") === v ? "is-on" : ""}
                onClick={() => update((s) => ({ ...s, spend: v, ...(v === "fixed" ? { mode: "budget" } : {}) }))}>{label}</button>
            ))}
          </span>
        )}
        {full && !fixed && (
          <span className="seg seg--full" role="group" aria-label={T.target.modes}>
            {[["budget", T.target.budgetMode], ["pulls", T.target.pullsMode]].map(([m, label]) => (
              <button key={m} type="button" aria-pressed={state.mode === m} className={state.mode === m ? "is-on" : ""}
                onClick={() => update((s) => ({ ...s, mode: m }))}>{label}</button>
            ))}
          </span>
        )}
      </div>
      {fixed ? (
        <div className="s-row">
          <label className="s-row-label">
            <span>{G.pullsOn}</span>
            <NumberInput className="custom-input s-field s-num s-pulls" min={0} placeholder="0" value={view.budget || ""} onChange={(v) => su((s) => ({ ...s, budget: v || 0 }))} />
            <span>{S.pulls}</span>
          </label>
        </div>
      ) : (!full || state.mode === "budget") && (
        <div className="s-row">
          <label className="s-row-label">
            <span>{S.iHave}</span>
            <input type="number" inputMode="numeric" min={0} className="custom-input s-field s-num s-pulls" value={pullsText}
              placeholder="?" onChange={(e) => onPulls(e.target.value)} />
            <span>{S.pulls}</span>
          </label>
          <HelpButton label={S.iHave} text={stacked ? G.pullsHelpShared : S.pullsHelp} />
        </div>
      )}
    </section>
  );
}
