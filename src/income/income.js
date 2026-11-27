// Pull income: what each source gives and how often, and what that comes to per day, week and
// 28 days. Everything here is plain data and arithmetic, so other pages (pull plans) can use the
// saved income too: loadIncome() reads it, incomeTotals() works it out.

export const SILVER_PER_PULL = 200; // silver for one limited pull
export const PERIOD = 28;           // days in the "per 28 days" numbers
export const SEDIMENT_PER_PULL = 4.46366311; // sediment per pull, on average (the default)

// D-Tide: every tier of points reached gives 300 silver (each 14 days)
export const DTIDE_TIERS = [50, 100, 150, 250, 350, 375, 400, 425, 450];
export const DTIDE_SILVER = 300;
export const dTideSilver = (points) => DTIDE_SILVER * DTIDE_TIERS.filter((p) => p <= points).length;

// How many standard pulls are worth one limited pull: by what you pull for, and how limited
// ones that come off-rate are counted ("none": not factored in)
export const RATIOS = {
  characters: { none: 90 / 19, wanted: 900 / 361, unwanted: 100 / 19 },
  wheels: { none: 20 / 3, wanted: 95 / 21, unwanted: 190 / 27 },
};
export const DEFAULT_RATIO = { target: "characters", offRate: "none" };
export const ratioOf = (r) => RATIOS[r?.target]?.[r?.offRate] ?? RATIOS.characters.none;

// The sources, in groups. silver / limited / standard: what one time gives; days: how often;
// paid: bought with Silver Prime (not counted here); sub: an add-on to the row above it;
// on: counted by default; points: D-Tide's points (its silver comes from them)
export const SOURCES = [
  { key: "dailyDrills", group: 0, silver: 60, limited: 0, standard: 1, days: 1 },
  { key: "weeklyTrials", group: 0, silver: 500, limited: 0, standard: 10, days: 7 },
  { key: "assignments", group: 0, silver: 20, limited: 0, standard: 0, days: 1 },
  { key: "dailyGift", group: 0, silver: 20, limited: 0, standard: 0, days: 1 },
  { key: "sedimentShop", group: 1, silver: 0, limited: 5, standard: 5, days: 28 },
  { key: "awakenerTrials", group: 1, silver: 80, limited: 4, standard: 0, days: 28 },
  { key: "mythagGifts", group: 1, silver: 0, limited: 11, standard: 0, days: 28 },
  { key: "wheelEvent", group: 1, silver: 0, limited: 0, standard: 30, days: 28 },
  { key: "wheelEventPaid", group: 1, silver: 0, limited: 60, standard: 0, days: 28, paid: true, sub: true, on: false },
  { key: "event1", group: 1, silver: 900, limited: 6, standard: 6, days: 28 },
  { key: "event2", group: 1, silver: 900, limited: 6, standard: 6, days: 28 },
  { key: "dTide", group: 2, points: 425, limited: 0, standard: 0, days: 14 },
  { key: "arcade", group: 3, silver: 250, limited: 0, standard: 5, days: 28 },
  { key: "pDive", group: 3, silver: 250, limited: 0, standard: 5, days: 28 },
  { key: "traphaseAll", group: 3, silver: 250, limited: 0, standard: 5, days: 28 },
  { key: "traphaseDraft", group: 3, silver: 250, limited: 0, standard: 5, days: 28 },
  { key: "curriculumFree", group: 4, silver: 0, limited: 0, standard: 12, days: 28 },
  { key: "curriculumBasic", group: 4, silver: 2500, limited: 12, standard: 0, days: 28, paid: true, sub: true, on: false },
  { key: "curriculumPremium", group: 4, silver: 3360, limited: 0, standard: 56, days: 28, paid: true, sub: true, on: false },
  { key: "moonphaseVigil", group: 5, silver: 200, limited: 0, standard: 0, days: 1, paid: true, on: false },
];
export const CUSTOM_GROUP = 6;
export const MAX_CUSTOM = 20;
export const MAX_AMOUNT = 1e7;
export const MAX_DAYS = 3650;
const BUILT_IN = Object.fromEntries(SOURCES.map((s) => [s.key, s]));
const FIELDS = ["silver", "limited", "standard", "days"];

// A row as the page keeps it: { key, on, silver, limited, standard, days, points? } for a
// built-in source, { id, name, on, silver, limited, standard, days } for one you added
const defaultRow = (s) => ({ key: s.key, on: s.on !== false, silver: s.points != null ? dTideSilver(s.points) : s.silver, limited: s.limited, standard: s.standard, days: s.days, ...(s.points != null ? { points: s.points } : {}) });
export const defaultIncome = () => ({ rows: SOURCES.map(defaultRow), sediment: SEDIMENT_PER_PULL, ratio: { ...DEFAULT_RATIO } });
export const sourceOf = (row) => (row.key ? BUILT_IN[row.key] : null);
export const isDefaultRow = (row) => {
  const s = sourceOf(row);
  if (!s) return false;
  const d = defaultRow(s);
  return d.on === row.on && FIELDS.every((f) => d[f] === row[f]) && d.points === row.points;
};

// ── Checking what was saved or shared ──
const num = (v, min, max) => (typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null);
const pick = (v, d, min, max) => num(v, min, max) ?? d;
function cleanRow(raw, base) {
  const r = raw && typeof raw === "object" ? raw : {};
  const row = {
    ...base,
    on: typeof r.on === "boolean" ? r.on : base.on,
    silver: pick(r.silver, base.silver, 0, MAX_AMOUNT),
    limited: pick(r.limited, base.limited, 0, MAX_AMOUNT),
    standard: pick(r.standard, base.standard, 0, MAX_AMOUNT),
    days: pick(r.days, base.days, 1, MAX_DAYS),
  };
  if (base.points != null) {
    row.points = r.points === 0 || DTIDE_TIERS.includes(r.points) ? r.points : base.points;
    row.silver = dTideSilver(row.points);
  }
  return row;
}
let lastId = 0;
export const newRowId = () => `r${Date.now().toString(36)}${(lastId++).toString(36)}`;
export const blankCustom = (name = "") => ({ id: newRowId(), name, on: true, silver: 0, limited: 0, standard: 0, days: 28 });
export function cleanIncome(raw) {
  const fresh = defaultIncome();
  if (!raw || typeof raw !== "object") return fresh;
  const saved = Array.isArray(raw.rows) ? raw.rows : [];
  const byKey = new Map(saved.filter((r) => r && typeof r.key === "string").map((r) => [r.key, r]));
  const rows = fresh.rows.map((d) => cleanRow(byKey.get(d.key), d));
  const custom = saved.filter((r) => r && !r.key && typeof r.name === "string").slice(0, MAX_CUSTOM)
    .map((r) => ({ ...cleanRow(r, blankCustom()), id: typeof r.id === "string" ? r.id : newRowId(), name: r.name.slice(0, 60) }));
  const target = RATIOS[raw.ratio?.target] ? raw.ratio.target : DEFAULT_RATIO.target;
  const offRate = RATIOS[target][raw.ratio?.offRate] != null ? raw.ratio.offRate : DEFAULT_RATIO.offRate;
  return { rows: [...rows, ...custom], sediment: pick(raw.sediment, SEDIMENT_PER_PULL, 0, 1000), ratio: { target, offRate } };
}

// ── Saved in the browser, for this page and the pages that plan pulls with it ──
export const INCOME_KEY = "income-v1";
export function loadIncome(storage = globalThis.localStorage) {
  try { return cleanIncome(JSON.parse(storage?.getItem(INCOME_KEY) ?? "null")); } catch { return defaultIncome(); }
}
export function saveIncome(income, storage = globalThis.localStorage) {
  try { storage?.setItem(INCOME_KEY, JSON.stringify(income)); } catch { /* no storage */ }
}

// ── The numbers ──
// One row over 28 days, counted or not: its silver, limited and standard pulls, and the limited
// pulls they make (silver bought at 200 a pull; standard pulls not counted)
export function rowPer28(row) {
  const k = PERIOD / row.days;
  const silver = row.silver * k, limited = row.limited * k, standard = row.standard * k;
  return { silver, limited, standard, pulls: silver / SILVER_PER_PULL + limited };
}
// Every counted row together. perDay: the rates (pulls: limited pulls with silver bought;
// withStandard: plus the standard pulls at the chosen ratio; sediment: from those pulls, without
// and with the standard ones). over(days): the same for any number of days.
export function incomeTotals(income) {
  const t = { silver: 0, limited: 0, standard: 0 };
  for (const r of income.rows) {
    if (!r.on) continue;
    const x = rowPer28(r);
    t.silver += x.silver; t.limited += x.limited; t.standard += x.standard;
  }
  const ratio = ratioOf(income.ratio);
  const pulls = t.silver / SILVER_PER_PULL + t.limited;
  const per28 = {
    ...t,
    pulls,
    withStandard: pulls + t.standard / ratio,
    sediment: pulls * income.sediment,
    sedimentWithStandard: (pulls + t.standard) * income.sediment,
  };
  const over = (days) => Object.fromEntries(Object.entries(per28).map(([k, v]) => [k, (v * days) / PERIOD]));
  return { ratio, per28, perDay: over(1), perWeek: over(7), over };
}

// ── Links ("#i=…"): "1" (the format) and the changes from the defaults as base64url JSON ──
const VERSION = "1";
export const CODE_PATTERN = /^1[A-Za-z0-9_-]{2,6000}$/;
const SHORT = { on: "o", silver: "s", limited: "l", standard: "t", days: "d", points: "p" };
const LONG = Object.fromEntries(Object.entries(SHORT).map(([k, v]) => [v, k]));
const toB64 = (text) => {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64 = (code) => {
  const bin = atob(code.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};
export function encodeIncome(income) {
  const out = {};
  const fresh = defaultIncome();
  const changed = {};
  for (const r of income.rows.filter((x) => x.key)) {
    const d = fresh.rows.find((x) => x.key === r.key);
    const diff = {};
    for (const f of ["on", ...FIELDS, "points"]) {
      if (f === "silver" && r.points != null) continue; // from the points
      if (r[f] !== undefined && r[f] !== d[f]) diff[SHORT[f]] = f === "on" ? (r.on ? 1 : 0) : r[f];
    }
    if (Object.keys(diff).length) changed[r.key] = diff;
  }
  if (Object.keys(changed).length) out.b = changed;
  const custom = income.rows.filter((x) => !x.key).map((r) => [r.name, r.on ? 1 : 0, r.silver, r.limited, r.standard, r.days]);
  if (custom.length) out.c = custom;
  if (income.sediment !== SEDIMENT_PER_PULL) out.m = income.sediment;
  if (income.ratio.target !== DEFAULT_RATIO.target || income.ratio.offRate !== DEFAULT_RATIO.offRate) out.r = [income.ratio.target, income.ratio.offRate];
  return VERSION + toB64(JSON.stringify(out));
}
// The income in a code; null when it isn't one
export function decodeIncome(code) {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) return null;
  let raw;
  try { raw = JSON.parse(fromB64(code.slice(1))); } catch { return null; }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const fresh = defaultIncome();
  const rows = fresh.rows.map((d) => {
    const diff = raw.b?.[d.key];
    if (!diff || typeof diff !== "object") return d;
    const r = { ...d };
    for (const [s, v] of Object.entries(diff)) if (LONG[s]) r[LONG[s]] = LONG[s] === "on" ? v === 1 : v;
    return r;
  });
  const custom = Array.isArray(raw.c) ? raw.c.filter(Array.isArray).map(([name, on, silver, limited, standard, days]) => ({ name: String(name ?? ""), on: on === 1, silver, limited, standard, days })) : [];
  return cleanIncome({ rows: [...rows, ...custom], sediment: raw.m ?? SEDIMENT_PER_PULL, ratio: Array.isArray(raw.r) ? { target: raw.r[0], offRate: raw.r[1] } : DEFAULT_RATIO });
}
export const incomeCode = (hash) => (hash.startsWith("#i=") ? hash.slice(3) : null);
