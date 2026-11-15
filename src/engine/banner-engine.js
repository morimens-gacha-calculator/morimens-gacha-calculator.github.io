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
// method ("joint", "split" or "layered"), states, ms — diagnostics
//
// ── Start state (all optional) ───────────────────────────────────────────────
// { pity:   { "1": 12 },            visits since that alternative last came up
//   streak: { "1,1": [0, 2] },      node path → [last alternative index, run length]
//   owned:  { "1,1,0": [2, 0, 1],   per-item copies of a pool, in item order
//             "1,0": 3 } }          or a total; paths must not be nested in each other

import { cached, now } from "./cache.js";
import { MAX_GROUPS, expandSubsets } from "./goal.js";
import { budgetReport, solveJoint } from "./joint.js";
import { budgetLayered, planLayered, solveLayered } from "./layered.js";
import { budgetSplit, planSplit, solveSplit } from "./split.js";

// Also part of the engine's interface (used by tests and tools)
export { compile } from "./chain.js";
export { expandSubsets } from "./goal.js";
export { clearCache } from "./cache.js";

const DEFAULT_PERCENTILES = [10, 25, 50, 75, 90, 95, 99];

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
  method = "auto",    // "auto" | "joint" | "split" | "layered" (see choosePlan)
  onProgress = null,  // optional callback: { phase: "build" | "calc" | "budget", ... }
}) {
  const t0 = now();
  const { layered, split, opts, tree: exTree, goal: exGoal, orig } = choosePlan({ tree, goal, goalMode, start, eps, maxStates, method, onProgress });

  // the distribution doesn't depend on the budget: changing only the budget reuses it
  const distKey = [tree, goal, start, goalMode, maxStates, eps, method, maxPulls];
  let res;
  if (layered) res = cached("distLayered", distKey, () => solveLayered(layered, eps, maxPulls, onProgress));
  else if (split) res = cached("distSplit", distKey, () => solveSplit(orig.tree, split, { ...opts, start: orig.start }, eps, maxPulls));
  else res = solveJoint(orig, opts, eps, maxPulls, onProgress);

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

// Budget report only ("what will I get with B pulls"), without the pulls-to-goal part.
export function budgetOnly({ tree, goal, goalMode = "all", start = {}, budget, eps = 1e-13, maxStates = 1e6, method = "auto", onProgress = null }) {
  const { layered, split, opts, tree: exTree, goal: exGoal, orig } = choosePlan({ tree, goal, goalMode, start, eps, maxStates, method, onProgress });
  if (layered) return budgetLayered(layered, budget);
  if (split) return budgetSplit(orig.tree, split, { ...opts, start: orig.start }, budget);
  return budgetReport(exTree, exGoal, opts, budget);
}
