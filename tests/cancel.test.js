// Stopping a calculation in place: it ends with a "cancelled" error at any point, and leaves
// nothing half-done behind (the next calculation gives exactly the fresh result).
import { test } from "node:test";
import assert from "node:assert/strict";
import { solve, clearCache, setCancelCheck } from "../src/engine/banner-engine.js";
import { preset } from "./helpers.js";

const plain = (r) => JSON.stringify(r, (k, v) => (k === "ms" ? undefined : ArrayBuffer.isView(v) ? Array.from(v) : v));
const K2 = preset("kaleido2"), A = preset("anniversary");
const queries = [
  ["layered", { ...K2, goal: [{ path: "0,0", type: "distinct", k: 19, copies: 4 }, { path: "0,1", type: "distinct", k: 5, copies: 3 }], budget: 6000 }],
  ["joint", { ...A, method: "joint", goal: [{ path: "0,0,0", copies: 3 }, { path: "0,0,1", copies: 3 }, { path: "0,1", type: "distinct", k: 6, copies: 1 }], budget: 400 }],
  ["split", { tree: [{ name: "SSR", p: 0.02, pity: 40, children: [{ name: "pool", p: 1, count: 3 }] }, { name: "SR", p: 0.1, pity: 8 }, { name: "R", p: "rest" }], goal: [{ path: "0,0", type: "distinct", k: 3, copies: 1 }], method: "split", budget: 300 }],
];

// how many cancel checks a run makes (with the cache as it is now)
function countChecks(q) {
  let checks = 0;
  setCancelCheck(() => { checks++; return false; });
  try { solve(q); } finally { setCancelCheck(null); }
  return checks;
}

for (const [method, q] of queries) {
  test(`cancel in place: ${method}`, () => {
    clearCache();
    const fresh = plain(solve(q));
    const phases = new Set();
    for (const cold of [true, false]) {
      for (const frac of [0.05, 0.4, 0.8]) {
        // cold: nothing cached yet; warm: the same goal was just calculated (only some parts rerun)
        if (cold) clearCache(); else { clearCache(); solve(q); }
        const checks = countChecks(q) || 1;
        if (cold) clearCache(); else { clearCache(); solve(q); }
        let n = 0, last = "start";
        setCancelCheck(() => ++n > Math.floor(checks * frac));
        let err = null;
        try { solve({ ...q, onProgress: (p) => { last = p.phase; } }); } catch (e) { err = e; }
        setCancelCheck(null);
        const where = `${cold ? "cold" : "warm"}, ${Math.round(frac * 100)}% (${last})`;
        if (checks > 1) assert.equal(err?.code, "cancelled", `${where}: ${err?.message ?? "finished anyway"}`);
        phases.add(last);
        assert.equal(plain(solve(q)), fresh, `after stopping (${where}) the next result differs`);
      }
    }
    // the layered method has several long parts: the stops must have hit more than one of them
    if (method === "layered") assert.ok(phases.size >= 2, `stopped only in ${[...phases]}`);
  });
}
