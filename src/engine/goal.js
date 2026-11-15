// Goal rows: parsing, item subsets, labels, grouping rows by pool, merging named items.
import { EngineError, internalError } from "./errors.js";
import { canonTree, findAlt, isPosInt, leavesUnder, normaliseNode, pathKey, resolvePath } from "./tree.js";

export const goalList = (goal) => (Array.isArray(goal) ? goal : Object.entries(goal ?? {}).map(([path, copies]) => ({ path, copies })));

export function parseGoal(root, goalRaw) {
  const list = Array.isArray(goalRaw)
    ? goalRaw
    : Object.entries(goalRaw ?? {}).map(([path, copies]) => ({ path, copies }));
  if (list.length === 0) throw new EngineError("emptyGoal", {}, "Goal is empty");
  return list.map((g) => {
    // `paths` (several outcomes counted together) comes from expandSubsets; `path` is one outcome
    const paths = Array.isArray(g.paths) ? g.paths.map((x) => resolvePath(root, x)) : [resolvePath(root, g.path)];
    const path = paths[0];
    const shown = g.label ?? (g.path === undefined || g.path === "" ? "everything" : String(g.path ?? g.paths));
    for (const p of paths) if (p.length && !findAlt(root, p)) throw internalError(`Goal path "${shown}" not in tree`);
    const have = Math.max(0, Math.floor(Number(g.have) || 0));
    const copies = g.copies ?? 1;
    if (!isPosInt(copies)) throw internalError(`copies for "${shown}" must be a positive integer`);
    let type = g.type ?? "total";
    if (type === "specific") {
      const alt = findAlt(root, path);
      if (!alt || alt.child)
        throw internalError(`"specific" needs a single item or a pool (count), not "${shown}"`);
      if (alt.count === 1) return { type: "total", path, paths: [path], copies, have, label: g.label ?? `${shown} ×${copies}` };
      let item = g.item ?? 0;
      if (typeof item === "string" && !/^\d+$/.test(item)) {
        const j = (alt.itemNames ?? []).indexOf(item);
        if (j < 0) throw new EngineError("noItemNamed", { row: shown, item }, `Pool "${shown}" has no item named "${item}"`);
        item = j;
      }
      item = Number(item);
      if (!Number.isInteger(item) || item < 0 || item >= alt.count)
        throw new EngineError("itemOutOfRange", { row: shown, count: alt.count }, `Pool "${shown}" has items 0–${alt.count - 1}, not ${g.item}`);
      const nm = alt.itemNames?.[item] ?? `item ${item + 1}`;
      return { type, path, copies, group: alt, item, label: g.label ?? `${nm} ×${copies}` };
    }
    if (type === "distinct") {
      const k = g.k;
      if (!isPosInt(k)) throw internalError(`k for "${shown}" must be a positive integer`);
      const groups = [...new Set(paths.flatMap((p) => leavesUnder(root, p)))];
      const items = groups.reduce((s, a) => s + a.count, 0);
      if (k > items) throw new EngineError("notEnoughItems", { row: shown, items, k }, `"${shown}" has only ${items} items, can't get ${k} different`);
      return { type, path, paths, copies, k, groups, items,
               label: g.label ?? `${k} different of ${shown}, ×${copies} each` };
    }
    if (type !== "total") throw internalError(`Unknown goal type "${type}"`);
    return { type, path, paths, copies, have, label: g.label ?? `${shown} ×${copies}` };
  });
}

// Item subsets.
// A "total" or "distinct" requirement can name some items of a pool:
//   { path: "0,0", type: "total", items: ["Lily", "Tawil", "Sorel"], copies: 5 }
// Items of a pool have equal odds, so the pool can be split into smaller pools with
// proportional chances without changing anything: each group of items that every
// requirement treats alike becomes its own sub-pool. Requirements are then rewritten to
// point at the sub-pools. Pity, memory rules, specific items and owned copies carry over.
export function expandSubsets(tree, goal, start = {}) {
  const list = Array.isArray(goal) ? goal : Object.entries(goal ?? {}).map(([path, copies]) => ({ path, copies }));
  if (!list.some((g) => Array.isArray(g.items))) return { tree, goal, start };

  const t = canonTree(tree);
  const root = normaliseNode(t, []); // only to resolve names and validate
  const altAtPath = (path) => { let n = t, a = null; for (const i of path) { a = n.alts[i]; n = a?.children; } return a; };
  const goalOut = list.map((g) => ({ ...g }));
  const owned = { ...(start.owned ?? {}) };

  // Group subset requirements by pool
  const byPool = new Map();
  for (const g of goalOut) {
    if (!Array.isArray(g.items)) continue;
    const type = g.type ?? "total";
    if (type !== "total" && type !== "distinct") throw internalError(`Only "total" and "distinct" requirements can pick items`);
    const path = resolvePath(root, g.path);
    const alt = findAlt(root, path);
    if (!alt || alt.child || alt.count < 2) throw internalError(`Picking items needs a pool (count > 1), not "${g.path}"`);
    const idx = g.items.map((it) => {
      if (typeof it === "number" || /^\d+$/.test(String(it))) return Number(it);
      const j = (alt.itemNames ?? []).indexOf(it);
      if (j < 0) throw new EngineError("noItemNamed", { row: g.label ?? String(g.path), item: it }, `Pool "${g.path}" has no item named "${it}"`);
      return j;
    });
    if (!idx.length) throw new EngineError("pickNone", { row: g.label ?? String(g.path) }, `Pick at least one item for "${g.label ?? g.path}"`);
    for (const i of idx) if (!Number.isInteger(i) || i < 0 || i >= alt.count) throw new EngineError("itemOutOfRange", { row: g.label ?? String(g.path), count: alt.count }, `Pool "${g.path}" has items 0–${alt.count - 1}, not ${i}`);
    g._set = new Set(idx);
    g._pool = pathKey(path);
    if (!byPool.has(g._pool)) byPool.set(g._pool, { path, alt, reqs: [] });
    byPool.get(g._pool).reqs.push(g);
  }

  for (const [key, { path, alt, reqs }] of byPool) {
    const n = alt.count;
    // Items every subset requirement treats alike end up in the same sub-pool
    const classes = new Map();
    for (let i = 0; i < n; i++) {
      const sig = reqs.map((r) => (r._set.has(i) ? 1 : 0)).join("");
      if (!classes.has(sig)) classes.set(sig, []);
      classes.get(sig).push(i);
    }
    const groups = [...classes.values()];
    const where = new Map(); // pool item index → [sub-pool index, index inside it]
    groups.forEach((g, ci) => g.forEach((i, li) => where.set(i, [ci, li])));
    const subPath = (ci) => [...path, ci].join(",");
    const names = alt.itemNames ?? [];

    if (groups.length > 1) {
      const raw = altAtPath(path);
      raw.children = {
        streak: 0,
        alts: groups.map((g, ci) => ({
          name: `${alt.name ?? "pool"} · ${ci + 1}`,
          p: `${g.length}/${n}`,
          count: g.length,
          items: g.map((i) => names[i] ?? `item ${i + 1}`),
        })),
      };
      delete raw.count;
      delete raw.items;
    }

    for (const r of reqs) {
      // all sub-pools fully inside the subset (each sub-pool is either fully in or fully out)
      r.paths = groups.length > 1 ? groups.map((g, ci) => (r._set.has(g[0]) ? subPath(ci) : null)).filter(Boolean) : [key];
      delete r.path; delete r.items; delete r._set; delete r._pool;
    }
    if (groups.length > 1) {
      // "one specific item" rows on this pool now point inside a sub-pool
      for (const g of goalOut) {
        if ((g.type ?? "total") !== "specific" || g.paths) continue;
        if (pathKey(resolvePath(root, g.path)) !== key) continue;
        let item = g.item ?? 0;
        if (typeof item === "string" && !/^\d+$/.test(item)) item = names.indexOf(item);
        const [ci, li] = where.get(Number(item)) ?? [0, 0];
        g.path = subPath(ci);
        g.item = li;
      }
      // owned copies listed per item are split between the sub-pools
      for (const [k, v] of Object.entries(owned)) {
        if (!Array.isArray(v) || pathKey(resolvePath(root, k)) !== key) continue;
        delete owned[k];
        groups.forEach((g, ci) => { owned[subPath(ci)] = g.map((i) => Math.max(0, v[i] | 0)); });
      }
    }
  }
  for (const g of goalOut) { delete g._set; delete g._pool; }
  return { tree: t, goal: goalOut, start: { ...start, owned } };
}

// ── Layered method ───────────────────────────────────────────────────────────
// For goals on one or two pools (or single outcomes) under a common "event" — e.g.
// characters and wheels that both come from an SSR. Three parts that never influence
// each other are solved separately and combined exactly:
//   items  — which item of a pool you get: per-pool chain, F_g(n) = P(pool goal met after n hits)
//   events — what each event is (pool 1, pool 2, other): the event subtree's own chain
//            (memory rules, inner pity) together with how many hits each pool has had
//   timing — when events happen: the rest of the banner. If it resets at every event (like
//            SSR pity), the gaps between events are independent and identically distributed,
//            and the number of pulls is a sum of gaps, combined with an FFT.
// Joint state space is never built, so goals needing billions of joint states become cheap.

export function labelsOf(tree, list, start) {
  return rowsOf(tree, list, start).map((r) => r.label);
}

export function resolveItem(alt, it, where) {
  if (typeof it === "number" || /^\d+$/.test(String(it))) return Number(it);
  const j = (alt.itemNames ?? []).indexOf(it);
  if (j < 0) throw new EngineError("noItemNamed", { row: where, item: it }, `Pool "${where}" has no item named "${it}"`);
  return j;
}

// Rows grouped by the pool / single outcome they target (null if a row targets something else)
export function groupRows(root, list) {
  if (!list.length || list.some((g) => g.paths)) return null;
  const groups = new Map();
  for (const [idx, g] of list.entries()) {
    const path = resolvePath(root, g.path);
    const alt = findAlt(root, path);
    if (!alt || alt.child) return null;
    const key = pathKey(path);
    if (!groups.has(key)) groups.set(key, { path, alt, reqs: [], idx: [] });
    groups.get(key).reqs.push(g);
    groups.get(key).idx.push(idx);
  }
  return [...groups.values()];
}

export const ownedFor = (root, start, x) => Object.entries(start.owned ?? {}).find(([k]) => pathKey(resolvePath(root, k)) === pathKey(x.path))?.[1];

// What a goal row is, for reports: type, copies, k, label, and its largest progress (the
// length of its progress distribution − 1): copies for totals and specific items, the number of
// items it looks at for "k different". One definition for every method.
export function rowShape(r) {
  return { label: r.label, type: r.type, copies: r.copies, k: r.k, max: r.type === "distinct" ? r.items : r.copies };
}
// The rows of a goal (with item subsets, owned copies), in the goal's order
export function rowsOf(tree, list, start) {
  const ex = expandSubsets(tree, list, start);
  return parseGoal(normaliseNode(canonTree(ex.tree), []), ex.goal).map(rowShape);
}

// Joint chain only: "specific" rows on one pool with the same copies become one
// "k different of these items" row (k = all of them, or 1 in "any" mode). Same goal,
// but a copy histogram replaces one counter per item: (c+1)^m states → C(m+c, c).
export function mergeNamedRows(tree, goal, goalMode) {
  const list = goalList(goal);
  const root = normaliseNode(canonTree(tree), []);
  const groups = new Map();
  list.forEach((g, i) => {
    if ((g.type ?? "total") !== "specific" || g.paths) return;
    const path = resolvePath(root, g.path);
    const alt = findAlt(root, path);
    if (!alt || alt.child || alt.count < 2) return;
    const key = `${pathKey(path)}|${g.copies ?? 1}`;
    if (!groups.has(key)) groups.set(key, { alt, rows: [] });
    groups.get(key).rows.push(i);
  });
  const drop = new Set(), add = [];
  for (const { alt, rows } of groups.values()) {
    if (rows.length < 2) continue;
    const items = [...new Set(rows.map((i) => resolveItem(alt, list[i].item ?? 0, list[i].path)))];
    rows.forEach((i) => drop.add(i));
    const g0 = list[rows[0]];
    add.push({ path: g0.path, type: "distinct", items, k: goalMode === "any" ? 1 : items.length, copies: g0.copies ?? 1 });
  }
  return add.length ? [...list.filter((_, i) => !drop.has(i)), ...add] : list;
}

export { MAX_GROUPS } from "./settings.js"; // (kept here for existing imports)
