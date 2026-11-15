// Pieces that don't change between runs (item formulas, event and timing chains, plans,
// distributions) are kept, so editing one row, the budget, or switching to "pulls" mode reuses
// the rest. Also the clock used for timings.
export const CACHE = new Map();

export const CACHE_MAX = 48;

export function cached(kind, keyParts, make) {
  const key = kind + "|" + JSON.stringify(keyParts);
  if (CACHE.has(key)) {
    const v = CACHE.get(key);
    CACHE.delete(key); CACHE.set(key, v); // most recently used last
    return v;
  }
  const v = make();
  CACHE.set(key, v);
  while (CACHE.size > CACHE_MAX) CACHE.delete(CACHE.keys().next().value);
  return v;
}

export function clearCache() { CACHE.clear(); }

export const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
