// The finite Markov chain of a banner (and goal): building it, merging states that behave
// alike, the exact worst case, and small helpers for stepping it.
import { stopIfCancelled } from "./cancel.js";
import { DEFAULT_MAX_STATES, LUMPING_TOLERANCE, MAX_GAP } from "./settings.js";
import { EngineError, internalError } from "./errors.js";
import { parseGoal } from "./goal.js";
import { findAlt, findNode, isPrefix, leavesUnder, normaliseNode, pathKey, resolvePath } from "./tree.js";

// State = small ints: pity counters, streak memories, goal totals, and for pools
// that need per-item tracking a histogram "how many items have 0,1,2,… copies"
// (identical items are interchangeable, so only the histogram matters).
// trackHits: list of paths. Instead of a goal, every transition is labelled with which of
// these outcomes (1, 2, …) the pull reached, or 0 for none. Used by the layered method.
// keepEnd (for banners stacked in one plan, see staged.js): instead of one "goal reached" sink, a
// separate end state for every combination of pity counters and memory the banner can be in when
// the goal is met. End states have no way out, so the mass that reaches one shows up in the
// stepper's vector for exactly one pull; ends[] says where each one is and its counters as a start.
export function compile(treeRaw, goalRaw, { start: startRaw = {}, goalMode = "all", absorb = true, keepEnd = false, maxStates = DEFAULT_MAX_STATES, onProgress = null, trackHits = null } = {}) {
  const root = normaliseNode(treeRaw, []);
  let nVars = 0;
  const newVar = () => nVars++;

  // the banner's own memory: pity counters and streak rules, with where they are in the tree
  const carry = [];
  (function assign(node, path) {
    if (node.streak > 0) { // value = (last+1)*(streak+1) + run
      node.sv = newVar();
      carry.push({ v: node.sv, kind: "streak", key: pathKey(path), n1: node.streak + 1 });
    }
    for (const [ai, a] of node.alts.entries()) {
      if (a.pity || a.soft) {
        a.cv = newVar();
        carry.push({ v: a.cv, kind: "pity", key: pathKey([...path, ai]) });
        let cap = a.pity || Infinity;
        if (a.soft) cap = Math.min(cap, a.soft.start - 1 + Math.ceil((1 - a.p) / a.soft.step));
        a.cap = Math.max(1, cap);
        if (a.pityResetBy === "above") node.resetBelow = true;
        if (a.pity && a.onPreempt === "lose") node.losesDue = true;
      }
      if (a.child) assign(a.child, [...path, ai]);
    }
  })(root, []);

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
        // outcomes listed below this one: counters that also restart on anything above them,
        // and guarantees that were due this pull but got taken by this outcome ("lose")
        if (node.resetBelow || node.losesDue) {
          for (let j = i + 1; j < node.alts.length; j++) {
            const b = node.alts[j];
            if (b.cv < 0) continue;
            if (b.pityResetBy === "above" || (b.onPreempt === "lose" && b.pity && s[b.cv] >= b.pity)) t[b.cv] = 0;
          }
        }
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
  // States are kept packed (StateStore) and transitions go straight into CSR arrays (RowBuilder):
  // about 8× less memory than one array, one text key and one Map per state. Same arithmetic in
  // the same order as before, so results are identical.
  const done = absorb ? isDone : () => false;
  const store = new StateStore(nVars);
  const rows = new RowBuilder();
  // keepEnd: an end state holds only the banner's memory; every other counter is -1, so it can't
  // be mistaken for a state still on its way to the goal
  const ends = [], endAt = new Set();
  const endOf = (t) => {
    const e = new Int32Array(nVars).fill(-1);
    for (const c of carry) e[c.v] = t[c.v];
    let j = store.find(e);
    if (j < 0) { j = store.add(e); endAt.add(j); ends.push({ index: j, vec: e }); }
    return j;
  };
  if (!done(start)) store.add(Int32Array.from(start));
  if (onProgress) onProgress({ phase: "build", states: store.n });
  let reachesSink = false;
  const merged = new Map();
  for (let k = 1; k < store.n; k++) {
    if ((k & 2047) === 0) {
      stopIfCancelled();
      if (onProgress) onProgress({ phase: "build", states: store.n });
    }
    merged.clear();
    if (endAt.has(k)) { rows.addRow(k, merged); continue; } // an end state: no way out
    for (const [p, t, lab] of step(store.view(k))) {
      let j = 0;
      if (keepEnd && done(t)) j = endOf(t);
      else if (!done(t)) {
        j = store.find(t);
        if (j < 0) {
          j = store.add(t);
          if (j > maxStates) throw new EngineError("tooBigStates", { limit: maxStates }, `Too big: over ${maxStates} states. Try fewer copies, fewer tracked items, or a higher maxStates.`);
        }
      }
      const key = j * 8 + lab; // target and label in one key
      merged.set(key, (merged.get(key) ?? 0) + p);
    }
    if (merged.has(0) || (keepEnd && ends.length)) reachesSink = true;
    rows.addRow(k, merged);
  }
  if (absorb && store.n > 1 && !reachesSink)
    throw new EngineError("unreachable", {}, "The goal can't be reached with this banner");
  const fullStates = store.n - 1;

  // Exact reduction: drop pity/streak variables that can't change the result
  const candidates = [];
  (function collect(node) {
    if (node.streak) candidates.push(node.sv);
    for (const a of node.alts) {
      if (a.cv >= 0) candidates.push(a.cv);
      if (a.child) collect(a.child);
    }
  })(root);
  let startIndex = store.n > 1 ? 1 : 0;
  if (onProgress) onProgress({ phase: "reduce", states: store.n });
  // (with keepEnd every counter of the banner's memory is wanted at the end: no reduction)
  let st = store, csr = rows.finish(store.n), progressMade = !keepEnd;
  const dropped = new Set();
  while (progressMade) {
    progressMade = false;
    for (const x of candidates) {
      if (dropped.has(x)) continue;
      const res = projectOut(st, csr, x);
      if (res) {
        st = res.store; csr = res.csr; startIndex = res.group[startIndex];
        dropped.add(x); progressMade = true;
      }
    }
  }
  return {
    ...csr, startIndex, fullStates,
    stateAt: (k) => st.view(k), // the counters of state k (k ≥ 1), for progress() and isDone()
    memoryBytes: st.data.byteLength + st.table.byteLength, // the stored states (for the cache)
    worst: absorb ? worstCase(csr, startIndex) : null,
    best: absorb ? bestCase(csr, startIndex) : null,
    reqs, progress, isDone, goalMode,
    // keepEnd: the end states, each with its counters as a start for the next banner; startEnd
    // is the start's own counters (for a goal already met before any pull)
    ends: keepEnd ? ends.map((e) => ({ index: e.index, start: memoryAsStart(carry, e.vec) })) : null,
    startEnd: keepEnd ? memoryAsStart(carry, start) : null,
  };
}

// Pity counters and streak memory from a state's counters, in the form solve() takes as start
function memoryAsStart(carry, vec) {
  const out = { pity: {}, streak: {} };
  for (const c of carry) {
    const v = vec[c.v];
    if (c.kind === "pity") { if (v > 0) out.pity[c.key] = v; continue; }
    if (v > 0) out.streak[c.key] = [Math.floor(v / c.n1) - 1, v % c.n1];
  }
  return out;
}

// States as rows of one growing Int32Array, found through an open-addressing hash table.
// Index 0 is the sink (no counters); states are 1, 2, …
export class StateStore {
  constructor(nVars) {
    this.nv = Math.max(1, nVars);
    this.n = 1;
    this.data = new Int32Array(this.nv * 1024);
    this.table = new Int32Array(2048).fill(-1);
    this.mask = 2047;
  }
  hash(t) {
    let h = 0x811c9dc5;
    for (let i = 0; i < this.nv; i++) { h ^= t[i] | 0; h = Math.imul(h, 0x01000193); }
    h ^= h >>> 15;
    return Math.imul(h, 0x2c1b3c6d) >>> 0;
  }
  same(k, t) {
    const d = this.data, o = k * this.nv;
    for (let i = 0; i < this.nv; i++) if (d[o + i] !== (t[i] | 0)) return false;
    return true;
  }
  find(t) {
    let slot = this.hash(t) & this.mask;
    for (;;) {
      const k = this.table[slot];
      if (k < 0) return -1;
      if (this.same(k, t)) return k;
      slot = (slot + 1) & this.mask;
    }
  }
  add(t) {
    const k = this.n++;
    if ((k + 1) * this.nv > this.data.length) { const d = new Int32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    this.data.set(t.length === this.nv ? t : Int32Array.from({ length: this.nv }, (_, i) => t[i] | 0), k * this.nv);
    if (2 * this.n > this.table.length) this.rehash(this.table.length * 2);
    let slot = this.hash(t) & this.mask;
    while (this.table[slot] >= 0) slot = (slot + 1) & this.mask;
    this.table[slot] = k;
    return k;
  }
  rehash(size) {
    this.table = new Int32Array(size).fill(-1);
    this.mask = size - 1;
    for (let k = 1; k < this.n; k++) {
      let slot = this.hash(this.view(k)) & this.mask;
      while (this.table[slot] >= 0) slot = (slot + 1) & this.mask;
      this.table[slot] = k;
    }
  }
  view(k) { return this.data.subarray(k * this.nv, (k + 1) * this.nv); }
}

// Transitions written row by row (in BFS order) into growing CSR arrays. A row is given as a Map
// key → probability with key = target·8 + label, in the order its entries were first reached.
export class RowBuilder {
  constructor() {
    this.rowStart = new Int32Array(1024);
    this.col = new Int32Array(4096); this.prob = new Float64Array(4096); this.lab = new Uint8Array(4096);
    this.e = 0;
  }
  addRow(k, m) {
    if (k + 2 > this.rowStart.length) { const r = new Int32Array(this.rowStart.length * 2); r.set(this.rowStart); this.rowStart = r; }
    if (this.e + m.size > this.col.length) {
      const size = Math.max(this.col.length * 2, this.e + m.size);
      const c = new Int32Array(size), p = new Float64Array(size), l = new Uint8Array(size);
      c.set(this.col); p.set(this.prob); l.set(this.lab);
      this.col = c; this.prob = p; this.lab = l;
    }
    this.rowStart[k] = this.e;
    for (const [key, p] of m) { this.col[this.e] = key >> 3; this.lab[this.e] = key & 7; this.prob[this.e] = p; this.e++; }
    this.rowStart[k + 1] = this.e;
  }
  finish(N) {
    const e = this.e;
    const rowStart = new Int32Array(N + 1);
    rowStart.set(this.rowStart.subarray(0, N + 1));
    rowStart[N] = e;
    // views, not copies: no second copy of every transition at the peak
    return { N, rowStart, col: this.col.subarray(0, e), prob: this.prob.subarray(0, e), lab: this.lab.subarray(0, e) };
  }
}

// Merge states that differ only in variable x, if that is exact: every merged
// state must have identical probabilities into every merged group.
export function projectOut(store, csr, x, tol = LUMPING_TOLERANCE) {
  const N = store.n;
  const group = new Int32Array(N);
  const next = new StateStore(store.nv), reps = [0];
  for (let k = 1; k < N; k++) {
    const t = store.view(k).slice();
    t[x] = 0;
    let g = next.find(t);
    if (g < 0) { g = next.add(t); reps.push(k); }
    group[k] = g;
  }
  if (next.n === N) return null;
  const { rowStart, col, prob, lab } = csr;
  const mergeRow = (k) => {
    const m = new Map();
    for (let e = rowStart[k]; e < rowStart[k + 1]; e++) { const g = group[col[e]] * 8 + lab[e]; m.set(g, (m.get(g) ?? 0) + prob[e]); }
    return m;
  };
  const rows = new RowBuilder();
  for (let g = 1; g < next.n; g++) rows.addRow(g, mergeRow(reps[g]));
  const merged = rows.finish(next.n);
  const rowOf = (g) => {
    const m = new Map();
    for (let e = merged.rowStart[g]; e < merged.rowStart[g + 1]; e++) m.set(merged.col[e] * 8 + merged.lab[e], merged.prob[e]);
    return m;
  };
  for (let k = 1; k < N; k++) {
    const a = mergeRow(k), b = rowOf(group[k]);
    for (const [g, p] of a) if (Math.abs(p - (b.get(g) ?? 0)) > tol) return null;
    for (const [g, p] of b) if (!a.has(g) && p > tol) return null;
  }
  return { store: next, csr: merged, group };
}

// Exact worst case: the most pulls the goal can possibly take. It exists only when no
// state can repeat (the graph of unfinished states has no cycle); then it is the longest
// path from the start to the goal. Returns null when there is no guarantee.
// Exact best case: the fewest pulls that can reach the goal (shortest path to the sink),
// null if it can't be reached
export function bestCase({ N, rowStart, col }, startIndex) {
  if (startIndex === 0) return 0;
  const dist = new Int32Array(N).fill(-1);
  dist[startIndex] = 0;
  const queue = [startIndex];
  for (let i = 0; i < queue.length; i++) {
    const k = queue[i];
    for (let e = rowStart[k]; e < rowStart[k + 1]; e++) {
      const j = col[e];
      if (j === 0) return dist[k] + 1;
      if (dist[j] < 0) { dist[j] = dist[k] + 1; queue.push(j); }
    }
  }
  return null;
}

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
// Like firstHitPmf, split by the state the event lands in: out[j][t] = P(first event at pull t
// and it lands in entry j), where entryOf[state] = j (−1 for states events never land in).
export function firstHitsByEntry(c, from, entryOf, J, cut) {
  const out = Array.from({ length: J }, () => [0]);
  let cur = new Float64Array(c.N), next = new Float64Array(c.N);
  cur[from] = 1;
  let left = 1;
  const hit = new Float64Array(J);
  for (let t = 1; left > cut && t < MAX_GAP; t++) {
    if ((t & 1023) === 0) stopIfCancelled();
    next.fill(0); hit.fill(0);
    for (let k = 1; k < c.N; k++) {
      const m = cur[k];
      if (!m) continue;
      for (let e = c.rowStart[k]; e < c.rowStart[k + 1]; e++) {
        if (c.lab[e]) hit[entryOf[c.col[e]]] += m * c.prob[e]; else next[c.col[e]] += m * c.prob[e];
      }
    }
    for (let j = 0; j < J; j++) out[j].push(hit[j]);
    left = 0;
    for (let k = 1; k < c.N; k++) left += next[k];
    [cur, next] = [next, cur];
  }
  return out;
}

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
