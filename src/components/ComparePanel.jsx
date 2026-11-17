import { useMemo, useRef } from "react";
import { Line } from "react-chartjs-2";
import { HelpButton } from "./Help.jsx";
import NumberInput from "./NumberInput.jsx";
import { TrashIcon } from "./Icon.jsx";
import { fmtInt, fmtNum, fmtPct } from "../model.js";
import { MarkerKey, downloadWithLabels, phoneLayout, sample, themeColors, usePhone, usePopup, yAxis } from "./ResultChart.jsx";
import { downloadCsv, fileName } from "../export.js";
import { useT, errorText } from "../i18n/index.js";

// Side-by-side comparison of saved setups (banner + plan + pity)
export default function ComparePanel({ items, results, budget, setBudget, rename, remove, load, theme, settings }) {
  const showBest = settings?.showBest !== false, showWorst = settings?.showWorst !== false;
  const T = useT();
  const L = T.compare;
  const rows = items.map((it, i) => {
    const res = results[it.id];
    const r = res?.status === "ok" ? res.result : null;
    const chance = r ? (budget < r.cdf.length ? r.cdf[budget] : 1 - r.tail) : null;
    return { it, i, res, r, chance };
  });
  const ready = rows.filter((x) => x.r);
  const chartRef = useRef(null);
  const phone = usePhone();

  // Best value per column: lowest pulls, highest chance
  const best = {
    mean: Math.min(...ready.map((x) => x.r.mean)),
    median: Math.min(...ready.map((x) => x.r.median ?? Infinity)),
    p90: Math.min(...ready.map((x) => x.r.percentiles.p90 ?? Infinity)),
    chance: Math.max(...ready.map((x) => x.chance)),
  };

  const chart = useMemo(() => {
    if (!ready.length) return null;
    const C = themeColors();
    let xMax = 10;
    for (const { r } of ready) {
      let x = r.cdf.length - 1;
      for (let t = 0; t < r.cdf.length; t++) if (r.cdf[t] >= 0.999) { x = t; break; }
      xMax = Math.max(xMax, x);
    }
    xMax = Math.max(xMax, budget || 0);
    return {
      C, xMax,
      data: {
        datasets: ready.map(({ it, r, i }) => ({
          label: it.name, data: sample(r.cdf, xMax), borderColor: C.series[i % C.series.length],
          backgroundColor: C.series[i % C.series.length], borderWidth: 2, pointRadius: 0, borderDash: i >= C.series.length ? [6, 4] : [],
        })),
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [results, items, budget, theme, T]);

  if (!items.length) {
    return (
      <div className="empty-state">
        <h3>{L.emptyTitle}</h3>
        <p>{L.emptyText}</p>
      </div>
    );
  }

  return (
    <div className="compare">
      <div className="compare-head">
        <label className="inline-field">
          {L.within}
          <NumberInput className="custom-input w-m" min={0} value={budget} onChange={setBudget} aria-label={L.budgetLabel} />
          {L.pulls}
        </label>
        <HelpButton label={L.helpLabel} text={L.help} />
        <CompareExport rows={rows} ready={ready} budget={budget} chartRef={chartRef} showBest={showBest} showWorst={showWorst} />
      </div>

      <div className="chart-container compare-chart">
        {chart && (
          <Line
            ref={chartRef}
            data={chart.data}
            options={{
              responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
              interaction: { mode: "index", intersect: false },
              layout: phoneLayout(phone),
              scales: {
                x: { type: "linear", min: 0, max: chart.xMax, title: { display: true, text: T.chart.xTitle, color: chart.C.tick }, ticks: { color: chart.C.tick, callback: (v) => fmtInt(v), maxTicksLimit: phone ? 5 : 9 }, grid: { color: chart.C.grid }, border: { color: chart.C.grid } },
                y: yAxis(phone, chart.C, (v) => `${Math.round(v * 100)}%`, { min: 0, max: 1 }),
              },
              plugins: {
                legend: { display: true, position: "bottom", labels: { boxWidth: 14, boxHeight: 3, color: chart.C.tick } },
                tooltip: { callbacks: { title: (it) => T.chart.pull(fmtInt(it[0]?.parsed.x)), label: (c) => `${c.dataset.label}: ${fmtPct(c.parsed.y)}` } },
                markers: { items: budget ? [{ x: budget, strong: true, color: chart.C.marker, label: L.marker(fmtInt(budget)) }] : [], labels: !phone },
              },
            }}
          />
        )}
      </div>
      {phone && chart && budget > 0 && <MarkerKey items={[{ x: budget, strong: true, color: chart.C.marker, label: L.marker(fmtInt(budget)) }]} />}

      <div className="table-scroll">
        <table className="probability-table compare-table">
          <thead>
            <tr>
              <th>{L.setup}</th>
              <th className="num">{L.average}</th>
              <th className="num">{L.median}</th>
              <th className="num">{L.p90}</th>
              {showBest && <th className="num">{L.best}</th>}
              {showWorst && <th className="num">{L.worst}</th>}
              <th className="num">{L.withinN(fmtInt(budget))}</th>
              <th><span className="sr-only">{L.actions}</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ it, i, res, r, chance }) => (
              <tr key={it.id}>
                <td>
                  <span className="swatch" style={{ "--c": `var(--s${(i % 6) + 1})` }} aria-hidden="true" />
                  <input type="text" className="custom-input name-input" value={it.name} onChange={(e) => rename(it.id, e.target.value)} aria-label={L.nameLabel} />
                </td>
                {r ? (
                  <>
                    <td className={`num ${r.mean === best.mean && ready.length > 1 ? "best" : ""}`}>{fmtNum(r.mean)}</td>
                    <td className={`num ${r.median === best.median && ready.length > 1 ? "best" : ""}`}>{fmtInt(r.median)}</td>
                    <td className={`num ${r.percentiles.p90 === best.p90 && ready.length > 1 ? "best" : ""}`}>{fmtInt(r.percentiles.p90 ?? null)}</td>
                    {showBest && <td className="num">{r.min != null ? fmtInt(r.min) : <span className="muted">{L.none}</span>}</td>}
                    {showWorst && <td className="num">{r.max != null ? fmtInt(r.max) : <span className="muted">{L.none}</span>}</td>}
                    <td className={`num ${chance === best.chance && ready.length > 1 ? "best" : ""}`}>{fmtPct(chance)}</td>
                  </>
                ) : (
                  <td colSpan={4 + (showBest ? 1 : 0) + (showWorst ? 1 : 0)} className={res?.status === "error" ? "err-text" : "muted"}>{res?.status === "error" ? errorText(T, res) : L.calculating}</td>
                )}
                <td className="actions">
                  <button type="button" className="btn btn--small" onClick={() => load(it)}>{L.load}</button>
                  <button type="button" className="btn btn--small btn--danger" onClick={() => remove(it.id)} aria-label={L.remove(it.name)}><TrashIcon size={15} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// "Export ▾" for the comparison: the table and the chance curves as CSV, the chart as PNG
export function CompareExport({ rows, ready, budget, chartRef, showBest, showWorst, buttonClass = "chip-tab", up = false }) {
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
