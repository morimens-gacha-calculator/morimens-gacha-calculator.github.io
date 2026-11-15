import { useEffect, useState } from "react";
import { presets } from "../model.js";
import { useT } from "../i18n/index.js";

// Banner dropdown with Reset and Share. Reset (and opening a shared link) can be undone right
// after, instead of asking first. Share gives a one-line summary and a link to this setup.
export default function BannerPicker({ current, onPick, hint, onReset, canUndo, undoKind, onUndo, onShare, linkError }) {
  const T = useT();
  const P = presets();
  const [shareMsg, setShareMsg] = useState(null); // { kind: "copied" } | { kind: "manual", text }
  useEffect(() => {
    if (shareMsg?.kind !== "copied") return undefined;
    const t = setTimeout(() => setShareMsg(null), 4000);
    return () => clearTimeout(t);
  }, [shareMsg]);
  // Share: on phones the system share sheet (summary + link); elsewhere both copied as text
  const share = async () => {
    const { url, summary } = await onShare();
    const text = `${summary}\n${url}`;
    const phone = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    if (phone && navigator.share) {
      try { await navigator.share({ title: summary, text: summary, url }); return; }
      catch (e) { if (e?.name === "AbortError") return; } // closed by the user
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareMsg({ kind: "copied" });
    } catch {
      setShareMsg({ kind: "manual", text }); // no clipboard access: show it to copy by hand
    }
  };
  let line;
  if (shareMsg?.kind === "copied") line = <p className="subtitle undo-note" role="status">{T.app.linkCopied}</p>;
  else if (shareMsg?.kind === "manual") line = (
    <p className="subtitle share-manual" role="status">
      {T.app.copyLink}{" "}
      <textarea className="custom-input share-url" readOnly rows={2} value={shareMsg.text} onFocus={(e) => e.target.select()} aria-label={T.app.copyLink} />
      <button type="button" className="btn btn--link" onClick={() => setShareMsg(null)}>{T.app.close}</button>
    </p>
  );
  else if (canUndo) line = <p className="subtitle undo-note" role="status">{undoKind === "shared" ? T.app.sharedLoaded : T.app.resetDone} <button type="button" className="btn btn--link" onClick={onUndo}>{T.app.undo}</button></p>;
  else if (linkError) line = <p className="subtitle err-text" role="alert">{T.app.linkBroken}</p>;
  else line = <p className="subtitle">{hint}</p>;
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
        <button type="button" className="btn btn--reset" onClick={share} title={T.app.shareTitle}>{T.app.share}</button>
      </div>
      {line}
    </div>
  );
}
