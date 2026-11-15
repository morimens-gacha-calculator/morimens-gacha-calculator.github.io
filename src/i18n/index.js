// Languages. To add one: copy en.js to a new file, translate it, import it here and add it
// to LOCALES under its language code. A language picker appears in the header once there is
// more than one. On a first visit the browser's language is used if it is available.
import { createContext, useContext } from "react";
import en from "./en.js";
import ru from "./ru.js";
import uk from "./ua.js";

export const LOCALES = { en, ru, uk };
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

// React components read strings with useT(), so they re-render when the language changes
export const I18nContext = createContext(LOCALES[DEFAULT_LOCALE]);
export const useT = () => useContext(I18nContext);
