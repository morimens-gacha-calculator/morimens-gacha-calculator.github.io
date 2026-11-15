import { HelpButton } from "./Help.jsx";
import { useT } from "../i18n/index.js";
import { fmtInt, fmtNum, fmtPct } from "../model.js";

// After N pulls: the chance of each result, for each row of the pull plan
export default function Distribution({ state, engine }) {
  const T = useT();
  const L = T.dist;
  const b = engine.result?.budget;
  if (!b) return null;
  const unit = (q) => (q.type !== "distinct" ? T.units.copies : T.units.itemsWith(q.copies));
  return (
    <section className={`dist-section ${engine.status === "busy" ? "is-busy" : ""}`} aria-labelledby="dist-h">
      <div className="table-header-line">
        <h2 id="dist-h">{L.title(fmtInt(b.pulls))}</h2>
        <HelpButton label={L.helpLabel} text={L.help} />
      </div>
      <div className="dist-grid">
        {b.requirements.map((q, i) => {
          const rows = [];
          for (let v = q.dist.length - 1; v >= 0; v--) {
            if (q.dist[v] < 0.00005 && v !== q.target) continue;
            const top = v === q.dist.length - 1 && q.dist.length > 1 && q.type !== "distinct";
            rows.push({ v, p: q.dist[v], label: `${fmtInt(v)}${top ? "+" : ""}`, met: v >= q.target });
          }
          return (
            <div className="dist-card" key={i}>
              <div className="dist-head">
                <b>{q.label}</b>
                <span className="muted small">{L.expected(fmtNum(q.mean), fmtPct(q.chanceMet))}</span>
              </div>
              <table className="probability-table">
                <thead><tr><th className="const-col">{q.type !== "distinct" ? L.copies : L.itemsDone}</th><th>{L.probability}</th></tr></thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.v} className={row.met ? "is-met" : ""}>
                      <td>{row.label}{row.v === q.target ? ` ${L.goal}` : ""}</td>
                      <td>
                        <div className="progress-container" title={`${unit(q)}: ${fmtPct(row.p)}`}>
                          <div className="progress-bar" style={{ width: `${Math.max(0.5, row.p * 100)}%` }} />
                          <span className="progress-label">{fmtPct(row.p)}</span>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      {b.requirements.length > 1 && (
        <p className="muted small">{state.goalMode === "all" ? L.allRows(fmtPct(b.chanceGoal)) : L.anyRow(fmtPct(b.chanceGoal))}</p>
      )}
    </section>
  );
}
