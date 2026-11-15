// Shared helpers for the engine tests (run with `npm test`).
import assert from "node:assert/strict";
import { compile, expandSubsets } from "../src/engine/banner-engine.js";
import { buildQuery, freshState } from "../src/model.js";

export const preset = (key) => buildQuery(freshState(key));

export function assertClose(got, want, tol, what = "value") {
  assert.ok(Number.isFinite(got), `${what}: got ${got}`);
  assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, expected ${want} (±${tol})`);
}

// Largest difference between two results of solve(): mean, chance curve, budget report.
// The mean is compared relatively: each method stops once less than eps (1e-13) is left, at
// slightly different pulls, and that tail moves a mean of thousands by ~1e-9.
export function resultDiff(a, b) {
  let d = Math.abs(a.mean - b.mean) / Math.max(1, a.mean);
  const n = Math.max(a.cdf.length, b.cdf.length);
  for (let t = 0; t < n; t++) d = Math.max(d, Math.abs((a.cdf[t] ?? 1) - (b.cdf[t] ?? 1)));
  if (a.budget && b.budget) {
    d = Math.max(d, Math.abs(a.budget.chanceGoal - b.budget.chanceGoal));
    for (let t = 0; t < a.budget.goalByPull.length; t++) d = Math.max(d, Math.abs(a.budget.goalByPull[t] - b.budget.goalByPull[t]));
    a.budget.requirements.forEach((r, i) => {
      const s = b.budget.requirements[i];
      d = Math.max(d, Math.abs(r.mean - s.mean), Math.abs(r.chanceMet - s.chanceMet));
      r.dist.forEach((v, k) => { d = Math.max(d, Math.abs(v - (s.dist[k] ?? 0))); });
    });
  }
  return d;
}

// Reference for one pool, the slow way (a state chain): S[h] = P(goal not met after h hits)
// and, per h, each row's expected progress and P(not met) from the non-stopping chain.
export function poolByChain(n, rows, owned, goalMode, H) {
  const ex = expandSubsets([{ p: 1, count: n }], rows.map((r) => ({ ...r, path: "0" })), owned.length ? { owned: { "0": owned } } : {});
  const step = (c, cur) => {
    const next = new Float64Array(c.N);
    for (let k = 1; k < c.N; k++) { const v = cur[k]; if (v) for (let e = c.rowStart[k]; e < c.rowStart[k + 1]; e++) next[c.col[e]] += v * c.prob[e]; }
    return next;
  };
  const mc = compile(ex.tree, ex.goal, { goalMode, start: ex.start, maxStates: 3e5 });
  const S = [];
  let cur = new Float64Array(mc.N); cur[mc.startIndex] = 1;
  for (let h = 0; h <= H; h++) {
    let m = 0; for (let k = 1; k < mc.N; k++) m += cur[k];
    S.push(m);
    cur = step(mc, cur); cur[0] = 0;
  }
  const bc = compile(ex.tree, ex.goal, { goalMode, start: ex.start, maxStates: 3e5, absorb: false });
  const E = bc.reqs.map(() => []), G = [];
  cur = new Float64Array(bc.N); cur[bc.startIndex] = 1;
  for (let h = 0; h <= H; h++) {
    bc.reqs.forEach((r, i) => { let e = 0; for (let k = 1; k < bc.N; k++) if (cur[k]) e += cur[k] * Math.min(bc.progress(r, bc.states[k]), r.max); E[i].push(e); });
    let g = 0; for (let k = 1; k < bc.N; k++) if (cur[k] && !bc.isDone(bc.states[k])) g += cur[k];
    G.push(g);
    cur = step(bc, cur);
  }
  return { S, E, G };
}

// Small deterministic random numbers (same cases on every run)
export function rng(seed) {
  let s = seed;
  const next = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  return { next, int: (a, b) => a + Math.floor(next() * (b - a + 1)) };
}
