import { useEffect, useMemo, useRef, useState } from "react";
import { I18nContext, useT as useContextT, withWording } from "../i18n/index.js";
import { Background, SiteFooter, SiteHeader, loadLang, saveLang } from "../components/SiteParts.jsx";
import { HelpButton } from "../components/Help.jsx";
import { TrashIcon } from "../components/Icon.jsx";
import NumberInput from "../components/NumberInput.jsx";
import { Notices, useShare } from "../components/Share.jsx";
import { postShortLink } from "../share.js";
import {
  CUSTOM_GROUP, DTIDE_SILVER, DTIDE_TIERS, MAX_AMOUNT, MAX_CUSTOM, MAX_DAYS, PERIOD, RATIOS, SILVER_PER_PULL,
  blankCustom, decodeIncome, defaultIncome, dTideSilver, encodeIncome, incomeCode, incomeTotals, isDefaultRow,
  loadIncome, rowPer28, saveIncome, sourceOf,
} from "./income.js";

// Pull income: the sources on the left (each one's silver and pulls, how often, counted or not),
// what they come to on the right. Saved in the browser (income.js), for the pages that plan
// pulls with it.

const ICONS = import.meta.glob("../assets/income/*.webp", { eager: true, import: "default" });
const icon = (name) => Object.entries(ICONS).find(([p]) => p.includes(`/${name}.`))?.[1];
const Icon = ({ name, className = "inc-icon" }) => <img className={className} src={icon(name)} alt="" aria-hidden="true" />;

const MARK = "\u0001";
function highlight(template, value) {
  const [before, after = ""] = template(MARK).split(MARK);
  return <>{before}<strong className="s-hl">{value}</strong>{after}</>;
}
const fmt = (x, L, digits = 2) => (Math.round(x * 1e9) / 1e9).toLocaleString(L, { maximumFractionDigits: digits });

export default function IncomeApp({ onGo }) {
  const [lang, setLang] = useState(loadLang);
  const T = useMemo(() => withWording(lang, false), [lang]);
  const I = T.income;
  const [income, setIncome] = useState(() => loadIncome());
  useEffect(() => { saveIncome(income); }, [income]);
  useEffect(() => {
    const before = document.title;
    document.title = I.pageTitle;
    return () => { document.title = before; };
  }, [I.pageTitle]);
  const totals = useMemo(() => incomeTotals(income), [income]);

  // a shared link (#i=…) opens its income, and Reset restores the defaults: Undo brings yours back
  const [undo, setUndo] = useState(null); // { income, text }
  const [linkError, setLinkError] = useState(false);
  const incomeRef = useRef(income);
  incomeRef.current = income;
  useEffect(() => {
    const open = () => {
      const code = incomeCode(location.hash);
      if (code == null) return;
      const shared = decodeIncome(code);
      if (shared) { setUndo({ income: incomeRef.current, text: T.app.sharedLoaded }); setIncome(shared); }
      else setLinkError(true);
      history.replaceState(null, "", location.pathname + location.search);
    };
    open();
    addEventListener("hashchange", open);
    return () => removeEventListener("hashchange", open);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const reset = () => { setUndo({ income, text: I.resetDone }); setIncome(defaultIncome()); };

  const { share, shareMsg, clearShare } = useShare(async () => {
    const parts = incomeShare(income, totals, T);
    const code = encodeIncome(income);
    const url = (await postShortLink({ calc: "income", code, title: parts.title, detail: parts.detail })) ?? incomeLink(code);
    return { url, summary: parts.summary };
  });

  return (
    <I18nContext.Provider value={T}>
      <Background view="simple" />
      <main className="main">
        <section className="content-box is-simple" aria-label={I.pageTitle}>
          <SiteHeader calc="income" onGo={onGo} lang={lang} onLang={(code) => { saveLang(code); setLang(code); }}>
            <button type="button" className="btn btn--primary header-share" onClick={share} title={I.shareTitle}>{T.app.share}</button>
          </SiteHeader>
          <Notices shareMsg={shareMsg} clearShare={clearShare}
            canUndo={!!undo} undoText={undo?.text} onUndo={() => { setIncome(undo.income); setUndo(null); }} onDismissUndo={() => setUndo(null)}
            linkError={linkError} onDismissError={() => setLinkError(false)} />
          <div className="app-layout inc-layout">
            <SourcesCard income={income} setIncome={setIncome} onReset={reset} />
            <div className="s-side">
              <TotalsCard income={income} setIncome={setIncome} totals={totals} />
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </I18nContext.Provider>
  );
}

function incomeLink(code) {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#i=${code}`;
}

// What a shared link says, in the same shape as the other calculators': the answer, then the setup
// (one thing per line), then the rest; the link goes on its own line after it.
//
//   94.4 limited pulls every 28 days
//   • Sources: all free ones except Daily gift; paid: Moonphase vigil
//   • D-Tide: 425 points
//   • Standard pulls: 4.74 for 1 limited (characters, off-rate limited not factored in)
//   With standard pulls: 125.43 limited pulls
//   Per day: 3.37 limited pulls (4.48 with standard pulls)
export function incomeShare(income, totals, T) {
  const I = T.income, S = I.share;
  const L = T.numberLocale;
  const name = (r) => (r.key ? I.sources[r.key] : r.name || I.customName);
  const paid = (r) => !!sourceOf(r)?.paid;
  const list = (rows) => (rows.length ? rows.map(name).join(", ") : null);
  const dTide = income.rows.find((r) => r.key === "dTide");
  const changed = income.rows.filter((r) => r.key && r.on && !isDefaultRow({ ...r, on: sourceOf(r).on !== false }) && !(r.key === "dTide" && onlyPointsChanged(r)));
  const setup = [
    S.sources(list(income.rows.filter((r) => !r.on && !paid(r))), list(income.rows.filter((r) => r.on && paid(r)))),
    dTide.on ? S.dTide(dTide.points) : null,
    changed.length ? S.changed(list(changed)) : null,
    income.rows.some((r) => !r.key && r.on) ? S.added(list(income.rows.filter((r) => !r.key && r.on))) : null,
    S.ratio(fmt(totals.ratio, L), `${S.targets[income.ratio.target]}, ${S.offRates[income.ratio.offRate]}`),
  ].filter(Boolean);
  const p = totals.per28, d = totals.perDay;
  const headline = S.headline(fmt(p.pulls, L));
  const extra = [S.withStandard(fmt(p.withStandard, L)), S.perDay(fmt(d.pulls, L), fmt(d.withStandard, L))];
  return {
    title: headline,
    detail: extra.join(" · "),
    summary: [headline, ...setup.map((x) => `• ${x}`), ...extra].join("\n"),
  };
}
const onlyPointsChanged = (r) => {
  const d = defaultIncome().rows.find((x) => x.key === "dTide");
  return r.limited === d.limited && r.standard === d.standard && r.days === d.days;
};

// ── Left: the sources ──
function SourcesCard({ income, setIncome, onReset }) {
  const T = useContextT();
  const I = T.income;
  const setRow = (i, patch) => setIncome((s) => ({ ...s, rows: s.rows.map((r, j) => (j === i ? { ...r, ...patch } : r)) }));
  const custom = income.rows.filter((r) => !r.key).length;
  const cols = [
    { key: "silver", icon: "silver", label: I.colSilver },
    { key: "limited", icon: "limited-pull", label: I.colLimited },
    { key: "standard", icon: "standard-pull", label: I.colStandard },
  ];
  const groupOf = (r) => sourceOf(r)?.group ?? CUSTOM_GROUP;
  return (
    <section className="s-card s-plan inc-card" aria-label={I.sourcesTitle}>
      <h2 className="s-lead">{I.sourcesTitle}<HelpButton label={I.sourcesTitle} text={<SourcesHelp />} /></h2>
      <div className="inc-table" role="table" aria-label={I.sourcesTitle}>
        <div className="inc-row inc-head" role="row">
          <span role="columnheader"><span className="sr-only">{I.colOn}</span></span>
          <span role="columnheader">{I.colSource}</span>
          <span className="inc-vals">
            {cols.map((c) => <span key={c.key} role="columnheader" className="inc-num"><Icon name={c.icon} />{c.label}</span>)}
            <span role="columnheader" className="inc-num">{I.colDays}</span>
          </span>
          <span role="columnheader" className="inc-num inc-per"><Icon name="limited-pull" />{I.colPer}</span>
        </div>
        {income.rows.map((r, i) => {
          const src = sourceOf(r);
          const name = r.key ? I.sources[r.key] : r.name;
          const first = i > 0 && groupOf(income.rows[i - 1]) !== groupOf(r);
          const per = rowPer28(r).pulls;
          const field = (k, max, integer = false) => (
            <span className="inc-cell">
              <span className="inc-label" aria-hidden="true">{k === "days" ? I.colDays : cols.find((c) => c.key === k).label}</span>
              <NumberInput className="custom-input inc-input" value={r[k]} min={k === "days" ? 1 : 0} max={max} integer={integer}
                onChange={(v) => setRow(i, { [k]: v })} aria-label={`${name || I.customName}: ${k === "days" ? I.colDays : cols.find((c) => c.key === k).label}`} />
            </span>
          );
          return (
            <div key={r.key ?? r.id} role="row" className={`inc-row ${r.on ? "" : "is-off"} ${first ? "is-group" : ""} ${src?.sub ? "is-sub" : ""}`}>
              <span role="cell" className="inc-on">
                <input type="checkbox" checked={r.on} onChange={(e) => setRow(i, { on: e.target.checked })} aria-label={I.count(name || I.customName)} />
              </span>
              <span role="cell" className="inc-name">
                {src ? (
                  <>
                    {src.sub && <span className="inc-plus" aria-hidden="true">+</span>}
                    <span className="inc-name-text">{name}</span>
                    {src.paid && <img className="inc-paid" src={icon("silver-prime")} alt={I.paid} title={I.paid} />}
                    {r.points != null && (
                      <select className="select inc-points" value={r.points} aria-label={I.dTidePoints}
                        onChange={(e) => { const points = Number(e.target.value); setRow(i, { points, silver: dTideSilver(points) }); }}>
                        {[0, ...DTIDE_TIERS].map((p) => <option key={p} value={p}>{I.points(p)}</option>)}
                      </select>
                    )}
                  </>
                ) : (
                  <>
                    <input className="custom-input inc-custom-name" value={r.name} maxLength={60} placeholder={I.customName}
                      onChange={(e) => setRow(i, { name: e.target.value })} aria-label={I.customNameLabel} />
                    <button type="button" className="s-remove" onClick={() => setIncome((s) => ({ ...s, rows: s.rows.filter((x) => x !== r) }))}
                      aria-label={I.remove(name || I.customName)} title={I.remove(name || I.customName)}><TrashIcon /></button>
                  </>
                )}
              </span>
              <span className="inc-vals">
                {r.points != null ? (
                  <span className="inc-cell">
                    <span className="inc-label" aria-hidden="true">{I.colSilver}</span>
                    <span role="cell" className="inc-fixed" title={I.fromPoints}>{fmt(r.silver, T.numberLocale)}</span>
                  </span>
                ) : field("silver", MAX_AMOUNT)}
                {field("limited", MAX_AMOUNT)}
                {field("standard", MAX_AMOUNT)}
                {field("days", MAX_DAYS, true)}
              </span>
              <span role="cell" className="inc-num inc-per" title={I.perTitle}>
                <span className="inc-label" aria-hidden="true">{I.colPer}</span>{fmt(per, T.numberLocale)}
              </span>
            </div>
          );
        })}
      </div>
      <div className="inc-actions">
        {custom < MAX_CUSTOM && (
          <button type="button" className="btn btn--quiet btn--sm" onClick={() => setIncome((s) => ({ ...s, rows: [...s.rows, blankCustom()] }))}>+ {I.addSource}</button>
        )}
        <button type="button" className="btn btn--quiet btn--sm" onClick={onReset}>{I.reset}</button>
      </div>
    </section>
  );
}

function SourcesHelp() {
  const T = useContextT();
  const H = T.income.help;
  return (
    <span className="goal-help">
      <span className="goal-help-line">{H.what}</span>
      <span className="goal-help-line">{H.per(PERIOD, SILVER_PER_PULL)}</span>
      <span className="goal-help-line">{H.dTide(DTIDE_SILVER, DTIDE_TIERS.join(", "))}</span>
      <span className="goal-help-line"><img className="inc-icon inc-help-icon" src={icon("silver-prime")} alt="" aria-hidden="true" />{H.paid}</span>
      <span className="goal-help-line">{H.missing}</span>
      <span className="goal-help-line">{H.saved}</span>
    </span>
  );
}

// ── Right: what it comes to ──
function TotalsCard({ income, setIncome, totals }) {
  const T = useContextT();
  const I = T.income;
  const L = T.numberLocale;
  const { per28 } = totals;
  const periods = [["perDay", I.perDay], ["perWeek", I.perWeek], ["per28", I.per28]];
  const res = [["silver", "silver", I.colSilver], ["limited", "limited-pull", I.colLimited], ["standard", "standard-pull", I.colStandard]];
  const setRatio = (patch) => setIncome((s) => ({ ...s, ratio: { ...s.ratio, ...patch } }));
  return (
    <section className="s-card s-answer inc-answer" aria-label={I.answerLabel}>
      <p className="s-big">{highlight(I.headline, fmt(per28.pulls, L))}</p>
      <p className="s-second">{highlight(I.withStandardLine, fmt(per28.withStandard, L))}</p>
      <p className="s-hint">{I.headlineHint(SILVER_PER_PULL)}</p>

      <div className="st-table inc-sum" role="table" aria-label={I.totalTitle} style={{ "--cols": 3 }}>
        <div className="st-row st-head" role="row">
          <span role="columnheader">{I.totalTitle}</span>
          {res.map(([k, ic, label]) => <span key={k} role="columnheader" className="st-num inc-col"><Icon name={ic} />{label}</span>)}
        </div>
        {periods.map(([k, label]) => (
          <div key={k} className="st-row" role="row">
            <span role="cell" className="st-name"><span>{label}</span></span>
            {res.map(([r, , head]) => <span key={r} role="cell" className="st-num"><span className="st-label">{head}</span>{fmt(totals[k][r], L)}</span>)}
          </div>
        ))}
      </div>

      <div className="inc-settings">
        <div className="field">
          <span className="field-label inc-field-label">{I.ratioLabel}<HelpButton label={I.ratioLabel} text={I.ratioHelp} /></span>
          <div className="inc-ratio">
            <select className="select" value={income.ratio.target} aria-label={I.ratioTarget}
              onChange={(e) => setRatio({ target: e.target.value })}>
              {Object.keys(RATIOS).map((k) => <option key={k} value={k}>{I.targets[k]}</option>)}
            </select>
            <select className="select" value={income.ratio.offRate} aria-label={I.ratioOffRate}
              onChange={(e) => setRatio({ offRate: e.target.value })}>
              {Object.keys(RATIOS.characters).map((k) => <option key={k} value={k}>{I.offRates[k]}</option>)}
            </select>
          </div>
          <span className="s-hint inc-ratio-value">{I.ratioValue(fmt(totals.ratio, L))}</span>
        </div>
        <label className="inline-field inc-sediment">
          <Icon name="sediment" />
          {I.sedimentLabel}
          <NumberInput className="custom-input w-m" value={income.sediment} min={0} max={1000} integer={false} fallback={0}
            onChange={(v) => setIncome((s) => ({ ...s, sediment: v }))} />
          <HelpButton label={I.sedimentLabel} text={I.sedimentHelp} />
        </label>
      </div>

      <div className="st-table inc-sum" role="table" aria-label={I.pullsTitle} style={{ "--cols": 2 }}>
        <div className="st-row st-head" role="row">
          <span role="columnheader">{I.pullsTitle}</span>
          <span role="columnheader" className="st-num">{I.colWithout}</span>
          <span role="columnheader" className="st-num">{I.colWith}</span>
        </div>
        {periods.map(([k, label]) => (
          <div key={k} className="st-row" role="row">
            <span role="cell" className="st-name"><Icon name="limited-pull" /><span>{label}</span></span>
            <span role="cell" className={`st-num ${k === "per28" ? "is-main" : ""}`}><span className="st-label">{I.colWithout}</span>{fmt(totals[k].pulls, L)}</span>
            <span role="cell" className="st-num"><span className="st-label">{I.colWith}</span>{fmt(totals[k].withStandard, L)}</span>
          </div>
        ))}
        <div className="st-row" role="row">
          <span role="cell" className="st-name"><Icon name="sediment" /><span>{I.sedimentRow}</span></span>
          <span role="cell" className="st-num"><span className="st-label">{I.colWithout}</span>{fmt(per28.sediment, L)}</span>
          <span role="cell" className="st-num"><span className="st-label">{I.colWith}</span>{fmt(per28.sedimentWithStandard, L)}</span>
        </div>
      </div>
    </section>
  );
}
