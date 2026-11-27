import { useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { I18nContext, useT as useContextT, withWording } from "../i18n/index.js";
import { fmtInt, newId } from "../model.js";
import { Background, CalcNav, LanguagePicker, SiteFooter, loadLang, saveLang } from "../components/SiteParts.jsx";
import { HelpButton } from "../components/Help.jsx";
import { TrashIcon } from "../components/Icon.jsx";
import { downloadWithLabels, phoneLayout, themeColors, usePhone, usePopup, yAxis } from "../components/ResultChart.jsx";
import { downloadCsv } from "../export.js";
import { linesToLock, solveCovenant } from "./engine.js";
import { LEVELS, LINES, MAX_GOALS, SUBSTATS } from "./rates.js";

// The covenant substat calculator: a piece's 3 substat lines now, the lines you want, and how
// many rerolls and materials that takes for each way of locking (engine.js). The same two
// cards as the pull calculator: your covenant on the left, the answer on the right.

const ICONS = import.meta.glob("../assets/covenant/*.{png,webp}", { eager: true, import: "default" });
const icon = (name) => Object.entries(ICONS).find(([p]) => p.includes(`/${name}.`))?.[1];

const STORE_KEY = "covenant-calc-v1";
const fresh = () => ({
  lines: [{ stat: "critRate", level: 8 }, { stat: "keyflareRegen", level: 6 }, { stat: "critRate", level: 5 }],
  goals: [{ id: newId(), stat: "critRate", level: 6 }, { id: newId(), stat: "critDmg", level: 5 }],
});
const okLine = (l) => l && SUBSTATS.some((s) => s.key === l.stat) && Number.isInteger(l.level) && l.level >= 1 && l.level <= LEVELS.length;
function loadState() {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY));
    if (Array.isArray(v?.lines) && v.lines.length === LINES && v.lines.every(okLine) && Array.isArray(v.goals) && v.goals.length <= MAX_GOALS && v.goals.every(okLine)) {
      return { lines: v.lines, goals: v.goals.map((g) => ({ id: g.id ?? newId(), stat: g.stat, level: g.level })) };
    }
  } catch { /* fresh */ }
  return fresh();
}

// "1.6%", "0.45%", "2.4": a substat's value at a level
const STEP = Object.fromEntries(SUBSTATS.map((s) => [s.key, s]));
export function valueText(stat, level, locale) {
  const s = STEP[stat];
  const v = Math.round(s.step * level * 1000) / 1000;
  return `${v.toLocaleString(locale, { maximumFractionDigits: 2 })}${s.unit}`;
}
// big numbers stay readable: 63.1M, 80B
const fmtBig = (x, locale) => (x == null ? "-" : x >= 1e7 ? new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 }).format(x) : fmtInt(x));
const fmtQuills = (x, locale) => (x >= 1e5 ? fmtBig(x, locale) : x.toLocaleString(locale, { minimumFractionDigits: 1, maximumFractionDigits: 1 }));

const MARK = "\u0001";
function highlight(template, value) {
  const [before, after = ""] = template(MARK).split(MARK);
  return <>{before}<strong className="s-hl">{value}</strong>{after}</>;
}

export default function CovenantApp({ onGo }) {
  const [lang, setLang] = useState(loadLang);
  const T = useMemo(() => withWording(lang, false), [lang]);
  const C = T.covenant;
  const [state, setState] = useState(loadState);
  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* no storage */ } }, [state]);
  useEffect(() => {
    const before = document.title;
    document.title = C.pageTitle;
    return () => { document.title = before; };
  }, [C.pageTitle]);

  const result = useMemo(() => (state.goals.length ? solveCovenant({ lines: state.lines, goals: state.goals }) : null), [state]);

  return (
    <I18nContext.Provider value={T}>
      <Background view="covenant" />
      <main className="main">
        <section className="content-box is-simple" aria-label={C.pageTitle}>
          <div className="header-row">
            <h1 className="main-title">{T.app.title}</h1>
            <div className="row header-buttons">
              <LanguagePicker lang={lang} onChange={(code) => { saveLang(code); setLang(code); }} />
            </div>
          </div>
          <CalcNav calc="covenant" onGo={onGo} />
          <div className="app-layout">
            <PieceCard state={state} setState={setState} />
            <div className="s-side">
              <AnswerCard state={state} result={result} />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </I18nContext.Provider>
  );
}

function StatSelect({ value, onChange, label }) {
  const C = useContextT().covenant;
  return (
    <span className="cov-stat">
      <img className="cov-icon" src={icon(value)} alt="" aria-hidden="true" />
      <select className="select" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {SUBSTATS.map((s) => <option key={s.key} value={s.key}>{C.stats[s.key]}</option>)}
      </select>
    </span>
  );
}
function LevelSelect({ stat, value, onChange, label }) {
  const T = useContextT();
  return (
    <select className="select cov-level" value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label}>
      {LEVELS.map((l) => <option key={l.level} value={l.level}>{T.covenant.levelOption(l.level, valueText(stat, l.level, T.numberLocale))}</option>)}
    </select>
  );
}
// Left: the piece's lines now, and the goals
function PieceCard({ state, setState }) {
  const T = useContextT();
  const C = T.covenant;
  const setLine = (i, patch) => setState((s) => ({ ...s, lines: s.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) }));
  const setGoal = (id, patch) => setState((s) => ({ ...s, goals: s.goals.map((g) => (g.id === id ? { ...g, ...patch } : g)) }));
  const addGoal = () => setState((s) => {
    const used = new Set(s.goals.map((g) => g.stat));
    const stat = SUBSTATS.find((x) => !used.has(x.key))?.key ?? "critRate";
    return { ...s, goals: [...s.goals, { id: newId(), stat, level: 5 }] };
  });
  return (
    <section className="s-card s-plan cov-card" aria-label={C.planLabel}>
      <h2 className="s-lead">{C.current}</h2>
      <div className="cov-lines">
        {state.lines.map((l, i) => (
          <div key={i} className="cov-row">
            <span className="cov-n" aria-hidden="true">{i + 1}</span>
            <StatSelect value={l.stat} onChange={(stat) => setLine(i, { stat })} label={`${C.line(i + 1)}: ${C.stat}`} />
            <LevelSelect stat={l.stat} value={l.level} onChange={(level) => setLine(i, { level })} label={`${C.line(i + 1)}: ${C.level}`} />
          </div>
        ))}
      </div>

      <div className="s-divider" />
      <h2 className="s-lead">{C.iWant}<HelpButton label={C.iWant} text={C.goalsHelp} /></h2>
      {state.goals.length > 0 && (
        <div className="cov-goals">
          <div className="cov-goal-head" aria-hidden="true"><span>{C.colStat}</span><span>{C.colAtLeast}</span></div>
          {state.goals.map((g, i) => (
            <div key={g.id} className="cov-row cov-goal">
              <StatSelect value={g.stat} onChange={(stat) => setGoal(g.id, { stat })} label={`${C.iWant} ${i + 1}: ${C.stat}`} />
              <LevelSelect stat={g.stat} value={g.level} onChange={(level) => setGoal(g.id, { level })} label={`${C.iWant} ${i + 1}: ${C.atLeast}`} />
              <button type="button" className="s-remove" onClick={() => setState((s) => ({ ...s, goals: s.goals.filter((x) => x.id !== g.id) }))}
                aria-label={C.removeGoal(i + 1)} title={C.removeGoal(i + 1)}><TrashIcon /></button>
            </div>
          ))}
        </div>
      )}
      {state.goals.length < MAX_GOALS && <button type="button" className="btn btn--quiet btn--sm s-add" onClick={addGoal}>+ {C.addGoal}</button>}
    </section>
  );
}

// Right: the answer for the cheapest way, what to lock now, the materials, every way side by
// side and the chance by reroll
function AnswerCard({ state, result }) {
  const T = useContextT();
  const C = T.covenant;
  const L = T.numberLocale;
  let body;
  if (!result) body = <p className="s-hint">{C.noGoals}</p>;
  else if (result.done) body = <p className="s-big cov-done">{C.done}</p>;
  else {
    const best = result.ways.find((w) => w.key === "cheapest");
    const lock = linesToLock(state.lines, state.goals, best.first).sort((a, b) => a - b);
    const what = lock.map((i) => C.lineName(i + 1, C.stats[state.lines[i].stat], state.lines[i].level)).join(C.and);
    // a way that comes out the same as the cheapest one isn't repeated: the cheapest says so
    const same = (w) => Math.abs(w.rerolls - best.rerolls) <= 1e-9 * best.rerolls && Math.abs(w.materials.inQuills - best.materials.inQuills) <= 1e-9 * best.materials.inQuills;
    const ways = result.ways.filter((w) => w === best || !same(w));
    best.sameAs = result.ways.filter((w) => w !== best && same(w)).map((w) => w.key);
    body = (
      <>
        <p className="s-big">{highlight(C.average, fmtInt(best.rerolls))}</p>
        {best.p90 != null && <p className="s-second">{highlight(C.nine, fmtInt(best.p90))}</p>}
        <p className="cov-next">
          <span className="cov-next-icon" aria-hidden="true">🔒</span>
          <span><strong>{C.next}</strong> {lock.length ? C.nextLock(what) : C.nextNoLock} <span className="muted">{C.nextAfter}</span></span>
        </p>
        <span className="s-eyebrow">{C.averages}</span>
        <div className="cov-mats" aria-label={C.averages}>
          {["roseScript", "seals", "quills"].map((k) => (
            <div key={k} className="s-stat cov-mat">
              <dt>{C.materials[k]}</dt>
              <dd><img src={icon(k === "roseScript" ? "rose-script" : k)} alt="" aria-hidden="true" />{k === "quills" ? fmtQuills(best.materials.quills, L) : fmtBig(best.materials[k], L)}</dd>
            </div>
          ))}
        </div>
        <p className="s-hint cov-inquills">{highlight(C.inQuills, fmtQuills(best.materials.inQuills, L))}</p>
        <WaysTable ways={ways} />
        <WaysChart ways={ways} best={best} />
      </>
    );
  }
  return <section className="s-card s-answer" aria-label={C.answerLabel}>{body}</section>;
}

function wayName(w, C) {
  if (w.key === "cheapest") {
    const sub = w.byLocks[1] + w.byLocks[2] > 0 ? C.waysSub.cheapestLocks : C.waysSub.cheapestNoLocks;
    return [C.ways.cheapest, w.sameAs?.length ? `${sub} · ${C.waysSub.sameAs(w.sameAs.map((k) => C.ways[k].toLowerCase()).join(", "))}` : sub];
  }
  if (w.key === "fewest2") return [C.ways.fewest2, C.waysSub.fewest2];
  return [C.ways[w.key], null];
}

function WaysTable({ ways }) {
  const T = useContextT();
  const C = T.covenant;
  const L = T.numberLocale;
  const cols = [C.colRerolls, C.col90, C.materials.roseScript, C.materials.seals, C.materials.quills, C.colInQuills];
  return (
    <div className="cov-ways">
      <div className="s-eyebrow-row">
        <span className="s-eyebrow">{C.waysTitle}</span>
        <HelpButton label={C.waysTitle} text={C.waysHelp} />
      </div>
      <div className="st-table cov-table" role="table" aria-label={C.waysTitle} style={{ "--cols": cols.length }}>
        <div className="st-row st-head" role="row">
          <span role="columnheader" />
          {cols.map((c) => <span key={c} role="columnheader" className="st-num">{c}</span>)}
        </div>
        {ways.map((w, i) => {
          const [name, sub] = wayName(w, C);
          const values = [fmtBig(w.rerolls, L), w.p90 != null ? fmtBig(w.p90, L) : "-", fmtBig(w.materials.roseScript, L), fmtBig(w.materials.seals, L), fmtQuills(w.materials.quills, L), fmtQuills(w.materials.inQuills, L)];
          return (
            <div key={w.key} className={`st-row ${w.key === "cheapest" ? "is-best" : ""}`} role="row">
              <span className="st-name" role="cell">
                <span className="swatch" style={{ "--c": `var(--s${(i % 6) + 1})` }} aria-hidden="true" />
                <span className="cov-way"><span>{name}</span>{sub && <small>{sub}</small>}</span>
              </span>
              {values.map((v, k) => (
                <span key={k} role="cell" className={`st-num ${w.key === "cheapest" && (k === 0 || k === 5) ? "is-main" : ""}`}><span className="st-label">{cols[k]}</span>{v}</span>
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// The chance to be done by each reroll, one line per way, up to where the cheapest way is
// done 99 times in 100
function WaysChart({ ways, best }) {
  const T = useContextT();
  const C = T.covenant;
  const phone = usePhone();
  const chartRef = useRef(null);
  const data = useMemo(() => {
    const Cs = themeColors();
    const last = Math.max(10, Math.ceil((best.p99 ?? best.rerolls * 5) * 1.1));
    const datasets = ways.map((w, i) => {
      const { xs, ys } = w.curve(last);
      return {
        label: wayName(w, C)[0], data: xs.map((x, j) => ({ x, y: ys[j] })),
        borderColor: Cs.series[i % Cs.series.length], backgroundColor: Cs.series[i % Cs.series.length],
        borderWidth: w.key === "cheapest" ? 2.5 : 2, pointRadius: 0,
      };
    });
    return { Cs, last, datasets };
  }, [ways, best, C]);
  const csv = () => {
    const rows = [[C.csvReroll, ...data.datasets.map((d) => d.label)]];
    data.datasets[0].data.forEach((p, j) => rows.push([p.x, ...data.datasets.map((d) => d.data[j]?.y ?? "")]));
    return rows;
  };
  return (
    <div className="chart-wrapper">
      <div className="chart-toolbar">
        <span className="field-label">{C.chartTitle}</span>
        <ChartExport onCsv={() => downloadCsv(`${C.fileName}.csv`, csv())}
          onImage={() => chartRef.current && downloadWithLabels(chartRef.current, `${C.fileName}.png`, imageLabels(C.chartTitle))} />
      </div>
      <div className="chart-container">
        <Line ref={chartRef} data={{ datasets: data.datasets }}
          options={{
            responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
            interaction: { mode: "index", intersect: false },
            layout: phoneLayout(phone),
            scales: {
              x: { type: "linear", min: 0, max: data.last, title: { display: true, text: C.chartX, color: data.Cs.tick }, ticks: { color: data.Cs.tick, callback: (v) => fmtInt(v), maxTicksLimit: phone ? 5 : 8 }, grid: { color: data.Cs.grid }, border: { color: data.Cs.grid } },
              y: yAxis(phone, data.Cs, (v) => `${Math.round(v * 100)}%`, { min: 0, max: 1 }),
            },
            plugins: {
              legend: { display: true, position: "bottom", labels: { boxWidth: 14, boxHeight: 3, color: data.Cs.tick } },
              tooltip: { callbacks: { title: (it) => C.reroll(fmtInt(it[0]?.parsed.x)), label: (c) => `${c.dataset.label}: ${(c.parsed.y * 100).toLocaleString(T.numberLocale, { maximumFractionDigits: 2 })}%` } },
            },
          }} />
      </div>
    </div>
  );
}
const imageLabels = (title) => {
  const cs = getComputedStyle(document.documentElement);
  const v = (n, d) => cs.getPropertyValue(n).trim() || d;
  return { background: v("--pop-bg", "#ffffff"), ink: v("--ink", "#000000"), muted: v("--ink-2", "#555555"), title, subtitle: "" };
};
function ChartExport({ onCsv, onImage }) {
  const T = useContextT();
  const L = T.chart;
  const { open, setOpen, ref } = usePopup();
  const run = (fn) => { setOpen(false); fn(); };
  return (
    <div className="lines-menu" ref={ref}>
      <button type="button" className="btn btn--sm" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{L.export} ▾</button>
      {open && (
        <div className="lines-pop" role="menu" aria-label={L.export}>
          <button type="button" role="menuitem" className="menu-item" onClick={() => run(onCsv)}>{T.covenant.exportCsv}</button>
          <button type="button" role="menuitem" className="menu-item" onClick={() => run(onImage)}>{L.exportImage}</button>
        </div>
      )}
    </div>
  );
}
