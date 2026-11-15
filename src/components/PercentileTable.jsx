import { useT } from "../i18n/index.js";
import { fmtInt, fmtNum } from "../model.js";

export default function PercentileTable({ engine, settings }) {
  const L = useT().pct;
  const r = engine.result;
  if (!r) return null;
  const rows = [];
  if (r.min != null && settings?.showBest !== false) rows.push([L.earliest, fmtInt(r.min)]);
  rows.push(...Object.entries(r.percentiles).map(([k, v]) => [L.row(k.slice(1)), fmtInt(v)]));
  rows.push([L.average, fmtNum(r.mean)]);
  if (r.max != null && settings?.showWorst !== false) rows.push([L.guaranteed, fmtInt(r.max)]);
  const ms = engine.ms ?? r.ms;
  const time = ms >= 1000 ? L.timeS(fmtNum(ms / 1000, 1)) : L.timeMs(fmtInt(Math.max(1, Math.round(ms))));
  return (
    <section className="table-section" aria-labelledby="pct-h">
      <div className="table-header-line"><h2 id="pct-h">{L.title}</h2></div>
      <table className="probability-table pct-table">
        <thead><tr><th>{L.chanceCol}</th><th className="num">{L.needCol}</th></tr></thead>
        <tbody>{rows.map(([a, b]) => <tr key={a}><td>{a}</td><td className="num">{b}</td></tr>)}</tbody>
      </table>
      <p className="muted small">
        {L.footer(time, fmtInt(r.states))}
      </p>
    </section>
  );
}
