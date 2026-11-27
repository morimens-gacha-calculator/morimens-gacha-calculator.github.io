import { useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { I18nContext, useT as useContextT, withWording } from "../i18n/index.js";
import { fmtInt, newId } from "../model.js";
import { Background, SiteFooter, SiteHeader, loadLang, saveLang } from "../components/SiteParts.jsx";
import { HelpButton } from "../components/Help.jsx";
import { TrashIcon } from "../components/Icon.jsx";
import { downloadWithLabels, phoneLayout, themeColors, usePhone, usePopup, yAxis } from "../components/ResultChart.jsx";
import { downloadCsv, shareCard } from "../export.js";
import { Notices, useShare } from "../components/Share.jsx";
import { covenantCode, covenantLink, covenantShare, covenantShortLink, decodeCovenant } from "./share.js";
import { linesToLock, solveCovenant } from "./engine.js";
import { COSTS, LEVELS, LINES, MAX_GOALS, PIECES, SUBSTATS } from "./rates.js";

const NEW_GOAL_LEVEL = 6; // a new goal starts here (and the odds hint shows Lv 6+)

// The covenant substat calculator: a piece's 3 substat lines now, the lines you want, and how
// many rerolls and materials that takes (engine.js). The same two cards as the banner
// calculator: your covenant on the left, the answer on the right. Simple view: the simple rule
// (lock each line the moment it meets a goal, and keep it). Full view: every way of locking side
// by side, the cheapest one's numbers, and the whole plan of the way you pick.

const ICONS = import.meta.glob("../assets/covenant/*.{png,webp}", { eager: true, import: "default" });
const icon = (name) => Object.entries(ICONS).find(([p]) => p.includes(`/${name}.`))?.[1];

const STORE_KEY = "covenant-calc-v1";
const VIEW_KEY = "covenant-calc-view";
const fresh = () => ({
  lines: [{ stat: "critRate", level: 8 }, { stat: "keyflareRegen", level: 6 }, { stat: "critRate", level: 5 }],
  goals: [{ id: newId(), stat: "critRate", level: 6 }, { id: newId(), stat: "critDmg", level: 6 }],
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

const readView = () => { try { return localStorage.getItem(VIEW_KEY) === "full" ? "full" : "simple"; } catch { return "simple"; } };

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
  const [view, setView] = useState(readView);
  const full = view === "full";
  useEffect(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch { /* no storage */ } }, [state]);
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch { /* no storage */ } }, [view]);
  useEffect(() => {
    const before = document.title;
    document.title = C.pageTitle;
    return () => { document.title = before; };
  }, [C.pageTitle]);

  const result = useMemo(() => (state.goals.length ? solveCovenant({ lines: state.lines, goals: state.goals }) : null), [state]);

  // a shared link (#c=…) opens its covenant; Undo brings yours back
  const [undoState, setUndoState] = useState(null);
  const [linkError, setLinkError] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    // on opening the page, and when a link is pasted into this tab's address bar
    const open = () => {
      const code = covenantCode(location.hash);
      if (code == null) return;
      const shared = decodeCovenant(code);
      if (shared) {
        setUndoState(stateRef.current);
        setState({ lines: shared.lines, goals: shared.goals.map((g) => ({ ...g, id: newId() })) });
      } else setLinkError(true);
      history.replaceState(null, "", location.pathname + location.search);
    };
    open();
    addEventListener("hashchange", open);
    return () => removeEventListener("hashchange", open);
  }, []);
  // Share: a short link with its own preview card where the site's server functions are there
  // (Cloudflare), else the long "#c=" link
  const { share, shareMsg, clearShare } = useShare(async () => {
    const parts = covenantShare(state, result, T, full ? "cheapest" : "asTheyCome");
    let image = null;
    try { image = shareCard(parts, document.querySelector(".chart-container canvas")); } catch { /* text-only card */ }
    const url = (await covenantShortLink(state, parts, image)) ?? covenantLink(state);
    return { url, summary: parts.summary };
  });

  return (
    <I18nContext.Provider value={T}>
      <Background view={full ? "full" : "simple"} />
      <main className="main">
        <section className={`content-box ${full ? "is-full" : "is-simple"}`} aria-label={C.pageTitle}>
          <SiteHeader calc="covenant" onGo={onGo} lang={lang} onLang={(code) => { saveLang(code); setLang(code); }}>
            <div className="view-switch" role="group" aria-label={T.app.viewLabel}>
              <button type="button" aria-pressed={!full} className={!full ? "is-on" : ""} onClick={() => setView("simple")}>{T.app.viewSimple}</button>
              <button type="button" aria-pressed={full} className={full ? "is-on" : ""} onClick={() => setView("full")}>{T.app.viewFull}</button>
            </div>
            <button type="button" className="btn btn--primary header-share" onClick={share} title={C.shareTitle}>{T.app.share}</button>
          </SiteHeader>
          <Notices shareMsg={shareMsg} clearShare={clearShare}
            canUndo={!!undoState} undoText={T.app.sharedLoaded}
            onUndo={() => { setState(undoState); setUndoState(null); }} onDismissUndo={() => setUndoState(null)}
            linkError={linkError} onDismissError={() => setLinkError(false)} />
          <div className="app-layout">
            <PieceCard state={state} setState={setState} />
            <div className="s-side">
              <AnswerCard state={state} result={result} full={full} onOtherView={() => setView(full ? "simple" : "full")} />
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
    return { ...s, goals: [...s.goals, { id: newId(), stat, level: NEW_GOAL_LEVEL }] };
  });
  return (
    <section className="s-card s-plan cov-card" aria-label={C.planLabel}>
      <h2 className="s-lead">{C.current}<HelpButton label={C.howTitle} text={<HowItWorks />} /></h2>
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

// Right: the answer. Simple view: the simple rule's numbers and next step. Full view: the
// cheapest way's, every way side by side, and the whole plan of the way you pick.
function AnswerCard({ state, result, full, onOtherView }) {
  const T = useContextT();
  const C = T.covenant;
  const L = T.numberLocale;
  const actions = (
    <div className="s-actions">
      <button type="button" className="btn btn--secondary" onClick={onOtherView}>{full ? T.app.toSimple : T.simple.details}</button>
    </div>
  );
  let body;
  if (!result) body = <><p className="s-hint">{C.noGoals}</p>{actions}</>;
  else if (result.done) body = <><p className="s-big cov-done">{C.done}</p>{actions}</>;
  else {
    const way = (k) => result.ways.find((w) => w.key === k);
    const main = way(full ? "cheapest" : "asTheyCome");
    const lock = linesToLock(state.lines, state.goals, main.first).sort((a, b) => a - b);
    const what = lock.map((i) => C.lineName(i + 1, C.stats[state.lines[i].stat], state.lines[i].level)).join(C.and);
    // full view: a way that comes out the same as one above it is folded into that row
    const shown = [];
    for (const w of ["cheapest", "asTheyCome", "fewest2", "fewest1", "none"].map(way)) {
      const twin = shown.find((x) => sameWay(x, w));
      if (twin) twin.sameAs.push(w.key); else shown.push({ ...w, sameAs: [] });
    }
    body = (
      <>
        <p className="s-big">{highlight(C.average, fmtInt(main.rerolls))}</p>
        {main.p90 != null && <p className="s-second">{highlight(C.nine, fmtInt(main.p90))}</p>}
        <p className="s-sure cov-next">{C.next} {lock.length ? C.nextLock(what) : C.nextNoLock}</p>
        <p className="s-hint">{full ? C.nextAfter : `${C.ruleSimple} ${C.nextAfter}`}</p>
        <dl className="s-stats cov-mats">
          {["roseScript", "seals", "quills"].map((k) => (
            <div key={k} className="s-stat cov-mat">
              <dt>{C.matAverage[k]}</dt>
              <dd><img src={icon(k === "roseScript" ? "rose-script" : k)} alt="" aria-hidden="true" />{k === "quills" ? fmtQuills(main.materials.quills, L) : fmtBig(main.materials[k], L)}</dd>
            </div>
          ))}
        </dl>
        <p className="s-hint">{C.inQuills(fmtQuills(main.materials.inQuills, L))}</p>
        {full && <WaysTable ways={shown} />}
        {full && <PlanSection result={result} state={state} ways={shown} />}
        <WaysChart ways={full ? shown : [main]} best={main} />
        {actions}
      </>
    );
  }
  return <section className="s-card s-answer" aria-label={C.answerLabel}>{body}</section>;
}
const sameWay = (a, b) => Math.abs(a.rerolls - b.rerolls) <= 1e-9 * Math.max(1, a.rerolls) && Math.abs(a.materials.inQuills - b.materials.inQuills) <= 1e-9 * Math.max(1, a.materials.inQuills);

// The odds behind it all, from the game's own numbers (rates.js), in a few plain sentences like
// the banners' descriptions
function HowItWorks() {
  const T = useContextT();
  const H = T.covenant.how;
  const L = T.numberLocale;
  const pct = (x) => `${(x * 100).toLocaleString(L, { maximumFractionDigits: 3 })}%`;
  const subs = PIECES[0].substats, SW = subs.reduce((a, x) => a + x.weight, 0);
  const LW = LEVELS.reduce((a, l) => a + l.weight, 0);
  const atLeast = (lv) => LEVELS.filter((l) => l.level >= lv).reduce((a, l) => a + l.weight, 0) / LW;
  const one = subs[0].weight / SW;
  const levels = LEVELS.map((l) => H.level(l.level, pct(l.weight / LW))).join(", ");
  return (
    <>
      {H.draw(pct(one), levels)}<br />
      {H.example(pct(one * atLeast(NEW_GOAL_LEVEL)), pct(one * atLeast(8)))}<br />
      {H.value(valueText("critRate", 1, L), valueText("critRate", 8, L))} {H.costs(fmtInt(COSTS.roseScript), COSTS.seals, COSTS.lockQuills[1], COSTS.lockQuills[2])}
    </>
  );
}

// The full plan of one way: every situation it can reach, what to lock there and how many
// rerolls are left on average from there
function PlanSection({ result, state, ways }) {
  const T = useContextT();
  const C = T.covenant;
  const L = T.numberLocale;
  const choices = ways.filter((w) => w.key === "cheapest" || w.key === "asTheyCome");
  const [pick, setPick] = useState("cheapest");
  const w = choices.find((x) => x.key === pick) ?? choices[0];
  // a line by the hardest goal it meets ("Crit. Rate 8+")
  const lineText = (m) => {
    const gs = state.goals.filter((_, i) => (m >> i) & 1);
    const g = gs.reduce((a, x) => (x.level > a.level ? x : a), gs[0]);
    return C.share.goal(C.stats[g.stat].replace(/\s*Lv\.$/, ""), g.level);
  };
  // a situation by the goals its lines meet together (each line one goal): extra lines that only
  // repeat a goal change nothing, so such situations are one row
  const metGoals = (masks) => {
    let best = [];
    const rec = (g, used, got) => {
      if (g === state.goals.length) { if (got.length > best.length) best = got; return; }
      rec(g + 1, used, got);
      masks.forEach((m, i) => { if (!((used >> i) & 1) && ((m >> g) & 1)) rec(g + 1, used | (1 << i), [...got, g]); });
    };
    rec(0, 0, []);
    return best;
  };
  const have = (masks) => { const gs = metGoals(masks); return gs.length ? gs.map((g) => lineText(1 << g)).join(" · ") : C.planNothing; };
  const rows = [];
  for (const step of w.plan) {
    const met = metGoals(step.masks).length;
    const key = `${have(step.masks)}|${step.kept.map(lineText).join("+")}`;
    const row = rows.find((r) => r.key === key);
    if (row) { row.lo = Math.min(row.lo, step.rerollsLeft); row.hi = Math.max(row.hi, step.rerollsLeft); row.start ||= step.start; }
    else rows.push({ key, met, masks: step.masks, kept: step.kept, locks: step.locks, start: step.start, lo: step.rerollsLeft, hi: step.rerollsLeft });
  }
  rows.sort((a, b) => b.start - a.start || a.met - b.met || b.hi - a.hi);
  const left = (r) => (Math.round(r.lo) === Math.round(r.hi) ? fmtBig(r.lo, L) : `${C.planRange(fmtBig(r.lo, L), fmtBig(r.hi, L))}`);
  const quillsPer = (locks) => (COSTS.seals / 20 + COSTS.lockQuills[locks]).toLocaleString(L, { maximumFractionDigits: 2 });
  const cols = [C.planHave, C.planDo, C.planLeft];
  return (
    <div className="cov-ways">
      <div className="s-eyebrow-row">
        <span className="s-eyebrow">{C.planTitle}</span>
        <HelpButton label={C.planTitle} text={C.planHelp} />
      </div>
      {choices.length > 1 && (
        <div className="seg" role="tablist" aria-label={C.planTitle}>
          {choices.map((x) => (
            <button key={x.key} type="button" role="tab" aria-selected={w.key === x.key} className={w.key === x.key ? "is-on" : ""} onClick={() => setPick(x.key)}>{C.ways[x.key]}</button>
          ))}
        </div>
      )}
      <div className="st-table cov-plan" role="table" aria-label={C.planTitle}>
        <div className="st-row st-head" role="row">{cols.map((c, k) => <span key={c} role="columnheader" className={k === 2 ? "st-num" : ""}>{c}</span>)}</div>
        {rows.map((r) => (
          <div key={r.key} className="st-row" role="row">
            <span role="cell" className="st-name"><span>{r.start ? C.planNow(have(r.masks)) : have(r.masks)}</span></span>
            <span role="cell" className="cov-plan-do">
              <span className="st-label">{cols[1]}</span>
              {r.kept.length ? C.planLock(r.kept.map(lineText).join(C.and)) : C.planReroll}
              <small>{C.planCost(quillsPer(r.locks))}</small>
            </span>
            <span role="cell" className="st-num"><span className="st-label">{cols[2]}</span>{left(r)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function wayName(w, C) {
  let sub = C.waysSub[w.key] ?? null;
  if (w.key === "cheapest") sub = w.byLocks[1] + w.byLocks[2] > 0 ? C.waysSub.cheapestLocks : C.waysSub.cheapestNoLocks;
  if (w.sameAs?.length) sub = [sub, C.waysSub.sameAs(w.sameAs.map((k) => C.ways[k].toLowerCase()).join(", "))].filter(Boolean).join(" · ");
  return [C.ways[w.key], sub];
}

function WaysTable({ ways }) {
  const T = useContextT();
  const C = T.covenant;
  const L = T.numberLocale;
  const cols = [C.colRerolls, C.col90, C.materials.roseScript, C.materials.seals, C.materials.quills, C.colInQuills];
  return (
    <div className="cov-ways">
      <div className="st-table cov-table" role="table" aria-label={C.waysTitle} style={{ "--cols": cols.length }}>
        <div className="st-row st-head" role="row">
          <span role="columnheader" className="cov-ways-head">{C.waysTitle}<HelpButton label={C.waysTitle} text={C.waysHelp} /></span>
          {cols.map((c) => <span key={c} role="columnheader" className="st-num">{c}</span>)}
        </div>
        {ways.map((w, i) => {
          const [name, sub] = wayName(w, C);
          const values = [fmtBig(w.rerolls, L), w.p90 != null ? fmtBig(w.p90, L) : "-", fmtBig(w.materials.roseScript, L), fmtBig(w.materials.seals, L), fmtQuills(w.materials.quills, L), fmtQuills(w.materials.inQuills, L)];
          return (
            <div key={w.key} className="st-row" role="row">
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
              legend: { display: data.datasets.length > 1, position: "bottom", labels: { boxWidth: 14, boxHeight: 3, color: data.Cs.tick } },
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
