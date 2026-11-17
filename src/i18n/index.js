// Languages. To add one: copy en.js to a new file, translate it, import it here and add it
// to LOCALES under its language code. A language picker appears in the header once there is
// more than one. On a first visit the browser's language is used if it is available.
import { createContext, useContext } from "react";
import en from "./en.js";
import ru from "./ru.js";
import uk from "./ua.js";

import enSimple from "./simple/en.js";
import ruSimple from "./simple/ru.js";
import ukSimple from "./simple/ua.js";

export const LOCALES = { en, ru, uk };
// Everyday wording per language: only the texts that differ from the normal ones
export const SIMPLE_WORDING = { en: enSimple, ru: ruSimple, uk: ukSimple };

// The texts with the simple wording laid over them (sections merged one level deep)
const wordingCache = new Map();
export function withWording(code, simple) {
  const base = LOCALES[code] ?? LOCALES[DEFAULT_LOCALE];
  if (!simple) return base;
  if (!wordingCache.has(code)) {
    const over = SIMPLE_WORDING[code] ?? {};
    const out = { ...base };
    for (const [k, v] of Object.entries(over)) out[k] = v && typeof v === "object" && !Array.isArray(v) ? { ...base[k], ...v } : v;
    out.simpleWording = true;
    wordingCache.set(code, out);
  }
  return wordingCache.get(code);
}
export const DEFAULT_LOCALE = "en";

// The best match for the visitor's browser languages, e.g. "uk-UA" → "uk"
export function browserLocale() {
  const langs = typeof navigator !== "undefined" ? navigator.languages ?? [navigator.language] : [];
  for (const l of langs) {
    const code = String(l).toLowerCase().split("-")[0];
    if (LOCALES[code]) return code;
    if (code === "ua") return "uk";
  }
  return DEFAULT_LOCALE;
}

// Current strings for code outside React components (model, formatting)
let current = LOCALES[DEFAULT_LOCALE];
export function setLocale(code) { current = LOCALES[code] ?? LOCALES[DEFAULT_LOCALE]; return current; }
export const getStrings = () => current;

// The text of a failed calculation in the given language: engine errors come with a code and
// values (src/engine/errors.js); anything else is shown as it is.
export function errorText(T, { error, errorCode, errorValues } = {}) {
  const f = errorCode && T.errors.engine?.[errorCode];
  return f ? f(errorValues ?? {}) : error;
}

// React components read strings with useT(), so they re-render when the language changes
export const I18nContext = createContext(LOCALES[DEFAULT_LOCALE]);
export const useT = () => useContext(I18nContext);
