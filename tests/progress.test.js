// Progress messages: real phases in order, with step numbers, for every method; and the page's
// time-left estimate.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, budgetOnly, clearCache } from "../src/engine/banner-engine.js";
import { estimate } from "../src/useEngine.js";
import { preset } from "./helpers.js";

const ORDER = { layered: ["plan", "events", "combine", "budget"], joint: ["build", "reduce", "calc", "budget"], split: ["plan", "build", "reduce", "calc", "budget"] };

function phasesOf(q) {
  clearCache();
  const msgs = [];
  const r = solve({ ...q, onProgress: (p) => msgs.push(p) });
  return { r, msgs };
}

for (const [label, q, method] of [
  ["layered with budget", { ...preset("kaleido2"), goal: [{ path: "0,0", type: "distinct", k: 19, copies: 4 }, { path: "0,1", type: "distinct", k: 5, copies: 4 }], budget: 8000 }, "layered"],
  ["joint with budget", { ...preset("anniversary"), method: "joint", budget: 300 }, "joint"],
  ["split with budget", { tree: [{ name: "SSR", p: 0.02, pity: 40, children: [{ name: "pool", p: 1, count: 4 }] }, { name: "SR", p: 0.1, pity: 8 }, { name: "R", p: "rest" }], goal: [{ path: "0,0", type: "distinct", k: 4, copies: 2 }], method: "split", budget: 400 }, "split"],
]) {
  test(`progress: ${label}`, () => {
    const { r, msgs } = phasesOf(q);
    assert.equal(r.method, method);
    assert.ok(msgs.length > 0);
    const order = ORDER[method];
    let last = -1, lastStep = 0;
    for (const p of msgs) {
      const i = order.indexOf(p.phase);
      assert.ok(i >= 0, `unexpected phase ${p.phase}`);
      assert.ok(i >= last, `phase ${p.phase} came after ${order[last]}`);
      last = i;
      if (p.steps != null) {
        assert.ok(p.step >= 1 && p.step <= p.steps, `step ${p.step} of ${p.steps}`);
        assert.ok(p.step >= lastStep, "steps go forward");
        lastStep = p.step;
      }
      if ("total" in p) assert.ok(p.done >= 0 && p.done <= p.total, `${p.phase}: ${p.done} of ${p.total}`);
    }
    const budgetMsgs = msgs.filter((p) => p.phase === "budget");
    assert.ok(budgetMsgs.length > 0, "the budget report says so");
    assert.ok(budgetMsgs.every((p) => p.step === p.steps), "the budget is the last step");
    if (method === "layered") {
      assert.ok(msgs.some((p) => p.phase === "events" && p.name === "SSR"), "events are named after the banner's SSR");
      assert.ok(!msgs.some((p) => p.phase === "calc"), "no pulls are claimed while walking SSRs");
    }
  });
}

test("progress: pulls mode numbers the budget as the last step", () => {
  clearCache();
  const q = { ...preset("kaleido2"), goal: [{ path: "0,0", type: "distinct", k: 19, copies: 3 }, { path: "0,1", type: "distinct", k: 3, copies: 3 }] };
  const steps = new Set();
  const r = solve({ ...q, budget: null, budgetAfter: true, onProgress: (p) => p.steps && steps.add(p.steps) });
  budgetOnly({ ...q, budget: r.percentiles.p90, onProgress: (p) => { assert.equal(p.phase, "budget"); assert.equal(p.step, 4); assert.equal(p.steps, 4); } });
  assert.deepEqual([...steps], [4]);
});

test("time left: shrinking chance and done-of-total", () => {
  // the chance left halves every 10 events, 10 events per 100 ms: from 2^-4 down to 1e-13 is
  // log2(2^-4 / 1e-13) ≈ 39.2 halvings → ≈ 392 events → ≈ 3.9 s
  const samples = [];
  let out;
  for (let k = 0; k <= 4; k++) out = estimate({ phase: "events", step: 2, steps: 3, t: 40 + 10 * k, remaining: 2 ** -(4 + k), eps: 1e-13, at: 1000 + 100 * k }, samples, 0);
  assert.ok(Math.abs(out.eta - 3.5) < 0.6, `eta ${out.eta}`);
  // done-of-total: 30% in 300 ms → 70% left ≈ 0.7 s
  const s2 = [];
  estimate({ phase: "combine", step: 3, steps: 3, done: 0, total: 100, at: 0 }, s2, 0);
  out = estimate({ phase: "combine", step: 3, steps: 3, done: 30, total: 100, at: 300 }, s2, 0);
  assert.ok(Math.abs(out.eta - 0.7) < 1e-9, `eta ${out.eta}`);
  // a new phase starts its own history
  out = estimate({ phase: "budget", step: 4, steps: 4, done: 0, total: 1, at: 400 }, s2, 0);
  assert.equal(out.eta, null);
});
