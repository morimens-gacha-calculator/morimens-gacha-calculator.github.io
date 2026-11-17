import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useT } from "../i18n/index.js";

// A technical word with a dotted underline: hovering shows its meaning, and a tap or click opens
// it as a note (phones have no hover). Closes like the "?" notes.
export function Term({ label, explain }) {
  const [open, setOpen] = useState(false);
  const boxRef = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <span className="help term-box" ref={boxRef}>
      <button type="button" className="term" title={open ? undefined : explain} aria-expanded={open} onClick={() => setOpen((o) => !o)}>{label}</button>
      {open && <span className="help-pop term-pop" role="note">{explain}</span>}
    </span>
  );
}

// "?" button that opens a short explanation. On wide screens it opens under the button and
// shifts left or right to stay inside the window; on phones it opens as a panel at the bottom.
// It closes on a click or tap anywhere outside it, on Escape, or with its × button.
export function HelpButton({ text, label }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  const [shift, setShift] = useState(0);
  const popRef = useRef(null);
  const boxRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const outside = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", outside); document.removeEventListener("keydown", esc); };
  }, [open]);

  useLayoutEffect(() => {
    if (!open || !popRef.current) return;
    const r = popRef.current.getBoundingClientRect();
    const margin = 10, vw = document.documentElement.clientWidth;
    if (r.right > vw - margin) setShift((s) => s - (r.right - (vw - margin)));
    else if (r.left < margin) setShift((s) => s + (margin - r.left));
  }, [open]);

  const toggle = () => { setShift(0); setOpen((o) => !o); };
  return (
    <span className="help" ref={boxRef}>
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
