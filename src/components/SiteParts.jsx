import { LOCALES, browserLocale, setLocale, useT } from "../i18n/index.js";
import { BACKGROUNDS, BANNERS_PATCH, SITE_NAME, SOURCE_URL } from "../site.config.js";

// What every calculator on the site shares: which calculator is open (its own address, so links
// and reloads keep it), the language, the background and the footer.

// The calculators, in the order of the switch under the title; path: where each one lives,
// from the site's root (each has its own index.html, so the address works on any host)
export const CALCULATORS = [
  { key: "pulls", path: "" },
  { key: "covenant", path: "covenant/" },
];
const others = CALCULATORS.filter((c) => c.path);
// the open calculator and the site's root, from the address
export function whereAmI(pathname = location.pathname) {
  for (const c of others) {
    const m = pathname.match(new RegExp(`^(.*/)${c.path.replace(/\/$/, "")}(/|/index\\.html)?$`));
    if (m) return { calc: c.key, root: m[1] };
  }
  return { calc: "pulls", root: pathname.replace(/[^/]*$/, "") };
}
export const hrefOf = (root, key) => root + (CALCULATORS.find((c) => c.key === key)?.path ?? "");

// The switch between calculators, under the site's title. Plain links (they open in a new tab
// too); a normal click switches without reloading the page.
export function CalcNav({ calc, onGo }) {
  const T = useT();
  const { root } = whereAmI();
  return (
    <nav className="seg calc-nav" aria-label={T.site.navLabel}>
      {CALCULATORS.map((c) => (
        <a key={c.key} href={hrefOf(root, c.key)} className={calc === c.key ? "is-on" : ""} aria-current={calc === c.key ? "page" : undefined}
          onClick={(e) => {
            if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
            e.preventDefault();
            onGo(c.key);
          }}>
          {T.site.calcs[c.key]}
        </a>
      ))}
    </nav>
  );
}

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
export function LanguagePicker({ lang, onChange }) {
  const T = useT();
  if (Object.keys(LOCALES).length < 2) return null;
  return (
    <label className="inline-field">
      <span className="sr-only">{T.app.language}</span>
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
