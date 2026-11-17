import { useCallback, useEffect, useMemo, useState } from "react";
import { freshState, newId, presets, reqLabel, withPresetNames, setPrecision, DEFAULT_SETTINGS } from "./model.js";
import { useEngine } from "./useEngine.js";
import { decodeSetup, linkCode, makeShareLink, makeShortLink, shareParts, shareSummary } from "./share.js";
import { shareCard } from "./export.js";
import { useCompare } from "./useCompare.js";
import { I18nContext, LOCALES, browserLocale, setLocale, withWording } from "./i18n/index.js";
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
import SimpleView from "./components/SimpleView.jsx";

const STORE_KEY = "banner-calc-v2";
const COMPARE_KEY = "banner-calc-compare";
const CUSTOM_KEY = "banner-calc-custom"; // your own banner, kept apart from the presets
const SETTINGS_KEY = "banner-calc-settings"; // settings: shared by every banner and comparison
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
  // nothing saved yet and no shared link: show the example questions
  const [firstVisit, setFirstVisit] = useState(() => !read(STORE_KEY) && !linkCode(window.location.hash));
  // Settings belong to the calculator, not to a banner: kept apart, so picking a banner,
  // Reset, a shared link or loading a comparison never changes them
  const [settings, setSettings] = useState(() => {
    const saved = load(SETTINGS_KEY, (v) => v && typeof v === "object")
      ?? load(STORE_KEY, (v) => v && v.banner)?.settings; // older versions kept them with the banner
    const merged = { ...DEFAULT_SETTINGS, ...saved };
    // the state limit that was briefly the default (2 million) goes back to the current default
    if (Number(saved?.maxStates) === 2e6) merged.maxStates = DEFAULT_SETTINGS.maxStates;
    return merged;
  });
  const [setup, setSetup] = useState(() => {
    const s = load(STORE_KEY, (v) => v && v.banner && Array.isArray(v.goal));
    if (!s) return freshState(DEFAULT_PRESET);
    // a preset that no longer exists becomes your custom banner; presets get names in this language
    return presets()[s.preset] ? withPresetNames(s) : { ...s, preset: "custom" };
  });
  // What the components see: the setup with the current settings. Changes to it keep the
  // settings as they are (they change only through setSettings).
  const state = useMemo(() => ({ ...setup, settings }), [setup, settings]);
  // the simple view, and its everyday wording (Settings › Wording can choose either wording)
  const simpleView = (settings.view ?? "simple") === "simple";
  const simpleWording = settings.wording === "simple" || ((settings.wording ?? "auto") === "auto" && simpleView);
  const T = useMemo(() => withWording(lang, simpleWording), [lang, simpleWording]);
  const setViewMode = (v) => setSettings((cur) => ({ ...cur, view: v }));
  const setState = useCallback((v) => setSetup((cur) => {
    const next = typeof v === "function" ? v({ ...cur, settings }) : v;
    const { settings: _ignored, ...rest } = next; // eslint-disable-line no-unused-vars
    return rest;
  }), [settings]);
  const [tabRequest, setTabRequest] = useState(null);
  const [undoState, setUndoState] = useState(null); // the setup from just before a Reset or a shared link
  const [undoKind, setUndoKind] = useState("reset");
  const [linkError, setLinkError] = useState(false);
  const [compare, setCompare] = useState(() => load(COMPARE_KEY, (c) => c && Array.isArray(c.items)) ?? { items: [], budget: 600 });
  const [theme, setTheme] = useState(loadTheme);
  const [showHelp, setShowHelp] = useState(true);
  const [runToken, setRunToken] = useState(0);
  const [view, setView] = useState("single");
  const [detail, setDetail] = useState("dist");
  const [note, setNote] = useState("");
  setPrecision(state.settings.decimals ?? 2); // before any child formats a number
  const engine = useEngine(state, runToken, lang);
  // every comparison is calculated with the current settings too
  const calcKey = JSON.stringify(["pct", "eps", "maxPulls", "maxStates", "method", "noLimits"].map((k) => settings[k]));
  const compareItems = useMemo(() => compare.items.map((it) => ({ ...it, snapshot: { ...it.snapshot, settings } })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compare.items, calcKey]);
  const compareResults = useCompare(compareItems, lang);
  const P = presets();

  useEffect(() => store(STORE_KEY, setup), [setup]);
  useEffect(() => store(SETTINGS_KEY, settings), [settings]);
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
    setUndoKind("reset");
    setState((s) => ({ ...freshState(presets()[s.preset] ? s.preset : "custom"), mode: s.mode, desired: s.desired, chartLines: s.chartLines }));
  };
  const undoReset = () => { if (undoState) setState(undoState); setUndoState(null); };
  useEffect(() => {
    if (!undoState) return undefined;
    const t = setTimeout(() => setUndoState(null), undoKind === "shared" ? 30000 : 15000);
    return () => clearTimeout(t);
  }, [undoState, undoKind]);

  // Opening a shared link (#s=…) loads its setup; Undo brings back your own. The link is then
  // taken out of the address, so reloading keeps whatever you change afterwards.
  useEffect(() => {
    const code = linkCode(window.location.hash);
    if (!code) return;
    const own = state;
    decodeSetup(code)
      .then((shared) => { setUndoState(own); setUndoKind("shared"); setState(withPresetNames(shared)); })
      .catch(() => setLinkError(true))
      .finally(() => window.history.replaceState(null, "", window.location.pathname + window.location.search));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
                <div className="view-switch" role="group" aria-label={T.app.viewLabel}>
                  <button type="button" aria-pressed={simpleView} className={simpleView ? "is-on" : ""} onClick={() => setViewMode("simple")}>{T.app.viewSimple}</button>
                  <button type="button" aria-pressed={!simpleView} className={!simpleView ? "is-on" : ""} onClick={() => setViewMode("full")}>{T.app.viewFull}</button>
                </div>
                <button type="button" className="btn btn--ghost" onClick={toggleTheme}>{theme === "dark" ? T.app.lightTheme : T.app.darkTheme}</button>
                <button type="button" className="btn btn--ghost" onClick={() => setShowHelp((v) => !v)}>{showHelp ? T.app.hideHelp : T.app.showHelp}</button>
              </div>
            </div>

            <BannerPicker current={state.preset} hint={P[state.preset]?.hint ?? T.app.customHint} onPick={pickBanner}
              onReset={resetBanner} canUndo={!!undoState} undoKind={undoKind} onUndo={undoReset} onDismissUndo={() => setUndoState(null)}
              onShare={async () => {
                // a short link with its own preview card where the site's server functions are
                // there (Cloudflare), else the long "#s=" link
                const result = engine.status === "busy" ? null : engine.result;
                const parts = shareParts(state, result, T);
                let image = null;
                try { image = shareCard(parts, document.querySelector(".chart-container canvas")); } catch { /* text-only card */ }
                const url = (await makeShortLink(state, parts, image)) ?? (await makeShareLink(state));
                return { url, summary: shareSummary(state, result, T) };
              }}
              linkError={linkError} onDismissError={() => setLinkError(false)} />

            {simpleView ? (
              <SimpleView state={state} update={update} engine={engine} theme={theme}
                firstVisit={firstVisit} onExampleDone={() => setFirstVisit(false)}
                onCompare={() => { addToCompare(); setViewMode("full"); setView("compare"); }}
                onDetails={() => { setViewMode("full"); setView("single"); }} />
            ) : (
            <div className="workspace">
              <div className="inputs-col">
                <SetupCard state={state} update={update} setState={setState} setSettings={setSettings} tabRequest={tabRequest} />
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
                    <StatsRow engine={engine} settings={state.settings} />
                    <ResultChart state={state} update={update} engine={engine} theme={theme} />
                    <div className="detail-tabs" role="tablist" aria-label={T.app.detailTabs}>
                      <button type="button" role="tab" aria-selected={detail === "dist"} className={`chip-tab ${detail === "dist" ? "is-active" : ""}`} onClick={() => setDetail("dist")}>{T.app.detailDist}</button>
                      <button type="button" role="tab" aria-selected={detail === "pct"} className={`chip-tab ${detail === "pct" ? "is-active" : ""}`} onClick={() => setDetail("pct")}>{T.app.detailPct}</button>
                    </div>
                    {detail === "dist" ? <Distribution state={state} engine={engine} /> : <PercentileTable engine={engine} settings={state.settings} />}
                  </>
                ) : (
                  <ComparePanel {...compareApi} theme={theme} settings={state.settings} />
                )}
              </div>
            </div>
            )}
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
