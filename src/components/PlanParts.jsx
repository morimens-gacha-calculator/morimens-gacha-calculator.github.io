import { useT } from "../i18n/index.js";
import NumberInput from "./NumberInput.jsx";
import { allAlts, allNodes, num, DEFAULT_SETTINGS } from "../model.js";

// The full view's pieces of a banner plan: the pity table, the settings (in their own dialog,
// for every plan) and saving or loading a setup as a file (the "⋯" menu).

// Export: the setup as a JSON file (or copied, where downloads are blocked). Import: a file
// exported before, as your custom banner. Each returns the message to show.
export async function exportData(state, S) {
  const text = JSON.stringify(state, null, 2);
  try {
    const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url; a.download = "banner-calculator.json";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return S.exported;
  } catch {
    try { await navigator.clipboard.writeText(text); return S.copied; }
    catch { return S.exportBlocked; }
  }
}
export async function importData(file, { setState, setSettings, S }) {
  try {
    const s = JSON.parse(await file.text());
    if (!s.banner || !Array.isArray(s.goal)) throw new Error(S.notAnExport);
    setState({ ...s, preset: "custom" });
    if (s.settings) setSettings({ ...DEFAULT_SETTINGS, ...s.settings });
    return S.loaded(file.name);
  } catch (err) { return S.loadFailed(err.message); }
}

export function PityPanel({ state, update }) {
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

// One setting per row: name and hint on the left, a control of fixed width on the right
function SettingRow({ label, hint, wide, children }) {
  return (
    <label className={`setting-row ${wide ? "is-wide" : ""}`}>
      <span className="setting-text">
        <span className="setting-label">{label}</span>
        {hint && <span className="setting-hint">{hint}</span>}
      </span>
      <span className="setting-control">{children}</span>
    </label>
  );
}

export function SettingsPanel({ settings: s, setSettings }) {
  const L = useT().settings;
  const set = (f, v) => setSettings((cur) => ({ ...cur, [f]: v }));
  return (
    <div className="settings-list">
      <p className="settings-global-note">{L.globalNote}</p>
      <div className="settings-group">{L.groupDisplay}</div>
      <SettingRow label={L.decimals} hint={L.decimalsHint}>
        <NumberInput className="custom-input" min={0} max={6} fallback={2} value={s.decimals ?? 2} onChange={(v) => set("decimals", v)} />
      </SettingRow>
      <SettingRow label={L.percentiles} hint={L.percentilesHint} wide>
        <input type="text" className="custom-input" value={s.pct} onChange={(e) => set("pct", e.target.value)} />
      </SettingRow>
      <SettingRow label={L.wording} hint={L.wordingHint}>
        <select className="select" value={s.wording ?? "auto"} onChange={(e) => set("wording", e.target.value)}>
          <option value="auto">{L.wordingAuto}</option>
          <option value="simple">{L.wordingSimple}</option>
          <option value="technical">{L.wordingTechnical}</option>
        </select>
      </SettingRow>
      <SettingRow label={L.showBest} hint={L.showBestHint}>
        <span className="switch-row">
          <input type="checkbox" className="switch" checked={s.showBest !== false} onChange={(e) => set("showBest", e.target.checked)} />
          <span>{s.showBest !== false ? L.on : L.off}</span>
        </span>
      </SettingRow>
      <SettingRow label={L.showWorst} hint={L.showWorstHint}>
        <span className="switch-row">
          <input type="checkbox" className="switch" checked={s.showWorst !== false} onChange={(e) => set("showWorst", e.target.checked)} />
          <span>{s.showWorst !== false ? L.on : L.off}</span>
        </span>
      </SettingRow>
      <div className="settings-group">{L.groupCalc}</div>
      <SettingRow label={L.eps} hint={L.epsHint}>
        <input type="text" className="custom-input" value={s.eps} onChange={(e) => set("eps", e.target.value)} />
      </SettingRow>
      <SettingRow label={L.noLimits} hint={L.noLimitsHint}>
        <span className="switch-row">
          <input type="checkbox" className="switch" checked={!!s.noLimits} onChange={(e) => set("noLimits", e.target.checked)} />
          <span>{s.noLimits ? L.on : L.off}</span>
        </span>
      </SettingRow>
      <SettingRow label={L.maxPulls}>
        {s.noLimits
          ? <input type="text" className="custom-input" value={L.unlimited} disabled readOnly />
          : <NumberInput className="custom-input" min={1} fallback={DEFAULT_SETTINGS.maxPulls} value={s.maxPulls} onChange={(v) => set("maxPulls", v)} />}
      </SettingRow>
      <SettingRow label={L.maxStates}>
        {s.noLimits
          ? <input type="text" className="custom-input" value={L.unlimited} disabled readOnly />
          : <NumberInput className="custom-input" min={1000} fallback={DEFAULT_SETTINGS.maxStates} value={s.maxStates} onChange={(v) => set("maxStates", v)} />}
      </SettingRow>
      <SettingRow label={L.method}>
        <select className="select" value={s.method} onChange={(e) => set("method", e.target.value)}>
          <option value="auto">{L.methodAuto}</option>
          <option value="joint">{L.methodJoint}</option>
          <option value="split">{L.methodSplit}</option>
          <option value="layered">{L.methodLayered}</option>
        </select>
      </SettingRow>
    </div>
  );
}
