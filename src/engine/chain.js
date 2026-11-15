// The finite Markov chain of a banner (and goal): building it, merging states that behave
// alike, the exact worst case, and small helpers for stepping it.
import { DEFAULT_MAX_STATES, LUMPING_TOLERANCE, MAX_GAP } from "./settings.js";
import { EngineError, internalError } from "./errors.js";
import { parseGoal } from "./goal.js";
import { findAlt, findNode, isPrefix, leavesUnder, normaliseNode, resolvePath } from "./tree.js";

// State = small ints: pity counters, streak memories, goal totals, and for pools
// that need per-item tracking a histogram "how many items have 0,1,2,… copies"
// (identical items are interchangeable, so only the histogram matters).
// trackHits: list of paths. Instead of a goal, every transition is labelled with which of
// these outcomes (1, 2, …) the pull reached, or 0 for none. Used by the layered method.
export function compile(treeRaw, goalRaw, { start: startRaw = {}, goalMode = "all", absorb = true, maxStates = DEFAULT_MAX_STATES, onProgress = null, trackHits = null } = {}) {
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
      if (!a) throw internalError(`trackHits: no alternative "${spec}"`);
      a.hitLabel = g + 1;
    });
  }
  if (goalMode !== "all" && goalMode !== "any") throw internalError(`goalMode must be "all" or "any"`);

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
    if (!a) throw internalError(`start.pity: no alternative "${spec}"`);
    if (a.cv >= 0) start[a.cv] = Math.min(Math.max(0, val | 0), a.cap);
  }
  for (const [spec, [last, run]] of Object.entries(startRaw.streak ?? {})) {
    const node = findNode(root, resolvePath(root, spec));
    if (!node || !node.streak) throw internalError(`start.streak: no streak node "${spec}"`);
    const r = Math.min(Math.max(0, run | 0), node.streak);
    start[node.sv] = r === 0 ? 0 : (last + 1) * (node.streak + 1) + r;
  }
  const ownedPaths = Object.keys(startRaw.owned ?? {}).map((k) => [k, resolvePath(root, k)]);
  for (const [k1, p1] of ownedPaths)
    for (const [k2, p2] of ownedPaths)
      if (k1 !== k2 && isPrefix(p1, p2)) throw internalError(`start.owned: "${k2}" is inside "${k1}"`);
  for (const [spec, path] of ownedPaths) {
    const val = startRaw.owned[spec];
    const alt = path.length ? findAlt(root, path) : null;
    if (path.length && !alt) throw internalError(`start.owned: no alternative "${spec}"`);
    let items = null, total;
    if (Array.isArray(val)) {
      if (!alt || alt.child) throw internalError(`start.owned: per-item counts need a single item or pool, not "${spec}"`);
      if (val.length > alt.count) throw internalError(`start.owned: "${spec}" has only ${alt.count} items`);
      items = val.map((x) => Math.max(0, x | 0));
      total = items.reduce((a, b) => a + b, 0);
    } else {
      total = Math.max(0, val | 0);
      if (alt && !alt.child && alt.icap) {
        if (alt.count > 1) throw internalError(`start.owned: give per-item counts for pool "${spec}" as an array`);
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
          if (j > maxStates) throw new EngineError("tooBigStates", { limit: maxStates }, `Too big: over ${maxStates} states. Try fewer copies, fewer tracked items, or a higher maxStates.`);
        }
      }
      const key = j * 8 + lab; // target and label in one key
      merged.set(key, (merged.get(key) ?? 0) + p);
    }
    rows.push(merged);
  }
  if (absorb && states.length > 1 && !rows.some((r, k) => k > 0 && r.has(0)))
    throw new EngineError("unreachable", {}, "The goal can't be reached with this banner");

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
export function projectOut(states, rows, x, tol = LUMPING_TOLERANCE) {
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
export function worstCase({ N, rowStart, col }, startIndex) {
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
export function pack(states, rows) {
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
export function advance(cur, next, N, rowStart, col, prob) {
  next.fill(0);
  for (let k = 1; k < N; k++) {
    const m = cur[k];
    if (m === 0) continue;
    for (let e = rowStart[k], end = rowStart[k + 1]; e < end; e++) next[col[e]] += m * prob[e];
  }
}

// Distribution of pulls until the first labelled transition, from a given state
export function firstHitPmf(c, from, cut) {
  const pmf = [0];
  let cur = new Float64Array(c.N), next = new Float64Array(c.N);
  cur[from] = 1;
  let left = 1;
  for (let t = 1; left > cut && t < MAX_GAP; t++) {
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
