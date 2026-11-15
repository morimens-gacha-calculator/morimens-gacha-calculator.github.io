// ── Exact best case: the earliest pull on which a goal can be met ──
// The mirror of worst.js: every outcome the banner allows goes your way. Inside a pool, which
// item a hit gives changes no counter, so per pool the fewest hits that meet its rows ("all"
// mode: every row; "any" mode: its easiest row) is a separate puzzle. The pool's rows then
// become "that many hits on the pool", a plain total, and a small chain of counts finds the
// fewest pulls with pity and memory (shortest path, chain.js).
// The result lets the distribution be exactly 0 before that pull, and known to be positive
// from it on, even where the layered method's FFT noise (~1e-16) hides how small it is.
import { compile } from "./chain.js";
import { expandSubsets, goalList, ownedFor, resolveItem } from "./goal.js";
import { poolRows } from "./pool-formulas.js";
import { canonTree, findAlt, normaliseNode, pathKey, resolvePath } from "./tree.js";

const SEARCH_LIMIT = 200000;

// Fewest hits that meet every given row (poolRows() form): 0 if already met, Infinity if they
// can't all be met, null if this search can't tell (then the caller uses a chain).
export function minHits(n, own, rows) {
  const low = new Array(n).fill(0); // per item: extra copies it must get
  const totals = [], distinct = [];
  for (const r of rows) {
    if (r.type === "specific") low[r.item] = Math.max(low[r.item], r.copies - own[r.item]);
    else if (r.type === "total") { const need = r.copies - r.base; if (need > 0) totals.push({ set: [...new Set(r.set)].sort((a, b) => a - b), need }); }
    else {
      const done = r.set.filter((i) => own[i] >= r.copies).length;
      const more = r.k - done; // items that must still reach the copies
      if (more <= 0) continue;
      const members = r.set.filter((i) => own[i] < r.copies);
      if (members.length < more) return Infinity;
      distinct.push({ c: r.copies, more, members: new Set(members) });
    }
  }
  const byKey = new Map();
  for (const t of totals) { const k = t.set.join(","); byKey.set(k, { set: t.set, need: Math.max(t.need, byKey.get(k)?.need ?? 0) }); }
  const sets = [...byKey.values()].sort((a, b) => a.set.length - b.set.length);
  for (const a of sets) for (const b of sets) {
    if (a === b) continue;
    const sb = new Set(b.set), inter = a.set.filter((i) => sb.has(i)).length;
    if (inter && inter !== a.set.length && inter !== b.set.length) return null;
  }
  const parent = sets.map((a, i) => { for (let j = i + 1; j < sets.length; j++) if (a.set.every((x) => sets[j].set.includes(x))) return j; return -1; });
  const owner = Array.from({ length: n }, (_, it) => sets.findIndex((s) => s.set.includes(it)));

  const D = distinct.length;
  const classes = new Map();
  for (let i = 0; i < n; i++) {
    const k = [own[i], low[i], owner[i], ...distinct.map((d) => (d.members.has(i) ? 1 : 0))].join("|");
    if (!classes.has(k)) classes.set(k, { rep: i, size: 0 });
    classes.get(k).size++;
  }
  const cls = [...classes.values()];
  // extra copies an item of class c gets when raised for the distinct rows in mask
  const costOf = (c, mask) => {
    let u = low[c.rep];
    for (let d = 0; d < D; d++) if (mask & (1 << d)) u = Math.max(u, distinct[d].c - own[c.rep]);
    return u;
  };
  const evaluate = (counts) => {
    const sum = new Array(sets.length).fill(0);
    let free = 0;
    cls.forEach((c, ci) => {
      for (const [mask, k] of counts[ci]) {
        if (!k) continue;
        const v = costOf(c, mask) * k;
        if (owner[c.rep] < 0) free += v; else sum[owner[c.rep]] += v;
      }
    });
    let total = free;
    for (let s = 0; s < sets.length; s++) { // children first: a set needs at least its own total
      const v = Math.max(sets[s].need, sum[s]);
      if (parent[s] >= 0) sum[parent[s]] += v; else total += v;
    }
    return total;
  };
  // Search: per class, how many items are raised for which distinct rows; each row needs
  // exactly `more` of them (raising more items only costs more)
  const masksOf = (c) => {
    let all = 0;
    for (let d = 0; d < D; d++) if (distinct[d].members.has(c.rep)) all |= 1 << d;
    const out = [];
    for (let m = all; m > 0; m = (m - 1) & all) out.push(m);
    return out;
  };
  const left = distinct.map((d) => d.more);
  let best = Infinity, tried = 0, gaveUp = false;
  const counts = cls.map(() => []);
  const go = (ci) => {
    if (gaveUp) return;
    if (++tried > SEARCH_LIMIT) { gaveUp = true; return; }
    if (ci === cls.length) { if (left.every((x) => x === 0)) best = Math.min(best, evaluate(counts)); return; }
    const masks = masksOf(cls[ci]);
    const place = (mi, rest) => {
      if (gaveUp) return;
      if (mi === masks.length) { counts[ci].push([0, rest]); go(ci + 1); counts[ci].pop(); return; }
      const m = masks[mi];
      let room = rest;
      for (let d = 0; d < D; d++) if (m & (1 << d)) room = Math.min(room, left[d]);
      for (let k = 0; k <= room; k++) {
        for (let d = 0; d < D; d++) if (m & (1 << d)) left[d] -= k;
        counts[ci].push([m, k]);
        place(mi + 1, rest - k);
        counts[ci].pop();
        for (let d = 0; d < D; d++) if (m & (1 << d)) left[d] += k;
      }
    };
    place(0, cls[ci].size);
  };
  go(0);
  return gaveUp ? null : best;
}

// The same from the pool's own chain (exact, but only for small ones)
function minHitsByChain(alt, reqs, owned, goalMode, maxStates) {
  const tree = [{ p: 1, count: alt.count, items: alt.itemNames ?? undefined }];
  const goal = reqs.map((r) => ({ ...r, path: "0" }));
  const ex = expandSubsets(tree, goal, owned != null ? { owned: { "0": owned } } : {});
  const c = compile(ex.tree, ex.goal, { start: ex.start, goalMode, maxStates });
  return c.best == null ? Infinity : c.best; // every pull is a hit here
}

// The earliest pull on which the goal can be met (null if never). Throws like compile when even
// the reduced chain is too big.
export function bestCase(tree, goal, start = {}, goalMode = "all", maxStates) {
  const list = goalList(goal);
  const root = normaliseNode(canonTree(tree), []);
  const pools = new Map(), kept = [];
  for (const g of list) {
    const path = g.paths ? null : resolvePath(root, g.path);
    const alt = path ? findAlt(root, path) : null;
    if (!alt || alt.child || !(alt.count > 1)) { kept.push(g); continue; }
    const key = pathKey(path);
    if (!pools.has(key)) pools.set(key, { path, alt, reqs: [], rowPath: g.path });
    pools.get(key).reqs.push(g);
  }

  const reduced = [...kept], ownedKeys = new Set();
  for (const x of pools.values()) {
    const ownedVal = ownedFor(root, start, x);
    const owned = Array.isArray(ownedVal) ? ownedVal : ownedVal != null ? [ownedVal] : [];
    const where = x.reqs[0]?.label ?? pathKey(x.path);
    const rows = x.reqs.map((r) => ({
      type: r.type ?? "total",
      item: r.type === "specific" ? resolveItem(x.alt, r.item ?? 0, where) : undefined,
      items: Array.isArray(r.items) ? r.items.map((it) => resolveItem(x.alt, it, where)) : null,
      copies: r.copies ?? 1, k: r.k, have: r.have,
    }));
    const { own, norm } = poolRows(x.alt.count, rows, owned);
    const fewest = (subset, subReqs, mode) => minHits(x.alt.count, own, subset) ?? minHitsByChain(x.alt, subReqs, ownedVal, mode, maxStates);
    const h = goalMode === "all"
      ? fewest(norm, x.reqs, "all")
      : norm.reduce((m, r, i) => Math.min(m, fewest([r], [x.reqs[i]], "all")), Infinity);
    for (const [k] of Object.entries(start.owned ?? {})) if (pathKey(resolvePath(root, k)) === pathKey(x.path)) ownedKeys.add(k);
    if (h === Infinity) {
      if (goalMode === "all") return null; // this pool's rows can never all be met
      continue;
    }
    if (h === 0) {
      if (goalMode === "any") return 0;     // already met
      continue;
    }
    reduced.push({ path: x.rowPath, type: "total", copies: h });
  }
  if (!reduced.length) return goalMode === "all" ? 0 : null;

  const owned = Object.fromEntries(Object.entries(start.owned ?? {}).filter(([k]) => !ownedKeys.has(k)));
  const ex = expandSubsets(tree, reduced, { ...start, owned });
  const c = compile(ex.tree, ex.goal, { start: ex.start, goalMode, maxStates });
  return c.best;
}
