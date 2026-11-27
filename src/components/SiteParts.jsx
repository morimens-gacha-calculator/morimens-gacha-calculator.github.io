import { useEffect, useRef, useState } from "react";
import { LOCALES, browserLocale, setLocale, useT } from "../i18n/index.js";
import { BACKGROUNDS, BANNERS_PATCH, SITE_NAME, SOURCE_URL } from "../site.config.js";

// What every calculator on the site shares: which calculator is open (its own address, so links
// and reloads keep it), the header with the menu of calculators, the language, the background
// and the footer.

// The calculators, in the menu's order; path: where each one lives, from the site's root (each
// has its own index.html, so the address works on any host; the root page sends you to the
// first one); icon: drawn in the menu
export const CALCULATORS = [
  { key: "banners", path: "banners/" },
  { key: "covenant", path: "covenant/" },
  { key: "income", path: "income/" },
];
// the open calculator and the site's root, from the address
export function whereAmI(pathname = location.pathname) {
  for (const c of CALCULATORS) {
    const m = pathname.match(new RegExp(`^(.*/)${c.path.replace(/\/$/, "")}(/|/index\\.html)?$`));
    if (m) return { calc: c.key, root: m[1] };
  }
  return { calc: CALCULATORS[0].key, root: pathname.replace(/[^/]*$/, "") };
}
export const hrefOf = (root, key) => root + (CALCULATORS.find((c) => c.key === key)?.path ?? "");

// The header of every calculator: the menu button, the site's name with the open calculator's
// name under it, and the calculator's own buttons (children) on the right
export function SiteHeader({ calc, onGo, lang, onLang, children }) {
  const T = useT();
  const [open, setOpen] = useState(false);
  return (
    <div className="header-row">
      <div className="site-brand">
        <button type="button" className="menu-btn" onClick={() => setOpen(true)} aria-label={T.site.openMenu} aria-haspopup="dialog" aria-expanded={open} title={T.site.openMenu}>
          <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
        <div className="site-titles">
          <h1 className="main-title">{T.app.title}</h1>
          <p className="calc-name">{T.site.calcs[calc]}</p>
        </div>
      </div>
      {children && <div className="row header-buttons">{children}</div>}
      {open && <SiteMenu calc={calc} onGo={onGo} lang={lang} onLang={onLang} onClose={() => setOpen(false)} />}
    </div>
  );
}

// The menu: the calculators (plain links: they open in a new tab too; a normal click switches
// without reloading the page) and the language. A panel from the left on every screen size;
// Escape, × or a click outside closes it.
function SiteMenu({ calc, onGo, lang, onLang, onClose }) {
  const T = useT();
  const ref = useRef(null);
  const { root } = whereAmI();
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal?.();
    d?.querySelector(".is-on")?.focus();
    return () => { if (d?.open) d.close(); };
  }, []);
  return (
    <dialog ref={ref} className="site-menu" aria-label={T.site.menuTitle}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}>
      <div className="site-menu-inner">
        <div className="site-menu-head">
          <span className="site-menu-title">{T.site.menuTitle}</span>
          <button type="button" className="notice-close" onClick={onClose} aria-label={T.site.closeMenu} title={T.site.closeMenu}>×</button>
        </div>
        <nav aria-label={T.site.navLabel}>
          <ul className="site-menu-list">
            {CALCULATORS.map((c) => (
              <li key={c.key}>
                <a href={hrefOf(root, c.key)} className={`site-menu-item ${calc === c.key ? "is-on" : ""}`} aria-current={calc === c.key ? "page" : undefined}
                  onClick={(e) => {
                    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
                    e.preventDefault();
                    onClose();
                    onGo(c.key);
                  }}>
                  <span className="site-menu-icon" aria-hidden="true">{MENU_ICONS[c.key]}</span>
                  <span className="site-menu-text">
                    <span className="site-menu-name">{T.site.calcs[c.key]}</span>
                    <span className="site-menu-desc">{T.site.descs[c.key]}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
        <div className="site-menu-foot">
          <LanguagePicker lang={lang} onChange={onLang} labelled />
        </div>
      </div>
    </dialog>
  );
}
const MENU_ICONS = {
  // a chance curve
  banners: <svg width="22" height="22" viewBox="0 0 24 24" focusable="false"><path d="M3 20h18M4 19c3-1 4-12 8-13s5 6 8 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>,
  // substat lines, one locked
  covenant: <svg width="22" height="22" viewBox="0 0 24 24" focusable="false"><path d="M3 6h10M3 12h8M3 18h10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /><rect x="15" y="12" width="6.5" height="6" rx="1.2" fill="none" stroke="currentColor" strokeWidth="1.6" /><path d="M16.5 12v-1.6a1.75 1.75 0 0 1 3.5 0V12" fill="none" stroke="currentColor" strokeWidth="1.6" /></svg>,
  // a stack of coins
  income: <svg width="22" height="22" viewBox="0 0 24 24" focusable="false"><ellipse cx="12" cy="6" rx="7" ry="2.6" fill="none" stroke="currentColor" strokeWidth="1.7" /><path d="M5 6v4.5c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6V6M5 10.5V15c0 1.4 3.1 2.6 7 2.6s7-1.2 7-2.6v-4.5M5 15v3.4C5 19.8 8.1 21 12 21s7-1.2 7-2.6V15" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" /></svg>,
};

// The language, read before the first render so charts and texts are right from the start
const LANG_KEY = "banner-calc-lang";
export function loadLang() {
  let saved = null;
  try { saved = localStorage.getItem(LANG_KEY); } catch { /* no storage */ }
  const code = LOCALES[saved] ? saved : browserLocale();
  setLocale(code);
  document.documentElement.lang = code;
  return code;
}
export function saveLang(code) {
  setLocale(code);
  document.documentElement.lang = code;
  try { localStorage.setItem(LANG_KEY, code); } catch { /* no storage */ }
}
export function LanguagePicker({ lang, onChange, labelled = false }) {
  const T = useT();
  if (Object.keys(LOCALES).length < 2) return null;
  return (
    <label className={labelled ? "site-lang" : "inline-field"}>
      <span className={labelled ? "s-eyebrow" : "sr-only"}>{T.app.language}</span>
      <select className="select" value={lang} onChange={(e) => onChange(e.target.value)} aria-label={T.app.language}>
        {Object.entries(LOCALES).map(([code, L]) => <option key={code} value={code}>{L.langName}</option>)}
      </select>
    </label>
  );
}

// The background of a view ("simple", "full" or a calculator's key), from src/site.config.js
export function backgroundStyle(view) {
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
}
export function Background({ view }) {
  const style = backgroundStyle(view);
  return style ? <div key={view} className="background-container" style={style} aria-hidden="true" /> : null;
}

export function SiteFooter() {
  const T = useT();
  return (
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
  );
}
