// Anniversary reruns (a page for this event only): the 35 rerun days, what you hold on each of
// them, and the plan as the engine (engine.js) takes it. Each day has the character's limited
// banner and their wheel's limited banner.
import { SILVER_PER_PULL } from "../income/income.js";
import { stateIndex } from "./engine.js";

// One rerun a day from 30 Nov 2026 to 3 Jan 2027
export const FIRST_DAY = { y: 2026, m: 10, d: 30 };
export const CHARACTERS = [
  "Tulu", "Daffodil", "Sorel", "Lily", "Murphy", "Wanda", "Salvador", "“24”", "Thais", "Miryam", "Horla", "Ryker",
  "Hameln", "GHelot", "Tawil", "GDoll", "Clementine", "Corposant", "Castor", "Doresain", "Kathigu-Ra", "Pickman",
  "Pollux", "GMurphy", "Mouchette", "Xu", "Vortice", "Arachne", "Saya", "Pontos", "GLotan", "Caraboo", "GOgier",
  "Vivian", "Tulu",
];
export const DAYS = CHARACTERS.length;
export const NAMES = [...new Set(CHARACTERS)]; // each character once (Tulu has two days)
export const iconName = (name) => name.toLowerCase().replace(/[“”"]/g, "");

// Copies, as levels: None, E0 (1 copy) … E3 (4), E3+1 …, OE (8), …, AA (16). Wheels the same.
export const LEVELS = ["None", "E0", "E1", "E2", "E3", "E3+1", "E3+2", "E3+3", "OE", "E3+5", "E3+6", "E3+7", "E3+8", "E3+9", "E3+10", "E3+11", "AA"];
export const MAX_LEVEL = LEVELS.length - 1;
export const KINDS = ["char", "wheel"]; // pulled in this order each day

// One-off rewards for the event, on its first day; only Sleepless Oath is counted at first
export const ONE_OFFS = [
  { key: "oath", day: 0, pulls: 300, silver: 0, on: true },
  { key: "archives", day: 0, pulls: 300, silver: 15000, paid: true },
  { key: "pilgrimage", day: 0, pulls: 105, silver: 2260 },
];

// Days counted from the first rerun day (0 = 30 Nov), by the local calendar
const DAY_MS = 864e5;
const base = Date.UTC(FIRST_DAY.y, FIRST_DAY.m, FIRST_DAY.d);
export const dayOf = (date) => Math.round((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - base) / DAY_MS);
export const dateOf = (day) => new Date(FIRST_DAY.y, FIRST_DAY.m, FIRST_DAY.d + day);

export const defaultPlan = () => ({
  pulls: 0,
  silver: 0,
  pity: { char: { k: 0, l: 0 }, wheel: { k: 0, l: 0 } },
  oneOffs: Object.fromEntries(ONE_OFFS.map((o) => [o.key, !!o.on])),
  now: { char: Object.fromEntries(NAMES.map((n) => [n, 0])), wheel: Object.fromEntries(NAMES.map((n) => [n, 0])) },
  goals: CHARACTERS.map(() => ({ char: 0, wheel: 0 })),
});

// ── What you hold each day ──
// Income from the Pull income page: a source that comes every N days comes on the first rerun day
// and every N days before and after it (daily ones every day). Only what comes after today is
// added: what came until today is in the bank you typed. Standard pulls aren't counted.
const timesBetween = (from, to, every) => Math.max(0, Math.floor(to / every) - Math.floor(from / every));
export function bankByDay(plan, income, today) {
  const start = plan.pulls + plan.silver / SILVER_PER_PULL;
  const rows = income.rows.filter((r) => r.on && r.days >= 1);
  const gifts = ONE_OFFS.filter((o) => plan.oneOffs[o.key]);
  return CHARACTERS.map((_, day) => {
    if (day < today) return null;
    let bank = start;
    for (const r of rows) bank += timesBetween(today, day, r.days) * (r.limited + r.silver / SILVER_PER_PULL);
    for (const g of gifts) if (g.day > today && g.day <= day) bank += g.pulls + g.silver / SILVER_PER_PULL;
    return bank;
  });
}

// ── The plan ──
// Your level before a banner: what you have now, or what you plan to have from an earlier rerun
// of the same character that hasn't ended
export function levelBefore(plan, kind, day, today) {
  const name = CHARACTERS[day];
  let lv = plan.now[kind][name] ?? 0;
  for (let i = Math.max(0, today); i < day; i++) if (CHARACTERS[i] === name) lv = Math.max(lv, plan.goals[i][kind]);
  return lv;
}
export const copiesOn = (plan, kind, day, today) => (day < today ? 0 : Math.max(0, plan.goals[day][kind] - levelBefore(plan, kind, day, today)));

// The engine's question: the days still to come, their banners in order, the pity now
export function planQuery(plan, income, today) {
  const banks = bankByDay(plan, income, today);
  const first = Math.max(0, today);
  const days = [], banners = [];
  for (let day = first; day < DAYS; day++) {
    days.push({ bank: banks[day] });
    for (const kind of KINDS) banners.push({ day: day - first, type: kind, copies: copiesOn(plan, kind, day, today), at: day });
  }
  const p = plan.pity;
  return { first, days, banners, start: { char: stateIndex(p.char.k, p.char.l), wheel: stateIndex(p.wheel.k, p.wheel.l) } };
}

// ── Saved in the browser ──
export const PLAN_KEY = "reruns-v1";
const int = (v, min, max, d) => (Number.isInteger(v) && v >= min && v <= max ? v : d);
export function cleanPlan(raw) {
  const p = defaultPlan();
  if (!raw || typeof raw !== "object") return p;
  p.pulls = int(raw.pulls, 0, 1e6, 0);
  p.silver = int(raw.silver, 0, 1e8, 0);
  for (const kind of KINDS) {
    const g = kind === "char" ? 2 : 1;
    p.pity[kind] = { k: int(raw.pity?.[kind]?.k, 0, 29, 0), l: int(raw.pity?.[kind]?.l, 0, g, 0) };
    for (const n of NAMES) p.now[kind][n] = int(raw.now?.[kind]?.[n], 0, MAX_LEVEL, 0);
  }
  for (const o of ONE_OFFS) if (typeof raw.oneOffs?.[o.key] === "boolean") p.oneOffs[o.key] = raw.oneOffs[o.key];
  if (Array.isArray(raw.goals)) p.goals = p.goals.map((g, i) => ({ char: int(raw.goals[i]?.char, 0, MAX_LEVEL, 0), wheel: int(raw.goals[i]?.wheel, 0, MAX_LEVEL, 0) }));
  return p;
}
export function loadPlan(storage = globalThis.localStorage) {
  try { return cleanPlan(JSON.parse(storage?.getItem(PLAN_KEY) ?? "null")); } catch { return defaultPlan(); }
}
export function savePlan(plan, storage = globalThis.localStorage) {
  try { storage?.setItem(PLAN_KEY, JSON.stringify(plan)); } catch { /* no storage */ }
}

// ── Links: "#r=1-pulls-silver-charK-charL-wheelK-wheelL-gifts-levels" ──
// levels: each character's levels now (character, wheel), then each day's goals (character,
// wheel), one character each (0–9, a–g)
const DIGITS = "0123456789abcdefg";
export const CODE_PATTERN = new RegExp(`^1(?:-\\d{1,8}){7}-[0-9a-g]{${NAMES.length * 2 + DAYS * 2}}$`);
export function encodePlan(plan) {
  const levels = NAMES.map((n) => DIGITS[plan.now.char[n]] + DIGITS[plan.now.wheel[n]]).join("")
    + plan.goals.map((g) => DIGITS[g.char] + DIGITS[g.wheel]).join("");
  const gifts = ONE_OFFS.reduce((bits, o, i) => bits | (plan.oneOffs[o.key] ? 1 << i : 0), 0);
  const { char: c, wheel: w } = plan.pity;
  return ["1", plan.pulls, plan.silver, c.k, c.l, w.k, w.l, gifts, levels].join("-");
}
export function decodePlan(code) {
  if (typeof code !== "string" || !CODE_PATTERN.test(code)) return null;
  const [, pulls, silver, ck, cl, wk, wl, gifts, levels] = code.split("-");
  const lv = [...levels].map((ch) => DIGITS.indexOf(ch));
  const n = NAMES.length;
  const raw = {
    pulls: +pulls, silver: +silver,
    pity: { char: { k: +ck, l: +cl }, wheel: { k: +wk, l: +wl } },
    oneOffs: Object.fromEntries(ONE_OFFS.map((o, i) => [o.key, !!(+gifts & (1 << i))])),
    now: { char: Object.fromEntries(NAMES.map((name, i) => [name, lv[2 * i]])), wheel: Object.fromEntries(NAMES.map((name, i) => [name, lv[2 * i + 1]])) },
    goals: CHARACTERS.map((_, d) => ({ char: lv[2 * n + 2 * d], wheel: lv[2 * n + 2 * d + 1] })),
  };
  const p = cleanPlan(raw);
  // a code with values out of range isn't one
  return encodePlan(p) === code ? p : null;
}
export const planCode = (hash) => (hash.startsWith("#r=") ? hash.slice(3) : null);
