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
    const path = resolvePath(root, g.path);
    const shown = g.path === undefined || g.path === "" ? "everything" : String(g.path);
    if (path.length && !findAlt(root, path)) throw new Error(`Goal path "${shown}" not in tree`);
    const copies = g.copies ?? 1;
    if (!isPosInt(copies)) throw new Error(`copies for "${shown}" must be a positive integer`);
    let type = g.type ?? "total";
    if (type === "specific") {
      const alt = findAlt(root, path);
      if (!alt || alt.child)
        throw new Error(`"specific" needs a single item or a pool (count), not "${shown}"`);
      if (alt.count === 1) return { type: "total", path, copies, label: g.label ?? `${shown} ×${copies}` };
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
      const groups = leavesUnder(root, path);
      const items = groups.reduce((s, a) => s + a.count, 0);
      if (k > items) throw new Error(`"${shown}" has only ${items} items, can't get ${k} different`);
      return { type, path, copies, k, groups, items,
               label: g.label ?? `${k} different of ${shown}, ×${copies} each` };
    }
    if (type !== "total") throw new Error(`Unknown goal type "${type}"`);
    return { type, path, copies, label: g.label ?? `${shown} ×${copies}` };
  });
}

// ── Build the finite Markov chain ────────────────────────────────────────────
// State = small ints: pity counters, streak memories, goal totals, and for pools
// that need per-item tracking a histogram "how many items have 0,1,2,… copies"
// (identical items are interchangeable, so only the histogram matters).
export function compile(treeRaw, goalRaw, { start: startRaw = {}, goalMode = "all", absorb = true, maxStates = 1e6, onProgress = null } = {}) {
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

  const reqs = parseGoal(root, goalRaw);
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
    for (const a of leavesUnder(root, r.path)) a.sumReqs.push(r);
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
      if (r.type === "total" && isPrefix(r.path, path)) start[r.v] = Math.min(start[r.v] + total, r.copies);
  }

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
    (function walk(node, s, prob) {
      for (const a of node.alts) if (a.cv >= 0) s[a.cv] = Math.min(s[a.cv] + 1, a.cap);
      const pr = probsAt(node, s);
      for (let i = 0; i < node.alts.length; i++) {
        if (!(pr[i] > 0)) continue;
        const a = node.alts[i], p = prob * pr[i];
        const t = s.slice();
        if (a.cv >= 0) t[a.cv] = 0;
        if (node.streak) {
          const n1 = node.streak + 1, v = t[node.sv];
          const last = Math.floor(v / n1) - 1, run = v % n1;
          t[node.sv] = (i + 1) * n1 + (last === i ? Math.min(run + 1, node.streak) : 1);
        }
        if (a.child) { walk(a.child, t, p); continue; }
        for (const r of a.sumReqs) t[r.v] = Math.min(t[r.v] + 1, r.copies);
        if (!a.icap) { out.push([p, t]); continue; }
        // Which item of the pool: one of the named ones, or one of the others by copy count
        const n = a.count;
        for (const x of a.specs) {
          const u = t.slice();
          u[x.v] = Math.min(u[x.v] + 1, x.cap);
          out.push([p / n, u]);
        }
        if (!a.h.length) { if (a.m > 0) out.push([(p * a.m) / n, t]); continue; }
        for (let j = 0; j < a.h.length; j++) {
          const cnt = t[a.h[j]];
          if (!cnt) continue;
          const u = t.slice();
          u[a.h[j]]--;
          u[a.h[Math.min(j + 1, a.hcap)]]++;
          out.push([(p * cnt) / n, u]);
        }
      }
    })(root, s0.slice(), 1);
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
    for (const [p, t] of step(states[k])) {
      let j = 0;
      if (!done(t)) {
        const key = t.join(",");
        j = index.get(key);
        if (j === undefined) {
          j = states.length; index.set(key, j); states.push(t);
          if (j > maxStates) throw new Error(`Too big: over ${maxStates} states. Try fewer copies, fewer tracked items, or a higher maxStates.`);
        }
      }
      merged.set(j, (merged.get(j) ?? 0) + p);
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
    for (const [j, p] of rows[k]) { const g = group[j]; m.set(g, (m.get(g) ?? 0) + p); }
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
  const rowStart = new Int32Array(N + 1), col = new Int32Array(nnz), prob = new Float64Array(nnz);
  let e = 0;
  for (let k = 1; k < N; k++) {
    rowStart[k] = e;
    for (const [j, p] of rows[k]) { col[e] = j; prob[e] = p; e++; }
  }
  rowStart[N] = e;
  return { N, rowStart, col, prob };
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

// ── Solve ─────────────────────────────────────────────────────────────────────
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
  const opts = { start, goalMode, maxStates, onProgress };
  const split = method === "joint" ? null : planSplit(tree, goal, opts, eps, method === "split");
  if (method === "split" && !split) throw new Error(`method "split" needs all requirements on one pool`);

  let res;
  if (split) res = solveSplit(tree, split, opts, eps, maxPulls);
  else {
    const c = compile(tree, goal, opts);
    const { N, rowStart, col, prob, startIndex } = c;
    const pmf = [startIndex === 0 ? 1 : 0];
    const survival = [startIndex === 0 ? 0 : 1];
    let cur = new Float64Array(N), next = new Float64Array(N);
    cur[startIndex] = 1;
    let t = 0, remaining = survival[0];
    while (remaining > 0 && remaining >= eps && t < maxPulls) {
      if (onProgress && (t & 15) === 0) onProgress({ phase: "calc", t, remaining, eps });
      advance(cur, next, N, rowStart, col, prob);
      t++;
      pmf.push(next[0]);
      next[0] = 0;
      remaining = 0;
      for (let k = 1; k < N; k++) remaining += next[k];
      survival.push(remaining);
      [cur, next] = [next, cur];
    }
    res = { pmf, survival, labels: c.reqs.map((r) => r.label), states: N - 1, fullStates: c.fullStates, worst: c.worst };
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
      : split ? budgetSplit(tree, split, opts, budget)
      : budgetReport(tree, goal, opts, budget),
    method: split ? "split" : "joint",
    states: res.states,
    statesBeforeReduction: res.fullStates,
    ms: now() - t0,
  };
}

// ── Split method ─────────────────────────────────────────────────────────────
// When every requirement is about items of one pool, which item a pull gives never
// affects the banner (pity, streaks). So: (a) work out, on a tiny chain, the chance
// the goal is met after n hits on the pool; (b) work out, on the banner chain, the
// distribution of how many hits the pool has after t pulls; combine. Exact; used
// when it needs fewer states than tracking everything together.
function planSplit(tree, goal, opts, eps, force) {
  const root = normaliseNode(tree, []);
  const reqs = parseGoal(root, goal);
  if (!reqs.every((r) => r.type === "specific" || (r.type === "distinct" && r.groups.length === 1))) return null;
  const pools = new Set(reqs.map((r) => pathKey(r.type === "specific" ? r.group.path : r.groups[0].path)));
  if (pools.size !== 1) return null;
  const poolPath = [...pools][0].split(",").map(Number);
  const pool = findAlt(root, poolPath);

  const miniTree = [{ p: 1, count: pool.count }];
  const miniGoal = reqs.map((r) => ({ path: "0", type: r.type, item: r.item, copies: r.copies, k: r.k, label: r.label }));
  const owned = Object.entries(opts.start.owned ?? {}).find(([k]) => pathKey(resolvePath(root, k)) === pathKey(poolPath));
  const miniOpts = { goalMode: opts.goalMode, maxStates: opts.maxStates, start: owned ? { owned: { "0": owned[1] } } : {} };

  // F[n] = P(goal met after n hits on the pool)
  const mc = compile(miniTree, miniGoal, miniOpts);
  const F = [mc.startIndex === 0 ? 1 : 0];
  let cur = new Float64Array(mc.N), next = new Float64Array(mc.N), miss = 1 - F[0];
  cur[mc.startIndex] = 1;
  while (miss > 0 && miss >= eps / 10 && F.length < 1e5) {
    advance(cur, next, mc.N, mc.rowStart, mc.col, mc.prob);
    next[0] = 0;
    miss = 0;
    for (let k = 1; k < mc.N; k++) miss += next[k];
    F.push(1 - miss);
    [cur, next] = [next, cur];
  }
  const nMax = F.length - 1;
  const itemsGuaranteed = worstCase(mc, mc.startIndex) != null;
  if (!force && nMax >= mc.N - 1) return null; // tracking items directly is smaller
  return { reqs, poolPath, nMax, F, itemsGuaranteed, miniTree, miniGoal, miniOpts, labels: reqs.map((r) => r.label) };
}

function solveSplit(tree, plan, opts, eps, maxPulls) {
  const { nMax, F, poolPath } = plan;
  const bannerStart = { pity: opts.start.pity, streak: opts.start.streak };
  if (nMax === 0) return { pmf: [1], survival: [0], labels: plan.labels, states: 0, fullStates: 0, worst: 0 };
  // Banner chain counting hits on the pool, up to nMax (state 0 = "nMax or more")
  const c = compile(tree, [{ path: poolPath, copies: nMax }], { start: bannerStart, maxStates: opts.maxStates, onProgress: opts.onProgress });
  const { N, rowStart, col, prob, startIndex, states } = c;
  const miss = Float64Array.from(states, (s, k) => (k === 0 ? 1 - F[nMax] : 1 - F[c.progress(c.reqs[0], s)]));
  let cur = new Float64Array(N), next = new Float64Array(N);
  cur[startIndex] = 1;
  let sink = startIndex === 0 ? 1 : 0;
  const S = () => { let m = sink * miss[0]; for (let k = 1; k < N; k++) if (cur[k]) m += cur[k] * miss[k]; return m; };
  const survival = [S()], pmf = [1 - survival[0]];
  let t = 0, remaining = survival[0];
  while (remaining > 0 && remaining >= eps && t < maxPulls) {
    if (opts.onProgress && (t & 15) === 0) opts.onProgress({ phase: "calc", t, remaining, eps });
    advance(cur, next, N, rowStart, col, prob);
    sink += next[0];
    next[0] = 0;
    [cur, next] = [next, cur];
    t++;
    remaining = S();
    pmf.push(survival[t - 1] - remaining);
    survival.push(remaining);
  }
  // Guaranteed only if the item part is (then nMax is exactly the most hits ever needed)
  return { pmf, survival, labels: plan.labels, states: N - 1 + (plan.F.length), fullStates: c.fullStates, worst: plan.itemsGuaranteed ? c.worst : null };
}

function budgetSplit(tree, plan, opts, B) {
  if (!(Number.isInteger(B) && B >= 0)) throw new Error("budget must be a whole number of pulls ≥ 0");
  // Per number of hits n: each requirement's progress distribution and the goal chance
  const mc = compile(plan.miniTree, plan.miniGoal, { ...plan.miniOpts, absorb: false });
  const reqs = mc.reqs;
  const prog = reqs.map((r) => Int32Array.from(mc.states, (s, k) => (k === 0 ? 0 : mc.progress(r, s))));
  const maxed = Uint8Array.from(mc.states, (s, k) => (k > 0 && reqs.every((r, i) => prog[i][k] >= r.max) ? 1 : 0));
  const doneAt = Uint8Array.from(mc.states, (s, k) => (k > 0 && mc.isDone(s) ? 1 : 0));
  const D = reqs.map(() => []), E = reqs.map(() => []), G = [];
  let cur = new Float64Array(mc.N), next = new Float64Array(mc.N);
  cur[mc.startIndex] = 1;
  for (let n = 0; ; n++) {
    let full = 0, g = 0;
    reqs.forEach((r, i) => {
      const d = new Float64Array(r.max + 1);
      let e = 0;
      for (let k = 1; k < mc.N; k++) if (cur[k]) { d[prog[i][k]] += cur[k]; e += cur[k] * prog[i][k]; }
      D[i].push(d); E[i].push(e);
    });
    for (let k = 1; k < mc.N; k++) if (cur[k]) { if (maxed[k]) full += cur[k]; if (doneAt[k]) g += cur[k]; }
    G.push(g);
    if (full >= 1 - 1e-12 || n >= 1e5) break;
    advance(cur, next, mc.N, mc.rowStart, mc.col, mc.prob);
    [cur, next] = [next, cur];
  }
  const nB = G.length - 1;

  // Banner chain: distribution of hits on the pool for every pull 0..B
  const bannerStart = { pity: opts.start.pity, streak: opts.start.streak };
  const expectedByPull = reqs.map(() => new Float64Array(B + 1));
  const goalByPull = new Float64Array(B + 1);
  const dist = reqs.map((r) => new Float64Array(r.max + 1));
  if (nB === 0) {
    reqs.forEach((r, i) => { expectedByPull[i].fill(E[i][0]); dist[i].set(D[i][0]); });
    goalByPull.fill(G[0]);
  } else {
    const c = compile(tree, [{ path: plan.poolPath, copies: nB }], { start: bannerStart, maxStates: opts.maxStates, onProgress: opts.onProgress });
    const { N, rowStart, col, prob, startIndex, states } = c;
    const hits = Int32Array.from(states, (s, k) => (k === 0 ? nB : c.progress(c.reqs[0], s)));
    let bc = new Float64Array(N), bn = new Float64Array(N), sink = startIndex === 0 ? 1 : 0;
    bc[startIndex] = 1;
    const record = (t) => {
      const add = (m, h) => {
        for (let i = 0; i < reqs.length; i++) expectedByPull[i][t] += m * E[i][h];
        goalByPull[t] += m * G[h];
      };
      if (sink) add(sink, nB);
      for (let k = 1; k < N; k++) if (bc[k]) add(bc[k], hits[k]);
    };
    record(0);
    for (let t = 1; t <= B; t++) {
      if (opts.onProgress && (t & 15) === 0) opts.onProgress({ phase: "budget", t, total: B });
      advance(bc, bn, N, rowStart, col, prob);
      sink += bn[0];
      bn[0] = 0;
      [bc, bn] = [bn, bc];
      record(t);
    }
    for (let i = 0; i < reqs.length; i++) {
      const addD = (m, h) => { const d = D[i][h]; for (let v = 0; v < d.length; v++) dist[i][v] += m * d[v]; };
      if (sink) addD(sink, nB);
      for (let k = 1; k < N; k++) if (bc[k]) addD(bc[k], hits[k]);
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
        label: r.label,
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
  const { N, rowStart, col, prob, startIndex, states, reqs } = c;
  const prog = reqs.map((r) => Int32Array.from(states, (s, k) => (k === 0 ? 0 : c.progress(r, s))));
  const doneAt = Uint8Array.from(states, (s, k) => (k > 0 && c.isDone(s) ? 1 : 0));
  const expectedByPull = reqs.map(() => new Float64Array(B + 1));
  const goalByPull = new Float64Array(B + 1);

  let cur = new Float64Array(N), next = new Float64Array(N);
  cur[startIndex] = 1;
  const record = (t) => {
    for (let k = 1; k < N; k++) {
      const m = cur[k];
      if (m === 0) continue;
      for (let r = 0; r < reqs.length; r++) expectedByPull[r][t] += m * prog[r][k];
      if (doneAt[k]) goalByPull[t] += m;
    }
  };
  record(0);
  for (let t = 1; t <= B; t++) {
    if (opts.onProgress && (t & 15) === 0) opts.onProgress({ phase: "budget", t, total: B });
    advance(cur, next, N, rowStart, col, prob);
    [cur, next] = [next, cur];
    record(t);
  }
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
  const opts = { start, goalMode, maxStates, onProgress };
  const split = method === "joint" ? null : planSplit(tree, goal, opts, eps, method === "split");
  return split ? budgetSplit(tree, split, opts, budget) : budgetReport(tree, goal, opts, budget);
}
