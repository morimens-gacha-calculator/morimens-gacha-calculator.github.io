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

// What a shared link says:
//   16 rerolls on average, the cheapest way
//   Now: Crit. Rate Lv 8 · Keyflare Regen Lv. Lv 6 · Crit. Rate Lv 5
//   Want: Crit. Rate Lv 6+ · Crit. DMG Lv 5+
//   On average: 117,291 Rose script, 47 seals, 15.6 quills
// title / detail: the preview card's (the answer; what's wanted)
export function covenantShare(state, result, T) {
  const C = T.covenant;
  const L = T.numberLocale;
  const name = (x) => C.shareStat(C.stats[x.stat], x.level);
  const now = C.shareNow(state.lines.map(name).join(" · "));
  const want = state.goals.length ? C.shareWant(state.goals.map((g) => C.shareGoal(C.stats[g.stat], g.level)).join(" · ")) : C.noGoals;
  let headline = "", extra = "";
  if (result?.done) headline = C.done;
  else if (result) {
    const best = result.ways.find((w) => w.key === "cheapest");
    headline = C.shareHeadline(fmtInt(best.rerolls));
    const q = best.materials.quills.toLocaleString(L, { maximumFractionDigits: 1 });
    extra = C.shareMaterials(fmtInt(best.materials.roseScript), fmtInt(best.materials.seals), q);
  }
  return {
    title: headline || want,
    detail: headline ? want : now,
    summary: [headline, now, want, extra].filter(Boolean).join("\n"),
  };
}

export const covenantShortLink = (state, parts, image) =>
  postShortLink({ calc: "covenant", code: encodeCovenant(state), title: parts.title, detail: parts.detail, image });
