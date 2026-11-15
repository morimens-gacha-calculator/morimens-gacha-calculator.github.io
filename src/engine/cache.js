// Pieces that don't change between runs (item formulas, event and timing chains, plans,
// distributions) are kept, so editing one row, the budget, or switching to "pulls" mode reuses
// the rest. Kept by memory, not count: least recently used pieces go first once the total passes
// CACHE_MAX_BYTES, and a piece bigger than that on its own isn't kept at all. Also the clock
// used for timings.
import { CACHE_ENTRIES, CACHE_MAX_BYTES } from "./settings.js";

export const CACHE = new Map(); // key → { value, bytes }
let total = 0;

export function cached(kind, keyParts, make) {
  const key = kind + "|" + JSON.stringify(keyParts);
  const hit = CACHE.get(key);
  if (hit) {
    CACHE.delete(key); CACHE.set(key, hit); // most recently used last
    return hit.value;
  }
  const value = make();
  const bytes = sizeOf(value);
  if (bytes > CACHE_MAX_BYTES) return value;
  CACHE.set(key, { value, bytes });
  total += bytes;
  while (total > CACHE_MAX_BYTES || CACHE.size > CACHE_ENTRIES) {
    const [oldest, entry] = CACHE.entries().next().value;
    CACHE.delete(oldest);
    total -= entry.bytes;
  }
  return value;
}

export function clearCache() { CACHE.clear(); total = 0; }
export const cacheBytes = () => total;

// Rough memory of a value: typed arrays by their buffers (each buffer counted once, so views of
// one buffer don't add up), arrays and objects by their contents. A value can state its own size
// as `memoryBytes` (built chains do: their states sit inside a closure a walk can't see).
export function sizeOf(value) {
  const seen = new Set();
  let bytes = 0;
  const walk = (v, depth) => {
    if (v === null || typeof v !== "object" || depth > 12) { bytes += 8; return; }
    if (ArrayBuffer.isView(v)) { if (!seen.has(v.buffer)) { seen.add(v.buffer); bytes += v.buffer.byteLength; } return; }
    if (seen.has(v)) return;
    seen.add(v);
    if (typeof v.memoryBytes === "number") bytes += v.memoryBytes;
    if (Array.isArray(v)) { bytes += 16; for (const x of v) walk(x, depth + 1); return; }
    bytes += 32;
    for (const k of Object.keys(v)) if (k !== "memoryBytes") walk(v[k], depth + 1);
  };
  walk(value, 0);
  return bytes;
}

export const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
