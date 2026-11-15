import { useEffect, useState } from "react";
import { freshState, newId, presets, reqLabel, withPresetNames, setPrecision, DEFAULT_SETTINGS } from "./model.js";
import { useEngine } from "./useEngine.js";
import { useCompare } from "./useCompare.js";
import { I18nContext, LOCALES, browserLocale, setLocale } from "./i18n/index.js";
import { BACKGROUND, DEFAULT_THEME, DEFAULT_PRESET, SITE_NAME, BANNERS_PATCH, SOURCE_URL } from "./site.config.js";
import { HelpContext } from "./components/Help.jsx";
import BannerPicker from "./components/BannerPicker.jsx";
import SetupCard from "./components/SetupCard.jsx";
import PullPlan from "./components/PullPlan.jsx";
import ResultChart from "./components/ResultChart.jsx";
import TargetSection from "./components/TargetSection.jsx";
import StatsRow from "./components/StatsRow.jsx";
import Distribution from "./components/Distribution.jsx";
import PercentileTable from "./components/PercentileTable.jsx";
import ComparePanel from "./components/ComparePanel.jsx";

const STORE_KEY = "banner-calc-v2";
const COMPARE_KEY = "banner-calc-compare";
const CUSTOM_KEY = "banner-calc-custom"; // your own banner, kept apart from the presets
const load = (key, check) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return check(v) ? v : null; } catch { return null; }
};
const store = (key, v) => { try { localStorage.setItem(key, typeof v === "string" ? v : JSON.stringify(v)); } catch { /* ignore */ } };
const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

// Theme and language are applied before rendering, so charts and model text are right on the first draw
function applyTheme(t) { document.documentElement.classList.toggle("theme-light", t === "light"); }
function loadTheme() {
  const saved = read("banner-calc-theme");
  const t = saved === "light" || saved === "dark" ? saved : DEFAULT_THEME;
  applyTheme(t);
  return t;
}
function loadLang() {
  const saved = read("banner-calc-lang");
  const code = LOCALES[saved] ? saved : browserLocale();
  setLocale(code);
  document.documentElement.lang = code;
  return code;
}

const backgroundStyle = BACKGROUND.desktop ? {
  "--bg-desktop": `url("${BACKGROUND.desktop}")`,
  "--bg-mobile": `url("${BACKGROUND.mobile ?? BACKGROUND.desktop}")`,
  "--bg-position": BACKGROUND.position,
  "--bg-size": BACKGROUND.size,
  position: BACKGROUND.fixed ? "fixed" : "absolute",
} : null;

// The parts of the state that define a setup worth comparing
const snapshotOf = (s) => ({ preset: s.preset, banner: s.banner, goal: s.goal, goalMode: s.goalMode, start: s.start, settings: s.settings });

export default function App() {
  const [lang, setLang] = useState(loadLang);
  const T = LOCALES[lang];
  const [state, setState] = useState(() => {
    const s = load(STORE_KEY, (v) => v && v.banner && Array.isArray(v.goal));
    if (!s) return freshState(DEFAULT_PRESET);
    // settings saved by an older version: fill in new ones; the old default state limit (1 million,
    // before chain building got leaner) moves up to the current default
    const settings = { ...DEFAULT_SETTINGS, ...s.settings };
    if (Number(s.settings?.maxStates) === 1e6) settings.maxStates = DEFAULT_SETTINGS.maxStates;
    const restored = { ...s, settings };
    // a preset that no longer exists becomes your custom banner; presets get names in this language
    return presets()[s.preset] ? withPresetNames(restored) : { ...restored, preset: "custom" };
  });
  const [tabRequest, setTabRequest] = useState(null);
  const [undoState, setUndoState] = useState(null); // the setup from just before a Reset
  const [compare, setCompare] = useState(() => load(COMPARE_KEY, (c) => c && Array.isArray(c.items)) ?? { items: [], budget: 600 });
  const [theme, setTheme] = useState(loadTheme);
  const [showHelp, setShowHelp] = useState(true);
  const [runToken, setRunToken] = useState(0);
  const [view, setView] = useState("single");
  const [detail, setDetail] = useState("dist");
  const [note, setNote] = useState("");
  setPrecision(state.settings.decimals ?? 2); // before any child formats a number
  const engine = useEngine(state, runToken, lang);
  const compareResults = useCompare(compare.items, lang);
  const P = presets();

  useEffect(() => store(STORE_KEY, state), [state]);
  useEffect(() => { if (state.preset === "custom") store(CUSTOM_KEY, snapshotOf(state)); }, [state]);
  useEffect(() => store(COMPARE_KEY, compare), [compare]);
  useEffect(() => store("banner-calc-theme", theme), [theme]);
  useEffect(() => store("banner-calc-lang", lang), [lang]);
  const toggleTheme = () => { const t = theme === "dark" ? "light" : "dark"; applyTheme(t); setTheme(t); };
  const changeLang = (code) => {
    setLocale(code);
    document.documentElement.lang = code;
    setLang(code);
    setState((s) => withPresetNames(s));
  };

  // Banner edits turn the setup into a custom banner
  const update = (fn, { custom = false } = {}) =>
    setState((s) => { const n = fn(s); return custom && n.preset !== "custom" ? { ...n, preset: "custom" } : n; });

  const addToCompare = () => {
    const goals = state.goal.map((r) => reqLabel(state.banner, r)).join(state.goalMode === "all" ? T.goalLabel.joinAll : T.goalLabel.joinAny);
    const name = T.compare.autoName(P[state.preset]?.title ?? T.app.customBanner, goals);
    setCompare((c) => ({ ...c, items: [...c.items, { id: newId(), name, snapshot: structuredClone(snapshotOf(state)) }] }));
    setNote(T.app.addedToCompare(name, compare.items.length + 1));
  };
  // Reset puts the current banner's rules, plan and pity back to defaults; Undo restores them
  const resetBanner = () => {
    setUndoState(state);
    setState((s) => ({ ...freshState(presets()[s.preset] ? s.preset : "custom"), mode: s.mode, desired: s.desired, chartLines: s.chartLines }));
  };
  const undoReset = () => { if (undoState) setState(undoState); setUndoState(null); };
  useEffect(() => {
    if (!undoState) return undefined;
    const t = setTimeout(() => setUndoState(null), 15000);
    return () => clearTimeout(t);
  }, [undoState]);

  // Picking a preset loads it fresh; picking "Custom banner" brings back your own banner
  const pickBanner = (key) => {
    setUndoState(null);
    if (key === "custom") {
      if (state.preset === "custom") return;
      const saved = load(CUSTOM_KEY, (v) => v && v.banner && Array.isArray(v.goal));
      setState((s) => ({ ...(saved ? { ...s, ...structuredClone(saved) } : { ...freshState("custom"), mode: s.mode, desired: s.desired, chartLines: s.chartLines }), preset: "custom" }));
      setTabRequest({ tab: "banner", at: Date.now() });
      return;
    }
    setState((s) => ({ ...freshState(key), mode: s.mode, desired: s.desired, chartLines: s.chartLines ?? freshState(key).chartLines }));
  };

  const compareApi = {
    items: compare.items,
    results: compareResults,
    budget: compare.budget,
    setBudget: (b) => setCompare((c) => ({ ...c, budget: b })),
    rename: (id, name) => setCompare((c) => ({ ...c, items: c.items.map((it) => (it.id === id ? { ...it, name } : it)) })),
    remove: (id) => setCompare((c) => ({ ...c, items: c.items.filter((it) => it.id !== id) })),
    load: (it) => { setState((s) => withPresetNames({ ...s, ...structuredClone(it.snapshot) })); setView("single"); },
  };

  return (
    <I18nContext.Provider value={T}>
      <HelpContext.Provider value={showHelp}>
        {backgroundStyle && <div className="background-container" style={backgroundStyle} aria-hidden="true" />}
        <main className="main">
          <section className="content-box" aria-label={T.app.title}>
            <div className="header-row">
              <h1 className="main-title">{T.app.title}</h1>
              <div className="row header-buttons">
                {Object.keys(LOCALES).length > 1 && (
                  <label className="inline-field">
                    <span className="sr-only">{T.app.language}</span>
                    <select className="select" value={lang} onChange={(e) => changeLang(e.target.value)} aria-label={T.app.language}>
                      {Object.entries(LOCALES).map(([code, L]) => <option key={code} value={code}>{L.langName}</option>)}
                    </select>
                  </label>
                )}
                <button type="button" className="btn btn--ghost" onClick={toggleTheme}>{theme === "dark" ? T.app.lightTheme : T.app.darkTheme}</button>
                <button type="button" className="btn btn--ghost" onClick={() => setShowHelp((v) => !v)}>{showHelp ? T.app.hideHelp : T.app.showHelp}</button>
              </div>
            </div>

            <BannerPicker current={state.preset} hint={P[state.preset]?.hint ?? T.app.customHint} onPick={pickBanner}
              onReset={resetBanner} canUndo={!!undoState} onUndo={undoReset} />

            <div className="workspace">
              <div className="inputs-col">
                <SetupCard state={state} update={update} setState={setState} tabRequest={tabRequest} />
                <PullPlan state={state} update={update} engine={engine}
                  onCalculate={() => setRunToken((t) => t + 1)} onAddCompare={addToCompare} note={note} />
                <TargetSection state={state} update={update} engine={engine} />
              </div>

              <div className="results-col">
                <div className="view-tabs" role="tablist" aria-label={T.app.viewTabs}>
                  <button type="button" role="tab" aria-selected={view === "single"} className={`view-tab ${view === "single" ? "is-active" : ""}`} onClick={() => setView("single")}>{T.app.viewSingle}</button>
                  <button type="button" role="tab" aria-selected={view === "compare"} className={`view-tab ${view === "compare" ? "is-active" : ""}`} onClick={() => setView("compare")}>
                    {T.app.viewCompare} <span className="count">{compare.items.length}</span>
                  </button>
                </div>
                {view === "single" ? (
                  <>
                    <StatsRow engine={engine} />
                    <ResultChart state={state} update={update} engine={engine} theme={theme} />
                    <div className="detail-tabs" role="tablist" aria-label={T.app.detailTabs}>
                      <button type="button" role="tab" aria-selected={detail === "dist"} className={`chip-tab ${detail === "dist" ? "is-active" : ""}`} onClick={() => setDetail("dist")}>{T.app.detailDist}</button>
                      <button type="button" role="tab" aria-selected={detail === "pct"} className={`chip-tab ${detail === "pct" ? "is-active" : ""}`} onClick={() => setDetail("pct")}>{T.app.detailPct}</button>
                    </div>
                    {detail === "dist" ? <Distribution state={state} engine={engine} /> : <PercentileTable engine={engine} />}
                  </>
                ) : (
                  <ComparePanel {...compareApi} theme={theme} />
                )}
              </div>
            </div>
          </section>
        </main>
        <footer className="footer">
          <p className="footer-patch">{T.footer.patch(BANNERS_PATCH)}</p>
          <small>
            {T.footer.unofficial(SITE_NAME)}<br />
            {T.footer.assets}<br />
            {T.footer.affiliation}
          </small>
          {SOURCE_URL && (
            <a className="footer-link" href={SOURCE_URL} target="_blank" rel="noopener noreferrer">{T.footer.source}</a>
          )}
        </footer>
      </HelpContext.Provider>
    </I18nContext.Provider>
  );
}
