import { useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { fmtInt, fmtNum, fmtPct, planTitle, stagesOf, stageView } from "../model.js";
import { errorText, useT } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import Progress from "./Progress.jsx";
import ResultChart, { MarkerKey, downloadWithLabels, phoneLayout, sample, themeColors, usePhone, usePopup, yAxis } from "./ResultChart.jsx";
import Distribution from "./Distribution.jsx";
import PercentileTable from "./PercentileTable.jsx";
import ComparePanel from "./ComparePanel.jsx";
import { Term } from "./Help.jsx";
import { downloadCsv, fileName } from "../export.js";

// The answer card, the same in both views: "This plan | Comparison", the answer in words, tiles,
// each banner plan's numbers, the chart, and "Add to comparison". The full view shows more of
// each (its own tiles, the chart's switch and Lines, the tables at the end); the simple view
// keeps to the plain ones.

// A sentence with its key number set off: the template is filled with a marker, then split around it.
// The value itself goes along as the second argument, so the words around it can agree with it.
const MARK = "\u0001";
function highlight(template, value) {
  const [before, after = ""] = template(MARK, value).split(MARK);
  return <>{before}<strong className="s-hl">{value}</strong>{after}</>;
}
const quantile = (cdf, p) => { for (let i = 0; i < cdf.length; i++) if (cdf[i] >= p - 1e-12) return i; return null; };

export default function AnswerCard({ state, update, engine, theme, full, compare, isSaved, onCompare, onOtherView, onRun }) {
  const T = useT();
  const S = T.simple;
  const r = engine.result;
  const [tab, setTab] = useState("plan");
  const [detail, setDetail] = useState("dist");
  const budgetMode = state.mode === "budget";
  const views = [state, ...stagesOf(state).map((_, k) => stageView(state, k + 1))];
  const fixed = r?.spend === "fixed";
  const busy = engine.status === "busy";

  const actions = (
    <div className="s-actions">
      <button type="button" className="btn btn--primary" onClick={() => { onCompare(); setTab("compare"); }} disabled={isSaved}>{isSaved ? S.inCompare : S.compare}</button>
      <button type="button" className="btn btn--secondary" onClick={onOtherView}>{full ? T.app.toSimple : S.details}</button>
    </div>
  );

  let body;
  if (tab === "compare") {
    body = (
      <ComparePanel {...compare} full={full} theme={theme} settings={state.settings} current={isSaved || r?.spend === "fixed" ? null : r}
        load={(it) => { compare.load(it); setTab("plan"); }} />
    );
  } else if (engine.status === "error" || engine.status === "cancelled") {
    body = (
      <>
        <p className={engine.status === "error" ? "error-box" : "note-box"} role={engine.status === "error" ? "alert" : "status"}>
          {engine.status === "error" ? errorText(T, engine) : T.progress.cancelled}
        </p>
        <div className="s-actions"><button type="button" className="btn btn--primary" onClick={onRun}>{T.plan.calculate}</button></div>
      </>
    );
  } else if (!r) {
    body = <Progress engine={engine} />;
  } else {
    const chance = fixed ? r.chanceAll : r.budget?.chanceGoal;
    body = (
      <>
        {/* the answer in words */}
        {fixed ? (
          <p className="s-big">{highlight(T.stages.youHaveAll, fmtPct(chance))}</p>
        ) : budgetMode && chance != null ? (
          <>
            <p className="s-big">{highlight(S.youHave, fmtPct(chance))}</p>
            <p className="s-second">{highlight(S.averageBig, full ? fmtNum(r.mean) : fmtInt(r.mean))}</p>
          </>
        ) : (
          <p className="s-big">{highlight(S.averageBig, full ? fmtNum(r.mean) : fmtInt(r.mean))}</p>
        )}
        {!budgetMode && !fixed && (
          <p className="s-sure">
            <span>{S.toBeSure}</span>
            <NumberInput className="custom-input s-field s-num" integer={false} min={1} max={99.99} value={state.desired}
              onChange={(v) => update((s) => ({ ...s, desired: v }))} aria-label={S.sureLabel} />
            <span>{highlight(S.sureResult, r.requiredPulls != null ? fmtInt(r.requiredPulls) : "-")}</span>
          </p>
        )}
        {!fixed && <Tiles r={r} full={full} settings={state.settings} />}
        {/* (while a plan just added or removed is being worked out, the table waits for it) */}
        {r.staged && r.stages.length === views.length && <StageTable views={views} r={r} budgetMode={budgetMode} />}
        {budgetMode && !fixed && r.min != null && state.budget < r.min && <p className="note-box" role="status">{T.target.notPossible(fmtInt(r.min))}</p>}
        {fixed
          ? r.stages.length === views.length && <StagesChart views={views} r={r} theme={theme} />
          : <ResultChart state={state} update={update} engine={engine} theme={theme} simple={!full} />}
        {/* the full view's tables: what you get with your pulls, and the pulls each chance takes */}
        {full && !fixed && (
          <div className="answer-more">
            {!r.staged && r.budget && (
              <div className="seg" role="tablist" aria-label={T.app.detailTabs}>
                {[["dist", T.app.detailDist], ["pct", T.app.detailPct]].map(([k, label]) => (
                  <button key={k} type="button" role="tab" aria-selected={detail === k} className={detail === k ? "is-on" : ""} onClick={() => setDetail(k)}>{label}</button>
                ))}
              </div>
            )}
            {detail === "dist" && !r.staged && r.budget ? <Distribution state={state} engine={engine} /> : <PercentileTable engine={engine} settings={state.settings} />}
          </div>
        )}
        {actions}
      </>
    );
  }

  return (
    <section className={`s-card s-answer ${busy ? "is-updating" : ""}`} aria-label={S.answerLabel} aria-busy={busy}>
      <div className="seg s-chart-tabs" role="tablist" aria-label={S.chartTabs}>
        <button type="button" role="tab" aria-selected={tab === "plan"} className={tab === "plan" ? "is-on" : ""} onClick={() => setTab("plan")}>{S.tabPlan}</button>
        <button type="button" role="tab" aria-selected={tab === "compare"} className={tab === "compare" ? "is-on" : ""} onClick={() => setTab("compare")}>
          {S.compareTitle} <span className="count">{compare.items.length}</span>
        </button>
      </div>
      {busy && r && tab === "plan" && <Progress engine={engine} compact />}
      {body}
    </section>
  );
}

// Tiles: a number over its label. Simple: the pulls half and 9 in 10 players need, the earliest
// and guaranteed pull. Full: average (± spread), median, 90% and 99% or the guarantee.
function Tiles({ r, full, settings }) {
  const T = useT();
  const S = T.simple, L = T.stats;
  const term = (label, explain) => (T.simpleWording ? label : <Term label={label} explain={explain} />);
  let tiles;
  if (full) {
    tiles = [
      [fmtNum(r.mean), term(L.average, T.terms.average), L.averageSub(fmtNum(r.sd))],
      [fmtInt(r.median), term(L.median, T.terms.median), L.medianSub],
      [fmtInt(r.percentiles?.p90 ?? null), term(L.p90, T.terms.p90), L.pulls],
      r.max != null && settings?.showWorst !== false
        ? [fmtInt(r.max), term(L.guaranteed, T.terms.guaranteed), L.guaranteedSub]
        : [fmtInt(r.percentiles?.p99 ?? null), term(L.p99, T.terms.p99), settings?.showWorst === false ? L.pulls : r.maxKnown === false ? L.guaranteeUnknown : L.noGuarantee],
    ];
  } else {
    const half = quantile(r.cdf, 0.5), nine = quantile(r.cdf, 0.9);
    tiles = [
      half != null && [fmtInt(half), S.statHalf],
      nine != null && [fmtInt(nine), S.statNine],
      settings?.showBest !== false && r.min != null && r.min > 0 && [fmtInt(r.min), S.statEarliest],
      settings?.showWorst !== false && r.maxKnown !== false && (r.max != null ? [fmtInt(r.max), S.statGuaranteed] : [S.statNone, S.statGuarantee]),
    ].filter(Boolean);
  }
  return (
    <dl className="s-stats">
      {tiles.map(([value, label, sub], i) => (
        <div key={i} className="s-stat"><dt>{label}</dt><dd>{value}</dd>{sub && <span className="s-stat-sub">{sub}</span>}</div>
      ))}
    </dl>
  );
}

// Each banner plan's numbers.
// One budget: the chance it's done with your pulls (or 9 in 10 done by, without a budget), the
//   pulls it takes on its own on average (the difference of the averages: exact), and the pull
//   it's done by on average.
// Each its own: its pulls, its chance with them, the pulls it takes on average however many you
//   put in, and by when 9 in 10 are done with it (given the plans before it were done).
export function StageTable({ views, r, budgetMode }) {
  const T = useT();
  const G = T.stages;
  const fixed = r.spend === "fixed";
  const cols = fixed
    ? [G.colPulls, G.colChance, G.colAvgNeeded, G.col90]
    : budgetMode ? [G.colDoneChance, G.colOwnAvg, G.colDoneBy] : [G.colOwnAvg, G.colDoneBy, G.colDone90];
  const rows = views.map((v, i) => {
    const st = r.stages[i];
    if (fixed) {
      const own = st.own;
      return [fmtInt(st.budget), fmtPct(st.chance), own ? fmtInt(own.mean) : "-", own?.p90 != null ? fmtInt(own.p90) : "-"];
    }
    const ownAvg = st.mean - (i > 0 ? r.stages[i - 1].mean : 0);
    return budgetMode
      ? [fmtPct(r.budget?.stages?.[i]), fmtInt(ownAvg), fmtInt(st.mean)]
      : [fmtInt(ownAvg), fmtInt(st.mean), st.p90 != null ? fmtInt(st.p90) : "-"];
  });
  const main = fixed ? 1 : budgetMode ? 0 : -1; // the column set off in the answer colour
  return (
    <div className="st-table" role="table" aria-label={G.tabsLabel} style={{ "--cols": cols.length }}>
      <div className="st-row st-head" role="row">
        <span role="columnheader">{G.colPlan}</span>
        {cols.map((c) => <span key={c} role="columnheader" className="st-num">{c}</span>)}
      </div>
      {views.map((v, i) => (
        <div key={i} className="st-row" role="row">
          <span className="st-name" role="cell">
            {fixed ? <span className="swatch" style={{ "--c": `var(--s${(i % 6) + 1})` }} aria-hidden="true" /> : <span className="s-stage-n">{i + 1}</span>}
            <span>{planTitle(v)}</span>
          </span>
          {rows[i].map((value, k) => (
            <span key={k} role="cell" className={`st-num ${k === main ? "is-main" : ""}`}><span className="st-label">{cols[k]}</span>{value}</span>
          ))}
        </div>
      ))}
    </div>
  );
}

// Each banner plan on its own pulls: each plan's chance by the pulls you put into it, with a line
// at the pulls it has
function StagesChart({ views, r, theme }) {
  const T = useT();
  const G = T.stages;
  const phone = usePhone();
  const chartRef = useRef(null);
  const chart = useMemo(() => {
    const C = themeColors();
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--page").trim();
    let xMax = 10;
    const curves = r.stages.map((st) => st.own?.cdf ?? st.curve);
    curves.forEach((c, i) => {
      let x = c.length - 1;
      for (let t = 0; t < c.length; t++) if (c[t] >= 0.999) { x = t; break; }
      xMax = Math.max(xMax, x, r.stages[i].budget);
    });
    const at = (c, t, tail) => (t < c.length ? c[t] : 1 - (tail ?? 0));
    const datasets = curves.map((c, i) => ({
      label: `${i + 1} · ${planTitle(views[i])}`, data: sample(Float64Array.from({ length: xMax + 1 }, (_, t) => at(c, t, r.stages[i].own?.tail)), xMax),
      borderColor: C.series[i % C.series.length], backgroundColor: C.series[i % C.series.length], borderWidth: 2, pointRadius: 0,
    }));
    const markers = r.stages.map((st, i) => ({
      x: st.budget, strong: true, color: C.series[i % C.series.length], bg,
      label: G.chartMark(i + 1, fmtInt(st.budget), fmtPct(st.chance)),
    }));
    return { C, xMax, datasets, markers };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [r, views.length, theme, T]);
  return (
    <div className="chart-wrapper">
      <div className="chart-toolbar">
        <span className="field-label">{G.chartTitle}</span>
        <StagesExport views={views} r={r} chartRef={chartRef} />
      </div>
      <div className="chart-container">
        <Line
          ref={chartRef}
          data={{ datasets: chart.datasets }}
          options={{
            responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
            interaction: { mode: "index", intersect: false },
            layout: phoneLayout(phone),
            scales: {
              x: { type: "linear", min: 0, max: chart.xMax, title: { display: true, text: G.chartX, color: chart.C.tick }, ticks: { color: chart.C.tick, callback: (v) => fmtInt(v), maxTicksLimit: phone ? 5 : 8 }, grid: { color: chart.C.grid }, border: { color: chart.C.grid } },
              y: yAxis(phone, chart.C, (v) => `${Math.round(v * 100)}%`, { min: 0, max: 1 }),
            },
            plugins: {
              legend: { display: true, position: "bottom", labels: { boxWidth: 14, boxHeight: 3, color: chart.C.tick } },
              tooltip: { callbacks: { title: (it) => T.chart.pull(fmtInt(it[0]?.parsed.x)), label: (c) => `${c.dataset.label}: ${fmtPct(c.parsed.y)}` } },
              markers: { items: chart.markers, labels: !phone },
            },
          }}
        />
      </div>
      {phone && <MarkerKey items={chart.markers} />}
    </div>
  );
}

function StagesExport({ views, r, chartRef }) {
  const T = useT();
  const G = T.stages, L = T.chart;
  const { open, setOpen, ref } = usePopup();
  const run = (fn) => { setOpen(false); fn(); };
  const names = views.map((v, i) => `${i + 1} · ${planTitle(v)}`);
  const csv = () => {
    const curves = r.stages.map((st) => st.own?.cdf ?? st.curve);
    const last = Math.max(...r.stages.map((st, i) => Math.max(st.budget, curves[i].length - 1)));
    const out = [[L.csvPull, ...names]];
    for (let t = 0; t <= last; t++) out.push([t, ...curves.map((c, i) => (t < c.length ? c[t] : 1 - (r.stages[i].own?.tail ?? 0)))]);
    return out;
  };
  const image = () => {
    const cs = getComputedStyle(document.documentElement);
    const v = (n, d) => cs.getPropertyValue(n).trim() || d;
    return { background: v("--pop-bg", "#ffffff"), ink: v("--ink", "#000000"), muted: v("--ink-2", "#555555"), title: G.chartTitle, subtitle: names.join(" · ") };
  };
  return (
    <div className="lines-menu" ref={ref}>
      <button type="button" className="btn btn--sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{L.export} ▾</button>
      {open && (
        <div className="lines-pop" role="menu" aria-label={L.export}>
          <button type="button" role="menuitem" className="menu-item" onClick={() => run(() => downloadCsv(fileName(G.chartTitle) + ".csv", csv()))}>{L.exportByPull}</button>
          <button type="button" role="menuitem" className="menu-item" disabled={!chartRef.current}
            onClick={() => run(() => chartRef.current && downloadWithLabels(chartRef.current, fileName(G.chartTitle) + ".png", image()))}>{L.exportImage}</button>
        </div>
      )}
    </div>
  );
}
