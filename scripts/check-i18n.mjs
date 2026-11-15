// Checks that every language file has exactly the same keys (and kinds of values) as en.js.
// Run: node scripts/check-i18n.mjs
import { LOCALES } from "../src/i18n/index.js";

const shape = (v) => (typeof v === "function" ? "function" : Array.isArray(v) ? "array" : typeof v);
function compare(ref, other, path, problems) {
  for (const [k, v] of Object.entries(ref)) {
    const p = path ? `${path}.${k}` : k;
    if (!(k in other)) { problems.push(`missing ${p}`); continue; }
    if (shape(v) !== shape(other[k])) problems.push(`${p}: ${shape(other[k])} instead of ${shape(v)}`);
    else if (shape(v) === "object") compare(v, other[k], p, problems);
    else if (shape(v) === "function" && v.length !== other[k].length) problems.push(`${p}: takes ${other[k].length} arguments instead of ${v.length}`);
  }
  for (const k of Object.keys(other)) if (!(k in ref)) problems.push(`extra ${path ? `${path}.${k}` : k}`);
}
let failed = false;
for (const [code, L] of Object.entries(LOCALES)) {
  if (code === "en") continue;
  const problems = [];
  compare(LOCALES.en, L, "", problems);
  console.log(`${code}: ${problems.length ? problems.join("; ") : "all keys match en"}`);
  failed ||= problems.length > 0;
}
process.exit(failed ? 1 : 0);
