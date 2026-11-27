import { useEffect, useMemo, useRef, useState } from "react";
import { Line } from "react-chartjs-2";
import { I18nContext, useT as useContextT, withWording } from "../i18n/index.js";
import { Background, SiteFooter, SiteHeader, hrefOf, loadLang, saveLang, whereAmI } from "../components/SiteParts.jsx";
import { HelpButton } from "../components/Help.jsx";
import NumberInput from "../components/NumberInput.jsx";
import { phoneLayout, themeColors, usePhone, yAxis } from "../components/ResultChart.jsx";
import { Notices, useShare } from "../components/Share.jsx";
import { download, fileName, shareCard } from "../export.js";
import { fmtDate, planImage, planLines, planText } from "./export.js";
import { postShortLink } from "../share.js";
import { incomeTotals, loadIncome } from "../income/income.js";
import { solvePlan } from "./engine.js";
import {
  CHARACTERS, DAYS, KINDS, LEVELS, ONE_OFFS, bankByDay, copiesOn, dateOf, dayOf, decodePlan, defaultPlan,
  encodePlan, iconName, levelBefore, loadPlan, planCode, planQuery, savePlan,
} from "./plan.js";

// Anniversary reruns: your bank, pity and the event's rewards on the left; the chance of your
// whole plan, what you'd have left and a chart of your pulls by day on the right; under them the
// 35 rerun days, each with its character's and its wheel's Now and Goal.

const PORTRAITS = import.meta.glob("../assets/reruns/*.webp", { eager: true, import: "default" });
const portrait = (name) => Object.entries(PORTRAITS).find(([p]) => p.endsWith(`/${iconName(name)}.webp`))?.[1];
const ICONS = import.meta.glob("../assets/income/*.webp", { eager: true, import: "default" });
const icon = (name) => Object.entries(ICONS).find(([p]) => p.includes(`/${name}.`))?.[1];
const Icon = ({ name }) => <img className="inc-icon" src={icon(name)} alt="" aria-hidden="true" />;

const MARK = "\u0001";
function highlight(template, value) {
  const [before, after = ""] = template(MARK).split(MARK);
  return <>{before}<strong className="s-hl">{value}</strong>{after}</>;
}
const int = (x, L) => Math.round(x).toLocaleString(L);
export const pct = (p, L) => {
  if (p >= 0.9995) return p === 1 ? "100%" : ">99.9%";
  if (p < 0.0005) return p === 0 ? "0%" : "<0.1%";
  return `${(Math.round(p * 1000) / 10).toLocaleString(L)}%`;
};
const tone = (p) => (p >= 0.9 ? "is-good" : p >= 0.5 ? "is-mid" : "is-bad");
const WEEK = [1, 2, 3, 4, 5, 6, 0]; // Monday first, as the first rerun day
const VIEW_KEY = "reruns-view";

// The plan worked out in a worker (the newest question wins); in the page if workers aren't there
function usePlanResult(query) {
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const worker = useRef(null), last = useRef(0);
  useEffect(() => {
    try { worker.current = new Worker(new URL("./plan.worker.js", import.meta.url), { type: "module" }); } catch { worker.current = null; }
    const w = worker.current;
    if (w) w.onmessage = (e) => { if (e.data.id === last.current) { setResult(e.data.result); setBusy(false); } };
    return () => w?.terminate();
  }, []);
  useEffect(() => {
    const id = ++last.current;
    if (worker.current) { setBusy(true); worker.current.postMessage({ id, query }); }
    else setResult(solvePlan(query));
  }, [query]);
  return { result, busy };
}

export default function RerunsApp({ onGo }) {
  const [lang, setLang] = useState(loadLang);
  const T = useMemo(() => withWording(lang, false), [lang]);
  const R = T.reruns;
  const [plan, setPlan] = useState(() => loadPlan());
  const [view, setViewState] = useState(() => { try { return localStorage.getItem(VIEW_KEY) === "compact" ? "compact" : "full"; } catch { return "full"; } });
  const setView = (v) => { setViewState(v); try { localStorage.setItem(VIEW_KEY, v); } catch { /* no storage */ } };
  useEffect(() => { savePlan(plan); }, [plan]);
  // the income from the Pull income page, and today's date: read again when you come back here
  const [income, setIncome] = useState(() => loadIncome());
  const [today, setToday] = useState(() => dayOf(new Date()));
  useEffect(() => {
    const again = () => { setIncome(loadIncome()); setToday(dayOf(new Date())); };
    addEventListener("focus", again);
    addEventListener("storage", again);
    return () => { removeEventListener("focus", again); removeEventListener("storage", again); };
  }, []);
  useEffect(() => {
    const before = document.title;
    document.title = R.pageTitle;
    return () => { document.title = before; };
  }, [R.pageTitle]);

  const query = useMemo(() => planQuery(plan, income, today), [plan, income, today]);
  const { result, busy } = usePlanResult(query);
  const banks = useMemo(() => bankByDay(plan, income, today), [plan, income, today]);

  // a shared link (#r=…) opens its plan; Clear plan empties the goals: Undo brings yours back
  const [undo, setUndo] = useState(null);
  const [linkError, setLinkError] = useState(false);
  const planRef = useRef(plan);
  planRef.current = plan;
  useEffect(() => {
    const open = () => {
      const code = planCode(location.hash);
      if (code == null) return;
      const shared = decodePlan(code);
      if (shared) { setUndo({ plan: planRef.current, text: T.app.sharedLoaded }); setPlan(shared); }
      else setLinkError(true);
      history.replaceState(null, "", location.pathname + location.search);
    };
    open();
    addEventListener("hashchange", open);
    return () => removeEventListener("hashchange", open);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const clearGoals = () => { setUndo({ plan, text: R.cleared }); setPlan((p) => ({ ...p, goals: defaultPlan().goals })); };

  const { share, shareMsg, clearShare } = useShare(async () => {
    const parts = rerunsShare(plan, query, result, income, today, T);
    let image = null;
    try { image = shareCard(parts, document.querySelector(".rr-answer .chart-container canvas")); } catch { /* text-only card */ }
    const code = encodePlan(plan);
    const { origin, pathname, search } = window.location;
    const url = (await postShortLink({ calc: "reruns", code, title: parts.title, detail: parts.detail, image })) ?? `${origin}${pathname}${search}#r=${code}`;
    return { url, summary: parts.summary };
  });

  return (
    <I18nContext.Provider value={T}>
      <Background view="simple" />
      <main className="main">
        <section className="content-box is-simple" aria-label={R.pageTitle}>
          <SiteHeader calc="reruns" onGo={onGo} lang={lang} onLang={(code) => { saveLang(code); setLang(code); }}>
            <div className="view-switch" role="group" aria-label={T.app.viewLabel}>
              <button type="button" aria-pressed={view === "full"} className={view === "full" ? "is-on" : ""} onClick={() => setView("full")}>{R.viewFull}</button>
              <button type="button" aria-pressed={view === "compact"} className={view === "compact" ? "is-on" : ""} onClick={() => setView("compact")}>{R.viewCompact}</button>
            </div>
            <button type="button" className="btn btn--primary header-share" onClick={share} title={R.shareTitle}>{T.app.share}</button>
          </SiteHeader>
          <Notices shareMsg={shareMsg} clearShare={clearShare}
            canUndo={!!undo} undoText={undo?.text} onUndo={() => { setPlan(undo.plan); setUndo(null); }} onDismissUndo={() => setUndo(null)}
            linkError={linkError} onDismissError={() => setLinkError(false)} />
          {today >= DAYS ? <p className="s-hint rr-over">{R.over}</p> : view === "compact" ? (
            <CompactPlan plan={plan} query={query} result={result} banks={banks} today={today} />
          ) : (
            <>
              <div className="app-layout">
                <BankCard plan={plan} setPlan={setPlan} income={income} today={today} onGo={onGo} />
                <div className="s-side">
                  <AnswerCard plan={plan} query={query} result={result} busy={busy} banks={banks} today={today} />
                </div>
              </div>
              <Calendar plan={plan} setPlan={setPlan} query={query} result={result} today={today} onClear={clearGoals} />
            </>
          )}
        </section>
      </main>
      <SiteFooter />
    </I18nContext.Provider>
  );
}

// ── Left: what you hold now, your pity, your income and the event's rewards ──
function BankCard({ plan, setPlan, income, today, onGo }) {
  const T = useContextT();
  const R = T.reruns;
  const L = T.numberLocale;
  const perDay = incomeTotals(income).perDay.pulls;
  const setPity = (kind, patch) => setPlan((p) => ({ ...p, pity: { ...p.pity, [kind]: { ...p.pity[kind], ...patch } } }));
  return (
    <section className="s-card s-plan rr-bank" aria-label={R.bankTitle}>
      <h2 className="s-lead">{R.bankTitle}<HelpButton label={R.bankTitle} text={R.bankHelp} /></h2>
      <div className="rr-bank-row">
        <label className="field">
          <span className="field-label rr-label"><Icon name="limited-pull" />{R.pulls}</span>
          <NumberInput className="custom-input" value={plan.pulls} min={0} max={1e6} onChange={(v) => setPlan((p) => ({ ...p, pulls: v }))} />
        </label>
        <label className="field">
          <span className="field-label rr-label"><Icon name="silver" />{R.silver}</span>
          <NumberInput className="custom-input" value={plan.silver} min={0} max={1e8} onChange={(v) => setPlan((p) => ({ ...p, silver: v }))} />
        </label>
      </div>

      <div className="field">
        <span className="field-label rr-label">{R.pityTitle}<HelpButton label={R.pityTitle} text={R.pityHelp} /></span>
        <div className="rr-pity" role="group" aria-label={R.pityTitle}>
          <span />
          <span className="rr-pity-head">{R.sinceSsr}</span>
          <span className="rr-pity-head">{R.inARow}</span>
          {KINDS.map((kind) => (
            <span key={kind} className="rr-pity-row">
              <span className="rr-pity-name">{R.pityKinds[kind]}</span>
              <NumberInput className="custom-input rr-small" value={plan.pity[kind].k} min={0} max={29} onChange={(v) => setPity(kind, { k: v })} aria-label={`${R.pityKinds[kind]}: ${R.sinceSsr}`} />
              <select className="select rr-small" value={plan.pity[kind].l} onChange={(e) => setPity(kind, { l: Number(e.target.value) })} aria-label={`${R.pityKinds[kind]}: ${R.inARow}`}>
                {Array.from({ length: kind === "char" ? 3 : 2 }, (_, i) => <option key={i} value={i}>{i}</option>)}
              </select>
            </span>
          ))}
        </div>
      </div>

      <div className="field">
        <span className="field-label rr-label">{R.incomeTitle}</span>
        <p className="rr-income">
          {highlight(R.incomeLine, (Math.round(perDay * 100) / 100).toLocaleString(L))}{" "}
          <a href={hrefOf(whereAmI().root, "income")} className="rr-link" onClick={(e) => { e.preventDefault(); onGo("income"); }}>{R.editIncome}</a>
        </p>
      </div>

      <div className="field">
        <span className="field-label rr-label">{R.giftsTitle(fmtDate(dateOf(0), L))}</span>
        <div className="rr-gifts">
          {ONE_OFFS.map((o) => (
            <label key={o.key} className={`rr-gift ${today >= o.day ? "is-past" : ""}`}>
              <input type="checkbox" checked={plan.oneOffs[o.key]} disabled={today >= o.day}
                onChange={(e) => setPlan((p) => ({ ...p, oneOffs: { ...p.oneOffs, [o.key]: e.target.checked } }))} />
              <span className="rr-gift-name">{R.gifts[o.key]}</span>
              {o.paid && <img className="inc-paid" src={icon("silver-prime")} alt={T.income.paid} title={T.income.paid} />}
              <span className="rr-gift-value">{giftValue(o, R, L)}</span>
            </label>
          ))}
        </div>
      </div>
    </section>
  );
}
const giftValue = (o, R, L) => [o.pulls ? R.pullsN(o.pulls.toLocaleString(L)) : null, o.silver ? R.silverN(o.silver.toLocaleString(L)) : null].filter(Boolean).join(", ");

// ── Right: the answer and the chart ──
function AnswerCard({ plan, query, result, busy, banks, today }) {
  const T = useContextT();
  const R = T.reruns;
  const L = T.numberLocale;
  const planned = query.banners.filter((b) => b.copies > 0);
  const copies = planned.reduce((a, b) => a + b.copies, 0);
  const lastDay = result?.days?.[result.days.length - 1];
  const bankEnd = banks[DAYS - 1];
  const riskiest = result && planned.length ? planned.map((b) => ({ b, chance: result.banners[query.banners.indexOf(b)].chance })).sort((x, y) => x.chance - y.chance)[0] : null;
  const name = (b) => (b.type === "char" ? CHARACTERS[b.at] : T.presets.wheelOf(CHARACTERS[b.at]));
  return (
    <section className={`s-card s-answer rr-answer ${busy ? "is-updating" : ""}`} aria-label={R.answerLabel} aria-busy={busy}>
      {!result ? <p className="s-hint">{R.working}</p> : copies ? (
        <>
          <p className="s-big">{highlight((p) => R.headline(p, int(copies, L)), pct(result.chance, L))}</p>
          <p className="s-second">{highlight(R.cost, int(result.spent, L))}</p>
          {riskiest && riskiest.chance < 0.9995 && <p className="s-hint">{R.riskiest(name(riskiest.b), fmtDate(dateOf(riskiest.b.at), L), pct(riskiest.chance, L))}</p>}
        </>
      ) : (
        <>
          <p className="s-big">{highlight((x) => R.headlineNone(x, fmtDate(dateOf(DAYS - 1), L)), int(bankEnd, L))}</p>
          <p className="s-hint">{R.none}</p>
        </>
      )}
      {result && (
        <dl className="s-stats">
          <div className="s-stat"><dt>{R.statFirst(fmtDate(dateOf(query.first), L))}</dt><dd>{int(banks[query.first], L)}</dd></div>
          <div className="s-stat"><dt>{R.statNothing(fmtDate(dateOf(DAYS - 1), L))}</dt><dd>{int(bankEnd, L)}</dd></div>
          {copies > 0 && lastDay && <div className="s-stat"><dt>{R.statLeft(fmtDate(dateOf(DAYS - 1), L))}</dt><dd>{int(lastDay.p50, L)}</dd><span className="s-stat-sub">{R.range(int(lastDay.p10, L), int(lastDay.p90, L))}</span></div>}
        </dl>
      )}
      {result && <BankChart query={query} result={result} banks={banks} plan={plan} today={today} />}
    </section>
  );
}

function BankChart({ query, result, banks }) {
  const T = useContextT();
  const R = T.reruns;
  const L = T.numberLocale;
  const phone = usePhone();
  const data = useMemo(() => {
    const Cs = themeColors();
    const xs = result.days.map((_, i) => query.first + i);
    const at = (f) => xs.map((x, i) => ({ x, y: f(i, x) }));
    const planned = query.banners.some((b) => b.copies > 0);
    const datasets = [
      { label: R.lineNothing, data: at((_, x) => banks[x]), borderColor: Cs.tick, borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, stepped: "middle" },
    ];
    if (planned) datasets.push(
      { label: R.lineLow, data: at((i) => result.days[i].p10), borderWidth: 0, pointRadius: 0, stepped: "middle", fill: false },
      { label: R.lineBand, data: at((i) => result.days[i].p90), borderWidth: 0, pointRadius: 0, stepped: "middle", fill: "-1", backgroundColor: Cs.fill },
      { label: R.lineMedian, data: at((i) => result.days[i].p50), borderColor: Cs.line, backgroundColor: Cs.line, borderWidth: 2.5, pointRadius: 0, stepped: "middle" },
    );
    return { Cs, datasets, min: xs[0], max: xs[xs.length - 1] };
  }, [query, result, banks, R]);
  return (
    <div className="chart-wrapper is-simple">
      <div className="chart-toolbar"><span className="field-label">{R.chartTitle}</span></div>
      <div className="chart-container rr-chart">
        <Line data={{ datasets: data.datasets }}
          options={{
            responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
            interaction: { mode: "index", intersect: false },
            layout: phoneLayout(phone),
            scales: {
              x: { type: "linear", min: data.min - 0.5, max: data.max + 0.5, ticks: { color: data.Cs.tick, autoSkip: false, maxRotation: 0, callback: (v) => fmtDate(dateOf(v), L) },
                afterBuildTicks: (axis) => { axis.ticks = Array.from({ length: DAYS }, (_, d) => d).filter((d) => d >= data.min && d <= data.max && dateOf(d).getDay() === 1).map((value) => ({ value })); }, grid: { color: data.Cs.grid }, border: { color: data.Cs.grid } },
              y: yAxis(phone, data.Cs, (v) => Math.round(v).toLocaleString(L), { min: 0 }),
            },
            plugins: {
              legend: { display: true, position: "bottom", labels: { boxWidth: 14, boxHeight: 3, color: data.Cs.tick, filter: (it) => it.text !== R.lineLow } },
              tooltip: {
                filter: (it) => it.dataset.label !== R.lineLow,
                callbacks: {
                  title: (it) => { const x = it[0]?.parsed.x; return `${fmtDate(dateOf(x), L, true)} · ${CHARACTERS[x]}`; },
                  label: (c) => {
                    const i = c.dataIndex;
                    if (c.dataset.label === R.lineBand) return R.range(int(result.days[i].p10, L), int(result.days[i].p90, L));
                    return `${c.dataset.label}: ${int(c.parsed.y, L)}`;
                  },
                },
              },
            },
          }} />
      </div>
      <p className="s-hint">{R.chartNote}</p>
    </div>
  );
}

// ── Under them: the rerun days ──
function Calendar({ plan, setPlan, query, result, today, onClear }) {
  const T = useContextT();
  const R = T.reruns;
  const L = T.numberLocale;
  const plannedDays = new Set(query.banners.filter((b) => b.copies > 0).map((b) => b.at)).size;
  const chanceOf = (day, kind) => {
    const i = query.banners.findIndex((b) => b.at === day && b.type === kind);
    return i >= 0 && query.banners[i].copies > 0 ? result?.banners?.[i]?.chance : null;
  };
  const setLevel = (kind, day, which, v) => setPlan((p) => {
    if (which === "goal") return { ...p, goals: p.goals.map((g, i) => (i === day ? { ...g, [kind]: v } : g)) };
    const name = CHARACTERS[day];
    return { ...p, now: { ...p.now, [kind]: { ...p.now[kind], [name]: v } } };
  });
  return (
    <section className="s-card rr-cal-card" aria-label={R.calendarTitle}>
      <div className="rr-cal-head">
        <h2 className="s-lead">{R.calendarTitle}<HelpButton label={R.calendarTitle} text={R.calendarHelp} /></h2>
        <span className="s-hint">{R.plannedDays(plannedDays, DAYS)}</span>
        <button type="button" className="btn btn--quiet btn--sm rr-clear" onClick={onClear}>{R.clear}</button>
      </div>
      <div className="rr-cal">
        {WEEK.map((wd) => <span key={wd} className="rr-wd" aria-hidden="true">{new Date(2026, 10, 29 + (wd || 7)).toLocaleDateString(L, { weekday: "short" })}</span>)}
        {CHARACTERS.map((name, day) => {
          const past = day < today;
          const copies = KINDS.map((k) => copiesOn(plan, k, day, today));
          const repeat = CHARACTERS.indexOf(name) !== day && CHARACTERS.indexOf(name) >= today;
          return (
            <div key={day} className={`rr-tile ${past ? "is-past" : copies.some(Boolean) ? "is-planned" : ""}`}>
              <div className="rr-por">
                <img src={portrait(name)} alt="" loading="lazy" />
                <span className="rr-date">{fmtDate(dateOf(day), L, true)}</span>
                {past && <span className="rr-ended">{R.ended}</span>}
              </div>
              <div className="rr-body">
                <b className="rr-name">{name}</b>
                <div className="rr-lv" role="group" aria-label={name}>
                  <span className="rr-lv-head">{R.now}</span>
                  <span className="rr-lv-head">{R.goal}</span>
                  {KINDS.map((kind, ki) => {
                    const before = levelBefore(plan, kind, day, today);
                    const goal = Math.max(before, plan.goals[day][kind]);
                    const chance = chanceOf(day, kind);
                    return (
                      <span key={kind} className="rr-lv-row">
                        <span className="rr-lv-kind">
                          <span>{R.kindsShort[kind]}</span>
                          {copies[ki] > 0 && (
                            <span className="rr-odds">
                              <span className="rr-plus">+{copies[ki]}</span>
                              <span className={`rr-pill ${chance == null ? "" : tone(chance)}`}>{chance == null ? "…" : pct(chance, L)}</span>
                            </span>
                          )}
                        </span>
                        <select className="select rr-sel" value={repeat ? before : plan.now[kind][name]} disabled={past || repeat}
                          title={repeat ? R.fromEarlier : undefined}
                          aria-label={`${name}, ${R.kinds[kind]}: ${R.now}`} onChange={(e) => setLevel(kind, day, "now", Number(e.target.value))}>
                          {LEVELS.map((l, i) => <option key={i} value={i}>{l}</option>)}
                        </select>
                        <select className={`select rr-sel ${copies[ki] ? "is-set" : ""}`} value={goal} disabled={past}
                          aria-label={`${name}, ${R.kinds[kind]}: ${R.goal}`} onChange={(e) => setLevel(kind, day, "goal", Number(e.target.value))}>
                          {LEVELS.map((l, i) => <option key={i} value={i} disabled={i < before}>{l}</option>)}
                        </select>
                      </span>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// ── Compact: the plan alone, to save as a picture or copy as text ──
function planSummary(query, result, banks, T) {
  const R = T.reruns, L = T.numberLocale;
  const planned = query.banners.filter((b) => b.copies > 0);
  const copies = planned.reduce((a, b) => a + b.copies, 0);
  const days = new Set(planned.map((b) => b.at)).size;
  if (!copies) return R.compact.summaryNone(int(banks[DAYS - 1], L), fmtDate(dateOf(DAYS - 1), L));
  return R.compact.summary(int(copies, L), int(days, L), result ? pct(result.chance, L) : "…");
}
function CompactPlan({ plan, query, result, banks, today }) {
  const T = useContextT();
  const R = T.reruns, C = R.compact;
  const L = T.numberLocale;
  const summary = planSummary(query, result, banks, T);
  const [note, setNote] = useState(null); // { ok, text? }
  const copy = async () => {
    const text = planText(plan, today, T, summary);
    try { await navigator.clipboard.writeText(text); setNote({ ok: true }); }
    catch { setNote({ ok: false, text }); }
  };
  const save = async () => {
    const blob = await planImage({ plan, today, T, summary, portrait });
    if (blob) download(`${fileName(C.fileName)}.jpg`, blob);
  };
  return (
    <section className="rr-compact" aria-label={C.title}>
      <div className="rr-compact-head">
        <h2 className="rr-compact-title">{C.title}</h2>
        <span className="rr-compact-sum">{summary}</span>
        <span className="rr-compact-actions">
          <button type="button" className="btn btn--sm" onClick={save}>{C.saveImage}</button>
          <button type="button" className="btn btn--sm" onClick={copy}>{C.copyText}</button>
        </span>
      </div>
      {note && (note.ok ? <p className="s-hint rr-copied" role="status">{C.copied}</p> : (
        <div className="rr-copy-fail" role="status">
          <p className="s-hint">{C.copyFailed}</p>
          <textarea className="custom-input" readOnly rows={Math.min(12, note.text.split("\n").length)} value={note.text} onFocus={(e) => e.target.select()} />
        </div>
      ))}
      <div className="rr-mini">
        {WEEK.map((wd) => <span key={wd} className="rr-wd" aria-hidden="true">{new Date(2026, 10, 29 + (wd || 7)).toLocaleDateString(L, { weekday: "short" })}</span>)}
        {CHARACTERS.map((name, day) => {
          const past = day < today;
          const planned = KINDS.filter((k) => copiesOn(plan, k, day, today) > 0);
          return (
            <div key={day} className={`rr-mt ${past ? "is-past" : planned.length ? "is-planned" : ""}`}>
              <div className="rr-por">
                <img src={portrait(name)} alt="" loading="lazy" />
                <span className="rr-date">{fmtDate(dateOf(day), L)}</span>
              </div>
              <span className="rr-mt-name">{name}</span>
              <span className="rr-mt-lv">
                {past ? R.ended : planned.length ? planned.map((k) => (
                  <span key={k} className={`rr-mt-line ${k === "wheel" ? "is-wheel" : ""}`}>
                    {k === "wheel" && `${R.kindsShort.wheel} `}{LEVELS[levelBefore(plan, k, day, today)]} → <b>{LEVELS[plan.goals[day][k]]}</b>
                  </span>
                )) : LEVELS[levelBefore(plan, "char", day, today)]}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

// What a shared plan says, in the same shape as the other calculators: the answer, then the
// setup (one thing per line), then the rest; the link goes on its own line after it.
//
//   73.4% chance to get all 12 planned copies
//   • Now: 1,200 limited pulls, 10,380 silver
//   • Income: 4.46 limited pulls a day; Sleepless Oath, Echoed Pilgrimage
//   • 13 Dec GHelot: E1 → E3
//   • 15 Dec GDoll: E0 → OE, wheel None → E0
//   Average cost: 504 pulls
//   Left on 3 Jan: 731 pulls (8 in 10: 600 to 850)
export function rerunsShare(plan, query, result, income, today, T) {
  const R = T.reruns, S = R.share;
  const L = T.numberLocale;
  const copies = query.banners.reduce((a, b) => a + b.copies, 0);
  const end = fmtDate(dateOf(DAYS - 1), L);
  const banks = bankByDay(plan, income, today);
  const gifts = ONE_OFFS.filter((o) => plan.oneOffs[o.key] && o.day > today).map((o) => R.gifts[o.key]);
  const setup = [S.now(int(plan.pulls, L), int(plan.silver, L))];
  const { char: c, wheel: w } = plan.pity;
  if (c.k || c.l || w.k || w.l) setup.push(S.pity(c.k, c.l, w.k, w.l));
  setup.push(S.income((Math.round(incomeTotals(income).perDay.pulls * 100) / 100).toLocaleString(L), gifts.join(", ")));
  setup.push(...planLines(plan, today, T));
  const last = result?.days?.[result.days.length - 1];
  const headline = copies && result ? S.headline(pct(result.chance, L), int(copies, L)) : S.headlineNone(int(banks[DAYS - 1], L), end);
  const extra = copies && result && last ? [S.cost(int(result.spent, L)), S.left(end, int(last.p50, L), int(last.p10, L), int(last.p90, L))] : [];
  return {
    title: headline,
    detail: extra.join(" · ") || S.noPlan,
    summary: [headline, ...setup.map((x) => `• ${x}`), ...extra].join("\n"),
  };
}
