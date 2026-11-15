// The WebAssembly kernels in src/engine/wasm-kernels.js are the compiled .wat sources (run
// `npm run build:wasm` after editing a .wat file).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { compileKernels, render } from "../scripts/build-wasm.mjs";

test("wasm-kernels.js matches the .wat sources", async () => {
  const generated = readFileSync(new URL("../src/engine/wasm-kernels.js", import.meta.url), "utf8");
  assert.equal(generated, render(await compileKernels()), "out of date: run npm run build:wasm");
});
