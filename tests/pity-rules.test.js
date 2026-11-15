// Guarantee options: what restarts a pity counter, and what happens to a guarantee when an
// outcome listed above takes its pull. Small cases worked out by hand, then the methods agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solve } from "../src/engine/banner-engine.js";
import { planLayered } from "../src/engine/layered.js";
import { resultDiff } from "./helpers.js";

// SSR 50%, SR 10% with pity 3, R the rest; the goal is one SR
const pmf = (sr, pity) => solve({ tree: [{ name: "SSR", p: 0.5 }, { name: "SR", p: 0.1, pity: 3, ...sr }, { name: "R", p: "rest" }],
  goal: [{ path: "1", copies: 1 }], start: { pity: { "1": pity } }, method: "joint" }).pmf;
const close = (a, b) => assert.ok(Math.abs(a - b) < 1e-12, `${a} vs ${b}`);

test("guarantee taken by an SSR: moves to the next pull, or is lost", () => {
  // pull 1 is guaranteed but SSR can still drop (50%); then pull 2: guaranteed again, or 10%
  close(pmf({ pityYields: true }, 2)[2], 0.5 * 0.5);
  close(pmf({ pityYields: true, onPreempt: "lose" }, 2)[2], 0.5 * 0.1);
});

test("counter restarts on SR only, or on SR or anything above", () => {
  // first SR on pull 3: no SR on pulls 1–2 (0.9²), then forced, unless an SSR restarted the counter
  close(pmf({}, 0)[3], 0.81);
  close(pmf({ pityResetBy: "above" }, 0)[3], 0.4 * 0.4 + (0.81 - 0.16) * 0.1);
});

const kaleidoLike = (sr) => [
  { name: "SSR", p: 0.05, pity: 20, children: { streak: 1, alts: [{ name: "char", p: 0.5, count: 3 }, { name: "wheel", p: "rest", count: 3 }] } },
  { name: "SR", p: 0.1, pity: 6, ...sr },
  { name: "R", p: "rest" },
];
for (const [label, sr, entries] of [
  ["SR or better restarts the counter", { pityResetBy: "above" }, 1],
  ["guarantee lost when an SSR takes it", { onPreempt: "lose", pityYields: true }, 1],
  ["SR guarantee blocks SSR and keeps counting", {}, 6],
]) {
  test(`layered = joint: ${label}`, () => {
    const q = { tree: kaleidoLike(sr), goal: [{ path: "0,0", type: "distinct", k: 2, copies: 1 }, { path: "0,1", type: "specific", item: 1, copies: 1 }], budget: 200 };
    const plan = planLayered(q.tree, q.goal, { start: {}, goalMode: "all", maxStates: 2e6 }, 1e-13, true);
    assert.equal(plan.mat ? plan.mat.J : 1, entries, "states after an SSR");
    const d = resultDiff(solve({ ...q, method: "joint" }), solve({ ...q, method: "layered" }));
    assert.ok(d < 1e-9, `differs by ${d}`);
  });
}
