import { useEffect, useState } from "react";
import { useT } from "../i18n/index.js";

// Share, for the whole plan (every banner plan): on phones the system share sheet (summary +
// link); elsewhere both copied as text, or shown to copy by hand when there's no clipboard.
// The button sits in the header; what happened shows in the notices line under it.
export function useShare(onShare) {
  const [shareMsg, setShareMsg] = useState(null); // { kind: "copied" } | { kind: "manual", text }
  useEffect(() => {
    if (shareMsg?.kind !== "copied") return undefined;
    const t = setTimeout(() => setShareMsg(null), 4000);
    return () => clearTimeout(t);
  }, [shareMsg]);
  const share = async () => {
    const { url, summary } = await onShare();
    const text = `${summary}\n${url}`;
    const phone = typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;
    // the link inside the text, on its own line: given separately, some apps put it on the
    // summary's last line
    if (phone && navigator.share) {
      try { await navigator.share({ text }); return; }
      catch (e) { if (e?.name === "AbortError") return; } // closed by the user
    }
    try {
      await navigator.clipboard.writeText(text);
      setShareMsg({ kind: "copied" });
    } catch {
      setShareMsg({ kind: "manual", text });
    }
  };
  return { share, shareMsg, clearShare: () => setShareMsg(null) };
}

// One line under the header: link copied, copy by hand, a reset or shared setup to undo, a broken
// link, or what Import / Export did
export function Notices({ shareMsg, clearShare, canUndo, undoText, onUndo, onDismissUndo, linkError, onDismissError, info, onDismissInfo }) {
  const T = useT();
  let line = null;
  if (shareMsg?.kind === "copied") line = <Notice tone="ok" icon="✓" text={T.app.linkCopied} />;
  else if (shareMsg?.kind === "manual") line = (
    <Notice tone="info" text={T.app.copyLink} onClose={clearShare} closeLabel={T.app.close}>
      <textarea className="custom-input share-url" readOnly rows={3} value={shareMsg.text} onFocus={(e) => e.target.select()} aria-label={T.app.copyLink} />
    </Notice>
  );
  else if (canUndo) line = <Notice tone="info" text={undoText} action={T.app.undo} onAction={onUndo} onClose={onDismissUndo} closeLabel={T.app.close} />;
  else if (linkError) line = <Notice tone="err" icon="!" text={T.app.linkBroken} onClose={onDismissError} closeLabel={T.app.close} />;
  else if (info) line = <Notice tone="info" text={info} onClose={onDismissInfo} closeLabel={T.app.close} />;
  return line ? <div className="notices">{line}</div> : null;
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
