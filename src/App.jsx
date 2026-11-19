import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { freshState, newId, newStage, planTitle, presets, removeStage, reqLabel, withPresetNames, setPrecision, stagesOf, stageUpdate, stageView, writeStage, DEFAULT_SETTINGS } from "./model.js";
import { useEngine } from "./useEngine.js";
import { decodeSetup, linkCode, makeShareLink, makeShortLink, shareParts, shareSummary } from "./share.js";
import { shareCard } from "./export.js";
import { useCompare } from "./useCompare.js";
import { I18nContext, LOCALES, browserLocale, setLocale, withWording } from "./i18n/index.js";
import { BACKGROUNDS, DEFAULT_PRESET, SITE_NAME, BANNERS_PATCH, SOURCE_URL } from "./site.config.js";
import { Notices, useShare } from "./components/Share.jsx";
import NamesDialog from "./components/NamesDialog.jsx";
import Dialog from "./components/Dialog.jsx";
import PlanCard from "./components/PlanCard.jsx";
import AnswerCard from "./components/AnswerCard.jsx";
import BannerEditor from "./components/BannerEditor.jsx";
import { SettingsPanel, exportData, importData } from "./components/PlanParts.jsx";

const STORE_KEY = "banner-calc-v2";
const COMPARE_KEY = "banner-calc-compare";
const CUSTOM_KEY = "banner-calc-custom"; // your own banner, kept apart from the presets
const SETTINGS_KEY = "banner-calc-settings"; // settings: shared by every banner and comparison
const load = (key, check) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return check(v) ? v : null; } catch { return null; }
};
const store = (key, v) => { try { localStorage.setItem(key, typeof v === "string" ? v : JSON.stringify(v)); } catch { /* ignore */ } };
const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };

// The language is applied before rendering, so charts and model text are right on the first draw
function loadLang() {
  const saved = read("banner-calc-lang");
  const code = LOCALES[saved] ? saved : browserLocale();
  setLocale(code);
  document.documentElement.lang = code;
  return code;
}

// The background of a view ("simple" or "full"), from src/site.config.js
const backgroundStyle = (view) => {
  const B = BACKGROUNDS[view] ?? BACKGROUNDS.simple;
  if (!B?.desktop) return null;
  return {
    "--bg-desktop": `url("${B.desktop}")`,
    "--bg-mobile": `url("${B.mobile ?? B.desktop}")`,
    "--bg-position": B.position ?? "center top",
    "--bg-size": B.size ?? "cover",
    ...(B.fade ? { "--bg-fade": B.fade } : {}),
    position: B.fixed ? "fixed" : "absolute",
  };
};

// The parts of the state that define a setup worth comparing
// (with several banners: all of them, and how the pulls are spent)
// (and banner plan 1's own names: Edit names)
const snapshotOf = (s) => ({ preset: s.preset, banner: s.banner, goal: s.goal, goalMode: s.goalMode, start: s.start, settings: s.settings,
  ...(String(s.title ?? "").trim() ? { title: s.title } : {}), ...(s.names ? { names: s.names } : {}),
  ...(stagesOf(s).length ? { stages: s.stages, spend: s.spend } : {}) });

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
  const fileRef = useRef(null);
  const [undoState, setUndoState] = useState(null); // the setup from just before a Reset or a shared link
  const [undoKind, setUndoKind] = useState("reset");
  const [undoPlan, setUndoPlan] = useState(1); // the banner plan a Reset was for
  const [linkError, setLinkError] = useState(false);
  const [compare, setCompare] = useState(() => load(COMPARE_KEY, (c) => c && Array.isArray(c.items)) ?? { items: [], budget: 0 });
  const theme = "dark"; // the one theme (charts read their colours from it)
  const [runToken, setRunToken] = useState(0);
  const [info, setInfo] = useState(""); // a message from Import / Export
  const [dialog, setDialog] = useState(null); // "settings" | { rules: i } (the full view's banner rules)
  // the selected banner plan (both views): 0 = banner plan 1
  const [stageTab, setStageTab] = useState(0);
  const [namesFor, setNamesFor] = useState(null); // the banner plan whose names are being edited
  setPrecision(state.settings.decimals ?? 2); // before any child formats a number
  const engine = useEngine(state, runToken, lang);
  // every comparison is calculated with the current settings too
  const calcKey = JSON.stringify(["pct", "eps", "maxPulls", "maxStates", "method", "noLimits"].map((k) => settings[k]));
  const compareItems = useMemo(() => compare.items.map((it) => ({ ...it, snapshot: { ...it.snapshot, settings } })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [compare.items, calcKey]);
  const compareResults = useCompare(compareItems, lang);
  const P = presets();
  // several banner plans: both views edit the selected one
  const views = [state, ...stagesOf(state).map((_, k) => stageView(state, k + 1))];
  const tab = Math.min(stageTab, views.length - 1);

  useEffect(() => store(STORE_KEY, setup), [setup]);
  useEffect(() => store(SETTINGS_KEY, settings), [settings]);
  useEffect(() => { if (state.preset === "custom") store(CUSTOM_KEY, snapshotOf(state)); }, [state]);
  useEffect(() => store(COMPARE_KEY, compare), [compare]);
  useEffect(() => store("banner-calc-lang", lang), [lang]);
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
    const nameOf = (v) => {
      const goals = v.goal.map((r) => reqLabel(v.banner, r)).join(v.goalMode === "all" ? T.goalLabel.joinAll : T.goalLabel.joinAny);
      return T.compare.autoName(planTitle(v), goals);
    };
    const name = [state, ...stagesOf(state).map((_, k) => stageView(state, k + 1))].map(nameOf).join(T.stages.then);
    setCompare((c) => ({ ...c, items: [...c.items, { id: newId(), name, snapshot: structuredClone(snapshotOf(state)) }] }));
  };
  // Reset puts a banner plan's rules, goals, pity and names back to defaults; Undo restores them
  // (the plan's other banner plans and your pulls stay as they are)
  const resetPlan = (i) => {
    setUndoState(state);
    setUndoKind("reset");
    setUndoPlan(i + 1);
    if (i === 0) {
      setState((s) => ({ ...freshState(presets()[s.preset] ? s.preset : "custom"), mode: s.mode, budget: s.budget, desired: s.desired, chartLines: s.chartLines, stages: stagesOf(s), spend: s.spend ?? "shared" }));
      return;
    }
    update((s) => {
      const v = stageView(s, i);
      const n = newStage(presets()[v.preset] ? v.preset : "custom");
      return writeStage(s, i, { ...v, banner: n.banner, goal: n.goal, goalMode: "all", start: n.start, title: "", names: null });
    });
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

  // Picking a preset loads it fresh; picking "Custom banner" brings back your own banner.
  // Either way only that banner plan changes: the others and how the pulls are spent stay.
  const savedCustom = () => load(CUSTOM_KEY, (v) => v && v.banner && Array.isArray(v.goal));
  const customParts = () => {
    const saved = savedCustom();
    if (!saved) { const f = freshState("custom"); return { banner: f.banner, goal: f.goal, goalMode: "all", start: f.start, title: "" }; }
    const c = structuredClone(saved);
    return { banner: c.banner, goal: c.goal, goalMode: c.goalMode ?? "all", start: c.start ?? { pity: {}, streak: {} }, title: c.title ?? "" };
  };
  const pickBanner = (i, key) => {
    setUndoState(null);
    const cur = stageView(state, i);
    if (key === "custom" && cur.preset === "custom") return;
    if (i === 0) {
      setState((s) => {
        const keep = { mode: s.mode, budget: s.budget, desired: s.desired, chartLines: s.chartLines ?? freshState(key === "custom" ? "custom" : key).chartLines, stages: stagesOf(s), spend: s.spend ?? "shared" };
        if (key !== "custom") return { ...freshState(key), ...keep };
        const c = customParts();
        return { ...freshState("custom"), ...keep, ...c, budget: s.budget, preset: "custom", names: null };
      });
    } else {
      update((s) => {
        const v = stageView(s, i);
        if (key !== "custom") {
          const n = newStage(key);
          return writeStage(s, i, { ...v, preset: key, banner: n.banner, goal: n.goal, goalMode: "all", start: n.start, title: "", names: null });
        }
        const c = customParts();
        return writeStage(s, i, { ...v, ...c, preset: "custom", names: null });
      });
    }
    // your own banner: its rules open right away in the full view
    if (key === "custom" && !simpleView) setDialog({ rules: i });
  };

  // the plan on screen is in the comparison already (same banner, plan and pity)
  // (settings are shared by all setups, so they don't count)
  const planKey = (snap) => JSON.stringify({ ...snap, settings: undefined });
  const currentKey = planKey(snapshotOf(state));
  const isSaved = compare.items.some((it) => planKey(it.snapshot) === currentKey);

  const compareApi = {
    items: compare.items,
    results: compareResults,
    budget: compare.budget,
    setBudget: (b) => setCompare((c) => ({ ...c, budget: b })),
    rename: (id, name) => setCompare((c) => ({ ...c, items: c.items.map((it) => (it.id === id ? { ...it, name } : it)) })),
    remove: (id) => setCompare((c) => ({ ...c, items: c.items.filter((it) => it.id !== id) })),
    load: (it) => { setState((s) => withPresetNames({ ...s, ...structuredClone(it.snapshot) })); setStageTab(0); },
  };

  // the banner plans, for the tabs and the plan row of both views
  const plans = {
    views,
    selected: tab,
    select: setStageTab,
    // a new banner plan: the same banner as the last one (the next banner of that type is the usual plan)
    add: () => {
      const last = views[views.length - 1];
      update((s) => ({ ...s, stages: [...stagesOf(s), newStage(P[last.preset] ? last.preset : "limitedChar")] }));
      setStageTab(views.length);
    },
    pick: pickBanner,
    reset: resetPlan,
    remove: (i) => { setUndoState(null); update((s) => removeStage(s, i)); setStageTab(Math.max(0, i - 1)); },
    editNames: (i) => setNamesFor(i),
    full: !simpleView,
    rules: (i) => setDialog({ rules: i }),
    importFile: () => fileRef.current?.click(),
    exportFile: async () => setInfo(await exportData(state, T.setup)),
  };
  const { share, shareMsg, clearShare } = useShare(async () => {
    // a short link with its own preview card where the site's server functions are there
    // (Cloudflare), else the long "#s=" link
    const result = engine.status === "busy" ? null : engine.result;
    const parts = shareParts(state, result, T);
    let image = null;
    try { image = shareCard(parts, document.querySelector(".chart-container canvas")); } catch { /* text-only card */ }
    const url = (await makeShortLink(state, parts, image)) ?? (await makeShareLink(state));
    return { url, summary: shareSummary(state, result, T) };
  });

  return (
    <I18nContext.Provider value={T}>
        {backgroundStyle(simpleView ? "simple" : "full") && (
          <div key={simpleView ? "simple" : "full"} className="background-container" style={backgroundStyle(simpleView ? "simple" : "full")} aria-hidden="true" />
        )}
        <main className="main">
          <section className={`content-box ${simpleView ? "is-simple" : "is-full"}`} aria-label={T.app.title}>
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
                <button type="button" className="btn btn--secondary header-settings" onClick={() => setDialog("settings")} title={T.setup.tabSettingsTitle} aria-label={T.setup.tabSettings}>
                  <span aria-hidden="true">⚙</span><span className="header-settings-text">{T.setup.tabSettings}</span>
                </button>
                <button type="button" className="btn btn--primary header-share" onClick={share} title={T.app.shareTitle}>{T.app.share}</button>
              </div>
            </div>

            <Notices shareMsg={shareMsg} clearShare={clearShare}
              canUndo={!!undoState} undoText={undoKind === "shared" ? T.app.sharedLoaded : views.length > 1 ? T.stages.resetDone(undoPlan) : T.app.resetDone}
              onUndo={undoReset} onDismissUndo={() => setUndoState(null)} linkError={linkError} onDismissError={() => setLinkError(false)}
              info={info} onDismissInfo={() => setInfo("")} />

            {/* the same two cards in both views: the plan, and the answer */}
            <div className="app-layout">
              <PlanCard state={state} update={update} plans={plans} full={!simpleView}
                firstVisit={firstVisit} onExampleDone={() => setFirstVisit(false)} />
              <div className="s-side">
                <AnswerCard state={state} update={update} engine={engine} theme={theme} full={!simpleView}
                  compare={compareApi} isSaved={isSaved} onCompare={addToCompare}
                  onOtherView={() => setViewMode(simpleView ? "full" : "simple")} onRun={() => setRunToken((t) => t + 1)} />
              </div>
            </div>
            <input ref={fileRef} type="file" accept=".json,application/json" hidden
              onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) setInfo(await importData(f, { setState, setSettings, S: T.setup })); }} />
          </section>
        </main>
        {dialog === "settings" && (
          <Dialog title={T.setup.tabSettings} closeLabel={T.app.close} onClose={() => setDialog(null)} wide
            foot={<button type="button" className="btn btn--primary" onClick={() => setDialog(null)}>{T.names.done}</button>}>
            <SettingsPanel settings={settings} setSettings={setSettings} />
          </Dialog>
        )}
        {dialog?.rules != null && dialog.rules < views.length && (
          <Dialog title={T.stages.rulesTitle(dialog.rules + 1)} closeLabel={T.app.close} onClose={() => setDialog(null)} wide
            foot={<button type="button" className="btn btn--primary" onClick={() => setDialog(null)}>{T.names.done}</button>}>
            <BannerEditor state={views[dialog.rules]} update={stageUpdate(update, dialog.rules)} />
          </Dialog>
        )}
        {namesFor != null && namesFor < views.length && (
          <NamesDialog key={namesFor} view={views[namesFor]} index={namesFor} onClose={() => setNamesFor(null)}
            onSave={(v) => { const i = namesFor; update((s) => writeStage(s, i, { ...stageView(s, i), title: v.title, names: v.names ?? null, banner: v.banner })); setNamesFor(null); }} />
        )}
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
    </I18nContext.Provider>
  );
}
