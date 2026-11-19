import { useEffect, useRef } from "react";

// A dialog over the page (Edit names, Banner rules, Settings): a title with ×, a body that
// scrolls, and an optional row of buttons at the bottom. Escape, × or a click outside closes it.
// On phones it opens as a sheet from the bottom.
export default function Dialog({ title, closeLabel, onClose, onSubmit, foot, wide = false, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
    return () => { if (d?.open) d.close(); };
  }, []);
  const body = (
    <>
      <div className="names-head">
        <h2 className="names-title">{title}</h2>
        <button type="button" className="notice-close names-x" onClick={onClose} aria-label={closeLabel} title={closeLabel}>×</button>
      </div>
      <div className="names-body">{children}</div>
      {foot && <div className="names-foot">{foot}</div>}
    </>
  );
  return (
    <dialog ref={ref} className={`names-dialog ${wide ? "is-wide" : ""}`} aria-label={title}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      {onSubmit
        ? <form method="dialog" className="names-form" onSubmit={(e) => { e.preventDefault(); onSubmit(); }}>{body}</form>
        : <div className="names-form">{body}</div>}
    </dialog>
  );
}
