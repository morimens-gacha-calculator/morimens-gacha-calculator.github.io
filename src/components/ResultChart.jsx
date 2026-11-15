import { useEffect, useMemo, useRef, useState } from "react";
import { Chart as ChartJS, LinearScale, PointElement, LineElement, Filler, Tooltip, Legend } from "chart.js";
import { Line } from "react-chartjs-2";
import { fmtInt, fmtNum, fmtPct, listOfInts, DEFAULT_LINES, getPrecision, presets, reqLabel } from "../model.js";
import { useT } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import Progress from "./Progress.jsx";
import { budgetRows, chanceByPullRows, downloadChartPng, downloadCsv, fileName } from "../export.js";

ChartJS.register(LinearScale, PointElement, LineElement, Filler, Tooltip, Legend);

// Chart colours come from the theme's CSS variables
export function themeColors() {
  const cs = getComputedStyle(document.documentElement);
  const v = (name) => cs.getPropertyValue(name).trim();
  return {
    line: v("--blue"), fill: v("--chart-fill"), tick: v("--chart-tick"), grid: v("--chart-grid"),
    marker: v("--chart-marker"), guide: v("--chart-guide"), series: [v("--s1"), v("--s2"), v("--s3"), v("--s4"), v("--s5"), v("--s6")],
  };
}

// Labelled vertical lines. Labels are measured and stacked into rows so they never overlap.
const markerPlugin = {
  id: "markers",
  afterDatasetsDraw(chart, _args, opts) {
    const { ctx, chartArea: area, scales } = chart;
    const items = [...(opts?.items ?? [])].sort((a, b) => a.x - b.x);
    const rowsEnd = []; // right edge of the last label in each row
    for (const m of items) {
      const x = scales.x.getPixelForValue(m.x);
      if (x < area.left - 1 || x > area.right + 1) continue;
      ctx.save();
      ctx.strokeStyle = m.color;
      ctx.lineWidth = m.strong ? 2 : 1;
      ctx.setLineDash(m.strong ? [] : [4, 4]);
      ctx.beginPath(); ctx.moveTo(x, area.top); ctx.lineTo(x, area.bottom); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `${m.strong ? 600 : 500} 12px Roboto, system-ui, sans-serif`;
      const w = ctx.measureText(m.label).width;
      const right = x + 6 + w > area.right; // flip to the left side near the right edge
      const x0 = right ? x - 6 - w : x + 6;
      let row = rowsEnd.findIndex((end) => end + 8 <= x0);
      if (row < 0) { row = rowsEnd.length; rowsEnd.push(0); }
      rowsEnd[row] = x0 + w;
      const y = area.top + 13 + row * 15;
      ctx.fillStyle = m.bg;
      ctx.fillRect(x0 - 3, y - 11, w + 6, 15);
      ctx.fillStyle = m.color;
      ctx.textAlign = "left";
      ctx.fillText(m.label, x0, y);
      ctx.restore();
    }
  },
};
ChartJS.register(markerPlugin);

// Thin a long series to about `max` points (keeps the first and last)
export function sample(values, xMax, max = 900) {
  const n = Math.min(values.length - 1, xMax);
  const step = Math.max(1, Math.floor(n / max));
  const out = [];
  for (let x = 0; x <= n; x += step) out.push({ x, y: values[x] });
  if (n % step) out.push({ x: n, y: values[n] });
  if (n < xMax) out.push({ x: xMax, y: values[n] }); // past the computed range the curve stays flat
  return out;
}

export default function ResultChart({ state, update, engine, theme }) {
  const T = useT();
  const L = T.chart;
  const [view, setView] = useState("cdf");
  const chartRef = useRef(null);
  const r = engine.result;
  const b = r?.budget;
  const lines = { ...DEFAULT_LINES, ...state.chartLines };
  const target = state.mode === "budget" ? state.budget : r?.requiredPulls;
  const views = [["cdf", L.cdf], ["pmf", L.pmf]];
  if (b) views.push(["progress", L.progress]);
  const active = views.some(([v]) => v === view) ? view : "cdf";
  const pctOptions = [...new Set([50, ...listOfInts(state.settings.pct).filter((x) => x > 0 && x < 100)])].sort((a, c) => a - c);

  const chart = useMemo(() => {
    if (!r) return null;
    const C = themeColors();
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--page").trim();
    const chanceAt = (x) => (x < r.cdf.length ? r.cdf[x] : 1 - r.tail);
    const quantile = (q) => { for (let i = 0; i < r.cdf.length; i++) if (r.cdf[i] >= q - 1e-12) return i; return null; };

    let xMax = r.cdf.length - 1;
    for (let i = 0; i < r.cdf.length; i++) if (r.cdf[i] >= 0.9995) { xMax = i; break; }
    if (r.max != null) xMax = Math.max(xMax, r.max);
    if (lines.target && target != null) xMax = Math.max(xMax, Math.min(target, r.cdf.length - 1));
    for (const c of lines.custom) xMax = Math.max(xMax, c);
    xMax = Math.max(xMax, 10);

    // The lines the person picked
    const markers = [];
    if (lines.mean) markers.push({ x: r.mean, label: L.average(fmtNum(r.mean)), color: C.guide });
    for (const p of lines.pcts) {
      const x = quantile(p / 100);
      if (x != null) markers.push({ x, label: p === 50 ? L.median(fmtInt(x)) : L.pctAt(p, fmtInt(x)), color: C.guide });
    }
    if (lines.worst && r.max != null) markers.push({ x: r.max, label: L.worst(fmtInt(r.max)), color: C.guide });
    for (const c of lines.custom) markers.push({ x: c, label: L.atPull(fmtInt(c), fmtPct(chanceAt(c))), color: C.guide });
    if (lines.target && target != null) {
      markers.push({ x: target, strong: true, color: C.marker,
        label: state.mode === "budget" ? L.yourBudget(fmtInt(target), fmtPct(chanceAt(target))) : L.forDesired(fmtInt(target), fmtNum(state.desired, Number.isInteger(state.desired) ? 0 : getPrecision())) });
    }
    for (const m of markers) m.bg = bg;

    if (active === "progress" && b) {
      const reqs = b.requirements.slice(0, 6);
      return {
        C, xMax: b.pulls, yMax: undefined, legend: true,
        markers: markers.filter((m) => m.x <= b.pulls && (m.strong || lines.custom.includes(m.x))),
        yFmt: (v) => fmtNum(v, Number.isInteger(v) ? 0 : 1),
        tip: (c) => `${c.dataset.label}: ${fmtNum(c.parsed.y)}`,
        data: {
          datasets: reqs.map((q, i) => ({
            label: `${q.label} (${q.type !== "distinct" ? T.units.copies : T.units.itemsWith(q.copies)})`,
            data: sample(q.expectedByPull, b.pulls), borderColor: C.series[i], backgroundColor: C.series[i], borderWidth: 2, pointRadius: 0,
          })),
        },
      };
    }
    const values = active === "pmf" ? r.pmf : r.cdf;
    return {
      C, xMax, yMax: active === "pmf" ? undefined : 1, legend: false, markers,
      yFmt: (v) => (active === "pmf" ? fmtPct(v, Math.max(1, getPrecision())) : `${Math.round(v * 100)}%`),
      tip: (c) => `${c.dataset.label}: ${fmtPct(c.parsed.y)}`,
      data: {
        datasets: [{
          label: active === "pmf" ? L.finish : L.reached, data: sample(values, xMax),
          borderColor: C.line, backgroundColor: C.fill, fill: "origin", borderWidth: 2, pointRadius: 0,
        }],
      },
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, b, active, target, state.mode, state.desired, state.chartLines, state.settings.decimals, theme, T]);

  const setLines = (patch) => update((s) => ({ ...s, chartLines: { ...DEFAULT_LINES, ...s.chartLines, ...patch } }));

  return (
    <div className="chart-wrapper">
      <div className="chart-toolbar">
        <div className="chart-tabs" role="tablist" aria-label={L.tabs}>
          {views.map(([v, label]) => (
            <button key={v} type="button" role="tab" aria-selected={active === v} className={`chip-tab ${active === v ? "is-active" : ""}`} onClick={() => setView(v)}>{label}</button>
          ))}
        </div>
        <div className="row toolbar-menus">
          <LinesMenu lines={lines} setLines={setLines} pctOptions={pctOptions} hasWorst={r?.max != null} worstUnknown={r?.maxKnown === false} mode={state.mode} />
          <ExportMenu result={engine.status === "busy" ? null : r} chartRef={chartRef} state={state} viewName={views.find(([v]) => v === active)?.[1]} />
        </div>
      </div>
      <div className="chart-container">
        {chart && (
          <Line
            ref={chartRef}
            data={chart.data}
            options={{
              responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
              interaction: { mode: "index", intersect: false },
              scales: {
                x: { type: "linear", min: 0, max: chart.xMax, title: { display: true, text: L.xTitle, color: chart.C.tick }, ticks: { color: chart.C.tick, callback: (v) => fmtInt(v), maxTicksLimit: 8 }, grid: { color: chart.C.grid }, border: { color: chart.C.grid } },
                y: { min: 0, max: chart.yMax, ticks: { color: chart.C.tick, callback: chart.yFmt, maxTicksLimit: 6 }, grid: { color: chart.C.grid }, border: { color: chart.C.grid } },
              },
              plugins: {
                legend: { display: chart.legend, position: "bottom", labels: { boxWidth: 14, boxHeight: 3, color: chart.C.tick } },
                tooltip: { callbacks: { title: (items) => L.pull(fmtInt(items[0]?.parsed.x)), label: chart.tip } },
                markers: { items: chart.markers },
              },
            }}
          />
        )}
        {engine.status === "busy" && <div className="loading-overlay"><Progress engine={engine} /></div>}
      </div>
    </div>
  );
}

// A small pop-up menu that closes on outside clicks and Escape
function usePopup() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!ref.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", esc); };
  }, [open]);
  return { open, setOpen, ref };
}

// "Export ▾": the numbers as CSV (for spreadsheets) and the chart as a PNG image
function ExportMenu({ result, chartRef, state, viewName }) {
  const L = useT().chart;
  const { open, setOpen, ref } = usePopup();

  const run = (fn) => { setOpen(false); fn(); };
  const T = useT();
  const title = presets()[state.preset]?.title ?? T.app.customBanner;
  const image = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => cs.getPropertyValue(n).trim() || d;
    const goals = state.goal.map((g) => reqLabel(state.banner, g)).join(state.goalMode === "all" ? T.goalLabel.joinAll : T.goalLabel.joinAny);
    return { background: v("--pop-bg", "#ffffff"), ink: v("--ink", "#000000"), muted: v("--ink-2", "#555555"), title: `${title} · ${viewName}`, subtitle: goals };
  };
  return (
    <div className="lines-menu" ref={ref}>
      <button type="button" className="chip-tab" aria-expanded={open} disabled={!result} onClick={() => setOpen((o) => !o)}>{L.export} ▾</button>
      {open && result && (
        <div className="lines-pop" role="menu" aria-label={L.export}>
          <button type="button" role="menuitem" className="menu-item" onClick={() => run(() => downloadCsv(fileName(title, L.fileByPull) + ".csv", chanceByPullRows(result, L)))}>{L.exportByPull}</button>
          {result.budget && (
            <button type="button" role="menuitem" className="menu-item" onClick={() => run(() => downloadCsv(fileName(title, L.fileBudget(result.budget.pulls)) + ".csv", budgetRows(result.budget, L)))}>{L.exportBudget(result.budget.pulls)}</button>
          )}
          <button type="button" role="menuitem" className="menu-item" disabled={!chartRef.current}
            onClick={() => run(() => chartRef.current && downloadChartPng(chartRef.current, fileName(title, viewName) + ".png", image()))}>{L.exportImage}</button>
        </div>
      )}
    </div>
  );
}

// "Lines ▾" menu: tick which reference lines to draw, and add lines at any pull
function LinesMenu({ lines, setLines, pctOptions, hasWorst, worstUnknown, mode }) {
  const L = useT().chart;
  const { open, setOpen, ref } = usePopup();
  const [newLine, setNewLine] = useState(100);
  const togglePct = (p) => setLines({ pcts: lines.pcts.includes(p) ? lines.pcts.filter((x) => x !== p) : [...lines.pcts, p].sort((a, b) => a - b) });
  const addCustom = () => { if (newLine > 0 && !lines.custom.includes(newLine)) setLines({ custom: [...lines.custom, newLine].sort((a, b) => a - b) }); };

  return (
    <div className="lines-menu" ref={ref}>
      <button type="button" className="chip-tab" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{L.lines} ▾</button>
      {open && (
        <div className="lines-pop" role="dialog" aria-label={L.linesTitle}>
          <div className="lines-title">{L.linesTitle}</div>
          <label className="check"><input type="checkbox" checked={lines.target} onChange={(e) => setLines({ target: e.target.checked })} />{mode === "budget" ? L.lineBudget : L.lineRequired}</label>
          <label className="check"><input type="checkbox" checked={lines.mean} onChange={(e) => setLines({ mean: e.target.checked })} />{L.lineAverage}</label>
          {pctOptions.map((p) => (
            <label className="check" key={p}><input type="checkbox" checked={lines.pcts.includes(p)} onChange={() => togglePct(p)} />{p === 50 ? L.lineMedian : L.linePct(p)}</label>
          ))}
          <label className="check" title={hasWorst ? undefined : worstUnknown ? L.worstUnknown : L.noWorst}>
            <input type="checkbox" checked={lines.worst} disabled={!hasWorst} onChange={(e) => setLines({ worst: e.target.checked })} />
            <span className={hasWorst ? "" : "muted"}>{L.lineWorst}</span>
          </label>
          <div className="lines-title">{L.customLines}</div>
          <div className="row">
            <NumberInput className="custom-input w-s" min={1} value={newLine} onChange={setNewLine} aria-label={L.addLineLabel}
              onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }} />
            <button type="button" className="btn btn--small" onClick={addCustom}>{L.addLine}</button>
          </div>
          {lines.custom.length > 0 && (
            <div className="custom-lines">
              {lines.custom.map((c) => (
                <span className="chip chip--line" key={c}>
                  {fmtInt(c)}
                  <button type="button" className="chip-x" onClick={() => setLines({ custom: lines.custom.filter((x) => x !== c) })} aria-label={L.removeLine(c)}>×</button>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
