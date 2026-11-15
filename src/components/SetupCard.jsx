import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import { HelpButton } from "./Help.jsx";
import BannerEditor from "./BannerEditor.jsx";
import { allAlts, allNodes, num, DEFAULT_SETTINGS } from "../model.js";

export default function SetupCard({ state, update, setState, tabRequest }) {
  const T = useT();
  const S = T.setup;
  const TABS = [
    { id: "pity", label: S.tabPity, help: S.helpPity },
    { id: "banner", label: S.tabBanner, help: S.helpBanner },
    { id: "settings", label: S.tabSettings, help: S.helpSettings },
  ];
  const [tab, setTab] = useState("pity");
  useEffect(() => { if (tabRequest) setTab(tabRequest.tab); }, [tabRequest]);
  const [msg, setMsg] = useState("");
  const fileRef = useRef(null);
  const current = TABS.find((t) => t.id === tab);

  const exportData = async () => {
    const text = JSON.stringify(state, null, 2);
    try {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url; a.download = "banner-calculator.json";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg(S.exported);
    } catch {
      try { await navigator.clipboard.writeText(text); setMsg(S.copied); }
      catch { setMsg(S.exportBlocked); }
    }
  };
  const importData = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    try {
      const s = JSON.parse(await f.text());
      if (!s.banner || !Array.isArray(s.goal)) throw new Error(S.notAnExport);
      setState({ ...s, settings: { ...DEFAULT_SETTINGS, ...s.settings }, preset: "custom" });
      setMsg(S.loaded(f.name));
    } catch (err) { setMsg(S.loadFailed(err.message)); }
  };

  return (
    <div className="tab-panel-card">
      <div className="tab-nav" role="tablist" aria-label={S.tabs}>
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" id={`tab-${t.id}`} aria-selected={tab === t.id} aria-controls={`panel-${t.id}`}
            className={`tab-link ${tab === t.id ? "active" : ""}`} onClick={() => setTab(t.id)}>{t.label}</button>
        ))}
        <HelpButton label={current.label} text={current.help} />
      </div>
      <div className="tab-content" role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
        {tab === "pity" && <PityPanel state={state} update={update} />}
        {tab === "banner" && <BannerEditor state={state} update={update} />}
        {tab === "settings" && <SettingsPanel state={state} update={update} />}
      </div>
      <div className="data-buttons">
        <button type="button" className="btn btn--soft" onClick={() => fileRef.current?.click()}>{S.importData}</button>
        <input ref={fileRef} type="file" accept=".json,application/json" hidden onChange={importData} />
        <button type="button" className="btn btn--soft" onClick={exportData}>{S.exportData}</button>
        <HelpButton label={S.importExportLabel} text={S.helpImportExport} />
        {msg && <span className="muted small">{msg}</span>}
      </div>
    </div>
  );
}

function PityPanel({ state, update }) {
  const T = useT();
  const L = T.pity;
  const alts = allAlts(state.banner);
  const pityAlts = alts.filter((a) => num(a.alt.pity) > 0 || (num(a.alt.softStart) > 0 && a.alt.softStep));
  const streakNodes = allNodes(state.banner).filter((n) => n.node.streak > 0);
  const setPity = (key, v) => update((s) => ({ ...s, start: { ...s.start, pity: { ...s.start.pity, [key]: Math.max(0, Math.floor(num(v))) } } }));
  const setStreak = (key, i, v) => update((s) => {
    const cur = s.start.streak[key] ?? [0, 0];
    const next = [...cur]; next[i] = Math.max(0, Math.floor(num(v)));
    return { ...s, start: { ...s.start, streak: { ...s.start.streak, [key]: next } } };
  });
  if (!pityAlts.length && !streakNodes.length) return <p className="muted">{L.none}</p>;
  return (
    <div className="table-container">
      {pityAlts.length > 0 && (
        <table className="pity-table">
          <thead><tr><th>{L.outcome}</th><th className="hide-sm">{L.countedIn}</th><th className="num">{L.pityNow}</th><th className="num hide-sm">{L.hardPity}</th></tr></thead>
          <tbody>
            {pityAlts.map((a) => (
              <tr key={a.key}>
                <td className="banner-name">
                  {a.name}
                  <span className="cell-sub show-sm">{a.parentName === null ? L.pulls : L.resultsOf(a.parentName)} · {L.hardPity.toLowerCase()} {num(a.alt.pity) > 0 ? a.alt.pity : L.softOnly}</span>
                </td>
                <td className="muted hide-sm">{a.parentName === null ? L.pulls : L.resultsOf(a.parentName)}</td>
                <td className="num">
                  <NumberInput className="custom-input w-s" min={0} max={num(a.alt.pity) > 0 ? num(a.alt.pity) - 1 : Infinity}
                    aria-label={L.pityNowFor(a.name)} value={state.start.pity[a.key] ?? 0} onChange={(v) => setPity(a.key, v)} />
                </td>
                <td className="num muted hide-sm">{num(a.alt.pity) > 0 ? a.alt.pity : L.softOnly}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {streakNodes.length > 0 && (
        <table className="pity-table">
          <thead><tr><th>{L.memory}</th><th>{L.lastResult}</th><th className="num">{L.inARow}</th></tr></thead>
          <tbody>
            {streakNodes.map((n) => {
              const cur = state.start.streak[n.key] ?? [0, 0];
              return (
                <tr key={n.key}>
                  <td className="banner-name">{n.name}</td>
                  <td>
                    <select className="select" aria-label={L.lastResultOf(n.name)} value={cur[0]} onChange={(e) => setStreak(n.key, 0, e.target.value)}>
                      {n.node.alts.map((a, i) => <option key={i} value={i}>{a.name}</option>)}
                    </select>
                  </td>
                  <td className="num">
                    <NumberInput className="custom-input w-s" min={0} max={n.node.streak} aria-label={L.inARowOf(n.name)}
                      value={cur[1]} onChange={(v) => setStreak(n.key, 1, v)} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SettingsPanel({ state, update }) {
  const L = useT().settings;
  const s = state.settings;
  const set = (f, v) => update((st) => ({ ...st, settings: { ...st.settings, [f]: v } }));
  return (
    <div className="form-grid">
      <label className="field">
        <span className="field-label">{L.decimals}</span>
        <NumberInput className="custom-input" min={0} max={6} fallback={2} value={s.decimals ?? 2} onChange={(v) => set("decimals", v)} />
        <span className="muted small">{L.decimalsHint}</span>
      </label>
      <label className="field">
        <span className="field-label">{L.percentiles}</span>
        <input type="text" className="custom-input" value={s.pct} onChange={(e) => set("pct", e.target.value)} />
      </label>
      <label className="field">
        <span className="field-label">{L.eps}</span>
        <input type="text" className="custom-input" value={s.eps} onChange={(e) => set("eps", e.target.value)} />
        <span className="muted small">{L.epsHint}</span>
      </label>
      <label className="field">
        <span className="field-label">{L.maxPulls}</span>
        <NumberInput className="custom-input" min={1} fallback={1000000} value={s.maxPulls} onChange={(v) => set("maxPulls", v)} />
      </label>
      <label className="field">
        <span className="field-label">{L.maxStates}</span>
        <NumberInput className="custom-input" min={1000} fallback={1000000} value={s.maxStates} onChange={(v) => set("maxStates", v)} />
      </label>
      <label className="field">
        <span className="field-label">{L.method}</span>
        <select className="select" value={s.method} onChange={(e) => set("method", e.target.value)}>
          <option value="auto">{L.methodAuto}</option>
          <option value="joint">{L.methodJoint}</option>
          <option value="split">{L.methodSplit}</option>
        </select>
      </label>
    </div>
  );
}
