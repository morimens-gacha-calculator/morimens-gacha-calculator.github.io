// The banner tree: probabilities, normalised nodes, paths (by index or by name).
import { CHANCE_SUM_TOLERANCE } from "./settings.js";
import { EngineError, internalError } from "./errors.js";

export function parseProb(x, where) { // where: outcome names, for messages
  if (x === "rest") return "rest";
  if (typeof x === "number") return x;
  if (typeof x === "string") {
    const m = x.trim().match(/^([\d.eE+-]+)\s*\/\s*([\d.eE+-]+)$/);
    const v = m ? Number(m[1]) / Number(m[2]) : Number(x);
    if (Number.isFinite(v)) return v;
  }
  throw new EngineError("badChance", { where, value: String(x) }, `Bad probability ${JSON.stringify(x)} at ${where}`);
}

export const pathKey = (path) => path.join(",");

export const isPrefix = (pre, path) => pre.length <= path.length && pre.every((v, i) => v === path[i]);

export const isPosInt = (x) => Number.isInteger(x) && x >= 1;

// names: outcome names leading here (for messages: "SSR › character" rather than [0,1])
export function normaliseNode(raw, path, names = []) {
  const isObj = raw && !Array.isArray(raw);
  const altsRaw = isObj ? raw.alts : raw;
  const here = names.join(" › ");
  if (!Array.isArray(altsRaw) || altsRaw.length === 0)
    throw new EngineError("noOutcomes", { where: here }, `Node at [${pathKey(path)}] has no alternatives`);
  const node = { path, streak: isObj && raw.streak ? raw.streak : 0, alts: [] };
  altsRaw.forEach((a, i) => {
    const ap = [...path, i];
    const o = Array.isArray(a) ? { p: a[0], pity: a[1], children: a[2] } : a;
    const an = [...names, o.name ?? `#${i + 1}`], where = an.join(" › ");
    let count = o.count ?? 1, children = o.children ?? null;
    if (typeof children === "number") { count = children; children = null; }
    if (!isPosInt(count)) throw new EngineError("badCount", { where }, `count at ${where} must be a positive integer`);
    if (count > 1 && children) throw new EngineError("poolWithChildren", { where }, `A pool (count > 1) can't have children, at ${where}`);
    const p = parseProb(o.p, where);
    const alt = {
      name: o.name ?? null,
      p: p === "rest" ? 0 : p,
      rest: p === "rest",
      pity: o.pity || 0,
      pityYields: !!o.pityYields,
      pityResetBy: o.pityResetBy === "above" ? "above" : "self",
      onPreempt: o.onPreempt === "lose" ? "lose" : "carry",
      soft: o.soft && o.soft.step > 0 ? o.soft : null,
      count,
      itemNames: Array.isArray(o.items) ? o.items.map(String) : null,
      path: ap,
      child: children ? normaliseNode(children, ap, an) : null,
      cv: -1, icap: 0, spec: false, sumReqs: [],
    };
    if (alt.p < 0 || alt.p > 1) throw new EngineError("chanceOutOfRange", { where }, `Probability out of range at ${where}`);
    node.alts.push(alt);
  });
  const rests = node.alts.filter((a) => a.rest).length;
  const sum = node.alts.reduce((s, a) => s + a.p, 0);
  if (rests > 1) throw new EngineError("manyRest", { where: here }, `More than one "rest" at [${pathKey(path)}]`);
  if (rests === 0 && Math.abs(sum - 1) > CHANCE_SUM_TOLERANCE)
    throw new EngineError("chancesSum", { where: here, sum }, `Probabilities at [${pathKey(path)}] sum to ${sum}, not 1`);
  if (rests === 1 && sum > 1 + CHANCE_SUM_TOLERANCE)
    throw new EngineError("overOneBeforeRest", { where: here, sum }, `Probabilities at [${pathKey(path)}] exceed 1 before "rest"`);
  return node;
}

export function resolvePath(root, spec) {
  if (Array.isArray(spec)) return spec;
  const s = String(spec ?? "").trim();
  if (s === "") return [];
  if (/^\d+(\s*,\s*\d+)*$/.test(s)) return s.split(",").map(Number);
  const path = [];
  let node = root;
  for (const name of s.split("/")) {
    if (!node) throw internalError(`Path "${s}" goes below a leaf`);
    const i = node.alts.findIndex((a) => a.name === name);
    if (i < 0) throw internalError(`No alternative named "${name}" in path "${s}"`);
    path.push(i);
    node = node.alts[i].child;
  }
  return path;
}

export function findNode(root, path) {
  let node = root;
  for (const i of path) {
    const a = node?.alts[i];
    if (!a) return null;
    node = a.child;
  }
  return node;
}

export function findAlt(root, path) {
  if (path.length === 0) return null;
  return findNode(root, path.slice(0, -1))?.alts[path[path.length - 1]] ?? null;
}

export function leavesUnder(root, path) {
  const out = [];
  (function walk(node) {
    for (const a of node.alts) {
      if (a.child) walk(a.child);
      else if (isPrefix(path, a.path)) out.push(a);
    }
  })(root);
  return out;
}

// A copy of the raw tree in one shape (objects, children as nodes, count for pools)
export function canonTree(raw) {
  const isObj = raw && !Array.isArray(raw);
  const altsRaw = isObj ? raw.alts : raw;
  return {
    streak: isObj ? raw.streak || 0 : 0,
    alts: altsRaw.map((a) => {
      const o = Array.isArray(a) ? { p: a[0], pity: a[1], children: a[2] } : { ...a };
      if (typeof o.children === "number") { o.count = o.children; o.children = null; }
      if (o.children) o.children = canonTree(o.children);
      return o;
    }),
  };
}

export function nodeAtCanon(t, path) {
  let n = t;
  for (const i of path) n = n.alts[i].children;
  return n;
}
