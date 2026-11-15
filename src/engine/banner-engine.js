// banner-engine.js — exact pull statistics for gacha banners.
// No dependencies; works in the browser (incl. Web Workers) and in Node.
//
// ── Tree ──────────────────────────────────────────────────────────────────────
// A node is a list of alternatives, or { streak, alts } to add a memory rule.
// An alternative is your Python tuple  [p, pity, children]  or an object
//   { name, p, pity, pityYields, soft, count, children }.
//
//   p           number, "1/33", or "rest" (= 1 − the other alternatives). With count,
//               p is the chance of the whole pool, split evenly between its items.
//   pity        hard pity n: forced on the n-th visit to its node since it last came up
//   pityYields  true: when this pity triggers, alternatives listed *before* it still
//               roll at their normal rates and this one takes the rest (e.g. a 4★ pity
//               pull can still become a 5★). Default false = forced outright.
//   soft        { start, step }: from the start-th visit on, rate = p + step·(visit − start + 1)
//               ("rest" shrinks to make room; without it, the other plain alternatives do)
//   count       n items at equal odds (a pool), e.g. 4 characters. Tuple form: put the
//               number in the children slot: ["1/2", 3, 4].
//   items       optional names for a pool's items: ["Alice", "Bob", "Cleo", "Dan"]
//   streak      on a node: if the last n outcomes here were the same alternative,
//               that alternative can't come next. Hard pity beats the streak rule.
//
// ── Goal ──────────────────────────────────────────────────────────────────────
// Shorthand  { "1,1,0": 16 }  = 16 copies of anything under that path.
// Full form, a list of requirements:
//   { path, copies }                          total copies of anything under path
//   { path, type: "specific", item, copies }  one particular item of a pool (count); item =
//                                             its index (0-based) or its name from "items"
//   { path, type: "distinct", k, copies }     k different items under path, each with
//                                             ≥ copies (k = 1: whichever item gets there first)
// Optional "label" on each. goalMode "all" (default) or "any" combines them.
// Paths: indices "1,1,0" / [1,1,0], or names "5star/featured/char". "" = everything.
//
// ── Outputs (solve) ───────────────────────────────────────────────────────────
// mean, sd, median, mode, percentiles, chanceAt, max, tail, pmf[t], cdf[t]  — pulls to goal
// budget (when budget: B is given): chanceGoal, goalByPull[t], and per requirement
//   dist[v] (P(progress = v) after B pulls; top value = "that many or more"),
//   mean, chanceMet, expectedByPull[t]
// method ("joint" or "split"), states, ms — diagnostics
//
// ── Start state (all optional) ───────────────────────────────────────────────
// { pity:   { "1": 12 },            visits since that alternative last came up
//   streak: { "1,1": [0, 2] },      node path → [last alternative index, run length]
//   owned:  { "1,1,0": [2, 0, 1],   per-item copies of a pool, in item order
//             "1,0": 3 } }          or a total; paths must not be nested in each other

const DEFAULT_PERCENTILES = [10, 25, 50, 75, 90, 95, 99];

function parseProb(x, where) {
  if (x === "rest") return "rest";
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const m = x.trim().match(/^([\d.eE+-]+)\s*\/\s*([\d.eE+-]+)$/);
    const v = m ? Number(m[1]) / Number(m[2]) : Number(x);
    if (Number.isFinite(v)) return v;
  }
  throw new Error(`Bad probability ${JSON.stringify(x)} at ${where}`);
}

import { poolPlan, poolNotMet, poolBudget, chainSizeEstimate } from "./pool-formulas.js";
import { makeStepper } from "./chain-step.js";

// Pieces that don't change between runs (item formulas, event and timing chains, …) are kept,
// so editing one row, the budget, or switching to "pulls" mode reuses the rest.
const CACHE = new Map();
const CACHE_MAX = 48;
function cached(kind, keyParts, make) {
  const key = kind + "|" + JSON.stringify(keyParts);
  if (CACHE.has(key)) {
    const v = CACHE.get(key);
    CACHE.delete(key); CACHE.set(key, v); // most recently used last
    return v;
  }
  const v = make();
  CACHE.set(key, v);
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return v;
}
export function clearCache() { CACHE.clear(); }

const pathKey = (path) => path.join(",");
const isPrefix = (pre, path) => pre.length <= path.length && pre.every((v, i) => v === path[i]);
const isPosInt = (x) => Number.isInteger(x) && x >= 1;

// ── Tree normalisation ───────────────────────────────────────────────────────
function normaliseNode(raw, path) {
  const isObj = raw && !Array.isArray(raw);
  const altsRaw = isObj ? raw.alts : raw;
  if (!Array.isArray(altsRaw) || altsRaw.length === 0)
    throw new Error(`Node at [${pathKey(path)}] has no alternatives`);
  const node = { path, streak: isObj && raw.streak ? raw.streak : 0, alts: [] };
  altsRaw.forEach((a, i) => {
    const ap = [...path, i];
    const where = `[${pathKey(ap)}]`;
    const o = Array.isArray(a) ? { p: a[0], pity: a[1], children: a[2] } : a;
    let count = o.count ?? 1, children = o.children ?? null;
    if (typeof children === "number") { count = children; children = null; }
    if (!isPosInt(count)) throw new Error(`count at ${where} must be a positive integer`);
    if (count > 1 && children) throw new Error(`A pool (count > 1) can't have children, at ${where}`);
    const p = parseProb(o.p, where);
    const alt = {
      name: o.name ?? null,
      p: p === "rest" ? 0 : p,
      rest: p === "rest",
      pity: o.pity || 0,
      pityYields: !!o.pityYields,
      soft: o.soft && o.soft.step > 0 ? o.soft : null,
      count,
      itemNames: Array.isArray(o.items) ? o.items.map(String) : null,
      path: ap,
      child: children ? normaliseNode(children, ap) : null,
      cv: -1, icap: 0, spec: false, sumReqs: [],
    };
    if (alt.p < 0 || alt.p > 1) throw new Error(`Probability out of range at ${where}`);
    node.alts.push(alt);
  });
  const rests = node.alts.filter((a) => a.rest).length;
  const sum = node.alts.reduce((s, a) => s + a.p, 0);
  if (rests > 1) throw new Error(`More than one "rest" at [${pathKey(path)}]`);
  if (rests === 0 && Math.abs(sum - 1) > 1e-9)
    throw new Error(`Probabilities at [${pathKey(path)}] sum to ${sum}, not 1`);
  if (rests === 1 && sum > 1 + 1e-9)
    throw new Error(`Probabilities at [${pathKey(path)}] exceed 1 before "rest"`);
  return node;
}

function resolvePath(root, spec) {
  if (Array.isArray(spec)) return spec;
  const s = String(spec ?? "").trim();
  if (s === "") return [];
  if (/^\d+(\s*,\s*\d+)*$/.test(s)) return s.split(",").map(Number);
  const path = [];
  let node = root;
  for (const name of s.split("/")) {
    if (!node) throw new Error(`Path "${s}" goes below a leaf`);
    const i = node.alts.findIndex((a) => a.name === name);
    if (i < 0) throw new Error(`No alternative named "${name}" in path "${s}"`);
    path.push(i);
    node = node.alts[i].child;
  }
  return path;
}

function findNode(root, path) {
  let node = root;
  for (const i of path) {
    const a = node?.alts[i];
    if (!a) return null;
    node = a.child;
  }
  return node;
}

function findAlt(root, path) {
  if (path.length === 0) return null;
  return findNode(root, path.slice(0, -1))?.alts[path[path.length - 1]] ?? null;
}

function leavesUnder(root, path) {
  const out = [];
  (function walk(node) {
    for (const a of node.alts) {
      if (a.child) walk(a.child);
      else if (isPrefix(path, a.path)) out.push(a);
    }
  })(root);
  return out;
}

// ── Goal parsing ─────────────────────────────────────────────────────────────
function parseGoal(root, goalRaw) {
  const list = Array.isArray(goalRaw)
    ? goalRaw
    : Object.entries(goalRaw ?? {}).map(([path, copies]) => ({ path, copies }));
  if (list.length === 0) throw new Error("Goal is empty");
  return list.map((g) => {
    // `paths` (several outcomes counted together) comes from expandSubsets; `path` is one outcome
    const paths = Array.isArray(g.paths) ? g.paths.map((x) => resolvePath(root, x)) : [resolvePath(root, g.path)];
    const path = paths[0];
    const shown = g.label ?? (g.path === undefined || g.path === "" ? "everything" : String(g.path ?? g.paths));
    for (const p of paths) if (p.length && !findAlt(root, p)) throw new Error(`Goal path "${shown}" not in tree`);
    const have = Math.max(0, Math.floor(Number(g.have) || 0));
    const copies = g.copies ?? 1;
    if (!isPosInt(copies)) throw new Error(`copies for "${shown}" must be a positive integer`);
    let type = g.type ?? "total";
    if (type === "specific") {
      const alt = findAlt(root, path);
      if (!alt || alt.child)
        throw new Error(`"specific" needs a single item or a pool (count), not "${shown}"`);
      if (alt.count === 1) return { type: "total", path, paths: [path], copies, have, label: g.label ?? `${shown} ×${copies}` };
      let item = g.item ?? 0;
      if (typeof item === "string" && !/^\d+$/.test(item)) {
        const j = (alt.itemNames ?? []).indexOf(item);
        if (j < 0) throw new Error(`Pool "${shown}" has no item named "${item}"`);
        item = j;
      }
      item = Number(item);
      if (!Number.isInteger(item) || item < 0 || item >= alt.count)
        throw new Error(`Pool "${shown}" has items 0–${alt.count - 1}, not ${g.item}`);
      const nm = alt.itemNames?.[item] ?? `item ${item + 1}`;
      return { type, path, copies, group: alt, item, label: g.label ?? `${nm} ×${copies}` };
    }
    if (type === "distinct") {
      const k = g.k;
      if (!isPosInt(k)) throw new Error(`k for "${shown}" must be a positive integer`);
      const groups = [...new Set(paths.flatMap((p) => leavesUnder(root, p)))];
      const items = groups.reduce((s, a) => s + a.count, 0);
      if (k > items) throw new Error(`"${shown}" has only ${items} items, can't get ${k} different`);
      return { type, path, paths, copies, k, groups, items,
               label: g.label ?? `${k} different of ${shown}, ×${copies} each` };
    }
    if (type !== "total") throw new Error(`Unknown goal type "${type}"`);
    return { type, path, paths, copies, have, label: g.label ?? `${shown} ×${copies}` };
  });
}

// ── Build the finite Markov chain ────────────────────────────────────────────
// State = small ints: pity counters, streak memories, goal totals, and for pools
// that need per-item tracking a histogram "how many items have 0,1,2,… copies"
// (identical items are interchangeable, so only the histogram matters).
// trackHits: list of paths. Instead of a goal, every transition is labelled with which of
// these outcomes (1, 2, …) the pull reached, or 0 for none. Used by the layered method.
export function compile(treeRaw, goalRaw, { start: startRaw = {}, goalMode = "all", absorb = true, maxStates = 1e6, onProgress = null, trackHits = null } = {}) {
  const root = normaliseNode(treeRaw, []);
  let nVars = 0;
  const newVar = () => nVars++;

  (function assign(node) {
    if (node.streak > 0) node.sv = newVar(); // value = (last+1)*(streak+1) + run
    for (const a of node.alts) {
      if (a.pity || a.soft) {
        a.cv = newVar();
        let cap = a.pity || Infinity;
        if (a.soft) cap = Math.min(cap, a.soft.start - 1 + Math.ceil((1 - a.p) / a.soft.step));
        a.cap = Math.max(1, cap);
      }
      if (a.child) assign(a.child);
    }
  })(root);

  const reqs = trackHits ? [] : parseGoal(root, goalRaw);
  if (trackHits) {
    absorb = false;
    trackHits.forEach((spec, g) => {
      const a = findAlt(root, resolvePath(root, spec));
      if (!a) throw new Error(`trackHits: no alternative "${spec}"`);
      a.hitLabel = g + 1;
    });
  }
  if (goalMode !== "all" && goalMode !== "any") throw new Error(`goalMode must be "all" or "any"`);

  // Per-item tracking for pools used by "specific" / "distinct" requirements.
  // Every item a "specific" requirement names gets its own counter; the other items
  // of the pool only need a copy histogram when a "distinct" requirement looks at them.
  for (const r of reqs) {
    if (r.type === "specific") {
      const g = r.group;
      g.specCaps ??= new Map();
      g.specCaps.set(r.item, Math.max(g.specCaps.get(r.item) ?? 0, r.copies));
    }
    if (r.type === "distinct") for (const g of r.groups) g.dcap = Math.max(g.dcap ?? 0, r.copies);
  }
  const tracked = [];
  (function alloc(node) {
    for (const a of node.alts) {
      if (a.child) { alloc(a.child); continue; }
      a.dcap = a.dcap ?? 0;
      const items = a.specCaps ? [...a.specCaps.keys()].sort((x, y) => x - y) : [];
      if (!items.length && !a.dcap) continue;
      a.icap = 1;
      a.specs = items.map((j) => ({ item: j, cap: Math.max(a.specCaps.get(j), a.dcap), v: newVar() }));
      a.specByItem = new Map(a.specs.map((x) => [x.item, x]));
      a.m = a.count - items.length;
      a.hcap = a.dcap;
      a.h = a.m > 0 && a.dcap ? Array.from({ length: a.hcap + 1 }, newVar) : [];
      tracked.push(a);
    }
  })(root);
  for (const r of reqs) {
    if (r.type !== "total") continue;
    r.v = newVar();
    for (const a of new Set(r.paths.flatMap((p) => leavesUnder(root, p)))) a.sumReqs.push(r);
  }

  const atLeast = (g, c, s) => {
    let n = 0;
    for (const x of g.specs) if (s[x.v] >= c) n++;
    for (let j = c; j < g.h.length; j++) n += s[g.h[j]];
    return n;
  };
  const progress = (r, s) =>
    r.type === "total" ? s[r.v]
    : r.type === "specific" ? s[r.group.specByItem.get(r.item).v]
    : r.groups.reduce((n, g) => n + atLeast(g, r.copies, s), 0);
  const met = (r, s) => progress(r, s) >= (r.type === "distinct" ? r.k : r.copies);
  const isDone = goalMode === "all" ? (s) => reqs.every((r) => met(r, s)) : (s) => reqs.some((r) => met(r, s));
  for (const r of reqs) r.max = r.type === "distinct" ? r.items : r.copies;

  // Start state
  const start = new Array(nVars).fill(0);
  for (const g of tracked) if (g.h.length) start[g.h[0]] = g.m;
  for (const [spec, val] of Object.entries(startRaw.pity ?? {})) {
    const a = findAlt(root, resolvePath(root, spec));
    if (!a) throw new Error(`start.pity: no alternative "${spec}"`);
    if (a.cv >= 0) start[a.cv] = Math.min(Math.max(0, val | 0), a.cap);
  }
  for (const [spec, [last, run]] of Object.entries(startRaw.streak ?? {})) {
    const node = findNode(root, resolvePath(root, spec));
    if (!node || !node.streak) throw new Error(`start.streak: no streak node "${spec}"`);
    const r = Math.min(Math.max(0, run | 0), node.streak);
    start[node.sv] = r === 0 ? 0 : (last + 1) * (node.streak + 1) + r;
  }
  const ownedPaths = Object.keys(startRaw.owned ?? {}).map((k) => [k, resolvePath(root, k)]);
  for (const [k1, p1] of ownedPaths)
    for (const [k2, p2] of ownedPaths)
      if (k1 !== k2 && isPrefix(p1, p2)) throw new Error(`start.owned: "${k2}" is inside "${k1}"`);
  for (const [spec, path] of ownedPaths) {
    const val = startRaw.owned[spec];
    const alt = path.length ? findAlt(root, path) : null;
    if (path.length && !alt) throw new Error(`start.owned: no alternative "${spec}"`);
    let items = null, total;
    if (Array.isArray(val)) {
      if (!alt || alt.child) throw new Error(`start.owned: per-item counts need a single item or pool, not "${spec}"`);
      if (val.length > alt.count) throw new Error(`start.owned: "${spec}" has only ${alt.count} items`);
      items = val.map((x) => Math.max(0, x | 0));
      total = items.reduce((a, b) => a + b, 0);
    } else {
      total = Math.max(0, val | 0);
      if (alt && !alt.child && alt.icap) {
        if (alt.count > 1) throw new Error(`start.owned: give per-item counts for pool "${spec}" as an array`);
        items = [total];
      }
    }
    if (items && alt.icap) {
      while (items.length < alt.count) items.push(0);
      const rest = [];
      items.forEach((c, i) => {
        const x = alt.specByItem.get(i);
        if (x) start[x.v] = Math.min(c, x.cap); else rest.push(c);
      });
      if (alt.h.length) {
        for (const v of alt.h) start[v] = 0;
        for (const c of rest) start[alt.h[Math.min(c, alt.hcap)]]++;
      }
    }
    for (const r of reqs)
      if (r.type === "total" && r.paths.some((p) => isPrefix(p, path))) start[r.v] = Math.min(start[r.v] + total, r.copies);
  }
  // Copies already owned that a requirement states itself (used for item subsets)
  for (const r of reqs) if (r.type === "total" && r.have) start[r.v] = Math.min(start[r.v] + r.have, r.copies);

  // Probabilities at a node given the (already incremented) counters in s
  function probsAt(node, s) {
    const alts = node.alts;
    let forced = -1;
    for (let i = 0; i < alts.length; i++) {
      const a = alts[i];
      if (a.pity && s[a.cv] >= a.pity) { forced = i; break; }
    }
    if (forced >= 0 && !alts[forced].pityYields) return alts.map((_, j) => (j === forced ? 1 : 0));
    const pr = baseProbs(node, s);
    if (forced >= 0) {
      let before = 0;
      for (let j = 0; j < forced; j++) before += pr[j];
      for (let j = forced; j < pr.length; j++) pr[j] = 0;
      pr[forced] = Math.max(0, 1 - before);
      return pr;
    }
    if (node.streak) {
      const v = s[node.sv], n1 = node.streak + 1;
      const last = Math.floor(v / n1) - 1, run = v % n1;
      if (last >= 0 && run >= node.streak) {
        const rem = 1 - pr[last];
        if (rem > 0) {
          pr[last] = 0;
          for (let i = 0; i < pr.length; i++) pr[i] /= rem;
        }
      }
    }
    return pr;
  }

  function baseProbs(node, s) {
    const alts = node.alts;
    const pr = alts.map((a) =>
      a.soft ? Math.min(1, a.p + a.soft.step * Math.max(0, s[a.cv] - a.soft.start + 1)) : a.p);
    const restIdx = alts.findIndex((a) => a.rest);
    const softSum = alts.reduce((t, a, i) => t + (a.soft ? pr[i] : 0), 0);
    const plainSum = alts.reduce((t, a, i) => t + (!a.soft && !a.rest ? pr[i] : 0), 0);
    if (softSum >= 1) {
      alts.forEach((a, i) => (pr[i] = a.soft ? pr[i] / softSum : 0));
    } else if (restIdx >= 0) {
      if (softSum + plainSum > 1) {
        const k = (1 - softSum) / plainSum;
        alts.forEach((a, i) => { if (!a.soft && !a.rest) pr[i] *= k; });
        pr[restIdx] = 0;
      } else pr[restIdx] = 1 - softSum - plainSum;
    } else if (softSum + plainSum !== 1) {
      if (plainSum > 0) {
        const k = (1 - softSum) / plainSum;
        alts.forEach((a, i) => { if (!a.soft) pr[i] *= k; });
      } else if (softSum > 0) {
        for (let i = 0; i < pr.length; i++) pr[i] /= softSum;
      }
    }
    return pr;
  }

  // All outcomes of one pull from state s: [[prob, nextState], ...]
  function step(s0) {
    const out = [];
    (function walk(node, s, prob, label) {
      for (const a of node.alts) if (a.cv >= 0) s[a.cv] = Math.min(s[a.cv] + 1, a.cap);
      const pr = probsAt(node, s);
      for (let i = 0; i < node.alts.length; i++) {
        if (!(pr[i] > 0)) continue;
        const a = node.alts[i], p = prob * pr[i];
        const lab = a.hitLabel || label;
        const t = s.slice();
        if (a.cv >= 0) t[a.cv] = 0;
        if (node.streak) {
          const n1 = node.streak + 1, v = t[node.sv];
          const last = Math.floor(v / n1) - 1, run = v % n1;
          t[node.sv] = (i + 1) * n1 + (last === i ? Math.min(run + 1, node.streak) : 1);
        }
        if (a.child) { walk(a.child, t, p, lab); continue; }
        for (const r of a.sumReqs) t[r.v] = Math.min(t[r.v] + 1, r.copies);
        if (!a.icap) { out.push([p, t, lab]); continue; }
        // Which item of the pool: one of the named ones, or one of the others by copy count
        const n = a.count;
        for (const x of a.specs) {
          const u = t.slice();
          u[x.v] = Math.min(u[x.v] + 1, x.cap);
          out.push([p / n, u, lab]);
        }
        if (!a.h.length) { if (a.m > 0) out.push([(p * a.m) / n, t, lab]); continue; }
        for (let j = 0; j < a.h.length; j++) {
          const cnt = t[a.h[j]];
          if (!cnt) continue;
          const u = t.slice();
          u[a.h[j]]--;
          u[a.h[Math.min(j + 1, a.hcap)]]++;
          out.push([(p * cnt) / n, u, lab]);
        }
      }
    })(root, s0.slice(), 1, 0);
    return out;
  }

  // BFS over reachable states. Index 0 = "goal reached" sink when absorbing.
  const done = absorb ? isDone : () => false;
  const index = new Map();
  const states = [null], rows = [null];
  if (!done(start)) { index.set(start.join(","), 1); states.push(start); }
  if (onProgress) onProgress({ phase: "build", states: states.length });
  for (let k = 1; k < states.length; k++) {
    if (onProgress && (k & 2047) === 0) onProgress({ phase: "build", states: states.length });
    const merged = new Map();
    for (const [p, t, lab] of step(states[k])) {
      let j = 0;
      if (!done(t)) {
        const key = t.join(",");
        j = index.get(key);
        if (j === undefined) {
          j = states.length; index.set(key, j); states.push(t);
          if (j > maxStates) throw new Error(`Too big: over ${maxStates} states. Try fewer copies, fewer tracked items, or a higher maxStates.`);
        }
      }
      const key = j * 8 + lab; // target and label in one key
      merged.set(key, (merged.get(key) ?? 0) + p);
    }
    rows.push(merged);
  }
  if (absorb && states.length > 1 && !rows.some((r, k) => k > 0 && r.has(0)))
    throw new Error("The goal can't be reached with this banner");

  // Exact reduction: drop pity/streak variables that can't change the result
  const candidates = [];
  (function collect(node) {
    if (node.streak) candidates.push(node.sv);
    for (const a of node.alts) {
      if (a.cv >= 0) candidates.push(a.cv);
      if (a.child) collect(a.child);
    }
  })(root);
  let startIndex = states.length > 1 ? 1 : 0;
  if (onProgress) onProgress({ phase: "reduce", states: states.length });
  let st = states, rw = rows, progressMade = true;
  const dropped = new Set();
  while (progressMade) {
    progressMade = false;
    for (const x of candidates) {
      if (dropped.has(x)) continue;
      const res = projectOut(st, rw, x);
      if (res) {
        st = res.states; rw = res.rows; startIndex = res.group[startIndex];
        dropped.add(x); progressMade = true;
      }
    }
  }
  const packed = pack(st, rw);
  return {
    ...packed, startIndex, states: st, fullStates: states.length - 1,
    worst: absorb ? worstCase(packed, startIndex) : null,
    reqs, progress, isDone, goalMode,
  };
}

// Merge states that differ only in variable x, if that is exact: every merged
// state must have identical probabilities into every merged group.
function projectOut(states, rows, x, tol = 1e-12) {
  const N = states.length;
  const group = new Int32Array(N);
  const keyMap = new Map();
  const newStates = [null], reps = [0];
  for (let k = 1; k < N; k++) {
    const t = states[k].slice();
    t[x] = 0;
    const key = t.join(",");
    let g = keyMap.get(key);
    if (g === undefined) { g = newStates.length; keyMap.set(key, g); newStates.push(t); reps.push(k); }
    group[k] = g;
  }
  if (newStates.length === N) return null;
  const mergeRow = (k) => {
    const m = new Map();
    for (const [key, p] of rows[k]) { const g = group[key >> 3] * 8 + (key & 7); m.set(g, (m.get(g) ?? 0) + p); }
    return m;
  };
  const newRows = [null];
  for (let g = 1; g < newStates.length; g++) newRows.push(mergeRow(reps[g]));
  for (let k = 1; k < N; k++) {
    const a = mergeRow(k), b = newRows[group[k]];
    for (const [g, p] of a) if (Math.abs(p - (b.get(g) ?? 0)) > tol) return null;
    for (const [g, p] of b) if (!a.has(g) && p > tol) return null;
  }
  return { states: newStates, rows: newRows, group };
}

// Exact worst case: the most pulls the goal can possibly take. It exists only when no
// state can repeat (the graph of unfinished states has no cycle); then it is the longest
// path from the start to the goal. Returns null when there is no guarantee.
function worstCase({ N, rowStart, col }, startIndex) {
  if (startIndex === 0) return 0;
  const indeg = new Int32Array(N);
  for (let k = 1; k < N; k++) for (let e = rowStart[k]; e < rowStart[k + 1]; e++) if (col[e] !== 0) indeg[col[e]]++;
  const order = [];
  for (let k = 1; k < N; k++) if (indeg[k] === 0) order.push(k);
  for (let i = 0; i < order.length; i++) {
    const k = order[i];
    for (let e = rowStart[k]; e < rowStart[k + 1]; e++) {
      const j = col[e];
      if (j !== 0 && --indeg[j] === 0) order.push(j);
    }
  }
  if (order.length < N - 1) return null; // a cycle: the goal can be delayed forever
  const longest = new Float64Array(N);   // pulls still needed, worst case, from each state
  for (let i = order.length - 1; i >= 0; i--) {
    const k = order[i];
    let m = 0;
    for (let e = rowStart[k]; e < rowStart[k + 1]; e++) m = Math.max(m, 1 + (col[e] === 0 ? 0 : longest[col[e]]));
    longest[k] = m;
  }
  return longest[startIndex];
}

// Pack transitions into CSR arrays for the fast DP loop
function pack(states, rows) {
  const N = states.length;
  let nnz = 0;
  for (let k = 1; k < N; k++) nnz += rows[k].size;
  const rowStart = new Int32Array(N + 1), col = new Int32Array(nnz), prob = new Float64Array(nnz), lab = new Uint8Array(nnz);
  let e = 0;
  for (let k = 1; k < N; k++) {
    rowStart[k] = e;
    for (const [key, p] of rows[k]) { col[e] = key >> 3; lab[e] = key & 7; prob[e] = p; e++; }
  }
  rowStart[N] = e;
  return { N, rowStart, col, prob, lab };
}

// One pull: push probability mass along the transitions (state 0 = sink, skipped)
function advance(cur, next, N, rowStart, col, prob) {
  next.fill(0);
  for (let k = 1; k < N; k++) {
    const m = cur[k];
    if (m === 0) continue;
    for (let e = rowStart[k], end = rowStart[k + 1]; e < end; e++) next[col[e]] += m * prob[e];
  }
}

const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

// ── Item subsets ──────────────────────────────────────────────────────────────
// A "total" or "distinct" requirement can name some items of a pool:
//   { path: "0,0", type: "total", items: ["Lily", "Tawil", "Sorel"], copies: 5 }
// Items of a pool have equal odds, so the pool can be split into smaller pools with
// proportional chances without changing anything: each group of items that every
// requirement treats alike becomes its own sub-pool. Requirements are then rewritten to
// point at the sub-pools. Pity, memory rules, specific items and owned copies carry over.
function canonTree(raw) {
  const isObj = raw && !Array.isArray(raw);
  const altsRaw = isObj ? raw.alts : raw;
  return {
    streak: isObj ? raw.streak || 0 : 0,
    alts: altsRaw.map((a) => {
      const o = Array.isArray(a) ? { p: a[0], pity: a[1], children: a[2] } : { ...a };
      if (typeof o.children === "number") { o.count = o.children; o.children = null; }
      if (o.children) o.children = canonTree(o.children);
      return o;
    }),
  };
}

export function expandSubsets(tree, goal, start = {}) {
  const list = Array.isArray(goal) ? goal : Object.entries(goal ?? {}).map(([path, copies]) => ({ path, copies }));
  if (!list.some((g) => Array.isArray(g.items))) return { tree, goal, start };

  const t = canonTree(tree);
  const root = normaliseNode(t, []); // only to resolve names and validate
  const altAtPath = (path) => { let n = t, a = null; for (const i of path) { a = n.alts[i]; n = a?.children; } return a; };
  const goalOut = list.map((g) => ({ ...g }));
  const owned = { ...(start.owned ?? {}) };

  // Group subset requirements by pool
  const byPool = new Map();
  for (const g of goalOut) {
    if (!Array.isArray(g.items)) continue;
    const type = g.type ?? "total";
    if (type !== "total" && type !== "distinct") throw new Error(`Only "total" and "distinct" requirements can pick items`);
    const path = resolvePath(root, g.path);
    const alt = findAlt(root, path);
    if (!alt || alt.child || alt.count < 2) throw new Error(`Picking items needs a pool (count > 1), not "${g.path}"`);
    const idx = g.items.map((it) => {
      if (typeof it === "number" || /^\d+$/.test(String(it))) return Number(it);
      const j = (alt.itemNames ?? []).indexOf(it);
      if (j < 0) throw new Error(`Pool "${g.path}" has no item named "${it}"`);
      return j;
    });
    if (!idx.length) throw new Error(`Pick at least one item for "${g.label ?? g.path}"`);
    for (const i of idx) if (!Number.isInteger(i) || i < 0 || i >= alt.count) throw new Error(`Pool "${g.path}" has items 0–${alt.count - 1}, not ${i}`);
    g._set = new Set(idx);
    g._pool = pathKey(path);
    if (!byPool.has(g._pool)) byPool.set(g._pool, { path, alt, reqs: [] });
    byPool.get(g._pool).reqs.push(g);
  }

  for (const [key, { path, alt, reqs }] of byPool) {
    const n = alt.count;
    // Items every subset requirement treats alike end up in the same sub-pool
    const classes = new Map();
    for (let i = 0; i < n; i++) {
      const sig = reqs.map((r) => (r._set.has(i) ? 1 : 0)).join("");
      if (!classes.has(sig)) classes.set(sig, []);
      classes.get(sig).push(i);
    }
    const groups = [...classes.values()];
    const where = new Map(); // pool item index → [sub-pool index, index inside it]
    groups.forEach((g, ci) => g.forEach((i, li) => where.set(i, [ci, li])));
    const subPath = (ci) => [...path, ci].join(",");
    const names = alt.itemNames ?? [];

    if (groups.length > 1) {
      const raw = altAtPath(path);
      raw.children = {
        streak: 0,
        alts: groups.map((g, ci) => ({
          name: `${alt.name ?? "pool"} · ${ci + 1}`,
          p: `${g.length}/${n}`,
          count: g.length,
          items: g.map((i) => names[i] ?? `item ${i + 1}`),
        })),
      };
      delete raw.count;
      delete raw.items;
    }

    for (const r of reqs) {
      // all sub-pools fully inside the subset (each sub-pool is either fully in or fully out)
      r.paths = groups.length > 1 ? groups.map((g, ci) => (r._set.has(g[0]) ? subPath(ci) : null)).filter(Boolean) : [key];
      delete r.path; delete r.items; delete r._set; delete r._pool;
    }
    if (groups.length > 1) {
      // "one specific item" rows on this pool now point inside a sub-pool
      for (const g of goalOut) {
        if ((g.type ?? "total") !== "specific" || g.paths) continue;
        if (pathKey(resolvePath(root, g.path)) !== key) continue;
        let item = g.item ?? 0;
        if (typeof item === "string" && !/^\d+$/.test(item)) item = names.indexOf(item);
        const [ci, li] = where.get(Number(item)) ?? [0, 0];
        g.path = subPath(ci);
        g.item = li;
      }
      // owned copies listed per item are split between the sub-pools
      for (const [k, v] of Object.entries(owned)) {
        if (!Array.isArray(v) || pathKey(resolvePath(root, k)) !== key) continue;
        delete owned[k];
        groups.forEach((g, ci) => { owned[subPath(ci)] = g.map((i) => Math.max(0, v[i] | 0)); });
      }
    }
  }
  for (const g of goalOut) { delete g._set; delete g._pool; }
  return { tree: t, goal: goalOut, start: { ...start, owned } };
}

// ── Layered method ───────────────────────────────────────────────────────────
// For goals on one or two pools (or single outcomes) under a common "event" — e.g.
// characters and wheels that both come from an SSR. Three parts that never influence
// each other are solved separately and combined exactly:
//   items  — which item of a pool you get: per-pool chain, F_g(n) = P(pool goal met after n hits)
//   events — what each event is (pool 1, pool 2, other): the event subtree's own chain
//            (memory rules, inner pity) together with how many hits each pool has had
//   timing — when events happen: the rest of the banner. If it resets at every event (like
//            SSR pity), the gaps between events are independent and identically distributed,
//            and the number of pulls is a sum of gaps, combined with an FFT.
// Joint state space is never built, so goals needing billions of joint states become cheap.

function nodeAtCanon(t, path) {
  let n = t;
  for (const i of path) n = n.alts[i].children;
  return n;
}

function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  // twiddles computed directly (not by repeated multiplication) to keep rounding at ~1e-16
  const half = n >> 1, cosT = new Float64Array(half), sinT = new Float64Array(half);
  for (let k = 0; k < half; k++) { cosT[k] = Math.cos(2 * Math.PI * k / n); sinT[k] = (inverse ? 1 : -1) * Math.sin(2 * Math.PI * k / n); }
  for (let len = 2; len <= n; len <<= 1) {
    const h = len >> 1, stride = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < h; k++) {
        const cr = cosT[k * stride], ci = sinT[k * stride];
        const a = i + k, b = a + h;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

// Distribution of pulls until the first labelled transition, from a given state
function firstHitPmf(c, from, cut) {
  const pmf = [0];
  let cur = new Float64Array(c.N), next = new Float64Array(c.N);
  cur[from] = 1;
  let left = 1;
  for (let t = 1; left > cut && t < 1e6; t++) {
    next.fill(0);
    let hit = 0;
    for (let k = 1; k < c.N; k++) {
      const m = cur[k];
      if (!m) continue;
      for (let e = c.rowStart[k]; e < c.rowStart[k + 1]; e++) {
        if (c.lab[e]) hit += m * c.prob[e]; else next[c.col[e]] += m * c.prob[e];
      }
    }
    pmf.push(hit);
    left = 0;
    for (let k = 1; k < c.N; k++) left += next[k];
    [cur, next] = [next, cur];
  }
  return pmf;
}

function resolveItem(alt, it, where) {
  if (typeof it === "number" || /^\d+$/.test(String(it))) return Number(it);
  const j = (alt.itemNames ?? []).indexOf(it);
  if (j < 0) throw new Error(`Pool "${where}" has no item named "${it}"`);
  return j;
}

// Rows of one pool → formula plan (null when the formulas can't do it: then a small chain)
function poolPlanFor(x, ownedVal, goalMode) {
  const alt = x.alt, where = x.reqs[0]?.label ?? pathKey(x.path);
  const rows = x.reqs.map((r) => ({
    type: r.type ?? "total",
    item: r.type === "specific" ? resolveItem(alt, r.item ?? 0, where) : undefined,
    items: Array.isArray(r.items) ? r.items.map((it) => resolveItem(alt, it, where)) : null,
    copies: r.copies ?? 1, k: r.k, have: r.have,
  }));
  const owned = Array.isArray(ownedVal) ? ownedVal : ownedVal != null ? [ownedVal] : [];
  return poolPlan(alt.count, rows, owned, goalMode);
}

// Fallback for a pool the formulas can't handle (total rows on subsets that partly overlap)
function poolChain(x, ownedVal, opts) {
  const miniTree = [{ p: 1, count: x.alt.count, items: x.alt.itemNames ?? undefined }];
  const miniGoal = x.reqs.map((r) => ({ ...r, path: "0" }));
  const miniOpts = { goalMode: opts.goalMode, maxStates: opts.maxStates, start: ownedVal != null ? { owned: { "0": ownedVal } } : {} };
  const ex = expandSubsets(miniTree, miniGoal, miniOpts.start);
  return { miniTree: ex.tree, miniGoal: ex.goal, miniOpts: { ...miniOpts, start: ex.start } };
}
function poolChainNotMet(pc, tol) {
  const mc = compile(pc.miniTree, pc.miniGoal, pc.miniOpts);
  const S = [mc.startIndex === 0 ? 0 : 1];
  let cur = new Float64Array(mc.N), next = new Float64Array(mc.N), miss = S[0];
  cur[mc.startIndex] = 1;
  while (miss > 0 && miss >= tol && S.length < 1e5) {
    advance(cur, next, mc.N, mc.rowStart, mc.col, mc.prob);
    next[0] = 0;
    miss = 0;
    for (let k = 1; k < mc.N; k++) miss += next[k];
    S.push(miss);
    [cur, next] = [next, cur];
  }
  return { S, states: mc.N - 1 };
}
function poolChainBudget(pc, Hcap) {
  const mc = compile(pc.miniTree, pc.miniGoal, { ...pc.miniOpts, absorb: false });
  const prog = mc.reqs.map((r) => Int32Array.from(mc.states, (s, k) => (k === 0 ? 0 : Math.min(mc.progress(r, s), r.max))));
  const maxed = Uint8Array.from(mc.states, (s, k) => (k > 0 && mc.reqs.every((r, i) => prog[i][k] >= r.max) ? 1 : 0));
  const D = mc.reqs.map(() => []), E = mc.reqs.map(() => []), G = [];
  let cur = new Float64Array(mc.N), next = new Float64Array(mc.N);
  cur[mc.startIndex] = 1;
  for (let n = 0; n <= Hcap; n++) {
    mc.reqs.forEach((r, i) => {
      const d = new Float64Array(r.max + 1);
      let e = 0;
      for (let k = 1; k < mc.N; k++) if (cur[k]) { d[prog[i][k]] += cur[k]; e += cur[k] * prog[i][k]; }
      D[i].push(d); E[i].push(e);
    });
    let g = 0, notMaxed = 0;
    for (let k = 1; k < mc.N; k++) if (cur[k]) { if (!mc.isDone(mc.states[k])) g += cur[k]; if (!maxed[k]) notMaxed += cur[k]; }
    G.push(g);
    if (notMaxed < 1e-15) break;
    advance(cur, next, mc.N, mc.rowStart, mc.col, mc.prob);
    [cur, next] = [next, cur];
  }
  return { D, E, G };
}

const MAX_GROUPS = 7; // transition labels have 3 bits

// Rows grouped by the pool / single outcome they target (null if a row targets something else)
function groupRows(root, list) {
  if (!list.length || list.some((g) => g.paths)) return null;
  const groups = new Map();
  for (const [idx, g] of list.entries()) {
    const path = resolvePath(root, g.path);
    const alt = findAlt(root, path);
    if (!alt || alt.child) return null;
    const key = pathKey(path);
    if (!groups.has(key)) groups.set(key, { path, alt, reqs: [], idx: [] });
    groups.get(key).reqs.push(g);
    groups.get(key).idx.push(idx);
  }
  return [...groups.values()];
}
const goalList = (goal) => (Array.isArray(goal) ? goal : Object.entries(goal ?? {}).map(([path, copies]) => ({ path, copies })));
const ownedFor = (root, start, x) => Object.entries(start.owned ?? {}).find(([k]) => pathKey(resolvePath(root, k)) === pathKey(x.path))?.[1];
function labelsOf(tree, list, start) {
  const ex = expandSubsets(tree, list, start);
  return parseGoal(normaliseNode(canonTree(ex.tree), []), ex.goal).map((r) => r.label);
}

function planLayered(tree, goal, opts, eps, force) {
  const list = goalList(goal);
  const t = canonTree(tree);
  const root = normaliseNode(t, []);
  const G = groupRows(root, list); // every row must target one pool or one single outcome
  if (!G || G.length > MAX_GROUPS) return null;
  const perItem = G.some((x) => x.reqs.some((r) => (r.type ?? "total") !== "total" || Array.isArray(r.items)));
  if (!force && !perItem) return { small: true }; // plain totals: the chain is small and gives the exact worst case

  // The event: the deepest node that contains every targeted outcome
  let pre = G[0].path.slice(0, -1);
  for (const x of G) {
    const p = x.path.slice(0, -1);
    let i = 0;
    while (i < pre.length && i < p.length && pre[i] === p[i]) i++;
    pre = pre.slice(0, i);
  }
  const start = opts.start ?? {};
  const inner = { pity: {}, streak: {} }, outer = { pity: {}, streak: {} };
  const inside = (p, strict) => p.length >= pre.length + (strict ? 1 : 0) && pre.every((v, i) => v === p[i]);
  for (const [k, v] of Object.entries(start.pity ?? {})) {
    const p = resolvePath(root, k);
    if (inside(p, true)) inner.pity[pathKey(p.slice(pre.length))] = v; else outer.pity[k] = v;
  }
  for (const [k, v] of Object.entries(start.streak ?? {})) {
    const p = resolvePath(root, k);
    if (inside(p, false)) inner.streak[pathKey(p.slice(pre.length))] = v; else outer.streak[k] = v;
  }

  // Events: the event subtree, labelled with which targeted outcome each event hits
  const ic = cached("inner", [nodeAtCanon(t, pre), inner, opts.maxStates, G.map((x) => x.path.slice(pre.length))], () =>
    compile(nodeAtCanon(t, pre), null, { start: inner, maxStates: opts.maxStates, trackHits: G.map((x) => x.path.slice(pre.length)) }));

  // Timing: the banner with the event subtree folded into one outcome
  let timing = null;
  if (pre.length) {
    timing = cached("timing", [t, pre, outer, opts.maxStates, eps], () => {
      const outerTree = canonTree(t);
      const evAlt = (() => { let n = outerTree, a = null; for (const i of pre) { a = n.alts[i]; n = a.children; } return a; })();
      evAlt.children = null; evAlt.count = 1; delete evAlt.items;
      const oc = compile(outerTree, null, { start: outer, maxStates: opts.maxStates, trackHits: [pre] });
      const entries = new Set();
      for (let e = 0; e < oc.col.length; e++) if (oc.lab[e]) entries.add(oc.col[e]);
      if (entries.size !== 1) return { ok: false }; // timing doesn't restart at each event
      const entry = [...entries][0];
      const gap = firstHitPmf(oc, entry, eps / 100);
      const gap1 = oc.startIndex === entry ? gap : firstHitPmf(oc, oc.startIndex, eps / 100);
      return { ok: true, states: oc.N - 1, gap, gap1 };
    });
    if (!timing.ok) return null;
  }

  // Items: formulas per pool (or a small chain when they can't)
  const pools = G.map((x) => {
    const ownedVal = ownedFor(root, start, x);
    const fp = poolPlanFor(x, ownedVal, opts.goalMode);
    return fp ? { formula: fp, est: chainSizeEstimate(fp) } : { chain: poolChain(x, ownedVal, opts), est: Infinity };
  });

  // Auto: a tiny joint chain is just as fast and also gives the exact worst case
  const jointEst = (timing ? timing.states : 1) * (ic.N - 1) * pools.reduce((m, x) => m * x.est, 1);
  if (!force && jointEst < 3000) return { small: true };

  const tol = eps / 1000;
  const items = pools.map((x) => {
    // the last value is below the cut-off: treat it as 0 so capped hit counts count as done
    if (x.formula) {
      const S = cached("poolS", [x.formula, tol], () => Array.from(poolNotMet(x.formula, tol)));
      return { ...x, S: [...S.slice(0, -1), 0], cap: S.length - 1, states: S.length };
    }
    const r = cached("poolChainS", [x.chain, tol], () => poolChainNotMet(x.chain, tol));
    return { ...x, S: [...r.S.slice(0, -1), 0], cap: r.S.length - 1, states: r.states };
  });

  const labels = labelsOf(tree, list, start);
  return {
    maxStates: opts.maxStates, reqs: list, labels, G, items, ic, pre, goalMode: opts.goalMode,
    gap: timing?.gap ?? null, gap1: timing?.gap1 ?? null, outerStates: timing?.states ?? 0,
  };
}

// Walks the event chain one event at a time, tracking hits per targeted outcome (capped).
// State index = eventState·W + Σ_g hits_g·stride_g. visit(m, cur, active, W) after each event count m.
function walkEvents(plan, caps, visit) {
  const { ic } = plan;
  const K = caps.length, stride = new Array(K), radix = caps.map((c) => c + 1);
  let W = 1;
  for (let g = K - 1; g >= 0; g--) { stride[g] = W; W *= radix[g]; }
  const size = ic.N * W;
  // cells here are plain numbers with no stored transitions, ~10× cheaper than chain states
  const limit = Math.min(10 * (plan.maxStates ?? 1e6), 4e7);
  if (size > limit)
    throw new Error(`Too big: ${size.toLocaleString("en")} states needed for the event layer (limit ${limit.toLocaleString("en")}).`);
  let cur = new Float64Array(size), next = new Float64Array(size);
  let active = [ic.startIndex * W], nextActive = [];
  const mark = new Int32Array(size).fill(-1);
  cur[ic.startIndex * W] = 1;
  const geom = { W, stride, radix, K };
  for (let m = 0; ; m++) {
    if (visit(m, cur, active, geom) === false) return;
    for (const i of active) {
      const p = cur[i];
      cur[i] = 0;
      if (!p) continue;
      const x = Math.floor(i / W), r = i - x * W;
      for (let e = ic.rowStart[x]; e < ic.rowStart[x + 1]; e++) {
        const l = ic.lab[e];
        let r2 = r;
        if (l) {
          const g = l - 1;
          if (Math.floor(r / stride[g]) % radix[g] < caps[g]) r2 += stride[g];
        }
        const j = ic.col[e] * W + r2;
        if (mark[j] !== m) { mark[j] = m; nextActive.push(j); }
        next[j] += p * ic.prob[e];
      }
    }
    [cur, next] = [next, cur];
    [active, nextActive] = [nextActive, []];
  }
}

// P(goal not met) for every combination of hits, from each group's "not met after n hits"
function undoneTable(geom, notMet, goalMode) {
  const { W, stride, radix, K } = geom;
  const out = new Float64Array(W);
  for (let r = 0; r < W; r++) {
    let u = goalMode === "any" ? 1 : 0;
    for (let g = 0; g < K; g++) {
      const s = notMet[g][Math.floor(r / stride[g]) % radix[g]];
      u = goalMode === "any" ? u * s : u + s - u * s; // all: 1 − ∏(1 − s) without cancellation
    }
    out[r] = u;
  }
  return out;
}

function solveLayered(plan, eps, maxPulls, onProgress) {
  const { items, gap, gap1, goalMode } = plan;

  // How many events the goal needs: U[m] = P(M > m)
  const U = [];
  let table = null;
  walkEvents(plan, items.map((x) => x.cap), (m, cur, active, geom) => {
    table ??= undoneTable(geom, items.map((x) => x.S), goalMode);
    let u = 0;
    for (const i of active) {
      const p = cur[i];
      if (p) u += p * table[i % geom.W];
    }
    U.push(Math.min(1, u));
    if (onProgress && (m & 15) === 0) onProgress({ phase: "calc", t: m, remaining: u, eps });
    if (m >= 1e6) throw new Error("Too big: the goal needs more than a million events.");
    return u > eps / 10;
  });
  const pM = U.map((u, m) => Math.max(0, (m ? U[m - 1] : 1) - u));

  // Number of pulls: each event costs one gap (the first from the starting state)
  let pmfT;
  if (!gap) pmfT = pM; // the event is the pull itself
  else {
    const Mmax = pM.length - 1;
    const len = (gap1.length - 1) + Math.max(0, Mmax - 1) * (gap.length - 1) + 1;
    if (len > maxPulls + 1 && len > 1 << 23) throw new Error("Too big: the result would span too many pulls.");
    let L = 1;
    while (L < len) L <<= 1;
    const gr = new Float64Array(L), gi = new Float64Array(L), hr = new Float64Array(L), hi = new Float64Array(L);
    gap.forEach((v, i) => { gr[i] = v; });
    gap1.forEach((v, i) => { hr[i] = v; });
    fft(gr, gi, false);
    fft(hr, hi, false);
    const outR = new Float64Array(L), outI = new Float64Array(L);
    const pMa = Float64Array.from(pM);
    // inputs are real, so the value at L − z is the conjugate of the value at z: do half
    for (let z = 0; z <= L / 2; z++) {
      // Σ_{m≥1} p_m · G1 · G^(m-1), by Horner
      let ar = 0, ai = 0;
      const xr = gr[z], xi = gi[z];
      for (let m = Mmax; m >= 1; m--) {
        const nr = ar * xr - ai * xi + pMa[m];
        ai = ar * xi + ai * xr;
        ar = nr;
      }
      outR[z] = ar * hr[z] - ai * hi[z] + pMa[0];
      outI[z] = ar * hi[z] + ai * hr[z];
      if (z > 0 && z < L / 2) { outR[L - z] = outR[z]; outI[L - z] = -outI[z]; }
      if (onProgress && (z & 4095) === 0) onProgress({ phase: "budget", t: z, total: L / 2 });
    }
    fft(outR, outI, true);
    pmfT = Array.from(outR.subarray(0, len), (v) => (v > 0 ? v : 0));
  }
  // Survival, cut where it falls below eps
  const pmf = [], survival = [];
  let acc = 0;
  for (let t = 0; t < pmfT.length && t <= maxPulls; t++) {
    acc += pmfT[t];
    pmf.push(pmfT[t]);
    const sv = Math.max(0, 1 - acc);
    survival.push(sv < 1e-15 ? 0 : sv);
    if (sv < eps) break;
  }
  return {
    pmf, survival, labels: plan.labels, worst: null,
    states: plan.ic.N - 1 + plan.outerStates + items.reduce((s, x) => s + x.states, 0),
    fullStates: null,
  };
}

function budgetLayered(plan, B) {
  if (!(Number.isInteger(B) && B >= 0)) throw new Error("budget must be a whole number of pulls ≥ 0");
  const { items, gap, gap1, goalMode } = plan;

  // P(N(t) = m): how many events by pull t, for every t ≤ B
  const Ccum = []; // Ccum[m][t] = P(event m+1 has happened by pull t)
  if (gap) {
    let tau = new Float64Array(B + 1);
    gap1.forEach((v, i) => { if (i <= B) tau[i] = v; });
    for (let m = 1; m < 1e5; m++) {
      const c = new Float64Array(B + 1);
      let acc = 0;
      for (let t = 0; t <= B; t++) { acc += tau[t]; c[t] = acc; }
      Ccum.push(c);
      if (acc < 1e-15) break;
      const nt = new Float64Array(B + 1);
      for (let t = 0; t <= B; t++) {
        if (!tau[t]) continue;
        for (let d = 1; d < gap.length && t + d <= B; d++) nt[t + d] += tau[t] * gap[d];
      }
      tau = nt;
    }
  } else {
    for (let m = 1; m <= B + 1; m++) Ccum.push(Float64Array.from({ length: B + 1 }, (_, t) => (t >= m ? 1 : 0)));
  }
  const mCount = Ccum.length; // events beyond this never happen within B pulls
  const pN = (t, m) => (m === 0 ? 1 : Ccum[m - 1][t]) - (m < mCount ? Ccum[m][t] : 0);

  // Per pool: progress of each row after n hits, until every row is maxed out
  const perGroup = items.map((x) => (x.formula
    ? cached("poolBudget", [x.formula, mCount], () => poolBudget(x.formula, mCount))
    : cached("poolChainBudget", [x.chain, mCount], () => poolChainBudget(x.chain, mCount))));

  // Per event count m: distribution of hits on each pool, and the chance the goal is met
  const caps = perGroup.map((x) => x.G.length - 1);
  const hitDist = [];
  let table = null;
  walkEvents(plan, caps, (m, cur, active, geom) => {
    table ??= undoneTable(geom, perGroup.map((x) => x.G), goalMode);
    const g = caps.map((c) => new Float64Array(c + 1));
    let undone = 0;
    for (const i of active) {
      const p = cur[i];
      if (!p) continue;
      const r = i % geom.W;
      undone += p * table[r];
      for (let k = 0; k < geom.K; k++) g[k][Math.floor(r / geom.stride[k]) % geom.radix[k]] += p;
    }
    hitDist.push({ g, done: 1 - undone });
    return m < mCount;
  });

  // Rows, in the goal's order
  const order = [];
  plan.G.forEach((grp, gi) => grp.idx.forEach((orig, i) => { order[orig] = { gi, i, r: rowInfo(grp.reqs[i], grp.alt) }; }));

  const expectedByPull = order.map(() => new Float64Array(B + 1));
  const goalByPull = new Float64Array(B + 1);
  const Em = order.map(({ gi, i }) => hitDist.map((h) => h.g[gi].reduce((s, p, n) => s + p * perGroup[gi].E[i][n], 0)));
  for (let t = 0; t <= B; t++) {
    for (let m = 0; m <= mCount && m < hitDist.length; m++) {
      const p = pN(t, m);
      if (!p) continue;
      goalByPull[t] += p * hitDist[m].done;
      order.forEach((_, k) => { expectedByPull[k][t] += p * Em[k][m]; });
    }
  }
  return {
    pulls: B,
    chanceGoal: goalByPull[B],
    goalByPull,
    requirements: order.map(({ gi, i, r }, k) => {
      const dist = new Float64Array(r.max + 1);
      for (let m = 0; m <= mCount && m < hitDist.length; m++) {
        const p = pN(B, m);
        if (!p) continue;
        hitDist[m].g[gi].forEach((q, n) => {
          if (!q) return;
          const d = perGroup[gi].D[i][n];
          for (let v = 0; v < d.length && v <= r.max; v++) dist[v] += p * q * d[v];
        });
      }
      const target = r.type === "distinct" ? r.k : r.copies;
      let chanceMet = 0;
      for (let v = target; v <= r.max; v++) chanceMet += dist[v];
      return {
        label: plan.labels[k], type: r.type, copies: r.copies,
        unit: r.type === "distinct" ? `items with ≥${r.copies} copies` : "copies",
        target, dist, mean: expectedByPull[k][B], chanceMet, expectedByPull: expectedByPull[k],
      };
    }),
  };
}

// Type, target and largest progress of a row (as the chain reports them)
function rowInfo(req, alt) {
  const type = req.type ?? "total";
  const copies = req.copies ?? 1;
  if (type === "distinct") return { type, copies, k: req.k, max: Array.isArray(req.items) ? new Set(req.items).size : alt.count };
  return { type: type === "specific" && alt.count === 1 ? "total" : type, copies, max: copies };
}

// ── Solve ─────────────────────────────────────────────────────────────────────
// Method choice (all exact; they differ in speed):
//   layered — rows on up to 7 pools/outcomes under an event that restarts the banner (SSR):
//             pool formulas + event chain + FFT over the gaps. Chosen unless the joint chain is tiny.
//   split   — rows on one pool when the banner doesn't restart at each event.
//   joint   — everything tracked together; tiny goals (gives the exact worst case) and the rest.
function choosePlan({ tree, goal, goalMode, start, eps, maxStates, method, onProgress }) {
  const orig = { tree, goal, start };
  const lp = method === "auto" || method === "layered"
    ? cached("planLayered", [tree, goal, start, goalMode, maxStates, eps, method], () => planLayered(tree, goal, { start, goalMode, maxStates }, eps, method === "layered"))
    : null;
  const small = !!lp?.small, layered = small ? null : lp;
  if (method === "layered" && !layered) throw new Error(`method "layered" needs every row on one pool or single outcome (up to ${MAX_GROUPS} of them), under an event that restarts the banner`);
  const split = !layered && !(small && method === "auto") && (method === "auto" || method === "split")
    ? cached("planSplit", [tree, goal, start, goalMode, maxStates, eps, method], () => planSplit(tree, goal, { start, goalMode, maxStates }, eps, method === "split"))
    : null;
  if (method === "split" && !split) throw new Error(`method "split" needs all requirements on one pool`);
  const ex = expandSubsets(tree, goal, start);
  return { layered, split, orig, tree: ex.tree, goal: ex.goal, opts: { start: ex.start, goalMode, maxStates, onProgress } };
}

export function solve({
  tree,
  goal,
  goalMode = "all",
  start = {},
  percentiles = DEFAULT_PERCENTILES,
  chanceAt = [],      // pull counts → P(goal met within that many pulls)
  budget = null,      // pull count → full "what will I get" report
  eps = 1e-13,        // stop once P(not done yet) < eps (0 = run to the guaranteed end)
  maxPulls = 1e6,
  maxStates = 1e6,    // refuse calculations bigger than this (protects the browser tab)
  method = "auto",    // "auto" | "joint" | "split" (see planSplit)
  onProgress = null,  // optional callback: { phase: "build" | "calc" | "budget", ... }
}) {
  const t0 = now();
  const { layered, split, opts, tree: exTree, goal: exGoal, orig } = choosePlan({ tree, goal, goalMode, start, eps, maxStates, method, onProgress });

  // the distribution doesn't depend on the budget: changing only the budget reuses it
  const distKey = [tree, goal, start, goalMode, maxStates, eps, method, maxPulls];
  let res;
  if (layered) res = cached("distLayered", distKey, () => solveLayered(layered, eps, maxPulls, onProgress));
  else if (split) res = cached("distSplit", distKey, () => solveSplit(orig.tree, split, { ...opts, start: orig.start }, eps, maxPulls));
  else {
    // the distribution only needs "is the goal met": merge same-target named items first
    const merged = expandSubsets(orig.tree, mergeNamedRows(orig.tree, orig.goal, goalMode), orig.start);
    const c = compile(merged.tree, merged.goal, { ...opts, start: merged.start });
    const { N, startIndex } = c;
    const pmf = [startIndex === 0 ? 1 : 0];
    const survival = [startIndex === 0 ? 0 : 1];
    const st = makeStepper(c);
    let t = 0, remaining = survival[0];
    while (remaining > 0 && remaining >= eps && t < maxPulls) {
      if (onProgress && (t & 15) === 0) onProgress({ phase: "calc", t, remaining, eps });
      pmf.push(st.step());
      t++;
      remaining = st.remaining;
      survival.push(remaining);
    }
    st.close();
    res = { pmf, survival, labels: labelsOf(orig.tree, goalList(orig.goal), orig.start), states: N - 1, fullStates: c.fullStates, worst: c.worst };
  }

  const { pmf, survival } = res;
  const t = survival.length - 1, remaining = survival[t];
  let mean = 0, m2 = 0;
  for (let i = 0; i < t; i++) { mean += survival[i]; m2 += (2 * i + 1) * survival[i]; }
  const cdf = Float64Array.from(survival, (sv) => 1 - sv);
  const quantile = (q) => {
    for (let i = 0; i < cdf.length; i++) if (cdf[i] >= q - 1e-12) return i;
    return null;
  };
  const pct = {};
  for (const q of percentiles) pct[`p${q}`] = quantile(q / 100);
  const chances = {};
  for (const b of chanceAt) chances[b] = b >= cdf.length ? 1 - remaining : cdf[Math.max(0, b)];
  let mode = 0;
  for (let i = 1; i < pmf.length; i++) if (pmf[i] > pmf[mode]) mode = i;

  return {
    requirements: res.labels,
    mean,
    sd: Math.sqrt(Math.max(0, m2 - mean * mean)),
    median: quantile(0.5),
    mode,                               // single most likely pull to finish on
    percentiles: pct,
    chanceAt: chances,
    max: res.worst ?? (remaining === 0 ? t : null), // exact worst case, if the goal is guaranteed
    tail: remaining,                    // probability not covered (0 or < eps)
    pmf: Float64Array.from(pmf),        // chart: P(goal first met on pull t)
    cdf,                                // chart: P(goal met within t pulls)
    budget: budget == null ? null
      : layered ? budgetLayered(layered, budget)
      : split ? budgetSplit(orig.tree, split, { ...opts, start: orig.start }, budget)
      : budgetReport(exTree, exGoal, opts, budget),
    method: layered ? "layered" : split ? "split" : "joint",
    states: res.states,
    statesBeforeReduction: res.fullStates,
    ms: now() - t0,
  };
}

// Joint chain only: "specific" rows on one pool with the same copies become one
// "k different of these items" row (k = all of them, or 1 in "any" mode). Same goal,
// but a copy histogram replaces one counter per item: (c+1)^m states → C(m+c, c).
function mergeNamedRows(tree, goal, goalMode) {
  const list = goalList(goal);
  const root = normaliseNode(canonTree(tree), []);
  const groups = new Map();
  list.forEach((g, i) => {
    if ((g.type ?? "total") !== "specific" || g.paths) return;
    const path = resolvePath(root, g.path);
    const alt = findAlt(root, path);
    if (!alt || alt.child || alt.count < 2) return;
    const key = `${pathKey(path)}|${g.copies ?? 1}`;
    if (!groups.has(key)) groups.set(key, { alt, rows: [] });
    groups.get(key).rows.push(i);
  });
  const drop = new Set(), add = [];
  for (const { alt, rows } of groups.values()) {
    if (rows.length < 2) continue;
    const items = [...new Set(rows.map((i) => resolveItem(alt, list[i].item ?? 0, list[i].path)))];
    rows.forEach((i) => drop.add(i));
    const g0 = list[rows[0]];
    add.push({ path: g0.path, type: "distinct", items, k: goalMode === "any" ? 1 : items.length, copies: g0.copies ?? 1 });
  }
  return add.length ? [...list.filter((_, i) => !drop.has(i)), ...add] : list;
}

// ── Split method ─────────────────────────────────────────────────────────────
// When every row is about one pool, which item a hit gives never affects the banner
// (pity, streaks). So: (a) the pool formulas give P(goal not met after n hits); (b) the banner
// chain gives the distribution of hits on the pool after t pulls; combine. Exact. Used when the
// layered method doesn't fit (the banner doesn't restart at each event).
function planSplit(tree, goal, opts, eps, force) {
  const list = goalList(goal);
  const root = normaliseNode(tree, []);
  const G = groupRows(root, list);
  if (!G || G.length !== 1) return null;
  const x = G[0];
  const ownedVal = ownedFor(root, opts.start, x);
  const fp = poolPlanFor(x, ownedVal, opts.goalMode);
  const chain = fp ? null : poolChain(x, ownedVal, opts);
  const tol = eps / 1000;
  let S, itemsWorst = null;
  if (fp) {
    S = Array.from(cached("poolS", [fp, tol], () => poolNotMet(fp, tol)));
    itemsWorst = fp.worstHits ?? null;
  } else {
    S = cached("poolChainS", [chain, tol], () => poolChainNotMet(chain, tol)).S.slice();
  }
  S[S.length - 1] = 0;
  // split tracks banner × hits (up to nMax); joint tracks banner × item counters: pick the smaller
  if (!force && fp && 4 * S.length >= chainSizeEstimate(fp)) return null;
  return {
    formula: fp, chain, S, nMax: S.length - 1, poolPath: x.path, alt: x.alt, reqs: x.reqs,
    itemsGuaranteed: itemsWorst != null, labels: labelsOf(tree, list, opts.start),
  };
}

function solveSplit(tree, plan, opts, eps, maxPulls) {
  const { nMax, S, poolPath } = plan;
  const bannerStart = { pity: opts.start.pity, streak: opts.start.streak };
  if (nMax === 0) return { pmf: [1], survival: [0], labels: plan.labels, states: 0, fullStates: 0, worst: 0 };
  // Banner chain counting hits on the pool, up to nMax (state 0 = "nMax or more")
  const c = cached("splitChain", [tree, poolPath, nMax, bannerStart, opts.maxStates], () =>
    compile(tree, [{ path: poolPath, copies: nMax }], { start: bannerStart, maxStates: opts.maxStates, onProgress: opts.onProgress }));
  const { N, states } = c;
  const st = makeStepper(c);
  const miss = st.weights(Float64Array.from(states, (s, k) => (k === 0 ? 0 : S[c.progress(c.reqs[0], s)])));
  const sumMiss = () => st.dot(miss);
  const survival = [sumMiss()], pmf = [1 - survival[0]];
  let t = 0, remaining = survival[0];
  while (remaining > 0 && remaining >= eps && t < maxPulls) {
    if (opts.onProgress && (t & 15) === 0) opts.onProgress({ phase: "calc", t, remaining, eps });
    st.step(); // mass reaching state 0 has ≥ nMax hits: goal met for sure
    t++;
    remaining = sumMiss();
    pmf.push(Math.max(0, survival[t - 1] - remaining));
    survival.push(remaining);
  }
  st.close();
  // Guaranteed only if the item part is (then nMax is exactly the most hits ever needed)
  return { pmf, survival, labels: plan.labels, states: N - 1 + nMax, fullStates: c.fullStates, worst: plan.itemsGuaranteed ? c.worst : null };
}

function budgetSplit(tree, plan, opts, B) {
  if (!(Number.isInteger(B) && B >= 0)) throw new Error("budget must be a whole number of pulls ≥ 0");
  // Per number of hits n ≤ B: each row's progress distribution and the goal chance
  const { D, E, G } = plan.formula
    ? cached("poolBudget", [plan.formula, B], () => poolBudget(plan.formula, B))
    : cached("poolChainBudget", [plan.chain, B], () => poolChainBudget(plan.chain, B));
  const reqs = plan.reqs.map((r) => rowInfo(r, plan.alt));
  const nB = G.length - 1;

  // Banner chain: distribution of hits on the pool for every pull 0..B
  const bannerStart = { pity: opts.start.pity, streak: opts.start.streak };
  const expectedByPull = reqs.map(() => new Float64Array(B + 1));
  const goalByPull = new Float64Array(B + 1);
  const dist = reqs.map((r) => new Float64Array(r.max + 1));
  const addD = (i, m, h) => { const d = D[i][h]; for (let v = 0; v < d.length && v <= reqs[i].max; v++) dist[i][v] += m * d[v]; };
  if (nB === 0) {
    reqs.forEach((r, i) => { expectedByPull[i].fill(E[i][0]); addD(i, 1, 0); });
    goalByPull.fill(1 - G[0]);
  } else {
    const c = compile(tree, [{ path: plan.poolPath, copies: nB }], { start: bannerStart, maxStates: opts.maxStates, onProgress: opts.onProgress });
    const { N, startIndex, states } = c;
    const hits = Int32Array.from(states, (s, k) => (k === 0 ? nB : c.progress(c.reqs[0], s)));
    const st = makeStepper(c);
    const wE = reqs.map((_, i) => st.weights(Float64Array.from(hits, (h) => E[i][h])));
    const wG = st.weights(Float64Array.from(hits, (h) => 1 - G[h]));
    let sink = startIndex === 0 ? 1 : 0;
    const record = (t) => {
      for (let i = 0; i < reqs.length; i++) expectedByPull[i][t] = st.dot(wE[i]) + sink * E[i][nB];
      goalByPull[t] = st.dot(wG) + sink * (1 - G[nB]);
    };
    record(0);
    for (let t = 1; t <= B; t++) {
      if (opts.onProgress && (t & 15) === 0) opts.onProgress({ phase: "budget", t, total: B });
      sink += st.step();
      record(t);
    }
    st.close();
    const bc = st.cur;
    for (let i = 0; i < reqs.length; i++) {
      if (sink) addD(i, sink, nB);
      for (let k = 1; k < N; k++) if (bc[k]) addD(i, bc[k], hits[k]);
    }
  }
  return {
    pulls: B,
    chanceGoal: goalByPull[B],
    goalByPull,
    requirements: reqs.map((r, i) => {
      const target = r.type === "distinct" ? r.k : r.copies;
      let chanceMet = 0;
      for (let v = target; v <= r.max; v++) chanceMet += dist[i][v];
      return {
        label: plan.labels[i],
        type: r.type, copies: r.copies,
        unit: r.type === "distinct" ? `items with ≥${r.copies} copies` : "copies",
        target, dist: dist[i], mean: expectedByPull[i][B], chanceMet, expectedByPull: expectedByPull[i],
      };
    }),
  };
}

// "I have B pulls, what will I get?" — the chain without stopping at the goal,
// run for B pulls; reports each requirement's progress distribution.
function budgetReport(tree, goal, opts, B) {
  if (!(Number.isInteger(B) && B >= 0)) throw new Error("budget must be a whole number of pulls ≥ 0");
  const c = compile(tree, goal, { ...opts, absorb: false });
  const { N, states, reqs } = c;
  const prog = reqs.map((r) => Int32Array.from(states, (s, k) => (k === 0 ? 0 : c.progress(r, s))));
  const expectedByPull = reqs.map(() => new Float64Array(B + 1));
  const goalByPull = new Float64Array(B + 1);

  const st = makeStepper(c);
  const wProg = prog.map((p) => st.weights(Float64Array.from(p)));
  const wDone = st.weights(Float64Array.from(states, (s, k) => (k > 0 && c.isDone(s) ? 1 : 0)));
  const record = (t) => {
    for (let r = 0; r < reqs.length; r++) expectedByPull[r][t] = st.dot(wProg[r]);
    goalByPull[t] = st.dot(wDone);
  };
  record(0);
  for (let t = 1; t <= B; t++) {
    if (opts.onProgress && (t & 15) === 0) opts.onProgress({ phase: "budget", t, total: B });
    st.step();
    record(t);
  }
  st.close();
  const cur = st.cur;
  return {
    pulls: B,
    chanceGoal: goalByPull[B],          // P(goal met after B pulls)
    goalByPull,                         // chart: same, for every pull 0..B
    requirements: reqs.map((r, i) => {
      const dist = new Float64Array(r.max + 1); // dist[v] = P(progress = v); top value = "v or more"
      for (let k = 1; k < N; k++) dist[Math.min(prog[i][k], r.max)] += cur[k];
      const target = r.type === "distinct" ? r.k : r.copies;
      let chanceMet = 0;
      for (let v = target; v <= r.max; v++) chanceMet += dist[v];
      return {
        label: r.label,
        type: r.type, copies: r.copies,
        unit: r.type === "distinct" ? `items with ≥${r.copies} copies` : "copies",
        target,
        dist,
        mean: expectedByPull[i][B],
        chanceMet,
        expectedByPull: expectedByPull[i], // chart: expected progress after t pulls
      };
    }),
  };
}

// Budget report only ("what will I get with B pulls"), without the pulls-to-goal part.
export function budgetOnly({ tree, goal, goalMode = "all", start = {}, budget, eps = 1e-13, maxStates = 1e6, method = "auto", onProgress = null }) {
  const { layered, split, opts, tree: exTree, goal: exGoal, orig } = choosePlan({ tree, goal, goalMode, start, eps, maxStates, method, onProgress });
  if (layered) return budgetLayered(layered, budget);
  if (split) return budgetSplit(orig.tree, split, { ...opts, start: orig.start }, budget);
  return budgetReport(exTree, exGoal, opts, budget);
}
