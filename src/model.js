// Editor model ↔ engine format, presets, and building the engine query.
//
// Editor tree:  node = { streak, alts: [alt] }
//               alt  = { name, p, pity, pityYields, softStart, softStep, count, children: node | null }
// Paths are index strings: "" = the root node, "1,1,0" = third level.

import { getStrings } from "./i18n/index.js";

let uid = 0;
export const newId = () => `r${Date.now().toString(36)}${(uid++).toString(36)}`;

export const leaf = (name, p, extra = {}) => ({
  name, p, pity: "", pityYields: false, softStart: "", softStep: "", count: 1, items: "", children: null, ...extra,
});
export const node = (alts, streak = 0) => ({ streak, alts });

// Built-in banners. Titles, hints, outcome and item names come from the language file.
const row = (path, type, copies, extra = {}) => ({ path, type, item: 0, k: 1, copies, from: "", ...extra });

export function presets() {
  const P = getStrings().presets;
  const lc = P.limitedChar.names, lw = P.limitedWheel.names, an = P.anniversary.names, kn = P.kaleidoNames;
  const kaleido = (key) => {
    const chars = P[key].characters;
    return {
      ...P[key],
      banner: node([
        leaf(kn.ssr, "1/33", { pity: 30, children: node([
          leaf(kn.character, "1/3", { count: chars.length, items: chars.join(", ") }),
          leaf(kn.wheel, "2/3", { count: chars.length, items: chars.map(P.wheelOf).join(", ") }),
        ], 2) }),
        leaf(kn.rest, "rest"),
      ]),
      // the first character and that character's own wheel
      goal: [row("0,0", "specific", 1), row("0,1", "specific", 1)],
      budget: 600,
    };
  };
  return {
    limitedChar: {
      ...P.limitedChar,
      banner: node([
        leaf(lc.ssr, "1/33", { pity: 30, children: node([
          leaf(lc.limited, "1/3", { pity: 3 }),
          leaf(lc.standard, "2/3", { count: 5 }),
        ]) }),
        leaf(lc.rest, "rest"),
      ]),
      goal: [row("0,0", "total", 1)],
      budget: 60,
    },
    limitedWheel: {
      ...P.limitedWheel,
      banner: node([
        leaf(lw.ssr, "1/33", { pity: 30, children: node([
          leaf(lw.limited, "1/2", { pity: 2 }),
          leaf(lw.standard, "1/2", { count: 5 }),
        ]) }),
        leaf(lw.rest, "rest"),
      ]),
      goal: [row("0,0", "total", 1)],
      budget: 40,
    },
    anniversary: {
      ...P.anniversary,
      banner: node([
        leaf(an.ssr, "1/33", { pity: 30, children: node([
          leaf(an.limited, "1/2", { pity: 2, children: node([
            leaf(an.character, "1/2"),
            leaf(an.wheel, "1/2"),
          ], 2) }),
          leaf(an.standard, "1/2", { count: 10 }),
        ]) }),
        leaf(an.rest, "rest"),
      ]),
      goal: [row("0,0,0", "total", 1), row("0,0,1", "total", 1)],
      budget: 150,
    },
    kaleido1: kaleido("kaleido1"),
    kaleido2: kaleido("kaleido2"),
  };
}

// Unedited presets take their outcome and item names from the current language, so
// switching language never leaves a banner half in another language. Your plan, pity and
// budget are kept. If the preset's structure changed (a newer version of the site), the
// preset is loaded fresh instead. Custom banners are your own and are never touched.
const sameShape = (a, b) => a.alts.length === b.alts.length && a.alts.every((x, i) => {
  const y = b.alts[i];
  if (!!x.children !== !!y.children) return false;
  return x.children ? sameShape(x.children, y.children) : num(x.count, 1) === num(y.count, 1);
});
export function withPresetNames(state) {
  const p = presets()[state.preset];
  if (!p) return state;
  if (!sameShape(state.banner, p.banner)) return { ...freshState(state.preset), mode: state.mode, desired: state.desired, chartLines: state.chartLines };
  return { ...state, banner: structuredClone(p.banner) };
}

// What "Custom banner" starts from the first time
export function customTemplate() {
  const C = getStrings().presets.custom;
  const n = C.names;
  return {
    banner: node([
      leaf(n.ssr, "1/60", { pity: 90, children: node([
        leaf(n.featured, "1/2", { pity: 2 }),
        leaf(n.standard, "1/2", { count: 5 }),
      ]) }),
      leaf(n.rest, "rest"),
    ]),
    goal: [row("0,0", "total", 1)],
    budget: 200,
  };
}

// Which reference lines the chart draws (the "Lines" menu)
export const DEFAULT_LINES = { target: true, mean: true, pcts: [50, 90], worst: true, custom: [] };

export const DEFAULT_SETTINGS = { pct: "10, 25, 50, 75, 90, 95, 99", eps: "1e-13", maxPulls: 1000000, maxStates: 1000000, method: "auto", decimals: 2, noLimits: false };

export function freshState(key) {
  const p = key === "custom" ? customTemplate() : presets()[key];
  return {
    preset: key,
    banner: structuredClone(p.banner),
    goal: p.goal.map((g) => ({ ...g, id: newId() })),
    goalMode: "all",
    start: { pity: {}, streak: {} },
    mode: "budget",
    budget: p.budget,
    desired: 90,
    settings: { ...DEFAULT_SETTINGS },
    chartLines: { ...DEFAULT_LINES },
  };
}

// ── Tree helpers ──
export const keyOf = (path) => path.join(",");
export const pathOf = (key) => (key === "" ? [] : key.split(",").map(Number));
export function nodeAt(tree, key) {
  let n = tree;
  for (const i of pathOf(key)) n = n.alts[i].children;
  return n;
}
export function altAt(tree, key) {
  const p = pathOf(key);
  return nodeAt(tree, keyOf(p.slice(0, -1))).alts[p[p.length - 1]];
}
export function allAlts(tree) {
  const out = [];
  (function walk(n, path, names) {
    n.alts.forEach((a, i) => {
      const p = [...path, i];
      const nm = [...names, a.name || `#${i + 1}`];
      out.push({
        key: keyOf(p), alt: a, label: nm.join(" › "), name: nm[nm.length - 1],
        parentName: names[names.length - 1] ?? null, isLeaf: !a.children, depth: p.length - 1,
        isPool: !a.children && num(a.count, 1) > 1,
      });
      if (a.children) walk(a.children, p, nm);
    });
  })(tree, [], []);
  return out;
}
export function allNodes(tree) {
  const out = [{ key: "", node: tree, name: "each pull" }];
  for (const a of allAlts(tree)) if (a.alt.children) out.push({ key: a.key, node: a.alt.children, name: a.name });
  return out;
}

// Names of a pool's items: given names first, then "item N"
export function itemNames(alt) {
  const given = String(alt.items ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const n = Math.max(1, Math.floor(num(alt.count, 1)));
  return Array.from({ length: n }, (_, i) => given[i] || getStrings().banner.itemN(i + 1));
}

export const num = (x, d = 0) => { const v = Number(x); return Number.isFinite(v) ? v : d; };

// "1/33", "0.6%", "0.5", "rest" → engine value
export function parseChance(str) {
  const s = String(str ?? "").trim();
  if (s === "") return NaN;
  if (s.toLowerCase() === "rest") return "rest";
  if (s.endsWith("%")) return Number(s.slice(0, -1)) / 100;
  if (s.includes("/")) { const [a, b] = s.split("/").map(Number); return a / b; }
  return Number(s);
}

export function chanceSum(n) {
  const B = getStrings().banner;
  let sum = 0, rest = false, bad = false;
  for (const a of n.alts) {
    const v = parseChance(a.p);
    if (v === "rest") { rest = true; continue; }
    if (!Number.isFinite(v)) { bad = true; continue; }
    sum += v;
  }
  if (bad) return { ok: false, text: B.sumNaN };
  if (rest) return sum <= 1 + 1e-9 ? { ok: true, text: B.sumRest(fmtPct(1 - sum)) } : { ok: false, text: B.sumOver };
  return Math.abs(sum - 1) < 1e-9 ? { ok: true, text: B.sumOk } : { ok: false, text: B.sumWrong(fmtPct(sum)) };
}

export function toEngineTree(n) {
  const alts = n.alts.map((a) => {
    const o = { name: a.name || undefined, p: parseChance(a.p) };
    if (typeof o.p === "number" && !Number.isFinite(o.p)) throw new Error(getStrings().errors.badChance(a.name, a.p));
    if (num(a.pity) > 0) o.pity = Math.floor(num(a.pity));
    if (a.pityYields) o.pityYields = true;
    const step = parseChance(a.softStep);
    if (num(a.softStart) > 0 && typeof step === "number" && step > 0) o.soft = { start: Math.floor(num(a.softStart)), step };
    if (a.children) o.children = toEngineTree(a.children);
    else if (num(a.count, 1) > 1) { o.count = Math.floor(num(a.count, 1)); o.items = itemNames(a); }
    return o;
  });
  return n.streak > 0 ? { streak: Math.floor(num(n.streak)), alts } : alts;
}

export function fromEngineTree(raw) {
  const isObj = raw && !Array.isArray(raw);
  const altsRaw = isObj ? raw.alts : raw;
  if (!Array.isArray(altsRaw) || !altsRaw.length) throw new Error(getStrings().errors.engine.noOutcomes({ where: "" }));
  return node(altsRaw.map((a, i) => {
    const o = Array.isArray(a) ? { p: a[0], pity: a[1], children: a[2] } : a;
    let count = o.count ?? 1, ch = o.children ?? null;
    if (typeof ch === "number") { count = ch; ch = null; }
    return leaf(o.name ?? `#${i + 1}`, String(o.p), {
      pity: o.pity || "", pityYields: !!o.pityYields,
      softStart: o.soft ? o.soft.start : "", softStep: o.soft ? String(o.soft.step) : "",
      count, items: Array.isArray(o.items) ? o.items.join(", ") : "", children: ch ? fromEngineTree(ch) : null,
    });
  }), isObj ? raw.streak || 0 : 0);
}

// Keep goal rows and start-state keys valid after the tree changes
export function remapKeys(state, fn) {
  const goal = state.goal.map((r) => { const k = fn(r.path); return k === null ? null : { ...r, path: k }; }).filter(Boolean);
  const start = {};
  for (const part of ["pity", "streak"]) {
    start[part] = {};
    for (const [k, v] of Object.entries(state.start[part] ?? {})) { const nk = fn(k); if (nk !== null) start[part][nk] = v; }
  }
  return { ...state, goal, start };
}

export const listOfInts = (s) => String(s ?? "").split(/[\s,;]+/).filter((x) => x !== "").map(Number).filter((x) => Number.isFinite(x) && x >= 0).map(Math.floor);

// The chosen items of a row (indices), or null when the whole pool counts
export function rowSubset(tree, r) {
  if (!Array.isArray(r.items) || r.type === "specific") return null;
  const t = allAlts(tree).find((a) => a.key === r.path);
  if (!t?.isPool) return null;
  const n = Math.floor(num(t.alt.count, 1));
  const items = r.items.filter((i) => i < n);
  return items.length === n ? null : items;
}

export function reqLabel(tree, r) {
  const L = getStrings().goalLabel;
  const t = allAlts(tree).find((a) => a.key === r.path);
  const sub = rowSubset(tree, r);
  const n = !t ? r.path : sub?.length ? L.subset(sub.map((i) => itemNames(t.alt)[i]), t.name) : t.name;
  if (sub?.length && r.type === "distinct") return L.distinctFrom(r.k, n, r.copies);
  if (r.type === "total") return L.total(n, r.copies);
  if (r.type === "specific") return L.specific(t ? itemNames(t.alt)[r.item ?? 0] ?? n : n, r.copies);
  return L.distinct(r.k, n, r.copies);
}

// Everything the worker needs
export function buildQuery(state) {
  const { banner, goal, goalMode, start, settings } = state;
  const E = getStrings().errors;
  if (!goal.length) throw new Error(E.emptyPlan);
  const tree = toEngineTree(banner);
  const alts = allAlts(banner);
  const keys = new Set(alts.map((a) => a.key));
  for (const r of goal) {
    if (!keys.has(r.path)) throw new Error(E.goneOutcome);
    const a = altAt(banner, r.path);
    if (r.type === "specific" && (r.item ?? 0) >= num(a.count, 1)) throw new Error(E.fewerItems(a.name));
    if (r.type === "specific" && a.children) throw new Error(E.hasChildren(a.name));
  }
  const q = {
    tree,
    goal: goal.map((r) => {
      const sub = rowSubset(banner, r);
      const g = { path: r.path, type: r.type, item: r.item ?? 0, k: r.k, copies: r.copies, label: reqLabel(banner, r) };
      if (sub) {
        if (!sub.length) throw new Error(E.noItems(g.label));
        if (r.type === "distinct" && r.k > sub.length) throw new Error(E.tooFewItems(sub.length, r.k));
        g.items = sub;
        if (r.type === "total") g.have = Math.max(0, Math.floor(num(r.from))); // copies already owned among the chosen items
      }
      return g;
    }),
    goalMode,
    start: { pity: {}, streak: {}, owned: {} },
  };
  for (const [k, v] of Object.entries(start.pity)) if (keys.has(k) && v > 0) q.start.pity[k] = v;
  const streakKeys = new Set(allNodes(banner).filter((n) => n.node.streak > 0).map((n) => n.key));
  for (const [k, v] of Object.entries(start.streak)) if (streakKeys.has(k) && v[1] > 0) q.start.streak[k] = v;

  // What you already own: one value per target, merged per outcome
  const byPath = {};
  // ("total" rows over chosen items carry their own "have", so they're left out here)
  for (const r of goal) if (!(r.type === "total" && rowSubset(banner, r))) (byPath[r.path] ??= []).push(r);
  for (const [path, rows] of Object.entries(byPath)) {
    const a = alts.find((x) => x.key === path);
    const perItem = a.isPool && rows.some((r) => r.type !== "total");
    if (perItem) {
      // Per item: a "different items" row gives a list; "specific" rows set their own item
      const n = Math.floor(num(a.alt.count, 1));
      const d = rows.find((r) => r.type === "distinct" && String(r.from).trim() !== "");
      const items = Array.from({ length: n }, (_, i) => (d ? listOfInts(d.from)[i] ?? 0 : 0));
      for (const r of rows) if (r.type === "specific" && String(r.from).trim() !== "") items[r.item ?? 0] = Math.max(0, Math.floor(num(r.from)));
      if (items.some((x) => x > 0)) q.start.owned[path] = items;
    } else {
      const t = rows.find((r) => String(r.from).trim() !== "");
      if (t && num(t.from) > 0) q.start.owned[path] = Math.floor(num(t.from));
    }
  }
  const pct = listOfInts(settings.pct).filter((x) => x > 0 && x < 100);
  return {
    ...q,
    percentiles: pct.length ? pct : [50, 90],
    eps: Math.max(0, num(settings.eps, 1e-13)),
    // "No limits" lifts both safety limits; the calculation can then run as long as it needs
    maxPulls: settings.noLimits ? Infinity : Math.max(1, num(settings.maxPulls, 1e6)),
    maxStates: settings.noLimits ? Infinity : Math.max(1000, num(settings.maxStates, 1e6)),
    method: settings.method,
  };
}

// ── Formatting ──
const loc = () => getStrings().numberLocale;

// Decimal places for chances and averages (the "Decimal places" setting). Pull counts are whole.
let precision = 2;
export const setPrecision = (d) => { precision = Math.min(6, Math.max(0, Math.floor(num(d, 2)))); };
export const getPrecision = () => precision;
const fixed = (x, d) => x.toLocaleString(loc(), { minimumFractionDigits: d, maximumFractionDigits: d });

// 0.7660 → "76.60%". A chance that would round to 0 or 100 but isn't exactly that shows as
// "<0.01%" / ">99.99%", so a near-certainty is never presented as a certainty.
export function fmtPct(p, d = precision) {
  if (!Number.isFinite(p)) return "–";
  if (p >= 1) return "100%";
  if (p <= 0) return "0%";
  const v = p * 100, step = 10 ** -d;
  const rounded = Math.round(v / step) * step;
  if (rounded <= 0) return `<${fixed(step, d)}%`;
  if (rounded >= 100) return `>${fixed(100 - step, d)}%`;
  return `${fixed(rounded, d)}%`;
}
export const fmtInt = (x) => (x == null ? "–" : Math.round(x).toLocaleString(loc()));
export const fmtNum = (x, d = precision) => (x == null ? "–" : fixed(x, d));
