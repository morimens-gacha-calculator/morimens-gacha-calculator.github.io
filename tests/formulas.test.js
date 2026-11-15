// Pool formulas against the slow, obviously-correct way (a state chain over the items).
import { test } from "node:test";
import assert from "node:assert/strict";
import { poolPlan, poolNotMet, poolBudget } from "../src/engine/pool-formulas.js";
import { poolByChain, rng } from "./helpers.js";

function compare(n, rows, owned, mode) {
  const plan = poolPlan(n, rows, owned, mode);
  assert.ok(plan, "formulas should handle this goal");
  const S = poolNotMet(plan, 1e-16);
  const H = S.length - 1 + 3;
  const ref = poolByChain(n, rows, owned, mode, H);
  let dS = 0, dB = 0;
  for (let h = 0; h <= H; h++) dS = Math.max(dS, Math.abs((S[h] ?? 0) - ref.S[h]));
  const B = poolBudget(plan, H);
  for (let h = 0; h <= H; h++) {
    const hh = Math.min(h, B.G.length - 1);
    dB = Math.max(dB, Math.abs(B.G[hh] - ref.G[h]));
    B.E.forEach((e, i) => { dB = Math.max(dB, Math.abs(e[hh] - ref.E[i][h])); });
  }
  return { dS, dB };
}

const cases = [
  ["all 4 different", 4, [{ type: "distinct", k: 4, copies: 1 }], [], "all"],
  ["2 of 5 at ×2", 5, [{ type: "distinct", k: 2, copies: 2 }], [], "all"],
  ["specific ×3 of 6", 6, [{ type: "specific", item: 2, copies: 3 }], [], "all"],
  ["two specific items", 5, [{ type: "specific", item: 0, copies: 2 }, { type: "specific", item: 1, copies: 1 }], [], "all"],
  ["two specific items, any", 5, [{ type: "specific", item: 0, copies: 2 }, { type: "specific", item: 1, copies: 3 }], [], "any"],
  ["owned + 3 of 6 at ×2", 6, [{ type: "distinct", k: 3, copies: 2 }], [2, 1, 0, 0, 3, 1], "all"],
  ["total + specific, owned", 4, [{ type: "total", copies: 5 }, { type: "specific", item: 3, copies: 2 }], [1, 0, 0, 1], "all"],
  ["subset total with have", 6, [{ type: "total", copies: 4, have: 1, items: [0, 1] }, { type: "specific", item: 4, copies: 1 }], [], "all"],
  ["subset different + specific inside it", 7, [{ type: "distinct", k: 2, copies: 2, items: [0, 1, 2] }, { type: "specific", item: 1, copies: 3 }], [], "all"],
  ["two different-rows", 5, [{ type: "distinct", k: 2, copies: 3 }, { type: "distinct", k: 4, copies: 1 }], [], "all"],
  ["two different-rows, any", 5, [{ type: "distinct", k: 3, copies: 2 }, { type: "distinct", k: 5, copies: 1 }], [0, 1], "any"],
  ["different + total, any", 5, [{ type: "distinct", k: 3, copies: 2 }, { type: "total", copies: 8 }], [], "any"],
  ["all items, any mode", 4, [{ type: "distinct", k: 4, copies: 2 }], [], "any"],
  ["nested totals", 6, [{ type: "total", copies: 3, items: [0, 1] }, { type: "total", copies: 5, items: [0, 1, 2, 3] }, { type: "specific", item: 5, copies: 1 }], [], "all"],
  ["nested totals, any", 6, [{ type: "total", copies: 3, items: [0, 1] }, { type: "total", copies: 6, items: [0, 1, 2, 3] }], [], "any"],
  ["single outcome", 1, [{ type: "total", copies: 3 }], [1], "all"],
];
for (const [label, n, rows, owned, mode] of cases) {
  test(`formula: ${label}`, () => {
    const { dS, dB } = compare(n, rows, owned, mode);
    assert.ok(dS < 1e-13, `P(not met) differs by ${dS}`);
    assert.ok(dB < 1e-12, `budget pieces differ by ${dB}`);
  });
}

test("formula: 100 random pool goals", () => {
  const r = rng(12345);
  let checked = 0;
  for (let t = 0; t < 115 && checked < 100; t++) {
    const n = r.int(1, 7), mode = r.next() < 0.3 ? "any" : "all";
    const rows = [];
    for (let k = r.int(1, 3); k > 0; k--) {
      const ty = ["specific", "total", "distinct"][r.int(0, 2)];
      const sub = n > 1 && r.next() < 0.4 ? [...new Set(Array.from({ length: r.int(1, n) }, () => r.int(0, n - 1)))] : null;
      if (ty === "specific") rows.push({ type: ty, item: r.int(0, n - 1), copies: r.int(1, 3) });
      else if (ty === "total") rows.push({ type: ty, copies: r.int(1, 6), ...(sub ? { items: sub } : {}), ...(r.next() < 0.3 ? { have: r.int(0, 2) } : {}) });
      else rows.push({ type: ty, k: r.int(1, sub ? sub.length : n), copies: r.int(1, 3), ...(sub ? { items: sub } : {}) });
    }
    const owned = r.next() < 0.4 ? Array.from({ length: n }, () => r.int(0, 2)) : [];
    if (!poolPlan(n, rows, owned, mode)) continue; // subsets that partly overlap: the chain does those
    const { dS } = compare(n, rows, owned, mode);
    assert.ok(dS < 1e-12, `case ${t} (${JSON.stringify({ n, mode, rows, owned })}): differs by ${dS}`);
    checked++;
  }
  assert.ok(checked >= 90, `only ${checked} cases checked`);
});

test("formula: total subsets that partly overlap are left to the chain", () => {
  assert.equal(poolPlan(4, [{ type: "total", copies: 2, items: [0, 1] }, { type: "total", copies: 2, items: [1, 2] }], [], "all"), null);
});
