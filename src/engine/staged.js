// ── Stacked banners: several banners in one plan ──
// Each stage is a banner with its own goal: { tree, goal, goalMode, start, shares }.
// Stages are done in order: pull on stage 1 until its goal is met, then stage 2, and so on.
// shares: the stage continues the previous stage's pity counters and memory (banners of the same
// type). Then where stage 2 starts depends on how stage 1 ended, and that is followed exactly: the
// chain reports, for every pull, how much probability met the goal in each pity/memory state
// (compile with keepEnd), and stage 2 is worked out from each of those states. Stages that don't
// share start from their own start, so their waits simply add up (a convolution).
//
// spend "shared": one pull budget for everything. The result has the same shape as solve()'s
//   (pmf, cdf, mean, percentiles, min, max, …) for the total number of pulls, plus stages[]: when
//   each stage's goal is met (doneCdf[t] = P(stages 1…k all met within t pulls)).
// spend "fixed": stage k gets budgets[k] pulls of its own (pulls left over aren't moved on). The
//   result: chanceAll and, per stage, its chance given the stages before it were met, and its
//   curve over its own pulls (curve[n] = P(met within n pulls on that banner | reached it)).
import { compile } from "./chain.js";
import { makeStepper } from "./chain-step.js";
import { expandSubsets, mergeNamedRows } from "./goal.js";
import { fft } from "./renewal.js";
import { solve } from "./banner-engine.js";
import { stopIfCancelled } from "./cancel.js";
import { EngineError } from "./errors.js";
import { DEFAULT_EPS, DEFAULT_MAX_PULLS, DEFAULT_MAX_STATES, FFT_ROUNDING, NEGLIGIBLE, PERCENTILE_SLACK } from "./settings.js";

const NEGLIGIBLE_MASS = NEGLIGIBLE; // a way of ending a stage less likely than this is left out
const DIRECT_CONV_MAX = 4e6;     // products below this: plain convolution (exact zeros stay zeros)

// a + b of two lengths that may be unknown (null = can go on forever)
const addLen = (a, b) => (a == null || b == null ? null : a + b);

// The distribution of a + b, for independent a and b given as pmfs over pulls
export function convolve(a, b) {
  if (!a.length || !b.length) return new Float64Array(0);
  const n = a.length + b.length - 1;
  if (a.length * b.length <= DIRECT_CONV_MAX) {
    const out = new Float64Array(n);
    for (let i = 0; i < a.length; i++) {
      const x = a[i];
      if (x === 0) continue;
      for (let j = 0; j < b.length; j++) out[i + j] += x * b[j];
    }
    return out;
  }
  let L = 1;
  while (L < n) L <<= 1;
  const ar = new Float64Array(L), ai = new Float64Array(L), br = new Float64Array(L), bi = new Float64Array(L);
  ar.set(a); br.set(b);
  fft(ar, ai, false); fft(br, bi, false);
  for (let k = 0; k < L; k++) {
    const r = ar[k] * br[k] - ai[k] * bi[k], i = ar[k] * bi[k] + ai[k] * br[k];
    ar[k] = r; ai[k] = i;
  }
  fft(ar, ai, true);
  // FFT rounding leaves ~1e-16 where the true value is 0: clear it
  return Float64Array.from(ar.subarray(0, n), (v) => (v < FFT_ROUNDING ? 0 : v));
}

const addInto = (acc, x) => {
  if (acc.length < x.length) { const y = new Float64Array(x.length); y.set(acc); acc = y; }
  for (let i = 0; i < x.length; i++) acc[i] += x[i];
  return acc;
};
const total = (x) => { let s = 0; for (const v of x) s += v; return s; };
const firstNonZero = (x) => { for (let i = 0; i < x.length; i++) if (x[i] > 0) return i; return null; };
const memoryKey = (start) => JSON.stringify([start.pity, start.streak]);

// A stage's own start, with the pity counters and memory carried over from the stage before
const withMemory = (own, memory) => (memory ? { ...own, pity: memory.pity, streak: memory.streak } : own);

// When the stage's goal is met, and in which pity/memory state: [{ start, pmf, min, max }]
function stageEnds(stage, start, { eps, maxPulls, maxStates }) {
  const merged = expandSubsets(stage.tree, mergeNamedRows(stage.tree, stage.goal, stage.goalMode), start);
  const c = compile(merged.tree, merged.goal, { start: merged.start, goalMode: stage.goalMode, maxStates, keepEnd: true });
  if (c.startIndex === 0) return [{ start: c.startEnd, pmf: Float64Array.of(1), min: 0, max: 0 }];
  const st = makeStepper(c, { threads: false });
  const inflow = c.ends.map(() => [0]);
  let t = 0, left = 1;
  while (left > 0 && left >= eps && t < maxPulls) {
    if ((t & 15) === 0) stopIfCancelled();
    st.step(); t++;
    let ended = 0;
    for (let i = 0; i < c.ends.length; i++) { const m = st.cur[c.ends[i].index]; inflow[i].push(m); ended += m; }
    left = st.remaining - ended; // the stepper still counts this pull's arrivals in its vector
  }
  // Did every way through meet the goal? End states have no way out, so one more pull leaves the
  // vector exactly empty then (no rounding involved); otherwise the latest pull isn't known.
  st.step();
  const finished = st.remaining === 0;
  st.close();
  return c.ends.map((e, i) => {
    const pmf = Float64Array.from(inflow[i]);
    let last = null;
    if (finished) for (let k = pmf.length - 1; k >= 0; k--) if (pmf[k] > 0) { last = k; break; }
    return { start: e.start, pmf, min: firstNonZero(pmf), max: last };
  }).filter((e) => total(e.pmf) > NEGLIGIBLE_MASS);
}

// Pulls to meet the stage's goal from one start (any method; exact): { pmf, min, max, cdf, tail }
function stageWait(stage, start, { eps, maxPulls, maxStates, method }) {
  const r = solve({ tree: stage.tree, goal: stage.goal, goalMode: stage.goalMode, start, eps, maxPulls, maxStates, method, percentiles: [] });
  return { pmf: r.pmf, cdf: r.cdf, tail: r.tail, min: r.min, max: r.max, method: r.method };
}

function checkStages(stages) {
  if (!Array.isArray(stages) || !stages.length) throw new EngineError("noStages", {}, "stages: give at least one banner");
  if (stages[0].shares) throw new EngineError("firstShares", {}, "the first stage can't continue another banner's pity");
}

// One budget for all stages, in order
function sharedStages(stages, opts, onProgress) {
  let frontier = [{ memory: null, arrival: Float64Array.of(1), min: 0, max: 0 }];
  const doneCurves = [];
  for (let k = 0; k < stages.length; k++) {
    const stage = stages[k];
    const nextShares = !!stages[k + 1]?.shares;
    if (onProgress) onProgress({ phase: "stages", step: k + 1, steps: stages.length });
    const next = new Map();
    let done = new Float64Array(0), dMin = null, dMax = 0;
    for (const f of frontier) {
      const start = withMemory(stage.start ?? {}, stage.shares ? f.memory : null);
      if (nextShares) {
        for (const e of stageEnds(stage, start, opts)) {
          const arrival = convolve(f.arrival, e.pmf);
          const min = addLen(f.min, e.min), max = addLen(f.max, e.max);
          const key = memoryKey(e.start);
          const had = next.get(key);
          if (had) { had.arrival = addInto(had.arrival, arrival); had.min = Math.min(had.min, min); had.max = had.max == null || max == null ? null : Math.max(had.max, max); }
          else next.set(key, { memory: e.start, arrival, min, max });
          done = addInto(done, arrival);
          dMin = dMin == null ? min : Math.min(dMin, min);
          dMax = dMax == null || max == null ? null : Math.max(dMax, max);
        }
      } else {
        const w = stageWait(stage, start, opts);
        done = addInto(done, convolve(f.arrival, w.pmf));
        dMin = dMin == null ? addLen(f.min, w.min) : Math.min(dMin, addLen(f.min, w.min));
        dMax = dMax == null || w.max == null || f.max == null ? null : Math.max(dMax, f.max + w.max);
      }
    }
    doneCurves.push({ pmf: done, min: dMin, max: dMax });
    // the next stage starts when this one is met: from each end state if it shares, else once
    frontier = nextShares ? [...next.values()] : [{ memory: null, arrival: done, min: dMin, max: dMax }];
  }
  return { doneCurves };
}

// Each stage with its own pulls
function fixedStages(stages, budgets, opts, onProgress) {
  let frontier = [{ memory: null, mass: 1 }];
  const out = [];
  for (let k = 0; k < stages.length; k++) {
    const stage = stages[k], B = Math.max(0, Math.floor(budgets[k] ?? 0));
    const nextShares = !!stages[k + 1]?.shares;
    if (onProgress) onProgress({ phase: "stages", step: k + 1, steps: stages.length });
    const reached = frontier.reduce((s, f) => s + f.mass, 0);
    const next = new Map();
    let met = 0;
    let curve = new Float64Array(B + 1);
    for (const f of frontier) {
      const start = withMemory(stage.start ?? {}, stage.shares ? f.memory : null);
      const w = f.mass / (reached || 1);
      if (nextShares) {
        for (const e of stageEnds(stage, start, opts)) {
          let run = 0;
          for (let t = 0; t <= B; t++) { run += e.pmf[t] ?? 0; curve[t] += w * run; }
          if (run <= NEGLIGIBLE_MASS) continue;
          const key = memoryKey(e.start);
          const mass = f.mass * run;
          met += mass;
          const had = next.get(key);
          if (had) had.mass += mass; else next.set(key, { memory: e.start, mass });
        }
      } else {
        const r = stageWait(stage, start, opts);
        const at = (t) => (t < r.cdf.length ? r.cdf[t] : 1 - r.tail);
        for (let t = 0; t <= B; t++) curve[t] += w * at(t);
        met += f.mass * at(B);
      }
    }
    curve = Float64Array.from(curve, (v) => Math.min(1, Math.max(0, v)));
    out.push({ budget: B, chance: reached > 0 ? Math.min(1, met / reached) : 0, reached: Math.min(1, reached), curve });
    frontier = nextShares ? [...next.values()] : [{ memory: null, mass: met }];
  }
  return { stages: out, chanceAll: out.length ? Math.min(1, out[out.length - 1].reached * out[out.length - 1].chance) : 0 };
}

// The cdf of a pmf, with the ends made exact (0 before the earliest pull, 1 from the latest)
function cdfOf(pmf, min, max) {
  let run = 0;
  const cdf = Float64Array.from(pmf, (v) => (run += v));
  for (let t = 0; t < cdf.length; t++) {
    if (min != null && t < min) cdf[t] = 0;
    else if (max != null && t >= max) cdf[t] = 1;
    else cdf[t] = Math.min(1 - 2 ** -53, Math.max(min != null ? Number.MIN_VALUE : 0, cdf[t]));
  }
  return cdf;
}

export function solveStages({
  stages, spend = "shared", budgets = [], budget = null, percentiles = [10, 25, 50, 75, 90, 95, 99],
  eps = DEFAULT_EPS, maxPulls = DEFAULT_MAX_PULLS, maxStates = DEFAULT_MAX_STATES, method = "auto", onProgress = null,
}) {
  checkStages(stages);
  const opts = { eps, maxPulls, maxStates, method };
  if (spend === "fixed") {
    const r = fixedStages(stages, budgets, opts, onProgress);
    return { staged: true, spend: "fixed", chanceAll: r.chanceAll, stages: r.stages };
  }

  const { doneCurves } = sharedStages(stages, opts, onProgress);
  const last = doneCurves[doneCurves.length - 1];
  const pmf = last.pmf;
  const tail = Math.max(0, 1 - total(pmf)); // probability past the point where the calculation stopped
  const cdf = cdfOf(pmf, last.min, last.max);
  let mean = 0, m2 = 0;
  for (let t = 0; t < pmf.length; t++) { mean += t * pmf[t]; m2 += t * t * pmf[t]; }
  const quantile = (q) => { for (let i = 0; i < cdf.length; i++) if (cdf[i] >= q - PERCENTILE_SLACK) return i; return null; };
  const pct = {};
  for (const q of percentiles) pct[`p${q}`] = quantile(q / 100);
  let mode = 0;
  for (let i = 1; i < pmf.length; i++) if (pmf[i] > pmf[mode]) mode = i;
  const chanceBy = (c, t) => (t >= c.length ? c[c.length - 1] : c[Math.max(0, t)]);
  const stageCdfs = doneCurves.map((d) => cdfOf(d.pmf, d.min, d.max));
  return {
    staged: true, spend: "shared",
    mean, sd: Math.sqrt(Math.max(0, m2 - mean * mean)),
    median: quantile(0.5), mode, percentiles: pct,
    min: last.min, minKnown: true, max: last.max, maxKnown: true,
    tail, pmf, cdf,
    // per stage: P(this stage and the ones before it are met within t pulls)
    stages: doneCurves.map((d, k) => ({ cdf: stageCdfs[k], min: d.min, max: d.max, mean: (() => { let s = 0; d.pmf.forEach((v, t) => (s += t * v)); return s; })() })),
    budget: budget == null ? null : {
      pulls: budget, chanceGoal: chanceBy(cdf, budget),
      stages: stageCdfs.map((c) => chanceBy(c, budget)),
      requirements: [],
    },
  };
}
