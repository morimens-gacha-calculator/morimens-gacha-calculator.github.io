// Several banners in one plan (staged.js): checks against answers known another way.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, solveStages } from "../src/engine/banner-engine.js";
import { buildQuery, freshState, newStage } from "../src/model.js";
import { assertClose } from "./helpers.js";

// a built-in banner's query, with an optional goal instead of its default
const bannerQuery = (key, goal) => {
  const s = freshState(key);
  if (goal) s.goal = goal.map((g, i) => ({ id: `g${i}`, type: "total", item: 0, k: 1, copies: 1, from: "", ...g }));
  const { tree, goal: gq, goalMode, start } = buildQuery(s);
  return { tree, goal: gq, goalMode, start };
};
const maxDiff = (a, b) => {
  let d = 0;
  for (let t = 0; t < Math.max(a.length, b.length); t++) d = Math.max(d, Math.abs((a[t] ?? 1) - (b[t] ?? 1)));
  return d;
};

// Pity carried over exactly: the same outcome on two banners of one type, in a row, is the same
// as asking one banner for both copies
test("shared pity: limited character 1 + 1 = one banner ×2", () => {
  const one = bannerQuery("limitedChar");
  const r = solveStages({ stages: [one, { ...one, shares: true }] });
  const two = solve(bannerQuery("limitedChar", [{ path: "0,0", copies: 2 }]));
  assertClose(r.mean, two.mean, 1e-9);
  assert.ok(maxDiff(r.cdf, two.cdf) < 1e-12);
  assert.equal(r.min, two.min);
  assert.equal(r.max, two.max);
});
test("shared pity: 1 + 1 + 1 = ×3", () => {
  const one = bannerQuery("limitedChar");
  const r = solveStages({ stages: [one, { ...one, shares: true }, { ...one, shares: true }] });
  const three = solve(bannerQuery("limitedChar", [{ path: "0,0", copies: 3 }]));
  assertClose(r.mean, three.mean, 1e-9);
  assert.equal(r.max, three.max);
});
test("shared memory (never 3 in a row): Kaleido GDoll 1 + 1 = ×2", () => {
  const one = bannerQuery("kaleido2", [{ path: "0,0", type: "specific", item: 0 }]);
  const r = solveStages({ stages: [one, { ...one, shares: true }] });
  const two = solve(bannerQuery("kaleido2", [{ path: "0,0", type: "specific", item: 0, copies: 2 }]));
  assertClose(r.mean, two.mean, 1e-8);
  assert.ok(maxDiff(r.cdf, two.cdf) < 1e-11);
});

// Banners that don't share pity: the waits add up
test("independent banners: averages and extremes add up", () => {
  const a = bannerQuery("limitedChar"), b = bannerQuery("limitedWheel");
  const r = solveStages({ stages: [a, b] });
  const ra = solve(a), rb = solve(b);
  assertClose(r.mean, ra.mean + rb.mean, 1e-9);
  assert.equal(r.min, ra.min + rb.min);
  assert.equal(r.max, ra.max + rb.max);
});
test("fixed pulls per banner: independent chances multiply", () => {
  const a = bannerQuery("limitedChar"), b = bannerQuery("limitedWheel");
  const r = solveStages({ stages: [a, b], spend: "fixed", budgets: [60, 40] });
  assertClose(r.chanceAll, solve(a).cdf[60] * solve(b).cdf[40], 1e-12);
  assertClose(r.stages[0].chance, solve(a).cdf[60], 1e-12);
});
test("fixed pulls, guaranteed in time: chance exactly 1", () => {
  const a = bannerQuery("limitedChar");
  const r = solveStages({ stages: [a, { ...a, shares: true }], spend: "fixed", budgets: [90, 90] });
  assert.equal(r.chanceAll, 1);
});

// Each banner plan's own wait, however many pulls it takes
test("fixed pulls: each banner's own wait (independent: the banner alone)", () => {
  const a = bannerQuery("limitedChar"), b = bannerQuery("limitedWheel");
  const r = solveStages({ stages: [a, b], spend: "fixed", budgets: [60, 40] });
  const rb = solve(b);
  assertClose(r.stages[1].own.mean, rb.mean, 1e-12);
  assert.ok(maxDiff(r.stages[1].own.cdf, rb.cdf) < 1e-12);
  assert.equal(r.stages[1].own.min, rb.min);
  assert.equal(r.stages[1].own.max, rb.max);
  assert.equal(r.stages[1].own.p90, rb.cdf.findIndex((v) => v >= 0.9 - 1e-12));
});
test("fixed pulls, shared pity: the second banner's own wait = (1 + 1) minus the first", () => {
  const a = bannerQuery("limitedChar");
  const r = solveStages({ stages: [a, { ...a, shares: true }], spend: "fixed", budgets: [90, 90] });
  const one = solve(a), two = solve(bannerQuery("limitedChar", [{ path: "0,0", copies: 2 }]));
  assertClose(r.stages[0].own.mean, one.mean, 1e-12);
  assertClose(r.stages[1].own.mean, two.mean - one.mean, 1e-9);
  assert.ok(r.stages[1].own.max <= one.max);
});
test("one budget: per banner, done by pull on average and 9 in 10", () => {
  const a = bannerQuery("limitedChar"), b = bannerQuery("limitedWheel");
  const r = solveStages({ stages: [a, b] });
  assertClose(r.stages[0].mean, solve(a).mean, 1e-9);
  assert.equal(r.stages[1].p90, r.percentiles.p90);
});

// Which banners share pity, from the plan
test("same type shares pity, other types don't", () => {
  const q = buildQuery({ ...freshState("limitedChar"), stages: [newStage("limitedChar"), newStage("limitedWheel"), newStage("limitedWheel")] });
  assert.deepEqual(q.stages.map((s) => s.shares), [false, true, false, true]);
  const k = buildQuery({ ...freshState("kaleido1"), stages: [newStage("kaleido2")] });
  assert.equal(k.stages[1].shares, true);
});
