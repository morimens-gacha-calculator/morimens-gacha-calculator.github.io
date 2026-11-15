import { presets } from "../model.js";
import { useT } from "../i18n/index.js";

// Banner dropdown with a Reset button. Reset can be undone right after, instead of asking first.
export default function BannerPicker({ current, onPick, hint, onReset, canUndo, onUndo }) {
  const T = useT();
  const P = presets();
  return (
    <div className="banner-picker">
      <div className="picker-row">
        <label className="field picker-field">
          <span className="field-label">{T.app.bannerLabel}</span>
          <select className="select picker-select" value={P[current] ? current : "custom"} onChange={(e) => onPick(e.target.value)}>
            {Object.entries(P).map(([key, p]) => <option key={key} value={key}>{p.title}</option>)}
            <option value="custom">{T.app.customBanner}</option>
          </select>
        </label>
        <button type="button" className="btn btn--reset" onClick={onReset} title={T.app.resetTitle}>{T.app.reset}</button>
      </div>
      {canUndo
        ? <p className="subtitle undo-note" role="status">{T.app.resetDone} <button type="button" className="btn btn--link" onClick={onUndo}>{T.app.undo}</button></p>
        : <p className="subtitle">{hint}</p>}
    </div>
  );
}
