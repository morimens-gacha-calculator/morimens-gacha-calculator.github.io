import { fmtInt, fmtNum } from "../model.js";
import { Term } from "./Help.jsx";
import { useT } from "../i18n/index.js";

export default function StatsRow({ engine, settings }) {
  const T = useT();
  const L = T.stats;
  // with the technical wording, each term explains itself on hover or tap
  const term = (label, explain) => (T.simpleWording ? label : <Term label={label} explain={explain} />);
  const r = engine.result;
  if (!r) return null;
  const tiles = [
    [term(L.average, T.terms.average), fmtNum(r.mean), L.averageSub(fmtNum(r.sd)), "avg"],
    [term(L.median, T.terms.median), fmtInt(r.median), L.medianSub, "med"],
    [term(L.p90, T.terms.p90), fmtInt(r.percentiles.p90 ?? null), L.pulls, "p90"],
    r.max != null && settings?.showWorst !== false
      ? [term(L.guaranteed, T.terms.guaranteed), fmtInt(r.max), L.guaranteedSub, "max"]
      : [term(L.p99, T.terms.p99), fmtInt(r.percentiles.p99 ?? null), settings?.showWorst === false ? L.pulls : r.maxKnown === false ? L.guaranteeUnknown : L.noGuarantee, "p99"],
  ];
  return (
    <div className={`stats-row ${engine.status === "busy" ? "is-busy" : ""}`}>
      {tiles.map(([k, v, s, id]) => (
        <div className="stat" key={id}>
          <span className="stat-label">{k}</span>
          <span className="stat-value">{v}</span>
          <span className="stat-sub">{s}</span>
        </div>
      ))}
    </div>
  );
}
