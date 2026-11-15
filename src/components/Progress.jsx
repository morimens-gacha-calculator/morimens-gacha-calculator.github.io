import { useT } from "../i18n/index.js";
import { fmtInt } from "../model.js";

// "Step 2 of 4 · Calculating… SSR 250 · about 3 s for this step [Cancel]". Shown for any running
// calculation; a short CSS fade-in keeps it from flashing on results that come back almost instantly.
export default function Progress({ engine, compact = false }) {
  const T = useT();
  const L = T.progress;
  if (engine.status !== "busy") return null;
  const p = engine.progress;
  const what = !p ? L.starting
    : p.phase === "plan" ? (p.total > 1 ? L.planningOf(p.done + 1, p.total) : L.planning)
    : p.phase === "build" ? L.preparing(fmtInt(p.states))
    : p.phase === "reduce" ? L.simplifying(fmtInt(p.states))
    : p.phase === "events" ? (p.name ? L.events(p.name, fmtInt(p.t)) : L.calculating(fmtInt(p.t)))
    : p.phase === "combine" ? L.combining
    : p.phase === "budget" ? L.budget
    : L.calculating(fmtInt(p.t));
  const laterSteps = p?.steps != null && p.step < p.steps;
  return (
    <div className={`progress-box ${compact ? "is-compact" : ""}`} role="status">
      {!compact && <div className="spinner" aria-hidden="true" />}
      <span className="progress-text">
        {p?.steps != null && <span className="muted">{L.step(p.step, p.steps)} · </span>}
        <span>{what}</span>
        {p?.eta != null && <span className="muted"> · {laterSteps ? L.etaStep(p.eta) : L.eta(p.eta)}</span>}
      </span>
      {!compact && <button type="button" className="btn btn--small" onClick={engine.cancel}>{L.cancel}</button>}
    </div>
  );
}
