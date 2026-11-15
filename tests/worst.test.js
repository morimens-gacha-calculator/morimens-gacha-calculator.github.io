// The worst case ("guaranteed by") comes from a separate small calculation when the layered or
// split method gives the distribution (worst.js). It must equal the joint chain's exact answer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, worstCase } from "../src/engine/banner-engine.js";
import { preset, rng } from "./helpers.js";

const trees = {
  sr: [{ name: "SSR", p: 0.02, pity: 12, children: [{ name: "pool", p: 1, count: 3, items: ["A", "B", "C"] }] }, { name: "SR", p: 0.1, pity: 5 }, { name: "R", p: "rest" }],
  two: [{ name: "SSR", p: 0.05, pity: 10, children: { streak: 1, alts: [{ name: "lim", p: 0.5, count: 2, items: ["X", "Y"] }, { name: "std", p: "rest", count: 3 }] } }, { name: "R", p: "rest" }],
  single: [{ name: "SSR", p: 0.05, pity: 8, children: { streak: 1, alts: [{ name: "lim", p: 0.5 }, { name: "std", p: "rest", count: 3 }] } }, { name: "R", p: "rest" }],
};
const pools = { sr: [["0,0", 3]], two: [["0,0", 2], ["0,1", 3]], single: [["0,1", 3]] };

test("worst case = joint chain's, on random goals (types, subsets, owned, any/all)", () => {
  const { next: R } = rng(5);
  const pick = (a) => a[Math.floor(R() * a.length)];
  let checked = 0, bounded = 0;
  for (let it = 0; it < 120; it++) {
    const key = pick(Object.keys(trees)), tree = trees[key];
    const rows = [];
    for (let r = 0, nr = 1 + Math.floor(R() * 3); r < nr; r++) {
      if (key === "single" && R() < 0.4) { rows.push({ path: "0,0", copies: 1 + Math.floor(R() * 2) }); continue; }
      const [path, cnt] = pick(pools[key]);
      const type = pick(["total", "specific", "distinct", "total"]);
      const row = { path, type, copies: 1 + Math.floor(R() * 3) };
      if (type === "specific") row.item = Math.floor(R() * cnt);
      if (type === "distinct") row.k = 1 + Math.floor(R() * cnt);
      if (type !== "specific" && R() < 0.3) row.items = [...new Set([Math.floor(R() * cnt), Math.floor(R() * cnt)])];
      if (type === "total" && R() < 0.2) row.have = 1;
      rows.push(row);
    }
    const goalMode = R() < 0.5 ? "all" : "any";
    const start = {};
    if (R() < 0.4) { const [path, cnt] = pick(pools[key]); start.owned = { [path]: Array.from({ length: cnt }, () => Math.floor(R() * 3)) }; }
    if (R() < 0.3) start.pity = { "0": Math.floor(R() * 5) };
    let J;
    try { J = solve({ tree, goal: rows, goalMode, start, method: "joint", eps: 1e-9 }); } catch { continue; } // e.g. k above a subset's size
    assert.equal(worstCase(tree, rows, start, goalMode, 2e6), J.max, JSON.stringify({ key, goalMode, rows, start }));
    checked++;
    if (J.max != null) bounded++;
  }
  assert.ok(checked > 100 && bounded > 40, `${checked} checked, ${bounded} bounded`);
});

test("layered shows the worst case when there is one", () => {
  const LC = preset("limitedChar");
  const q = { ...LC, goalMode: "any", goal: [{ path: "0,0", copies: 6 }, { path: "0,1", type: "distinct", k: 3, copies: 2 }] };
  const L = solve({ ...q, method: "layered" }), J = solve({ ...q, method: "joint" });
  assert.equal(L.method, "layered");
  assert.ok(J.max != null);
  assert.equal(L.max, J.max);
  assert.equal(L.maxKnown, true);
});

test("no worst case when an item can be avoided forever", () => {
  const K = preset("kaleido2");
  const r = solve({ ...K, goal: [{ path: "0,0", type: "distinct", k: 19, copies: 4 }, { path: "0,1", copies: 4 }] });
  assert.equal(r.max, null);
  assert.equal(r.maxKnown, true);
  // pigeonhole: any one character ×3 is forced after 19·2 + 1 characters
  assert.ok(worstCase(K.tree, [{ path: "0,0", type: "distinct", k: 1, copies: 3 }], {}, "all", 2e6) > 0);
});
