// Hand-checkable answers and exact worst cases.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solve } from "../src/engine/banner-engine.js";
import { assertClose } from "./helpers.js";

const T4 = [["1", null, 4]]; // every pull: one of 4 equally likely items

test("coupon collector: all 4 different", () => assertClose(solve({ tree: T4, goal: [{ type: "distinct", k: 4 }] }).mean, 4 * (1 + 1 / 2 + 1 / 3 + 1 / 4), 1e-9));
test("2 different of 4", () => assertClose(solve({ tree: T4, goal: [{ type: "distinct", k: 2 }] }).mean, 1 + 4 / 3, 1e-9));
test("one specific item of 4", () => assertClose(solve({ tree: T4, goal: [{ path: "0", type: "specific", copies: 1 }] }).mean, 4, 1e-9));
test("one specific item of 4, ×3", () => assertClose(solve({ tree: T4, goal: [{ path: "0", type: "specific", copies: 3 }] }).mean, 12, 1e-9));
test("whichever of 2 items reaches 2 first", () => assertClose(solve({ tree: [["1", null, 2]], goal: [{ type: "distinct", k: 1, copies: 2 }] }).mean, 2.5, 1e-9));
test("any mode: outcome A or outcome B", () => assertClose(solve({ tree: [["1/2", null, null], ["1/4", null, null], ["1/4", null, null]], goal: { "1": 1, "2": 1 }, goalMode: "any" }).mean, 2, 1e-9));
test("owning 2 of 4 already: 2 more different", () =>
  assertClose(solve({ tree: T4, goal: [{ type: "distinct", k: 4 }], start: { owned: { "0": [1, 1, 0, 0] } } }).mean, 4 / 2 + 4 / 1, 1e-9));

test("budget of 4 pulls on 4 items", () => {
  const b = solve({ tree: T4, goal: [{ type: "distinct", k: 4 }], budget: 4 }).budget;
  assertClose(b.chanceGoal, 24 / 256, 1e-12, "P(all 4)");
  assertClose(b.requirements[0].mean, 4 * (1 - (3 / 4) ** 4), 1e-12, "expected different");
  assertClose(b.requirements[0].dist.reduce((a, x) => a + x, 0), 1, 1e-12, "distribution sums to 1");
});

test("nested pity tree (unchanged since the first version)", () => {
  const TREE = [["32/33", null, null], ["1/33", 30, [["1/2", null, null], ["1/2", 2, [["1/2", 3, null], ["1/2", 3, null]]]]]];
  assertClose(solve({ tree: TREE, goal: { "1,1,0": 1 } }).mean, 52.21185210843078, 1e-8);
});

// Exact worst case: the most pulls a goal can take (null when there's no guarantee)
const soft = [
  { name: "5★", p: 0.006, pity: 90, soft: { start: 74, step: 0.06 }, children: [{ name: "featured", p: "1/2", pity: 2 }, { name: "standard", p: "1/2", count: 7 }] },
  { name: "4★", p: 0.051, pity: 10, pityYields: true, children: [{ name: "f4", p: "1/2", pity: 2, count: 3 }, { name: "o4", p: "1/2", count: 18 }] },
  { name: "3★", p: "rest" },
];
const ex = [["32/33", null, null], ["1/33", 30, [["1/2", null, null], ["1/2", 2, [["1/2", 3, 4], ["1/2", 3, 5]]]]]];
for (const [label, q, want] of [
  ["50/50: featured ×7 (90×2×7)", { tree: soft, goal: { "0,0": 7 } }, 1260],
  ["50/50: featured ×1", { tree: soft, goal: { "0,0": 1 } }, 180],
  ["50/50: featured ×1 from pity 50 + guaranteed", { tree: soft, goal: { "0,0": 1 }, start: { pity: { "0": 50, "0,0": 1 } } }, 40],
  ["50/50: any 5★", { tree: soft, goal: { "0": 1 } }, 90],
  ["50/50: one specific standard (random)", { tree: soft, goal: [{ path: "0,1", type: "specific", item: 0, copies: 1 }] }, null],
  ["nested: really special ×3 (30×2×3)", { tree: ex, goal: { "1,1": 3 } }, 180],
  ["nested: any character", { tree: ex, goal: { "1,1,0": 1 } }, 180],
  ["nested: specific character (random)", { tree: ex, goal: [{ path: "1,1,0", type: "specific", item: 0, copies: 1 }] }, null],
  ["no pity at all", { tree: [["1/2", null, null], ["1/2", null, null]], goal: { "0": 1 } }, null],
]) test(`worst case: ${label}`, () => assert.equal(solve(q).max, want));

// Found by the random formula test: "specific item" on a one-item pool used to crash the chain
test("specific item of a single-item outcome", () => {
  const r = solve({ tree: [["1/4", null, 1], ["3/4", null, null]], goal: [{ path: "0", type: "specific", item: 0, copies: 2 }], method: "joint" });
  assertClose(r.mean, 8, 1e-9);
});

test("tiny chances by pull stay exact instead of rounding to 0", () => {
  // 6 copies at 1% each: by pull 6 the chance is 1e-12, far below rounding noise of 1 − survival
  const r = solve({ tree: [{ name: "hit", p: 0.01 }, { name: "miss", p: "rest" }], goal: [{ path: "0", copies: 6 }], method: "joint" });
  assert.ok(Math.abs(r.cdf[6] - 1e-12) < 1e-24, `cdf[6] = ${r.cdf[6]}`);
  assert.equal(r.cdf[5], 0);
});
