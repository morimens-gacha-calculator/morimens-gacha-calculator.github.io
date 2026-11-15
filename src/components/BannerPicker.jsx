import { useEffect, useState } from "react";
import { presets } from "../model.js";
import { useT } from "../i18n/index.js";

// Banner dropdown with Reset and Share. Reset (and opening a shared link) can be undone right
// after, instead of asking first. Share gives a one-line summary and a link to this setup.
export default function BannerPicker({ current, onPick, hint, onReset, canUndo, undoKind, onUndo, onDismissUndo, onShare, linkError, onDismissError }) {
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
  // One line beside the buttons: a notice (copied, shared setup opened, reset, broken link) with
  // its action, or the banner's hint
  let line;
  if (shareMsg?.kind === "copied") line = <Notice tone="ok" icon="✓" text={T.app.linkCopied} />;
  else if (shareMsg?.kind === "manual") line = (
    <Notice tone="info" text={T.app.copyLink} onClose={() => setShareMsg(null)} closeLabel={T.app.close}>
      <textarea className="custom-input share-url" readOnly rows={2} value={shareMsg.text} onFocus={(e) => e.target.select()} aria-label={T.app.copyLink} />
    </Notice>
  );
  else if (canUndo) line = (
    <Notice tone="info" text={undoKind === "shared" ? T.app.sharedLoaded : T.app.resetDone}
      action={T.app.undo} onAction={onUndo} onClose={onDismissUndo} closeLabel={T.app.close} />
  );
  else if (linkError) line = <Notice tone="err" icon="!" text={T.app.linkBroken} onClose={onDismissError} closeLabel={T.app.close} />;
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

function Notice({ tone, icon, text, action, onAction, onClose, closeLabel, children }) {
  return (
    <div className={`notice notice--${tone}`} role={tone === "err" ? "alert" : "status"}>
      {icon && <span className="notice-icon" aria-hidden="true">{icon}</span>}
      <span className="notice-text">{text}</span>
      {children}
      {action && <button type="button" className="btn btn--small notice-action" onClick={onAction}>{action}</button>}
      {onClose && <button type="button" className="notice-close" onClick={onClose} aria-label={closeLabel}>×</button>}
    </div>
  );
}
