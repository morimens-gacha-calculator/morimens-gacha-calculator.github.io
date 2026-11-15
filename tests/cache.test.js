// The cache is limited by memory: sizes are counted per buffer, and old pieces go first.
import { test } from "node:test";
import assert from "node:assert/strict";
import { cached, clearCache, cacheBytes, sizeOf, CACHE } from "../src/engine/cache.js";
import { CACHE_MAX_BYTES } from "../src/engine/settings.js";

test("sizes: typed arrays by buffer, shared buffers once", () => {
  const a = new Float64Array(1000);
  assert.ok(Math.abs(sizeOf(a) - 8000) < 100);
  assert.ok(sizeOf({ x: a, y: a.subarray(0, 10), z: [a] }) < 8300, "one buffer counted once");
  assert.ok(sizeOf({ memoryBytes: 5e6, n: 1 }) >= 5e6, "a value can state its own size");
});

test("old pieces go once the memory budget is passed; too-big pieces aren't kept", () => {
  clearCache();
  const piece = Math.floor(CACHE_MAX_BYTES / 4);
  for (let i = 0; i < 6; i++) cached("t", [i], () => ({ memoryBytes: piece }));
  assert.ok(cacheBytes() <= CACHE_MAX_BYTES, `${cacheBytes()} bytes kept`);
  assert.ok(!CACHE.has('t|[0]') && CACHE.has('t|[5]'), "the oldest went first");
  let made = 0;
  cached("t", [5], () => { made++; return null; });
  assert.equal(made, 0, "a kept piece is reused");
  cached("big", [1], () => ({ memoryBytes: CACHE_MAX_BYTES * 2 }));
  assert.ok(!CACHE.has('big|[1]'), "too big to keep");
  clearCache();
  assert.equal(cacheBytes(), 0);
});
