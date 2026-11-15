import { fmtInt, fmtNum } from "../model.js";
import { useT } from "../i18n/index.js";

export default function StatsRow({ engine }) {
  const L = useT().stats;
  const r = engine.result;
  if (!r) return null;
  const tiles = [
    [L.average, fmtNum(r.mean), L.averageSub(fmtNum(r.sd))],
    [L.median, fmtInt(r.median), L.medianSub],
    [L.p90, fmtInt(r.percentiles.p90 ?? null), L.pulls],
    r.max != null ? [L.guaranteed, fmtInt(r.max), L.guaranteedSub] : [L.p99, fmtInt(r.percentiles.p99 ?? null), L.noGuarantee],
  ];
  return (
    <div className={`stats-row ${engine.status === "busy" ? "is-busy" : ""}`}>
      {tiles.map(([k, v, s]) => (
        <div className="stat" key={k}>
          <span className="stat-label">{k}</span>
          <span className="stat-value">{v}</span>
          <span className="stat-sub">{s}</span>
        </div>
      ))}
    </div>
  );
}
