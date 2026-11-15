// The three methods (joint, split, layered) are independent ways to the same exact answer:
// on goals small enough for all of them, they must agree.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, budgetOnly } from "../src/engine/banner-engine.js";
import { preset, resultDiff } from "./helpers.js";

const K2 = preset("kaleido2"), K1 = preset("kaleido1"), A = preset("anniversary"), LC = preset("limitedChar");
const own = Array(15).fill(0); own[0] = 1; own[3] = 2; // Arc 1 has 15 characters

const layeredCases = [
  ["Kaleido default goal", K2],
  ["Kaleido, any mode", { ...K2, goalMode: "any" }],
  ["Kaleido: subset + total", { ...K2, goal: [{ path: "0,0", type: "distinct", k: 2, copies: 1, items: [0, 1, 2] }, { path: "0,1", type: "total", copies: 3 }] }],
  ["Kaleido: two rows on one pool", { ...K2, goal: [{ path: "0,0", type: "specific", item: 0, copies: 2 }, { path: "0,0", type: "specific", item: 1, copies: 1 }, { path: "0,1", type: "specific", item: 0, copies: 1 }] }],
  ["Kaleido: pity and memory at the start", { ...K2, start: { pity: { "0": 12 }, streak: { "0": [0, 1] }, owned: {} } }],
  ["Kaleido: owned copies", { ...K1, goal: [{ path: "0,0", type: "distinct", k: 3, copies: 2 }, { path: "0,1", type: "specific", item: 0, copies: 1 }], start: { owned: { "0,0": own } } }],
  ["Kaleido: subset with have", { ...K1, goal: [{ path: "0,0", type: "total", copies: 4, have: 1, items: [0, 1] }, { path: "0,1", type: "specific", item: 1, copies: 1 }] }],
  ["Kaleido: one pool only", { ...K1, goal: [{ path: "0,0", type: "distinct", k: 2, copies: 2 }] }],
  ["Anniversary default", A],
  ["Anniversary, any mode", { ...A, goalMode: "any" }],
  ["Anniversary from pity 20", { ...A, start: { pity: { "0": 20, "0,0": 1 } } }],
  ["Anniversary: 3 groups", { ...A, goal: [{ path: "0,0,0", copies: 2 }, { path: "0,0,1", copies: 1 }, { path: "0,1", type: "distinct", k: 3, copies: 1 }] }],
  ["Anniversary: 3 groups, any", { ...A, goalMode: "any", goal: [{ path: "0,0,0", copies: 3 }, { path: "0,0,1", copies: 2 }, { path: "0,1", type: "specific", item: 2, copies: 2 }] }],
  ["Anniversary: 3 groups, start + owned", { ...A, start: { pity: { "0": 17, "0,0": 1 }, streak: { "0,0": [1, 1] }, owned: { "0,1": [1, 0, 2, 0, 0, 0, 1, 0, 0, 0] } }, goal: [{ path: "0,0,0", copies: 2 }, { path: "0,0,1", copies: 2 }, { path: "0,1", type: "distinct", k: 4, copies: 2 }] }],
  ["Limited character: pity inside the SSR", { ...LC, goal: [{ path: "0,0", copies: 2 }, { path: "0,1", type: "distinct", k: 3, copies: 1 }], start: { pity: { "0": 10, "0,0": 2 } } }],
  ["Limited character ×3 from a start", { ...LC, goal: [{ path: "0,0", copies: 3 }], start: { pity: { "0": 5, "0,0": 2 } } }],
];
for (const [label, q] of layeredCases) {
  test(`layered = joint: ${label}`, () => {
    const J = solve({ ...q, method: "joint", budget: 300 });
    const L = solve({ ...q, method: "layered", budget: 300 });
    assert.equal(L.method, "layered");
    assert.deepEqual(L.requirements, J.requirements, "row labels");
    const d = resultDiff(J, L);
    assert.ok(d < 1e-9, `differs by ${d}`);
  });
}

// A banner that doesn't restart at each SSR (the SR counter keeps going): split instead of layered
const srTree = [
  { name: "SSR", p: 0.02, pity: 40, children: [{ name: "pool", p: 1, count: 6, items: ["A", "B", "C", "D", "E", "F"] }] },
  { name: "SR", p: 0.1, pity: 8 },
  { name: "R", p: "rest" },
];
const splitCases = [
  ["specific ×2", [{ path: "0,0", type: "specific", item: 1, copies: 2 }], {}, "all"],
  ["3 different ×2 + total 8, owned", [{ path: "0,0", type: "distinct", k: 3, copies: 2 }, { path: "0,0", copies: 8 }], { owned: { "0,0": [1, 0, 0, 2, 0, 0] } }, "all"],
  ["subset, any mode, from pity", [{ path: "0,0", type: "distinct", k: 2, copies: 1, items: ["A", "C", "E"] }, { path: "0,0", type: "specific", item: "B", copies: 3 }], { pity: { "0": 13, "1": 5 } }, "any"],
  ["named items merged (all)", ["A", "B", "C", "D"].map((it) => ({ path: "0,0", type: "specific", item: it, copies: 2 })), {}, "all"],
  ["named items merged (any)", [{ path: "0,0", type: "specific", item: "A", copies: 3 }, { path: "0,0", type: "specific", item: "B", copies: 3 }, { path: "0,0", type: "specific", item: "C", copies: 1 }], {}, "any"],
];
for (const [label, goal, start, goalMode] of splitCases) {
  test(`split = joint: ${label}`, () => {
    const q = { tree: srTree, goal, start, goalMode, budget: 250 };
    const J = solve({ ...q, method: "joint" }), S = solve({ ...q, method: "split" });
    assert.equal(S.method, "split");
    const d = resultDiff(J, S);
    assert.ok(d < 1e-9, `differs by ${d}`);
  });
}

test("layered refuses a banner that doesn't restart at each SSR", () => {
  assert.throws(() => solve({ tree: srTree, goal: [{ path: "0,0", type: "specific", item: 1, copies: 2 }], method: "layered" }));
});

test("budgetOnly (pulls mode) = budget report of solve", () => {
  const a = budgetOnly({ ...K2, method: "layered", budget: 200 }), b = solve({ ...K2, method: "joint", budget: 200 }).budget;
  assert.ok(Math.abs(a.chanceGoal - b.chanceGoal) < 1e-12);
});

// Item subsets vs the same goal written out by hand (one outcome per character)
const chars = ["Lily", "GHelot", "Miryam", "Tawil", "Thais", "Daffodil", "Ryker", "Murphy", "Tulu", "Horla", "Wanda", "24", "Hameln", "Salvador", "Sorel"];
const N = chars.length;
const banner = (characterNode) => [
  { name: "SSR", p: "1/33", pity: 30, children: { streak: 2, alts: [characterNode, { name: "wheel", p: "2/3", count: N }] } },
  { name: "rest", p: "rest" },
];
const pool = banner({ name: "character", p: "1/3", count: N, items: chars });
const each = banner({ name: "character", p: "1/3", children: chars.map((c) => ({ name: c, p: `1/${N}` })) });
const want = ["Lily", "Tawil", "Sorel"];
const leaf = (name) => `0,0,${chars.indexOf(name)}`;
for (const [label, A1, B1] of [
  ["5 copies total from 3 chosen", { tree: pool, goal: [{ path: "0,0", type: "total", items: want, copies: 5 }] }, { tree: each, goal: [{ paths: want.map(leaf), type: "total", copies: 5 }] }],
  ["2 different of 4 chosen", { tree: pool, goal: [{ path: "0,0", type: "distinct", items: [...want, "Wanda"], k: 2 }] }, { tree: each, goal: [{ paths: [...want, "Wanda"].map(leaf), type: "distinct", k: 2 }] }],
  ["Lily ×2 + 3 total from 3 chosen", { tree: pool, goal: [{ path: "0,0", type: "specific", item: "Lily", copies: 2 }, { path: "0,0", type: "total", items: want, copies: 3 }] }, { tree: each, goal: [{ path: leaf("Lily"), copies: 2 }, { paths: want.map(leaf), type: "total", copies: 3 }] }],
  ["2 different of 3 chosen, Tawil owned", { tree: pool, goal: [{ path: "0,0", type: "distinct", items: want, k: 2 }], start: { owned: { "0,0": chars.map((c) => (c === "Tawil" ? 1 : 0)) } } }, { tree: each, goal: [{ paths: want.map(leaf), type: "distinct", k: 2 }], start: { owned: { [leaf("Tawil")]: 1 } } }],
  ["overlapping subsets, any mode", { tree: pool, goalMode: "any", goal: [{ path: "0,0", type: "total", items: ["Lily", "Tawil"], copies: 3 }, { path: "0,0", type: "total", items: ["Tawil", "Sorel"], copies: 3 }] }, { tree: each, goalMode: "any", goal: [{ paths: ["Lily", "Tawil"].map(leaf), type: "total", copies: 3 }, { paths: ["Tawil", "Sorel"].map(leaf), type: "total", copies: 3 }] }],
]) {
  test(`subsets: ${label}`, () => {
    const a = solve({ ...A1, budget: 500 }), b = solve({ ...B1, budget: 500 });
    assert.ok(Math.abs(a.mean - b.mean) < 1e-6, `${a.mean} vs ${b.mean}`);
    assert.ok(Math.abs(a.budget.chanceGoal - b.budget.chanceGoal) < 1e-9);
  });
}

test("big goal: all 19 ×6 + all 19 wheels ×6 runs and is sensible", () => {
  const r = solve({ ...K2, goal: [{ path: "0,0", type: "distinct", k: 19, copies: 6 }, { path: "0,1", type: "distinct", k: 19, copies: 6 }] });
  assert.equal(r.method, "layered");
  assert.ok(Math.abs(r.mean - 9814.56) < 0.01, `mean ${r.mean}`);
  assert.ok(r.tail < 1e-12);
});

// The event layer stores only reachable cells; these values come from the earlier version that
// stored every combination (results must be identical).
const REF_ANNIV = { chance: 0.7395014272518445, rows: [6.000000000000036, 6.000000000000036, 9.713754142000301] };
test("big goal: all 19 ×16 + all 19 wheels ×16 within the default limits", () => {
  const r = solve({ ...K2, goal: [{ path: "0,0", type: "distinct", k: 19, copies: 16 }, { path: "0,1", type: "distinct", k: 19, copies: 16 }], percentiles: [99] });
  assert.equal(r.method, "layered");
  assert.ok(Math.abs(r.mean - 20689.89117535) < 1e-6, `mean ${r.mean}`);
  assert.equal(r.percentiles.p99, 27263);
});

test("event layer, 3 groups with a budget report (pinned)", () => {
  const r = solve({ ...A, goal: [{ path: "0,0,0", copies: 6 }, { path: "0,0,1", copies: 6 }, { path: "0,1", type: "distinct", k: 10, copies: 4 }], budget: 5000 });
  assert.ok(Math.abs(r.mean - 4493.180529) < 1e-6, `mean ${r.mean}`);
  assert.ok(Math.abs(r.budget.chanceGoal - REF_ANNIV.chance) < 1e-12, `chance ${r.budget.chanceGoal}`);
  r.budget.requirements.forEach((x, i) => assert.ok(Math.abs(x.mean - REF_ANNIV.rows[i]) < 1e-9, `row ${i}: ${x.mean}`));
});

// Budget reports of the layered method use generating functions + FFT instead of a table of
// "events by pull". Long budgets (many SSRs) against the joint method's pull-by-pull chain:
for (const [label, q] of [
  ["Kaleido default, 3,000 pulls", { ...K2, budget: 3000 }],
  ["Kaleido any mode, 1,500 pulls", { ...K2, goalMode: "any", budget: 1500 }],
  ["Anniversary from pity, 700 pulls", { ...A, start: { pity: { "0": 20, "0,0": 1 } }, goal: [{ path: "0,0,0", copies: 3 }, { path: "0,1", type: "specific", item: 4, copies: 2 }], budget: 700 }],
  ["Limited character, 4,000 pulls (goal certain)", { ...LC, goal: [{ path: "0,0", copies: 2 }, { path: "0,1", type: "distinct", k: 3, copies: 1 }], budget: 4000 }],
]) {
  test(`long budget, layered = joint: ${label}`, () => {
    const J = solve({ ...q, method: "joint" }), L = solve({ ...q, method: "layered" });
    const d = resultDiff(J, L);
    assert.ok(d < 1e-11, `differs by ${d}`);
    for (let t = 0; t < J.budget.goalByPull.length; t += 1) assert.ok(L.budget.goalByPull[t] >= 0 && L.budget.goalByPull[t] <= 1);
  });
}

test("budget edge cases: 0 pulls, fewer pulls than one SSR gap", () => {
  const goal = [{ path: "0,0", copies: 2 }, { path: "0,1", type: "distinct", k: 3, copies: 1 }];
  for (const [budget, start] of [[0, {}], [10, { pity: { "0": 25 } }], [3, {}]]) {
    const J = solve({ ...LC, goal, start, budget, method: "joint" }), L = solve({ ...LC, goal, start, budget, method: "layered" });
    const d = resultDiff(J, L);
    assert.ok(d < 1e-12, `budget ${budget}: differs by ${d}`);
    assert.equal(L.budget.goalByPull.length, budget + 1);
  }
});

test("×16 budget report at 20,000 pulls (pinned to the version with the full table)", () => {
  const b = solve({ ...K2, goal: [{ path: "0,0", type: "distinct", k: 19, copies: 16 }, { path: "0,1", type: "distinct", k: 19, copies: 16 }], budget: 20000 }).budget;
  assert.ok(Math.abs(b.chanceGoal - 0.42472191075631854) < 1e-11, `chance ${b.chanceGoal}`);
  assert.ok(Math.abs(b.requirements[0].mean - 18.255097549215197) < 1e-10);
  assert.ok(Math.abs(b.requirements[1].mean - 18.956726634460832) < 1e-10);
  assert.ok(Math.abs(b.goalByPull[10000]) < 1e-11, "nothing by 10,000 pulls");
});

// Every method builds its budget report with the same builder: same rows, same shape
test("budget reports have the same rows whichever method made them", () => {
  const srTree = [
    { name: "SSR", p: 0.02, pity: 40, children: [{ name: "pool", p: 1, count: 6, items: ["A", "B", "C", "D", "E", "F"] }] },
    { name: "SR", p: 0.1, pity: 8 },
    { name: "R", p: "rest" },
  ];
  const shape = (b) => b.requirements.map((r) => ({ label: r.label, type: r.type, copies: r.copies, target: r.target, len: r.dist.length }));
  const checks = [
    [{ ...K2, goal: [{ path: "0,0", type: "distinct", k: 2, copies: 2, items: [0, 1, 2] }, { path: "0,1", type: "total", copies: 3, have: 1 }, { path: "0,0", type: "specific", item: 4, copies: 2 }], budget: 200 }, ["joint", "layered"]],
    [{ tree: srTree, goal: [{ path: "0,0", type: "distinct", k: 3, copies: 2 }, { path: "0,0", copies: 8 }, { path: "0,0", type: "specific", item: "B", copies: 1 }], budget: 200 }, ["joint", "split"]],
    [{ tree: [["1/4", null, 1], ["3/4", null, null]], goal: [{ path: "0", type: "specific", item: 0, copies: 2 }], budget: 20 }, ["joint", "layered"]],
  ];
  for (const [q, methods] of checks) {
    const [a, b] = methods.map((method) => solve({ ...q, method }).budget);
    assert.deepEqual(shape(b), shape(a));
    assert.ok(b.goalByPull.every((v) => v >= 0 && v <= 1) && a.goalByPull.every((v) => v >= 0 && v <= 1));
  }
});
