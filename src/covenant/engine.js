// Exact covenant reroll odds: how many rerolls (and materials) it takes until a piece's 3
// substat lines meet the goals, for each way of locking lines, and which way is cheapest.
//
// The model. Each goal is "a line with substat X at level L or higher" (up to 3 goals, each met
// by its own line). What matters about a line is which goals it can meet: a bit mask over the
// goals. The state before a reroll is the multiset of the 3 lines' masks (at most 120 states);
// a choice is which lines to lock (at most 2; a line that meets no goal is never worth locking);
// the unlocked lines are then drawn again, each by the piece's substat and level weights. The
// piece is done when the goals can be matched to 3 different lines.
//
// Ways of locking:
//   asTheyCome: lock each line the moment it meets a goal and keep it locked (up to 2): the
//     simple rule, best or close to it for most goals
//   cheapest: the choices that cost the fewest quills on average (a reroll costs 3 seals = 0.15
//     quills, +1 quill with one lock, +10 with two), found exactly by policy iteration
//   fewest:   the fewest rerolls on average with up to 2, up to 1 or no locked lines
// For each: the average rerolls (exact, from linear equations), the average rerolls made with
// 0, 1 and 2 locks (for the materials), and the chance to be done by each reroll (exact, from
// powers of the transition matrix, so it stays fast even when it takes millions of rerolls).
import { COSTS, LEVELS, LINES, PIECES, SEALS_PER_QUILL } from "./rates.js";

const TIE = 1e-12; // relative: a choice must be better by more than this to replace another
const popcount = (m) => { let n = 0; for (; m; m >>= 1) n += m & 1; return n; };

// lines: [{ stat, level }] (LINES of them; stat null = empty); goals: [{ stat, level }] (≤ 3)
export function solveCovenant({ lines, goals, piece = 1, levels = LEVELS, pieces = PIECES, costs = COSTS }) {
  const G = goals.length;
  const weights = pieces.find((p) => p.piece === piece)?.substats;
  if (!weights) throw new Error(`No piece ${piece}`);
  const maskOf = (stat, level) => goals.reduce((m, g, i) => (stat != null && g.stat === stat && level >= g.level ? m | (1 << i) : m), 0);

  // one drawn line: the chance of each mask
  const SW = weights.reduce((s, w) => s + w.weight, 0), LW = levels.reduce((s, l) => s + l.weight, 0);
  const drawMap = new Map();
  for (const w of weights) for (const l of levels) {
    const m = maskOf(w.key, l.level);
    drawMap.set(m, (drawMap.get(m) ?? 0) + (w.weight / SW) * (l.weight / LW));
  }
  const draws = [...drawMap].sort((a, b) => a[0] - b[0]);

  // can the goals be met by different lines?
  const metBy = (ms) => {
    const rec = (g, used) => g === G || ms.some((m, i) => !((used >> i) & 1) && ((m >> g) & 1) && rec(g + 1, used | (1 << i)));
    return rec(0, 0);
  };
  const keyOf = (ms) => ms.slice().sort((a, b) => a - b).join(",");

  // the states: every multiset of LINES masks
  const startMasks = lines.map((l) => maskOf(l.stat, l.level));
  const maskSet = [...new Set([...draws.map(([m]) => m), ...startMasks])].sort((a, b) => a - b);
  const states = [];
  const index = new Map();
  const visit = (ms, from) => {
    if (ms.length === LINES) { const k = keyOf(ms); if (!index.has(k)) { index.set(k, states.length); states.push({ ms: ms.slice().sort((a, b) => a - b), key: k }); } return; }
    for (let j = from; j < maskSet.length; j++) visit([...ms, maskSet[j]], j);
  };
  visit([], 0);

  // the choices in each state, with where they lead
  const nextOf = new Map(); // kept masks → [[state, p]]
  const outcomes = (kept) => {
    const k = keyOf(kept);
    if (nextOf.has(k)) return nextOf.get(k);
    let dist = new Map([[k, { ms: kept, p: 1 }]]);
    for (let d = kept.length; d < LINES; d++) {
      const nd = new Map();
      for (const { ms, p } of dist.values()) for (const [m, q] of draws) {
        const n = [...ms, m];
        const nk = keyOf(n);
        const e = nd.get(nk);
        if (e) e.p += p * q; else nd.set(nk, { ms: n, p: p * q });
      }
      dist = nd;
    }
    const out = [...dist.values()].map(({ ms, p }) => [index.get(keyOf(ms)), p]);
    nextOf.set(k, out);
    return out;
  };
  for (const s of states) {
    s.done = metBy(s.ms);
    s.choices = [];
    if (s.done) continue;
    const seen = new Set();
    const subsets = [[]];
    for (let i = 0; i < LINES; i++) for (const sub of subsets.slice()) if (sub.length < costs.maxLocks && s.ms[i]) subsets.push([...sub, i]);
    for (const sub of subsets) {
      const kept = sub.map((i) => s.ms[i]);
      const k = keyOf(kept);
      if (seen.has(k)) continue;
      seen.add(k);
      s.choices.push({ locks: sub.length, kept, next: outcomes(kept) });
    }
    s.choices.sort((a, b) => a.locks - b.locks); // fewer locks first: kept on ties
  }

  // how many goals some of these lines can meet together (each line one goal)
  const matched = (ms) => {
    let best = 0;
    const rec = (g, used, n) => {
      if (g === G) { best = Math.max(best, n); return; }
      rec(g + 1, used, n);
      ms.forEach((m, i) => { if (!((used >> i) & 1) && ((m >> g) & 1)) rec(g + 1, used | (1 << i), n + 1); });
    };
    rec(0, 0, 0);
    return best;
  };
  const bits = (ms) => ms.reduce((n, m) => n + popcount(m), 0);
  // lock as they come: keep the lines that meet the most goals together; of those, the fewest
  // lines, then the lines that could meet more goals
  const asTheyCome = (choices) => {
    let best = 0;
    choices.forEach((c, j) => {
      const b = choices[best];
      const [mc, mb] = [matched(c.kept), matched(b.kept)];
      if (mc > mb || (mc === mb && (c.locks < b.locks || (c.locks === b.locks && bits(c.kept) > bits(b.kept))))) best = j;
    });
    return best;
  };

  const start = index.get(keyOf(startMasks));
  const quillsPer = (locks) => costs.seals / SEALS_PER_QUILL + costs.lockQuills[locks];
  const ways = [
    { key: "asTheyCome", maxLocks: costs.maxLocks, cost: quillsPer, fixed: asTheyCome },
    { key: "cheapest", maxLocks: costs.maxLocks, cost: quillsPer },
    { key: "fewest2", maxLocks: 2, cost: () => 1 },
    { key: "fewest1", maxLocks: 1, cost: () => 1 },
    { key: "none", maxLocks: 0, cost: () => 1 },
  ].map((w) => wayOf(w, states, start, costs));
  return { done: states[start].done, ways, startMasks, goals: G, matched };
}

// One way of locking: its choices (policy iteration), averages and the chance by reroll
function wayOf({ key, maxLocks, cost, fixed }, states, start, costs) {
  const T = []; // the states not done yet
  const at = new Map();
  states.forEach((s, i) => { if (!s.done) { at.set(i, T.length); T.push(i); } });
  const n = T.length;
  const allowed = T.map((i) => states[i].choices.filter((c) => c.locks <= maxLocks));
  // a fixed rule, or (policy iteration) start with no locks: every line drawn again, so done is
  // always possible
  let policy = allowed.map((choices) => (fixed ? fixed(choices) : 0));
  let lu, V;
  for (let round = 0; round < 1000; round++) {
    // (I − Q): the diagonal as the chance of leaving the state, not 1 − the chance of staying,
    // so waits of millions of rerolls keep their digits
    lu = factor(n, (r, add) => {
      for (const [t, p] of allowed[r][policy[r]].next) {
        if (t === T[r]) continue;
        add(r, p);
        if (at.has(t)) add(at.get(t), -p);
      }
    });
    V = lu.solve(T.map((_, r) => cost(allowed[r][policy[r]].locks)));
    if (fixed) break;
    let changed = false;
    policy = policy.map((cur, r) => {
      const value = (c) => cost(c.locks) + c.next.reduce((s, [t, p]) => s + (at.has(t) ? p * V[at.get(t)] : 0), 0);
      let best = cur, bestV = value(allowed[r][cur]);
      allowed[r].forEach((c, j) => { const v = value(c); if (v < bestV - TIE * Math.abs(bestV)) { best = j; bestV = v; } });
      if (best !== cur) changed = true;
      return best;
    });
    if (!changed) break;
  }
  const done = states[start].done;
  const s0 = done ? -1 : at.get(start);
  // average rerolls made with 0, 1 and 2 locks
  const byLocks = [0, 1, 2].map((k) => (done ? 0 : Math.max(0, lu.solve(T.map((_, r) => (allowed[r][policy[r]].locks === k ? 1 : 0)))[s0]) || 0));
  const rerolls = byLocks[0] + byLocks[1] + byLocks[2];
  const materials = {
    roseScript: costs.roseScript * rerolls,
    seals: costs.seals * rerolls,
    quills: costs.lockQuills[1] * byLocks[1] + costs.lockQuills[2] * byLocks[2],
  };
  materials.inQuills = materials.quills + materials.seals / SEALS_PER_QUILL;
  const first = done ? null : allowed[s0][policy[s0]].kept;
  const chain = done ? null : chanceChain(T, at, allowed, policy, s0);
  // the whole plan: every situation this way can reach from the start, what it locks there and
  // how many rerolls are left on average from there
  let plan = [];
  if (!done) {
    const left = lu.solve(T.map(() => 1));
    const seen = new Set([s0]), order = [s0];
    for (let i = 0; i < order.length; i++) {
      for (const [t] of allowed[order[i]][policy[order[i]]].next) if (at.has(t) && !seen.has(at.get(t))) { seen.add(at.get(t)); order.push(at.get(t)); }
    }
    plan = order.map((r) => {
      const c = allowed[r][policy[r]];
      return { masks: states[T[r]].ms, kept: c.kept, locks: c.locks, rerollsLeft: Math.max(0, left[r]), start: r === s0 };
    });
  }
  return { key, maxLocks, rerolls, byLocks, materials, first, policy, done, plan, ...(chain ?? {}) };
}

// The chance to be done by reroll n, from the transient part of the chain: P(not done after n) =
// e_start Q^n 1. Q^(2^k) are kept, so any n (and quantiles by bisection) costs a few products.
function chanceChain(T, at, allowed, policy, s0) {
  // only the states reachable from the start matter
  const reach = [s0], seen = new Set([s0]);
  for (let i = 0; i < reach.length; i++) {
    const r = reach[i];
    for (const [t] of allowed[r][policy[r]].next) if (at.has(t) && !seen.has(at.get(t))) { seen.add(at.get(t)); reach.push(at.get(t)); }
  }
  const m = reach.length;
  const pos = new Map(reach.map((r, i) => [r, i]));
  const Q = new Float64Array(m * m);
  reach.forEach((r, i) => { for (const [t, p] of allowed[r][policy[r]].next) if (at.has(t) && pos.has(at.get(t))) Q[i * m + pos.get(at.get(t))] += p; });
  const powers = [Q]; // Q^(2^k)
  const mul = (A, B) => {
    const C = new Float64Array(m * m);
    for (let i = 0; i < m; i++) for (let k = 0; k < m; k++) { const a = A[i * m + k]; if (a) for (let j = 0; j < m; j++) C[i * m + j] += a * B[k * m + j]; }
    return C;
  };
  const vecMul = (v, A) => {
    const out = new Float64Array(m);
    for (let k = 0; k < m; k++) { const a = v[k]; if (a) for (let j = 0; j < m; j++) out[j] += a * A[k * m + j]; }
    return out;
  };
  const sum = (v) => v.reduce((s, x) => s + x, 0);
  const power = (k) => { while (powers.length <= k) powers.push(mul(powers.at(-1), powers.at(-1))); return powers[k]; };
  const e0 = new Float64Array(m); e0[0] = 1;
  const after = (n) => { // the distribution over states not done after n rerolls
    let v = e0;
    for (let k = 0; n > 0; k++, n = Math.floor(n / 2)) if (n % 2) v = vecMul(v, power(k));
    return v;
  };
  const survival = (n) => Math.max(0, Math.min(1, sum(after(n))));
  // the reroll by which a chance p is reached
  const MAX_K = 52;
  const quantile = (p) => {
    let k = 0;
    while (survival(2 ** k) > 1 - p) { k++; if (k > MAX_K) return null; }
    let lo = k === 0 ? 0 : 2 ** (k - 1), hi = 2 ** k; // survival(lo) > 1-p ≥ survival(hi)
    if (survival(lo) <= 1 - p) return lo;
    while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (survival(mid) > 1 - p) lo = mid; else hi = mid; }
    return hi;
  };
  // chance by reroll at evenly spaced points 0, step, 2·step, … up to last
  const curve = (last, points = 240) => {
    const step = Math.max(1, Math.ceil(last / points));
    let P = null; // Q^step
    for (let k = 0, s = step; s > 0; k++, s = Math.floor(s / 2)) if (s % 2) P = P ? mul(P, power(k)) : power(k);
    const xs = [], ys = [];
    let v = e0;
    for (let x = 0; x <= last + step - 1; x += step) { xs.push(x); ys.push(1 - Math.min(1, sum(v))); v = vecMul(v, P); }
    return { xs, ys };
  };
  return { survival, quantile, curve, median: quantile(0.5), p90: quantile(0.9), p99: quantile(0.99) };
}

// Dense LU with partial pivoting for the small systems (I − Q)x = b
function factor(n, fill) {
  const A = new Float64Array(n * n);
  for (let r = 0; r < n; r++) fill(r, (c, v) => { A[r * n + c] += v; });
  const piv = new Int32Array(n);
  for (let k = 0; k < n; k++) {
    let p = k, best = Math.abs(A[k * n + k]);
    for (let r = k + 1; r < n; r++) { const v = Math.abs(A[r * n + k]); if (v > best) { best = v; p = r; } }
    piv[k] = p;
    if (p !== k) for (let c = 0; c < n; c++) { const t = A[k * n + c]; A[k * n + c] = A[p * n + c]; A[p * n + c] = t; }
    const d = A[k * n + k];
    for (let r = k + 1; r < n; r++) {
      const f = (A[r * n + k] /= d);
      if (f) for (let c = k + 1; c < n; c++) A[r * n + c] -= f * A[k * n + c];
    }
  }
  return {
    solve(b) {
      const x = Float64Array.from(b);
      for (let k = 0; k < n; k++) { const p = piv[k]; if (p !== k) { const t = x[k]; x[k] = x[p]; x[p] = t; } }
      for (let r = 1; r < n; r++) { let s = x[r]; for (let c = 0; c < r; c++) s -= A[r * n + c] * x[c]; x[r] = s; }
      for (let r = n - 1; r >= 0; r--) { let s = x[r]; for (let c = r + 1; c < n; c++) s -= A[r * n + c] * x[c]; x[r] = s / A[r * n + r]; }
      return x;
    },
  };
}

// Which of the current lines to lock first: the kept masks, matched back to line indexes
export function linesToLock(lines, goals, kept) {
  const masks = lines.map((l) => goals.reduce((m, g, i) => (l.stat != null && g.stat === l.stat && l.level >= g.level ? m | (1 << i) : m), 0));
  const used = new Set();
  return (kept ?? []).map((k) => { const i = masks.findIndex((m, j) => m === k && !used.has(j)); used.add(i); return i; });
}
