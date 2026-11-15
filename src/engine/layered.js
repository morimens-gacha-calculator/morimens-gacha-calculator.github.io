// ── Layered method ──
// For goals on up to 7 pools or single outcomes under a common "event": e.g. characters and
// wheels that both come from an SSR. Three parts that never influence each other are solved
// separately and combined exactly:
//   items  — which item of a pool a hit gives: the pool formulas (pool-formulas.js) give
//            S_g(n) = P(pool g's rows not met after n hits)
//   events — what each event is (which pool, or neither): the event subtree's own chain
//            (memory rules, inner pity) together with how many hits each pool has had so far
//            (only reachable cells are stored)
//   timing — when events happen: the rest of the banner. If it restarts at every event (like
//            SSR pity), the gaps between events are independent and identically distributed;
//            the number of pulls is a sum of gaps, combined with an FFT (renewal.js).
// The joint state space is never built, so goals needing billions of joint states are cheap.
import { stopIfCancelled } from "./cancel.js";
import { DEFAULT_MAX_STATES, EVENT_CELLS_PER_STATE, MAX_EVENTS, MAX_EVENT_CELLS, MAX_PULL_SPAN, NEGLIGIBLE, TINY_JOINT_CHAIN, eventTolerance, gapTolerance, poolTolerance } from "./settings.js";
import { EngineError } from "./errors.js";
import { cached } from "./cache.js";
import { compile, firstHitPmf } from "./chain.js";
import { MAX_GROUPS, goalList, groupRows, ownedFor, rowsOf } from "./goal.js";
import { addScaled, makeReport } from "./report.js";
import { chainSizeEstimate, poolBudget, poolNotMet } from "./pool-formulas.js";
import { poolChain, poolChainBudget, poolChainNotMet, poolPlanFor } from "./pools.js";
import { curvesByPull, eventsByPull, fft } from "./renewal.js";
import { canonTree, findAlt, nodeAtCanon, normaliseNode, pathKey, resolvePath } from "./tree.js";

export function planLayered(tree, goal, opts, eps, force) {
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
      const gap = firstHitPmf(oc, entry, gapTolerance(eps));
      const gap1 = oc.startIndex === entry ? gap : firstHitPmf(oc, oc.startIndex, gapTolerance(eps));
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
  if (!force && jointEst < TINY_JOINT_CHAIN) return { small: true };

  const tol = poolTolerance(eps);
  const items = pools.map((x, i) => {
    opts.onPlan?.({ done: i, total: pools.length });
    // the last value is below the cut-off: treat it as 0 so capped hit counts count as done
    if (x.formula) {
      const S = cached("poolS", [x.formula, tol], () => Array.from(poolNotMet(x.formula, tol)));
      return { ...x, S: [...S.slice(0, -1), 0], cap: S.length - 1, states: S.length };
    }
    const r = cached("poolChainS", [x.chain, tol], () => poolChainNotMet(x.chain, tol));
    return { ...x, S: [...r.S.slice(0, -1), 0], cap: r.S.length - 1, states: r.states };
  });

  const rows = rowsOf(tree, list, start), labels = rows.map((r) => r.label);
  // what an event is called, for progress messages ("SSR"); none when every pull is an event
  const eventName = pre.length ? (findAlt(root, pre)?.name ?? null) : null;
  return {
    eventName,
    maxStates: opts.maxStates, reqs: list, rows, labels, G, items, ic, pre, goalMode: opts.goalMode,
    gap: timing?.gap ?? null, gap1: timing?.gap1 ?? null, outerStates: timing?.states ?? 0,
  };
}

// Walks the event chain one event at a time, tracking hits per targeted outcome (capped at
// caps[g], where that pool's goal is certain). Only cells that can hold probability are stored:
// after m events the hits add up to at most m, so the live cells are a thin slice of all
// combinations (for Kaleido, where every SSR is a character or a wheel, a line: a + b = m).
// visit(m, cells) after each event count m = 0, 1, …; return false to stop. cells = { n, x, h, p }:
// event state x[i], hits h[i·K + g] on group g, probability p[i].
export function walkEvents(plan, caps, visit) {
  const { ic } = plan;
  const K = caps.length;
  const limit = Math.min(EVENT_CELLS_PER_STATE * (plan.maxStates ?? DEFAULT_MAX_STATES), MAX_EVENT_CELLS);
  let maxDeg = 1;
  for (let x = 1; x < ic.N; x++) maxDeg = Math.max(maxDeg, ic.rowStart[x + 1] - ic.rowStart[x]);
  const cells = (cap) => ({ n: 0, cap, x: new Int32Array(cap), h: new Int32Array(cap * K), p: new Float64Array(cap) });
  const grow = (c) => {
    const d = cells(c.cap * 2);
    d.n = c.n; d.x.set(c.x); d.h.set(c.h); d.p.set(c.p);
    return d;
  };
  let cur = cells(1024), next = cells(1024);
  cur.n = 1; cur.x[0] = ic.startIndex; cur.p[0] = 1;
  let table = new Int32Array(4096), mask = 4095;
  const h2 = new Int32Array(K);
  for (let m = 0; ; m++) {
    stopIfCancelled();
    if (visit(m, cur) === false) return;
    // hash table for merging transitions that land on the same cell (≤ 50% full)
    const bound = cur.n * maxDeg;
    if (table.length < 2 * bound) { let size = table.length; while (size < 2 * bound) size *= 2; table = new Int32Array(size); mask = size - 1; }
    table.fill(-1);
    next.n = 0;
    for (let i = 0; i < cur.n; i++) {
      const p = cur.p[i];
      if (!p) continue;
      const x = cur.x[i], hb = i * K;
      for (let e = ic.rowStart[x]; e < ic.rowStart[x + 1]; e++) {
        const x2 = ic.col[e], l = ic.lab[e];
        let hash = Math.imul(x2 + 1, 0x9e3779b1);
        for (let g = 0; g < K; g++) {
          let v = cur.h[hb + g];
          if (l === g + 1 && v < caps[g]) v++;
          h2[g] = v;
          hash = Math.imul(hash ^ (v + 0x7f4a7c15), 0x85ebca6b);
        }
        hash ^= hash >>> 15;
        let slot = hash & mask, j;
        for (;;) {
          j = table[slot];
          if (j < 0) break;
          if (next.x[j] === x2) {
            let same = true;
            for (let g = 0; g < K; g++) if (next.h[j * K + g] !== h2[g]) { same = false; break; }
            if (same) break;
          }
          slot = (slot + 1) & mask;
        }
        const q = p * ic.prob[e];
        if (j >= 0) { next.p[j] += q; continue; }
        if (next.n === next.cap) next = grow(next);
        j = next.n++;
        next.x[j] = x2; next.p[j] = q;
        for (let g = 0; g < K; g++) next.h[j * K + g] = h2[g];
        table[slot] = j;
      }
    }
    if (next.n > limit)
      throw new EngineError("tooBigEventLayer", { n: next.n, limit }, `Too big: ${next.n.toLocaleString("en")} states needed for the event layer (limit ${limit.toLocaleString("en")}).`);
    [cur, next] = [next, cur];
  }
}

// P(goal not met) for one cell, from each group's "not met after n hits"
export function undoneAt(cells, i, K, notMet, goalMode) {
  let u = goalMode === "any" ? 1 : 0;
  for (let g = 0; g < K; g++) {
    const s = notMet[g][cells.h[i * K + g]];
    u = goalMode === "any" ? u * s : u + s - u * s; // all: 1 − ∏(1 − s) without cancellation
  }
  return u;
}

export function solveLayered(plan, eps, maxPulls, onProgress) {
  const { items, gap, gap1, goalMode } = plan;

  // How many events the goal needs: U[m] = P(M > m)
  const U = [];
  const S = items.map((x) => x.S), K = items.length;
  walkEvents(plan, items.map((x) => x.cap), (m, cells) => {
    let u = 0;
    for (let i = 0; i < cells.n; i++) {
      const p = cells.p[i];
      if (p) u += p * undoneAt(cells, i, K, S, goalMode);
    }
    U.push(Math.min(1, u));
    if (onProgress && (m & 15) === 0) onProgress({ phase: "events", t: m, remaining: u, eps, name: plan.eventName });
    if (m >= MAX_EVENTS) throw new EngineError("tooManyEvents", { limit: MAX_EVENTS }, "Too big: the goal needs more than a million events.");
    return u > eventTolerance(eps);
  });
  const pM = U.map((u, m) => Math.max(0, (m ? U[m - 1] : 1) - u));

  // Number of pulls: each event costs one gap (the first from the starting state)
  let pmfT;
  if (!gap) pmfT = pM; // the event is the pull itself
  else {
    const Mmax = pM.length - 1;
    const len = (gap1.length - 1) + Math.max(0, Mmax - 1) * (gap.length - 1) + 1;
    if (len > maxPulls + 1 && len > MAX_PULL_SPAN) throw new EngineError("tooManyPulls", { limit: MAX_PULL_SPAN }, "Too big: the result would span too many pulls.");
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
      if ((z & 1023) === 0) {
        stopIfCancelled();
        if (onProgress) onProgress({ phase: "combine", done: z, total: L / 2 });
      }
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
    survival.push(sv < NEGLIGIBLE ? 0 : sv);
    if (sv < eps) break;
  }
  return {
    pmf, survival, labels: plan.labels, worst: null,
    states: plan.ic.N - 1 + plan.outerStates + items.reduce((s, x) => s + x.states, 0),
    fullStates: null,
  };
}

export function budgetLayered(plan, B, onProgress = null) {
  if (!(Number.isInteger(B) && B >= 0)) throw new EngineError("badBudget", {}, "budget must be a whole number of pulls ≥ 0");
  const { items, gap, gap1, goalMode } = plan;
  // progress through the parts, by rough share of the work: events by pull 15%, pool pieces 20%,
  // event walk 15%, curves 50%
  const report = (frac) => onProgress?.({ done: Math.min(1, frac), total: 1 });
  report(0);

  // How many events (SSRs) can happen within B pulls: P(m-th event by pull B) for each m
  // (tauB[m]), up to the first m where it's negligible. "mCount or more" counts as mCount.
  const ev = gap ? eventsByPull(gap1, gap, B, (f) => report(0.15 * f)) : null;
  const mCount = gap ? ev.mCount : B + 1;
  report(0.15);
  // Per pool: progress of each row after n hits, until every row is maxed out
  const perGroup = items.map((x) => (x.formula
    ? cached("poolBudget", [x.formula, mCount], () => poolBudget(x.formula, mCount, x.S))
    : cached("poolChainBudget", [x.chain, mCount], () => poolChainBudget(x.chain, mCount))));

  // Per event count m: distribution of hits on each pool, and the chance the goal is met
  // (each pool's hit distribution kept only over its non-zero range: { lo, w[n − lo] })
  report(0.35);
  const caps = perGroup.map((x) => x.G.length - 1);
  const G = perGroup.map((x) => x.G), K = caps.length;
  const hitDist = [];
  walkEvents(plan, caps, (m, cells) => {
    if ((m & 31) === 0) report(0.35 + 0.15 * (m / Math.max(1, mCount)));
    const lo = caps.map(() => Infinity), hi = caps.map(() => -1);
    for (let i = 0; i < cells.n; i++) {
      if (!cells.p[i]) continue;
      for (let k = 0; k < K; k++) { const v = cells.h[i * K + k]; if (v < lo[k]) lo[k] = v; if (v > hi[k]) hi[k] = v; }
    }
    const g = caps.map((_, k) => (hi[k] < 0 ? { lo: 0, w: new Float64Array(0) } : { lo: lo[k], w: new Float64Array(hi[k] - lo[k] + 1) }));
    let undone = 0;
    for (let i = 0; i < cells.n; i++) {
      const p = cells.p[i];
      if (!p) continue;
      undone += p * undoneAt(cells, i, K, G, goalMode);
      for (let k = 0; k < K; k++) g[k].w[cells.h[i * K + k] - g[k].lo] += p;
    }
    hitDist.push({ g, done: 1 - undone });
    return m < mCount;
  });

  // Rows, in the goal's order
  const order = [];
  plan.G.forEach((grp, gi) => grp.idx.forEach((orig, i) => { order[orig] = { gi, i, r: plan.rows[orig] }; }));

  const Em = order.map(({ gi, i }) => hitDist.map((h) => {
    const { lo, w } = h.g[gi], E = perGroup[gi].E[i];
    let s = 0;
    for (let j = 0; j < w.length; j++) s += w[j] * E[lo + j];
    return s;
  }));
  const done = hitDist.map((h) => h.done);
  // Curves over pulls: goal chance and each row's expected progress
  const [goalByPull, ...expectedByPull] = gap
    ? curvesByPull(gap1, gap, B, mCount, [done, ...Em], (f) => report(0.5 + 0.5 * f))
    : [done, ...Em].map((f) => Float64Array.from({ length: B + 1 }, (_, t) => f[Math.min(t, f.length - 1)]));
  // P(exactly m events by pull B), for the distributions at B
  const pAtB = (m) => (gap
    ? (m === 0 ? 1 : ev.tauB[m]) - (m < mCount ? ev.tauB[m + 1] : 0)
    : (m === Math.min(B, mCount) ? 1 : 0));
  const distAtB = order.map(({ gi, i, r }) => {
    const dist = new Float64Array(r.max + 1);
    for (let m = 0; m <= mCount && m < hitDist.length; m++) {
      const p = Math.max(0, pAtB(m));
      if (!p) continue;
      const { lo, w } = hitDist[m].g[gi];
      for (let j = 0; j < w.length; j++) if (w[j]) addScaled(dist, perGroup[gi].D[i][lo + j], p * w[j], r.max);
    }
    return dist;
  });
  return makeReport(B, plan.rows, goalByPull, expectedByPull, distAtB);
}
