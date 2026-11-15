import { createContext, useContext, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.js";

export const HelpContext = createContext(true);

// "?" button that opens a short explanation. On wide screens it opens under the button and
// shifts left or right to stay inside the window; on phones it opens as a panel at the bottom.
export function HelpButton({ text, label }) {
  const show = useContext(HelpContext);
  const T = useT();
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const popRef = useRef(null);

  useLayoutEffect(() => {
    if (!open || !popRef.current) return;
    const r = popRef.current.getBoundingClientRect();
    const margin = 10, vw = document.documentElement.clientWidth;
    if (r.right > vw - margin) setShift((s) => s - (r.right - (vw - margin)));
    else if (r.left < margin) setShift((s) => s + (margin - r.left));
  }, [open]);

  if (!show) return null;
  const toggle = () => { setShift(0); setOpen((o) => !o); };
  return (
    <span className="help">
      <button type="button" className="help-btn" aria-expanded={open} aria-label={T.help.label(label)} onClick={toggle}>?</button>
      {open && (
        <span className="help-pop" role="note" ref={popRef} style={{ "--shift": `${shift}px` }}>
          {text}
          <button type="button" className="help-close" onClick={() => setOpen(false)} aria-label={T.help.close}>×</button>
        </span>
      )}
    </span>
  );
}
