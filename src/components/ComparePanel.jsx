import { useMemo, useRef } from "react";
import { Line } from "react-chartjs-2";
import NumberInput from "./NumberInput.jsx";
import { TrashIcon } from "./Icon.jsx";
import { fmtInt, fmtNum, fmtPct } from "../model.js";
import { MarkerKey, downloadWithLabels, phoneLayout, sample, themeColors, usePhone, usePopup, yAxis } from "./ResultChart.jsx";
import { downloadCsv, fileName } from "../export.js";
import { useT, errorText } from "../i18n/index.js";

// The comparison, the same in both views: every saved plan's chance curve on one chart (and this
// plan as a dashed line while it isn't saved), and a list with Open and Remove. The simple view
// lists the average, 9 in 10 and the chance by your pull; the full view adds the median, the
// earliest and the guaranteed pull, and its names can be edited.
export default function ComparePanel({ items, results, budget, setBudget, remove, rename, load, theme, settings, current, full = false }) {
  const T = useT();
  const S = T.simple;
  const chartRef = useRef(null);
  const phone = usePhone();
  const rows = items.map((it, i) => {
    const res = results[it.id];
    const r = res?.status === "ok" ? res.result : null;
    const chance = r ? (budget < r.cdf.length ? r.cdf[budget] : 1 - r.tail) : null;
    return { it, i, res, r, chance };
  });
  const ready = rows.filter((x) => x.r);
  const means = [...ready.map((x) => x.r.mean), ...(current ? [current.mean] : [])];
  const at = (r) => (budget < r.cdf.length ? r.cdf[budget] : 1 - r.tail);
  const chances = [...ready.map((x) => at(x.r)), ...(current ? [at(current)] : [])];
  const bestChance = budget > 0 && chances.length > 1 ? Math.max(...chances) : null;
  const bestMean = means.length > 1 ? Math.min(...means) : null;
  const showBest = settings?.showBest !== false, showWorst = settings?.showWorst !== false;
  const L = T.compare;
  // the columns: the simple view's three, the full view's more; the best of each set off
  const cols = [
    { key: "avg", label: S.cmpAverage, get: (r) => (full ? fmtNum(r.mean) : fmtInt(r.mean)), best: (r) => r.mean === bestMean },
    ...(full ? [{ key: "med", label: L.median, get: (r) => fmtInt(r.median ?? null) }] : []),
    { key: "p90", label: full ? L.p90 : S.cmpNine, get: (r) => (r.percentiles?.p90 != null ? fmtInt(r.percentiles.p90) : "-") },
    ...(full && showBest ? [{ key: "min", label: L.best, get: (r) => (r.min != null ? fmtInt(r.min) : L.none) }] : []),
    ...(full && showWorst ? [{ key: "max", label: L.worst, get: (r) => (r.max != null ? fmtInt(r.max) : L.none) }] : []),
    { key: "at", label: S.cmpChance(fmtInt(budget)), get: (r) => fmtPct(at(r)), best: (r) => at(r) === bestChance },
  ];
  const chart = useMemo(() => {
    if (!ready.length && !current) return null;
    const C = themeColors();
    let xMax = 10;
    for (const r of [...ready.map((x) => x.r), ...(current ? [current] : [])]) {
      let x = r.cdf.length - 1;
      for (let t = 0; t < r.cdf.length; t++) if (r.cdf[t] >= 0.999) { x = t; break; }
      xMax = Math.max(xMax, x);
    }
    const datasets = ready.map(({ it, r, i }) => ({
      label: it.name, data: sample(r.cdf, xMax), borderColor: C.series[i % C.series.length],
      backgroundColor: C.series[i % C.series.length], borderWidth: 2, pointRadius: 0, borderDash: i >= C.series.length ? [6, 4] : [],
    }));
    if (current) datasets.push({ label: S.cmpCurrent, data: sample(current.cdf, xMax), borderColor: C.marker, backgroundColor: C.marker, borderWidth: 2, pointRadius: 0, borderDash: [5, 4] });
    return { C, xMax: Math.max(xMax, budget || 0), datasets };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, items, current, budget, theme, T]);

  return (
    <div className="s-compare">
      <div className="chart-toolbar">
        <label className="s-inline s-cmp-at">
          <span>{S.cmpMark}</span>
          <NumberInput className="custom-input s-field s-pulls" min={0} value={budget} onChange={setBudget} aria-label={S.cmpMark} />
        </label>
        <CompareExport rows={rows} ready={ready} budget={budget} chartRef={chartRef} showBest={showBest} showWorst={showWorst} />
      </div>
      {chart && (
        <div className="chart-container s-compare-chart">
          <Line
            ref={chartRef}
            data={{ datasets: chart.datasets }}
            options={{
              responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
              interaction: { mode: "index", intersect: false },
              layout: phoneLayout(phone),
              scales: {
                x: { type: "linear", min: 0, max: chart.xMax, title: { display: true, text: T.chart.xTitle, color: chart.C.tick }, ticks: { color: chart.C.tick, callback: (v) => fmtInt(v), maxTicksLimit: phone ? 5 : 8 }, grid: { color: chart.C.grid }, border: { color: chart.C.grid } },
                y: yAxis(phone, chart.C, (v) => `${Math.round(v * 100)}%`, { min: 0, max: 1 }),
              },
              plugins: {
                legend: { display: false },
                tooltip: { callbacks: { title: (it) => T.chart.pull(fmtInt(it[0]?.parsed.x)), label: (c) => `${c.dataset.label}: ${fmtPct(c.parsed.y)}` } },
                markers: { items: budget > 0 ? [{ x: budget, strong: true, color: chart.C.marker, bg: chart.C.inset, label: S.cmpLine(fmtInt(budget)) }] : [], labels: !phone },
              },
            }}
          />
        </div>
      )}
      {phone && chart && budget > 0 && <MarkerKey items={[{ x: budget, strong: true, color: chart.C.marker, label: S.cmpLine(fmtInt(budget)) }]} />}
      {items.length === 0 && <p className="s-hint">{S.compareEmpty}</p>}
      {items.length === 1 && !current && <p className="s-hint">{S.compareOne}</p>}
      {(items.length > 0 || current) && (
        <div className={`s-cmp ${full ? "is-full" : ""}`} role="table" aria-label={S.compareTitle} style={{ "--n": cols.length }}>
          <div className="s-cmp-row s-cmp-head" role="row">
            <span role="columnheader">{S.cmpPlan}</span>
            {cols.map((c) => <span key={c.key} role="columnheader" className="s-cmp-num">{c.label}</span>)}
            <span role="columnheader"><span className="sr-only">{T.compare.actions}</span></span>
          </div>
          {current && (
            <div className="s-cmp-row is-current" role="row">
              <span className="s-cmp-name" role="cell"><span className="swatch swatch--dashed" aria-hidden="true" /><span>{S.cmpCurrent}</span></span>
              {cols.map((c) => <Cell key={c.key} c={c} r={current} />)}
              <span role="cell" className="s-cmp-actions s-cmp-note">{S.cmpNotAdded}</span>
            </div>
          )}
          {rows.map(({ it, i, res, r }) => (
            <div key={it.id} className="s-cmp-row" role="row">
              <span className="s-cmp-name" role="cell">
                <span className="swatch" style={{ "--c": `var(--s${(i % 6) + 1})` }} aria-hidden="true" />
                {full
                  ? <input type="text" className="custom-input s-field s-cmp-input" value={it.name} onChange={(e) => rename(it.id, e.target.value)} aria-label={T.compare.nameLabel} />
                  : <span title={it.name}>{it.name}</span>}
              </span>
              {r ? cols.map((c) => <Cell key={c.key} c={c} r={r} />) : (
                <>
                  <span role="cell" className={`s-cmp-num s-cmp-wait ${res?.status === "error" ? "err-text" : "muted"}`}>{res?.status === "error" ? errorText(T, res) : T.compare.calculating}</span>
                  {cols.slice(1).map((c) => <span key={c.key} role="cell" />)}
                </>
              )}
              <span className="s-cmp-actions" role="cell">
                <button type="button" className="btn btn--quiet btn--sm" onClick={() => load(it)}>{S.cmpOpen}</button>
                <button type="button" className="s-remove" onClick={() => remove(it.id)} aria-label={T.compare.remove(it.name)} title={T.compare.remove(it.name)}><TrashIcon /></button>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// "Export ▾" for the comparison: the table and the chance curves as CSV, the chart as PNG
export function CompareExport({ rows, ready, budget, chartRef, showBest, showWorst, buttonClass = "btn btn--sm", up = false }) {
  const T = useT();
  const L = T.compare;
  const { open, setOpen, ref } = usePopup();
  const run = (fn) => { setOpen(false); fn(); };
  const table = () => [
    [L.setup, L.average, L.median, L.p90, ...(showBest ? [L.best] : []), ...(showWorst ? [L.worst] : []), L.withinN(budget)],
    ...rows.map(({ it, r, chance }) => (r
      ? [it.name, r.mean, r.median ?? "", r.percentiles.p90 ?? "", ...(showBest ? [r.min ?? ""] : []), ...(showWorst ? [r.max ?? ""] : []), chance]
      : [it.name])),
  ];
  const byPull = () => {
    const last = Math.max(budget || 0, ...ready.map(({ r }) => r.cdf.length - 1));
    const out = [[T.chart.csvPull, ...ready.map(({ it }) => it.name)]];
    for (let t = 0; t <= last; t++) out.push([t, ...ready.map(({ r }) => (t < r.cdf.length ? r.cdf[t] : 1 - r.tail))]);
    return out;
  };
  const image = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => cs.getPropertyValue(n).trim() || d;
    return { background: v("--pop-bg", "#ffffff"), ink: v("--ink", "#000000"), muted: v("--ink-2", "#555555"), title: L.imageTitle, subtitle: ready.map(({ it }) => it.name).join(" · ") };
  };
  return (
    <div className="lines-menu compare-export" ref={ref}>
      <button type="button" className={buttonClass} aria-expanded={open} disabled={!ready.length} onClick={() => setOpen((o) => !o)}>{T.chart.export} ▾</button>
      {open && ready.length > 0 && (
        <div className={`lines-pop ${up ? "is-up" : ""}`} role="menu" aria-label={T.chart.export}>
          <button type="button" role="menuitem" className="menu-item" onClick={() => run(() => downloadCsv(fileName(L.fileTable) + ".csv", table()))}>{L.exportTable}</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => run(() => downloadCsv(fileName(L.fileByPull) + ".csv", byPull()))}>{L.exportByPull}</button>
          <button type="button" role="menuitem" className="menu-item" disabled={!chartRef.current}
            onClick={() => run(() => chartRef.current && downloadWithLabels(chartRef.current, fileName(L.fileTable) + ".png", image()))}>{T.chart.exportImage}</button>
        </div>
      )}
    </div>
  );
}

function Cell({ c, r }) {
  return <span role="cell" className={`s-cmp-num ${c.best?.(r) ? "is-best" : ""}`}><span className="s-cmp-label">{c.label}</span>{c.get(r)}</span>;
}
