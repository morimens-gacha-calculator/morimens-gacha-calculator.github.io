import { useT } from "../i18n/index.js";
import { fmtInt } from "../model.js";

// "Calculating… about 12 s left [Cancel]". Shown for any running calculation; a short CSS
// fade-in keeps it from flashing on results that come back almost instantly.
export default function Progress({ engine, compact = false }) {
  const T = useT();
  const L = T.progress;
  if (engine.status !== "busy") return null;
  const p = engine.progress;
  const what = !p ? L.starting : p.phase === "build" ? L.preparing(fmtInt(p.states)) : p.phase === "reduce" ? L.simplifying(fmtInt(p.states))
    : p.phase === "budget" ? L.budget : L.calculating(fmtInt(p.pulls));
  return (
    <div className={`progress-box ${compact ? "is-compact" : ""}`} role="status">
      {!compact && <div className="spinner" aria-hidden="true" />}
      <span className="progress-text">
        <span>{what}</span>
        {p?.eta != null && <span className="muted"> · {L.eta(p.eta)}</span>}
      </span>
      {!compact && <button type="button" className="btn btn--small" onClick={engine.cancel}>{L.cancel}</button>}
    </div>
  );
}
