// Per-pool pieces for the layered and split methods: the exact formulas (pool-formulas.js),
// or a small chain over the pool's items when the formulas can't (total rows on subsets that
// partly overlap).
import { stopIfCancelled } from "./cancel.js";
import { MAX_CHAIN_HITS, NEGLIGIBLE } from "./settings.js";
import { advance, compile } from "./chain.js";
import { expandSubsets, resolveItem } from "./goal.js";
import { poolPlan } from "./pool-formulas.js";
import { pathKey } from "./tree.js";

// Rows of one pool → formula plan (null when the formulas can't do it: then a small chain)
export function poolPlanFor(x, ownedVal, goalMode) {
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
export function poolChain(x, ownedVal, opts) {
  const miniTree = [{ p: 1, count: x.alt.count, items: x.alt.itemNames ?? undefined }];
  const miniGoal = x.reqs.map((r) => ({ ...r, path: "0" }));
  const miniOpts = { goalMode: opts.goalMode, maxStates: opts.maxStates, start: ownedVal != null ? { owned: { "0": ownedVal } } : {} };
  const ex = expandSubsets(miniTree, miniGoal, miniOpts.start);
  return { miniTree: ex.tree, miniGoal: ex.goal, miniOpts: { ...miniOpts, start: ex.start } };
}

export function poolChainNotMet(pc, tol) {
  const mc = compile(pc.miniTree, pc.miniGoal, pc.miniOpts);
  const S = [mc.startIndex === 0 ? 0 : 1];
  let cur = new Float64Array(mc.N), next = new Float64Array(mc.N), miss = S[0];
  cur[mc.startIndex] = 1;
  while (miss > 0 && miss >= tol && S.length < MAX_CHAIN_HITS) {
    if ((S.length & 63) === 0) stopIfCancelled();
    advance(cur, next, mc.N, mc.rowStart, mc.col, mc.prob);
    next[0] = 0;
    miss = 0;
    for (let k = 1; k < mc.N; k++) miss += next[k];
    S.push(miss);
    [cur, next] = [next, cur];
  }
  return { S, states: mc.N - 1 };
}

export function poolChainBudget(pc, Hcap) {
  const mc = compile(pc.miniTree, pc.miniGoal, { ...pc.miniOpts, absorb: false });
  const prog = mc.reqs.map((r) => Int32Array.from({ length: mc.N }, (_, k) => (k === 0 ? 0 : Math.min(mc.progress(r, mc.stateAt(k)), r.max))));
  const maxed = Uint8Array.from({ length: mc.N }, (_, k) => (k > 0 && mc.reqs.every((r, i) => prog[i][k] >= r.max) ? 1 : 0));
  const D = mc.reqs.map(() => []), E = mc.reqs.map(() => []), G = [];
  let cur = new Float64Array(mc.N), next = new Float64Array(mc.N);
  cur[mc.startIndex] = 1;
  for (let n = 0; n <= Hcap; n++) {
    if ((n & 63) === 0) stopIfCancelled();
    mc.reqs.forEach((r, i) => {
      const d = new Float64Array(r.max + 1);
      let e = 0;
      for (let k = 1; k < mc.N; k++) if (cur[k]) { d[prog[i][k]] += cur[k]; e += cur[k] * prog[i][k]; }
      D[i].push(d); E[i].push(e);
    });
    let g = 0, notMaxed = 0;
    for (let k = 1; k < mc.N; k++) if (cur[k]) { if (!mc.isDone(mc.stateAt(k))) g += cur[k]; if (!maxed[k]) notMaxed += cur[k]; }
    G.push(g);
    if (notMaxed < NEGLIGIBLE) break;
    advance(cur, next, mc.N, mc.rowStart, mc.col, mc.prob);
    [cur, next] = [next, cur];
  }
  return { D, E, G };
}
