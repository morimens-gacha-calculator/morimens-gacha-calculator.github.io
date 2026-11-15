// ── Joint method ──
// Everything tracked together in one chain: exact for any goal, including the worst case;
// used for small goals and for goals the other methods can't take (rows counting several
// pools together, banners that don't restart at each event).
import { EngineError } from "./errors.js";
import { makeStepper } from "./chain-step.js";
import { compile } from "./chain.js";
import { expandSubsets, goalList, labelsOf, mergeNamedRows, rowShape } from "./goal.js";
import { makeReport } from "./report.js";

// Distribution of the number of pulls: step the chain until less than eps is left
export function solveJoint(orig, opts, eps, maxPulls, onProgress) {
  // the distribution only needs "is the goal met": merge same-target named items first
  const merged = expandSubsets(orig.tree, mergeNamedRows(orig.tree, orig.goal, opts.goalMode), orig.start);
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
  return { pmf, survival, labels: labelsOf(orig.tree, goalList(orig.goal), orig.start), states: N - 1, fullStates: c.fullStates, worst: c.worst };
}

// "I have B pulls, what will I get?" — the chain without stopping at the goal,
// run for B pulls; reports each requirement's progress distribution.
export function budgetReport(tree, goal, opts, B) {
  if (!(Number.isInteger(B) && B >= 0)) throw new EngineError("badBudget", {}, "budget must be a whole number of pulls ≥ 0");
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
  const rows = reqs.map(rowShape);
  const distAtB = rows.map((r, i) => {
    const dist = new Float64Array(r.max + 1);
    for (let k = 1; k < N; k++) dist[Math.min(prog[i][k], r.max)] += cur[k];
    return dist;
  });
  return makeReport(B, rows, goalByPull, expectedByPull, distAtB);
}
