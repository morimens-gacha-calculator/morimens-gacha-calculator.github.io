// Sharing a covenant: the setup in a link ("#c=…") and the text that goes with it.
//
// The code is short and readable: "1" (the format's version), then 2 digits for each of the 3
// current lines and then for each goal: the substat's place in SUBSTATS (0…7) and the level
// (1…8). Lines Crit. Rate Lv 8, Keyflare Regen Lv 6, Crit. Rate Lv 5 with goals Crit. Rate 6+
// and Crit. DMG 5+ → "1" + "08" "56" "05" + "06" "15" = "10856050615".
import { fmtInt } from "../model.js";
import { postShortLink } from "../share.js";
import { LINES, MAX_GOALS, SUBSTATS } from "./rates.js";

const VERSION = "1";
export const CODE_PATTERN = /^1(?:[0-7][1-8]){3,6}$/;

export function encodeCovenant({ lines, goals }) {
  const pair = (x) => `${SUBSTATS.findIndex((s) => s.key === x.stat)}${x.level}`;
  return VERSION + lines.map(pair).join("") + goals.map(pair).join("");
}

// The setup in a code; null when it isn't one
export function decodeCovenant(code) {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) return null;
  const pairs = code.slice(1).match(/../g).map((p) => ({ stat: SUBSTATS[Number(p[0])].key, level: Number(p[1]) }));
  if (pairs.length < LINES || pairs.length > LINES + MAX_GOALS) return null;
  return { lines: pairs.slice(0, LINES), goals: pairs.slice(LINES) };
}

export const covenantCode = (hash) => (hash.startsWith("#c=") ? hash.slice(3) : null);

export function covenantLink(state) {
  const { origin, pathname, search } = window.location;
  return `${origin}${pathname}${search}#c=${encodeCovenant(state)}`;
}

// What a shared link says, in the same shape as the banner calculator's: the answer first, then
// what was asked (one thing per line), then the averages.
//
//   35 rerolls for a 90% chance
//   • Now: Crit. Rate Lv 8, Keyflare Regen Lv 6, Crit. Rate Lv 5
//   • Want: Crit. Rate Lv 6+, Crit. DMG Lv 6+
//   • Locking: each line as soon as it meets a goal
//   Average: 16 rerolls
//   Materials, on average: 117,291 Rose script, 47 seals, 15.6 quills
//
// way: whose numbers ("asTheyCome", the simple view's rule, or "cheapest", the full view's).
// title / detail: the preview card's (the answer; what's wanted and the average).
export function covenantShare(state, result, T, way = "asTheyCome") {
  const C = T.covenant, S = C.share;
  const L = T.numberLocale;
  // "Keyflare Regen Lv." + "Lv 6" would say Lv twice
  const name = (stat) => C.stats[stat].replace(/\s*Lv\.$/, "");
  const asked = [
    S.now(state.lines.map((l) => S.line(name(l.stat), l.level)).join(", ")),
    state.goals.length ? S.want(state.goals.map((g) => S.goal(name(g.stat), g.level)).join(", ")) : null,
    result && !result.done ? S.locking[way] : null,
  ].filter(Boolean);
  let headline = "", extra = [];
  if (result?.done) headline = C.done;
  else if (result) {
    const w = result.ways.find((x) => x.key === way);
    const avg = S.average(Math.round(w.rerolls), fmtInt(w.rerolls));
    headline = w.p90 != null ? S.forChance(w.p90, fmtInt(w.p90), "90%") : avg;
    const q = w.materials.quills.toLocaleString(L, { maximumFractionDigits: 1 });
    extra = [...(w.p90 != null ? [avg] : []), S.materials(fmtInt(w.materials.roseScript), fmtInt(w.materials.seals), q)];
  }
  const want = asked[1] ?? asked[0];
  return {
    title: headline || want,
    detail: headline ? [want, extra[0]].filter(Boolean).join(" · ") : asked[0],
    summary: [headline, ...asked.map((x) => `• ${x}`), ...extra].filter(Boolean).join("\n"),
  };
}

export const covenantShortLink = (state, parts, image) =>
  postShortLink({ calc: "covenant", code: encodeCovenant(state), title: parts.title, detail: parts.detail, image });
