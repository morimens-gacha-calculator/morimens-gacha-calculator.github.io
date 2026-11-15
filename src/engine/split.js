// ── Split method ──
// When every row is about one pool, which item a hit gives never affects the banner
// (pity, streaks). So: (a) the pool formulas give P(goal not met after n hits); (b) the banner
// chain gives the distribution of hits on the pool after t pulls; combine. Exact. Used when the
// layered method doesn't fit (the banner doesn't restart at each event).
import { EngineError } from "./errors.js";
import { cached } from "./cache.js";
import { makeStepper } from "./chain-step.js";
import { compile } from "./chain.js";
import { goalList, groupRows, ownedFor, rowsOf } from "./goal.js";
import { addScaled, makeReport } from "./report.js";
import { chainSizeEstimate, poolBudget, poolNotMet } from "./pool-formulas.js";
import { poolChain, poolChainBudget, poolChainNotMet, poolPlanFor } from "./pools.js";
import { normaliseNode } from "./tree.js";

// When every row is about one pool, which item a hit gives never affects the banner
// (pity, streaks). So: (a) the pool formulas give P(goal not met after n hits); (b) the banner
// chain gives the distribution of hits on the pool after t pulls; combine. Exact. Used when the
// layered method doesn't fit (the banner doesn't restart at each event).
const withRows = (rows) => ({ rows, labels: rows.map((r) => r.label) });

export function planSplit(tree, goal, opts, eps, force) {
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
    itemsGuaranteed: itemsWorst != null, ...withRows(rowsOf(tree, list, opts.start)),
  };
}

export function solveSplit(tree, plan, opts, eps, maxPulls) {
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

export function budgetSplit(tree, plan, opts, B) {
  if (!(Number.isInteger(B) && B >= 0)) throw new EngineError("badBudget", {}, "budget must be a whole number of pulls ≥ 0");
  // Per number of hits n ≤ B: each row's progress distribution and the goal chance
  const { D, E, G } = plan.formula
    ? cached("poolBudget", [plan.formula, B], () => poolBudget(plan.formula, B))
    : cached("poolChainBudget", [plan.chain, B], () => poolChainBudget(plan.chain, B));
  const reqs = plan.rows;
  const nB = G.length - 1;

  // Banner chain: distribution of hits on the pool for every pull 0..B
  const bannerStart = { pity: opts.start.pity, streak: opts.start.streak };
  const expectedByPull = reqs.map(() => new Float64Array(B + 1));
  const goalByPull = new Float64Array(B + 1);
  const dist = reqs.map((r) => new Float64Array(r.max + 1));
  const addD = (i, m, h) => addScaled(dist[i], D[i][h], m, reqs[i].max);
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
  return makeReport(B, reqs, goalByPull, expectedByPull, dist);
}
