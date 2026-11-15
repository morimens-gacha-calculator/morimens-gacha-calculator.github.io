// The chain-stepping kernels: WebAssembly vs plain JS, and the multi-thread version
// (helper threads via node:worker_threads, the same code the browser runs in Web Workers).
import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { compile } from "../src/engine/banner-engine.js";
import { makeStepper, setThreadPool, createPoolMemory } from "../src/engine/chain-step.js";
import { preset } from "./helpers.js";

const chain = () => {
  const A = preset("anniversary");
  return compile(A.tree, [{ path: "0,0,0", copies: 3 }, { path: "0,0,1", copies: 3 }, { path: "0,1", type: "distinct", k: 5, copies: 1 }], { maxStates: 1e6 });
};

function run(st, steps, w) {
  const h = w ? st.weights(w) : null;
  const out = [];
  for (let t = 0; t < steps; t++) out.push([st.step(), st.remaining, h ? st.dot(h) : 0]);
  st.close();
  return out;
}

test("WebAssembly and JS steppers give the same numbers", () => {
  const c = chain();
  const w = Float64Array.from({ length: c.N }, (_, k) => k % 7);
  const a = run(makeStepper(c, { useWasm: true, threads: false }), 200, w);
  const b = run(makeStepper(c, { useWasm: false }), 200, w);
  assert.equal(makeStepper(c, { threads: false }).kind, "wasm");
  for (let t = 0; t < a.length; t++) for (let i = 0; i < 3; i++) assert.equal(a[t][i], b[t][i], `step ${t}`);
});

test("helper threads give the same numbers (up to summation order)", async () => {
  const shared = createPoolMemory();
  assert.ok(shared, "shared memory available");
  const helpers = await Promise.all([1, 2].map((slot) => new Promise((resolve) => {
    const w = new Worker(new URL("./thread-entry.js", import.meta.url));
    w.on("message", (m) => {
      if (m.type === "ready") w.postMessage({ type: "init", mem: shared.mem, ctrl: shared.ctrl, slot });
      if (m.type === "initialised") resolve(w);
    });
  })));
  try {
    setThreadPool({ mem: shared.mem, ctrl: shared.ctrl, size: 2 });
    const c = chain();
    const w = Float64Array.from({ length: c.N }, (_, k) => (k % 5) / 3);
    for (let job = 0; job < 2; job++) { // twice: helpers must pick up a second job too
      const st = makeStepper(c, { minEdges: 0 });
      assert.match(st.kind, /threads/);
      const a = run(st, 120, w);
      const b = run(makeStepper(c, { threads: false }), 120, w);
      for (let t = 0; t < a.length; t++) for (let i = 0; i < 3; i++) assert.ok(Math.abs(a[t][i] - b[t][i]) < 1e-13, `job ${job}, step ${t}: ${a[t][i]} vs ${b[t][i]}`);
    }
  } finally {
    setThreadPool(null);
    await Promise.all(helpers.map((h) => h.terminate()));
  }
});
