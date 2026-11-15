// ── Exact worst case, whatever method gave the distribution ──
// The worst case is the most pulls a goal can take when every outcome the banner allows goes
// against you. It needs only which outcomes are possible, not their chances, which allows a
// much smaller calculation than the joint chain:
//   • Inside a pool, which item a hit gives changes no counter (pity and memory belong to
//     outcomes, not items). So the worst choice of items is a separate puzzle per pool: the most
//     hits h_max that can still keep the pool's rows unmet ("all" mode: at least one of them;
//     "any" mode: every one of them). The pool's rows are then exactly "h ≥ h_max + 1 hits on
//     the pool", a plain total, or can never be forced (no worst case in "all" mode; dropped in
//     "any" mode).
//   • The goal with those totals (and any rows not on pools, unchanged) is a small chain of
//     counts, and its longest path is the worst case (chain.js), exact with pity and memory.
// Examples: "a specific character from a random pool" can be avoided forever; "any 1 of 3 items
// ×2" is forced after 3·1 + 1 hits (pigeonhole); "limited ×2" with a 50/50 guarantee is bounded
// by the pity rules.
import { compile } from "./chain.js";
import { expandSubsets, goalList, ownedFor, resolveItem } from "./goal.js";
import { poolRows } from "./pool-formulas.js";
import { canonTree, findAlt, normaliseNode, pathKey, resolvePath } from "./tree.js";

const SEARCH_LIMIT = 200000; // item arrangements tried per pool before giving up

// Most hits a pool can take while every given row stays unmet: −1 if one is already met,
// Infinity if unbounded, null if this search can't tell (then the caller uses a chain).
// rows: poolRows() form; own: owned copies per item.
export function maxUnmet(n, own, rows) {
  const spec = new Array(n).fill(Infinity); // per item: most extra copies before a "specific" row is met
  const totals = [], distinct = [];
  for (const r of rows) {
    if (r.type === "specific") {
      const c = r.copies - own[r.item] - 1;
      if (c < 0) return -1;
      spec[r.item] = Math.min(spec[r.item], c);
    } else if (r.type === "total") {
      const c = r.copies - r.base - 1;
      if (c < 0) return -1;
      totals.push({ set: [...new Set(r.set)].sort((a, b) => a - b), cap: c });
    } else {
      const done = r.set.filter((i) => own[i] >= r.copies).length;
      const slack = r.k - 1 - done; // items that may still reach the copies
      if (slack < 0) return -1;
      distinct.push({ c: r.copies, slack, members: new Set(r.set.filter((i) => own[i] < r.copies)) });
    }
  }
  // totals: merge equal sets; they must nest or be disjoint (a forest)
  const byKey = new Map();
  for (const t of totals) { const k = t.set.join(","); byKey.set(k, { set: t.set, cap: Math.min(t.cap, byKey.get(k)?.cap ?? Infinity) }); }
  const sets = [...byKey.values()].sort((a, b) => a.set.length - b.set.length);
  for (const a of sets) for (const b of sets) {
    if (a === b) continue;
    const sb = new Set(b.set), inter = a.set.filter((i) => sb.has(i)).length;
    if (inter && inter !== a.set.length && inter !== b.set.length) return null;
  }
  const parent = sets.map((a, i) => { for (let j = i + 1; j < sets.length; j++) if (a.set.every((x) => sets[j].set.includes(x))) return j; return -1; });
  const owner = Array.from({ length: n }, (_, it) => sets.findIndex((s) => s.set.includes(it)));

  // Items alike in every respect are interchangeable: classes
  const D = distinct.length;
  const sigOf = (i) => [own[i], spec[i], owner[i], ...distinct.map((d) => (d.members.has(i) ? 1 : 0))].join("|");
  const classes = new Map();
  for (let i = 0; i < n; i++) {
    const k = sigOf(i);
    if (!classes.has(k)) classes.set(k, { rep: i, size: 0 });
    classes.get(k).size++;
  }
  const cls = [...classes.values()];
  // the extra copies an item of class c may get when it's let past the rows in mask
  const capOf = (c, mask) => {
    const i = c.rep;
    let u = spec[i];
    for (let d = 0; d < D; d++) if (distinct[d].members.has(i) && !(mask & (1 << d))) u = Math.min(u, distinct[d].c - 1 - own[i]);
    return u;
  };
  // value of an arrangement: per class, how many items get each mask
  const evaluate = (counts) => {
    const sum = new Array(sets.length).fill(0);
    let free = 0;
    cls.forEach((c, ci) => {
      for (const [mask, k] of counts[ci]) {
        if (!k) continue;
        const v = capOf(c, mask) * k;
        if (owner[c.rep] < 0) free += v; else sum[owner[c.rep]] += v;
      }
    });
    let total = free;
    for (let s = 0; s < sets.length; s++) { // smallest first: children before parents
      const v = Math.min(sets[s].cap, sum[s]);
      if (parent[s] >= 0) sum[parent[s]] += v; else total += v;
    }
    return total;
  };
  // Search: for each class, how many of its items are let past which distinct rows, within
  // each row's slack. Letting an item past a row only removes a cap, so more is never worse.
  const masksOf = (c) => {
    let all = 0;
    for (let d = 0; d < D; d++) if (distinct[d].members.has(c.rep)) all |= 1 << d;
    const out = [];
    for (let m = all; ; m = (m - 1) & all) { out.push(m); if (m === 0) break; }
    return out;
  };
  const slack = distinct.map((d) => d.slack);
  let best = -1, tried = 0, gaveUp = false;
  const counts = cls.map(() => []);
  const go = (ci) => {
    if (gaveUp) return;
    if (++tried > SEARCH_LIMIT) { gaveUp = true; return; }
    if (ci === cls.length) { best = Math.max(best, evaluate(counts)); return; }
    const masks = masksOf(cls[ci]).filter((m) => m !== 0);
    // distribute the class's items over the non-empty masks (the rest get none)
    const place = (mi, left) => {
      if (gaveUp) return;
      if (mi === masks.length) { counts[ci].push([0, left]); go(ci + 1); counts[ci].pop(); return; }
      const m = masks[mi];
      let room = left;
      for (let d = 0; d < D; d++) if (m & (1 << d)) room = Math.min(room, slack[d]);
      for (let k = room; k >= 0; k--) {
        for (let d = 0; d < D; d++) if (m & (1 << d)) slack[d] -= k;
        counts[ci].push([m, k]);
        place(mi + 1, left - k);
        counts[ci].pop();
        for (let d = 0; d < D; d++) if (m & (1 << d)) slack[d] += k;
        if (best === Infinity) return;
      }
    };
    place(0, cls[ci].size);
  };
  go(0);
  return gaveUp ? null : best;
}

// Same answer from the pool's own chain (exact, but only for small ones)
function maxUnmetByChain(alt, reqs, owned, goalMode, maxStates) {
  const tree = [{ p: 1, count: alt.count, items: alt.itemNames ?? undefined }];
  const goal = reqs.map((r) => ({ ...r, path: "0" }));
  const ex = expandSubsets(tree, goal, owned != null ? { owned: { "0": owned } } : {});
  const c = compile(ex.tree, ex.goal, { start: ex.start, goalMode, maxStates });
  return c.worst == null ? Infinity : c.worst - 1; // every pull is a hit here
}

// The exact worst case of a goal: a number of pulls, or null when it can be delayed forever.
// Throws (like compile) when even the reduced chain is too big.
export function worstCase(tree, goal, start = {}, goalMode = "all", maxStates) {
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
    const most = (subset, subReqs) => maxUnmet(x.alt.count, own, subset) ?? maxUnmetByChain(x.alt, subReqs, ownedVal, "any", maxStates);
    // most hits that keep the pool from being done
    const m = goalMode === "all"
      ? norm.reduce((acc, r, i) => Math.max(acc, most([r], [x.reqs[i]])), -1)
      : most(norm, x.reqs);
    for (const [k] of Object.entries(start.owned ?? {})) if (pathKey(resolvePath(root, k)) === pathKey(x.path)) ownedKeys.add(k);
    if (m === Infinity) {
      if (goalMode === "all") return null; // this pool can be kept from finishing forever
      continue;                            // "any": it never forces the goal
    }
    if (m < 0) {
      if (goalMode === "any") return 0;    // already met
      continue;                            // "all": this pool is already done
    }
    reduced.push({ path: x.rowPath, type: "total", copies: m + 1 });
  }
  if (!reduced.length) return goalMode === "all" ? 0 : null;

  const owned = Object.fromEntries(Object.entries(start.owned ?? {}).filter(([k]) => !ownedKeys.has(k)));
  const ex = expandSubsets(tree, reduced, { ...start, owned });
  const c = compile(ex.tree, ex.goal, { start: ex.start, goalMode, maxStates });
  return c.worst;
}
