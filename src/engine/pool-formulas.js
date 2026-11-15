// Exact pool probabilities without a state chain.
//
// A pool has n equally likely items. After h hits on it, the copy counts are multinomial.
// A goal on the pool is a set of conditions:
//   • per item: its count must lie in [lo, hi)            (specific rows, "all items" rows)
//   • per subset: the subset's total must lie in [lo, hi) (total rows; subsets must nest)
//   • markers: "item reached t copies" counted per row     (k-different rows), giving the
//     distribution of how many items in the row's set are at target
//
// Core identity: P(conditions | h) = h!/nʰ · [xʰ] ∏ᵢ fᵢ(x), fᵢ = Σ_{allowed j} xʲ/j!.
// It is evaluated in probability form: two disjoint blocks of items (sizes a, b) combine by
//   F(h) = Σⱼ C(h,j) pʲ(1−p)^(h−j) · F_A(j) · F_B(h−j),  p = a/(a+b)
// (given h hits on the union, Binomial(h, p) of them land in A). Identical items are combined
// by repeated squaring. Every term is ≥ 0, so there's no cancellation. Markers are handled by
// evaluating at roots of unity (|value| ≤ 1) and transforming back with an inverse DFT.
import { BINOMIAL_CUTOFF, MARKER_ROUNDING, MAXED_OUT, MAX_POOL_HITS, NEGLIGIBLE, WEIGHT_CACHE_CELLS } from "./settings.js";
import { EngineError } from "./errors.js";

const WCUT = BINOMIAL_CUTOFF; // binomial weights below this are skipped (all block values are ≤ 1 in size)

const LF = new Float64Array(1 << 16);
for (let i = 1; i < LF.length; i++) LF[i] = LF[i - 1] + Math.log(i);
const logFact = (n) => (n < LF.length ? LF[n] : (n + 0.5) * Math.log(n) - n + 0.5 * Math.log(2 * Math.PI) + 1 / (12 * n));

// Binomial(h, p) weights, only where they matter. Returns [lo, Float64Array]
function binomWindow(h, p, lp, lq, buf) {
  if (h === 0) { buf[0] = 1; return [0, 1]; }
  const ratio = p / (1 - p);
  const j0 = Math.min(h, Math.max(0, Math.floor((h + 1) * p)));
  // relative weights from the mode outward, normalised at the end (exp of big logs loses ~1e-13)
  const w0 = 1;
  const floor = WCUT * Math.exp(-(logFact(h) - logFact(j0) - logFact(h - j0) + j0 * lp + (h - j0) * lq));
  // walk down then up from the mode
  let lo = j0, w = w0;
  const tmp = buf.tmp;
  let nDown = 0;
  while (lo > 0) {
    w = w * lo / (h - lo + 1) / ratio;
    if (w < floor) break;
    tmp[nDown++] = w;
    lo--;
  }
  for (let i = 0; i < nDown; i++) buf[i] = tmp[nDown - 1 - i];
  let len = nDown;
  buf[len++] = w0;
  w = w0;
  for (let j = j0; j < h; j++) {
    w = w * (h - j) / (j + 1) * ratio;
    if (w < floor) break;
    buf[len++] = w;
  }
  let sum = 0;
  for (let i = 0; i < len; i++) sum += buf[i];
  for (let i = 0; i < len; i++) buf[i] /= sum;
  return [lo, len];
}

// All windows h = 0…H for one split ratio a : b, kept because the same ratios come up again
// and again (squaring is always 1 : 1). Flat: weights, start index and offset per h.
const WINDOWS = new Map();
let windowCells = 0;
function windowsFor(a, b, H) {
  const key = `${a}:${b}`;
  const have = WINDOWS.get(key);
  if (have && have.H >= H) return have;
  const p = a / (a + b), lp = Math.log(p), lq = Math.log1p(-p);
  const lo = new Int32Array(H + 1), off = new Int32Array(H + 2);
  let w = new Float64Array(Math.max(1024, 64 * (H + 1)));
  const buf = new Float64Array(H + 2);
  buf.tmp = new Float64Array(H + 2);
  let used = 0;
  for (let h = 0; h <= H; h++) {
    const [l, len] = binomWindow(h, p, lp, lq, buf);
    if (used + len > w.length) { const nw = new Float64Array(Math.max(w.length * 2, used + len)); nw.set(w); w = nw; }
    w.set(buf.subarray(0, len), used);
    lo[h] = l; off[h] = used; used += len;
  }
  off[H + 1] = used;
  const entry = { H, lo, off, w: w.subarray(0, used) };
  if (have) windowCells -= have.w.length;
  WINDOWS.set(key, entry);
  windowCells += used;
  // keep memory bounded (~16 MB of weights)
  for (const [k, v] of WINDOWS) { if (windowCells <= WEIGHT_CACHE_CELLS || k === key) continue; WINDOWS.delete(k); windowCells -= v.w.length; }
  return entry;
}

// Blocks: { size, re: Float64Array[P], im: Float64Array[P] | null }
function convolve(A, B, H, P) {
  const g = gcd(A.size, B.size);
  const W = windowsFor(A.size / g, B.size / g, H);
  const cplx = !!(A.im || B.im);
  const re = [], im = cplx ? [] : null;
  for (let q = 0; q < P; q++) { re.push(new Float64Array(H + 1)); if (cplx) im.push(new Float64Array(H + 1)); }
  const ww = W.w;
  for (let h = 0; h <= H; h++) {
    const lo = W.lo[h], base = W.off[h], len = W.off[h + 1] - base;
    for (let q = 0; q < P; q++) {
      const ar = A.re[q], br = B.re[q];
      if (!cplx) {
        let s = 0;
        for (let i = 0; i < len; i++) { const j = lo + i; s += ww[base + i] * ar[j] * br[h - j]; }
        re[q][h] = s;
      } else {
        const ai = A.im ? A.im[q] : null, bi = B.im ? B.im[q] : null;
        let sr = 0, si = 0;
        for (let i = 0; i < len; i++) {
          const j = lo + i, k = h - j, w = ww[base + i];
          const xr = ar[j], xi = ai ? ai[j] : 0, yr = br[k], yi = bi ? bi[k] : 0;
          sr += w * (xr * yr - xi * yi);
          si += w * (xr * yi + xi * yr);
        }
        re[q][h] = sr; im[q][h] = si;
      }
    }
  }
  return { size: A.size + B.size, re, im };
}

const gcd = (a, b) => (b ? gcd(b, a % b) : a);

function power(base, m, H, P) {
  let result = null, sq = base;
  while (m > 0) {
    if (m & 1) result = result ? convolve(result, sq, H, P) : sq;
    m >>= 1;
    if (m) sq = convolve(sq, sq, H, P);
  }
  return result;
}

// One item's factor, evaluated at every marker point
function itemBlock(cls, H, points, P) {
  const re = [], im = points.complex ? [] : null;
  for (let q = 0; q < P; q++) {
    const r = new Float64Array(H + 1), i = points.complex ? new Float64Array(H + 1) : null;
    for (let j = 0; j <= H; j++) {
      if (j < cls.lo || j >= cls.hi) continue;
      let vr = 1, vi = 0;
      cls.marks.forEach((t, d) => {
        if (t < 0 || j < t) return;
        const [yr, yi] = points.y[q][d];
        const nr = vr * yr - vi * yi; vi = vr * yi + vi * yr; vr = nr;
      });
      r[j] = vr;
      if (i) i[j] = vi;
    }
    re.push(r);
    if (im) im.push(i);
  }
  return { size: 1, re, im };
}

// System: { n, lo[], hi[] per item, totals: [{ set: number[], lo, hi }], markers: [{ set:number[], t: number[] per item (−1 if out) }] }
// Returns for each h ≤ H the joint distribution over marker counts (flattened, row-major), or
// a plain probability per h when there are no markers.
function evaluate(sys, H) {
  const { n, markers } = sys;
  const dims = markers.map((m) => m.set.length + 1);
  const P = dims.reduce((a, b) => a * b, 1);
  // marker points: y_d = exp(2πi ℓ_d / dims_d)
  const points = { complex: P > 1, y: [] };
  for (let q = 0; q < P; q++) {
    let rem = q;
    const ys = [];
    for (let d = dims.length - 1; d >= 0; d--) {
      const l = rem % dims[d]; rem = Math.floor(rem / dims[d]);
      const a = 2 * Math.PI * l / dims[d];
      ys[d] = [Math.cos(a), Math.sin(a)];
    }
    points.y.push(ys);
  }

  // Total subsets form a tree (each set inside the smallest set containing it)
  const totals = mergeTotals(sys.totals, n);
  const nodes = [{ set: null, lo: 0, hi: Infinity, size: n, children: [], classes: new Map() }];
  for (const t of totals) {
    if (t.set.length === n) { nodes[0].lo = Math.max(nodes[0].lo, t.lo); nodes[0].hi = Math.min(nodes[0].hi, t.hi); continue; }
    nodes.push({ set: new Set(t.set), lo: t.lo, hi: t.hi, size: t.set.length, children: [], classes: new Map() });
  }
  // each set hangs under the smallest other set that contains it (or the whole pool)
  const order = nodes.slice(1);
  const contains = (o, node) => o.size > node.size && [...node.set].every((i) => o.set.has(i));
  for (const node of order) {
    let best = nodes[0];
    for (const o of order) if (o !== node && contains(o, node) && (best === nodes[0] || o.size < best.size)) best = o;
    best.children.push(node);
  }
  const nodeOfItem = (i) => {
    let best = nodes[0];
    for (const o of order) if (o.set.has(i) && (best === nodes[0] || o.size < best.size)) best = o;
    return best;
  };
  for (let i = 0; i < n; i++) {
    const node = nodeOfItem(i);
    const marks = markers.map((m) => m.t[i]);
    const key = `${sys.lo[i]}|${sys.hi[i]}|${marks.join(",")}`;
    if (!node.classes.has(key)) node.classes.set(key, { lo: sys.lo[i], hi: sys.hi[i], marks, count: 0 });
    node.classes.get(key).count++;
  }

  const evalNode = (node) => {
    const blocks = [];
    for (const cls of node.classes.values()) blocks.push(power(itemBlock(cls, H, points, P), cls.count, H, P));
    for (const ch of node.children) blocks.push(evalNode(ch));
    let acc = blocks[0];
    for (let b = 1; b < blocks.length; b++) acc = convolve(acc, blocks[b], H, P);
    if (node.lo > 0 || node.hi < Infinity)
      for (let q = 0; q < P; q++)
        for (let h = 0; h <= H; h++) if (h < node.lo || h >= node.hi) { acc.re[q][h] = 0; if (acc.im) acc.im[q][h] = 0; }
    return acc;
  };
  const root = evalNode(nodes[0]);
  if (P === 1) return { P, dims, out: root.re[0] };

  // Back from points to counts: inverse DFT along each marker dimension
  const out = [];
  const re = new Float64Array(P), im = new Float64Array(P);
  for (let h = 0; h <= H; h++) {
    for (let q = 0; q < P; q++) { re[q] = root.re[q][h]; im[q] = root.im ? root.im[q][h] : 0; }
    let stride = 1;
    for (let d = dims.length - 1; d >= 0; d--) {
      const m = dims[d];
      for (let base = 0; base < P; base++) {
        if (Math.floor(base / stride) % m !== 0) continue;
        const xr = [], xi = [];
        for (let l = 0; l < m; l++) { xr.push(re[base + l * stride]); xi.push(im[base + l * stride]); }
        for (let r = 0; r < m; r++) {
          let sr = 0, si = 0;
          for (let l = 0; l < m; l++) {
            const a = -2 * Math.PI * l * r / m, c = Math.cos(a), s = Math.sin(a);
            sr += xr[l] * c - xi[l] * s; si += xr[l] * s + xi[l] * c;
          }
          re[base + r * stride] = sr / m; im[base + r * stride] = si / m;
        }
      }
      stride *= m;
    }
    out.push(Float64Array.from(re, (v) => (v > 0 ? v : 0)));
  }
  return { P, dims, out };
}

function mergeTotals(totals, n) {
  const byKey = new Map();
  for (const t of totals) {
    const set = [...new Set(t.set)].sort((a, b) => a - b);
    const key = set.join(",");
    const cur = byKey.get(key) ?? { set, lo: 0, hi: Infinity };
    cur.lo = Math.max(cur.lo, t.lo); cur.hi = Math.min(cur.hi, t.hi);
    byKey.set(key, cur);
  }
  const list = [...byKey.values()];
  // must nest or be disjoint
  for (const a of list) for (const b of list) {
    if (a === b) continue;
    const sb = new Set(b.set);
    const inter = a.set.filter((i) => sb.has(i)).length;
    if (inter && inter !== a.set.length && inter !== b.set.length) return null;
  }
  return list.filter((t) => t.lo > 0 || t.hi < Infinity || t.set.length === n);
}

// ── Public: per-pool plan ────────────────────────────────────────────────────
// rows: [{ type: "specific"|"total"|"distinct", item, items: number[]|null, copies, k, have }]
// owned: per-item copies (array, may be shorter than n)
export function poolPlan(n, rows, owned = [], goalMode = "all") {
  const own = Array.from({ length: n }, (_, i) => Math.max(0, owned[i] | 0));
  const norm = rows.map((r) => {
    const type = r.type ?? "total";
    const set = Array.isArray(r.items) ? [...new Set(r.items)] : Array.from({ length: n }, (_, i) => i);
    if (type === "specific") {
      if (n === 1) return { type: "total", set: [0], copies: r.copies, base: own[0], max: r.copies };
      return { type, item: r.item, copies: r.copies, max: r.copies };
    }
    if (type === "distinct") return { type, set, copies: r.copies, k: r.k, max: set.length };
    const base = (r.have | 0) + set.reduce((s, i) => s + own[i], 0);
    return { type: "total", set, copies: r.copies, base, max: r.copies };
  });
  const plan = { n, own, rows: norm, goalMode };
  // check total subsets nest (else the chain has to do it)
  if (mergeTotals(norm.filter((r) => r.type === "total").map((r) => ({ set: r.set, lo: 1, hi: Infinity })), n) === null) return null;
  // exactly guaranteed after this many hits? (totals over the whole pool only)
  const whole = (r) => r.type === "total" && r.set.length === n;
  const need = (r) => Math.max(0, r.copies - r.base);
  // most hits ever needed, when that's finite (the count over the whole pool is exactly h)
  if (goalMode === "all" && norm.every(whole)) plan.guaranteedAt = plan.worstHits = Math.max(...norm.map(need));
  else if (goalMode === "any" && norm.some(whole)) plan.worstHits = Math.min(...norm.filter(whole).map(need));
  return plan;
}

// The condition system for one combination of per-row wishes:
//   "met" / "not" (row met or not), "free" (ignored), "maxed" (at its top progress),
//   "marginal" (count items at target; distinct rows only)
// extra: optional per-item bounds { lo: Map(item → lo), hi: Map(item → hi) }
function systemFor(plan, wants, extra = null) {
  const { n, own, rows } = plan;
  const lo = new Array(n).fill(0), hi = new Array(n).fill(Infinity);
  const totals = [], markers = [], markerRows = [], markerWant = [];
  rows.forEach((r, ri) => {
    const want = wants[ri];
    if (want === "free") return;
    if (want === "marginal") { markers.push(markerOf(r, own, n)); markerRows.push(ri); markerWant.push("all"); return; }
    if (r.type === "specific") {
      const t = Math.max(0, r.copies - own[r.item]);
      if (want === "not") hi[r.item] = Math.min(hi[r.item], t); else lo[r.item] = Math.max(lo[r.item], t);
    } else if (r.type === "total") {
      const t = Math.max(0, r.copies - r.base);
      totals.push(want === "not" ? { set: r.set, lo: 0, hi: t } : { set: r.set, lo: t, hi: Infinity });
    } else {
      const all = r.k >= r.set.length;
      if (want === "maxed" || (want === "met" && all)) {
        for (const i of r.set) lo[i] = Math.max(lo[i], Math.max(0, r.copies - own[i]));
      } else if (want === "not" && r.k <= 1) {
        for (const i of r.set) hi[i] = Math.min(hi[i], Math.max(0, r.copies - own[i]));
      } else {
        markers.push(markerOf(r, own, n)); markerRows.push(ri); markerWant.push(want);
      }
    }
  });
  if (extra) {
    for (const [i, v] of extra.lo) lo[i] = Math.max(lo[i], v);
    for (const [i, v] of extra.hi) hi[i] = Math.min(hi[i], v);
  }
  return { n, lo, hi, totals, markers, markerRows, markerWant };
}

function markerOf(r, own, n) {
  const t = new Array(n).fill(-1);
  for (const i of r.set) t[i] = Math.max(0, r.copies - own[i]);
  return { set: r.set, t };
}

// P(system | h) for h ≤ H, summing marker counts over the wanted region
function probOf(plan, sys, H) {
  if (sys.hi.some((v, i) => v <= sys.lo[i])) return new Float64Array(H + 1); // impossible
  const { P, dims, out } = evaluate(sys, H);
  if (P === 1) return Float64Array.from(out, (v) => Math.min(1, Math.max(0, v)));
  const ks = sys.markerRows.map((ri) => plan.rows[ri].k);
  const res = new Float64Array(H + 1);
  for (let h = 0; h <= H; h++) {
    let s = 0;
    for (let q = 0; q < P; q++) {
      let rem = q, ok = true;
      for (let d = dims.length - 1; d >= 0; d--) {
        const r = rem % dims[d]; rem = Math.floor(rem / dims[d]);
        const w = sys.markerWant[d];
        if (w === "not" ? r >= ks[d] : w === "met" ? r < ks[d] : false) { ok = false; break; }
      }
      if (ok) s += out[h][q];
    }
    res[h] = Math.min(1, s);
  }
  return res;
}

const allWant = (plan, w) => plan.rows.map(() => w);

// P(goal not met | h). "any": no row met (one product). "all": split by the first row that
// isn't met — P(rows before met, this one not) — and an "every item" row further by the first
// item short of target. Every term is a positive probability: no 1 − x, no cancellation.
function notMetCurve(plan, H) {
  const { rows, own } = plan;
  const total = new Float64Array(H + 1);
  const add = (v) => { for (let h = 0; h <= H; h++) total[h] += v[h]; };
  const shortOf = (r, item) => Math.max(0, r.copies - own[item]);
  if (plan.goalMode === "any") {
    // no row met; an "every item" row isn't met when some item is short: split by the first
    // short item (one level per such row), so no marker transform is needed
    const allRows = rows.map((r, i) => i).filter((i) => rows[i].type === "distinct" && rows[i].k > 1 && rows[i].k >= rows[i].set.length);
    const wants = rows.map((r, i) => (allRows.includes(i) ? "free" : "not"));
    const walk = (d, lo, hi) => {
      if (d === allRows.length) { add(probOf(plan, systemFor(plan, wants, { lo, hi }), H)); return; }
      const r = rows[allRows[d]];
      r.set.forEach((item, a) => {
        const lo2 = new Map(lo), hi2 = new Map(hi);
        for (let b = 0; b < a; b++) lo2.set(r.set[b], Math.max(lo2.get(r.set[b]) ?? 0, shortOf(r, r.set[b])));
        hi2.set(item, Math.min(hi2.get(item) ?? Infinity, shortOf(r, item)));
        walk(d + 1, lo2, hi2);
      });
    };
    walk(0, new Map(), new Map());
    return Float64Array.from(total, (v) => Math.min(1, v));
  }
  rows.forEach((r, i) => {
    const wants = rows.map((_, j) => (j < i ? "met" : j === i ? "not" : "free"));
    if (r.type === "distinct" && r.k >= r.set.length) {
      // first item of the set that's short: items before it at target, this one below
      wants[i] = "free";
      r.set.forEach((item, a) => {
        const lo = new Map(), hi = new Map();
        for (let b = 0; b < a; b++) lo.set(r.set[b], Math.max(0, r.copies - own[r.set[b]]));
        hi.set(item, Math.max(0, r.copies - own[item]));
        add(probOf(plan, systemFor(plan, wants, { lo, hi }), H));
      });
    } else add(probOf(plan, systemFor(plan, wants), H));
  });
  return Float64Array.from(total, (v) => Math.min(1, v));
}

// P(Binomial(h, p) < t), from the terms below t (t is small)
function binomBelow(h, p, t) {
  if (t <= 0) return 0;
  if (t > h) return 1;
  const lp = Math.log(p), lq = Math.log1p(-p);
  let s = 0;
  for (let j = 0; j < t; j++) s += Math.exp(logFact(h) - logFact(j) - logFact(h - j) + j * lp + (h - j) * lq);
  return Math.min(1, s);
}
// A number of hits by which P(condition fails) < tol, from union bounds (always safe):
//   a row on items fails only if some needed item (or the subset) is short of its target
function hitsBound(plan, tol, want) {
  const { n, own, rows } = plan;
  const rowBound = (r) => {
    if (r.type === "specific") { const t = Math.max(0, r.copies - own[r.item]); return (h) => binomBelow(h, 1 / n, t); }
    if (r.type === "total") { const t = Math.max(0, r.copies - r.base); return (h) => binomBelow(h, r.set.length / n, t); }
    // k different (or all, when maxed): the k-th best item… bounded by "all items of the set reach"
    const ts = r.set.map((i) => Math.max(0, r.copies - own[i])).filter((t) => t > 0);
    return (h) => ts.reduce((s, t) => s + binomBelow(h, 1 / n, t), 0);
  };
  const bounds = rows.map(rowBound);
  const fail = plan.goalMode === "any" && want !== "maxed"
    ? (h) => Math.min(...bounds.map((b) => b(h)))
    : (h) => bounds.reduce((s, b) => s + b(h), 0);
  // grow fast, then bisect
  let hi = 16;
  while (fail(hi) >= tol) { hi *= 2; if (hi > 1e6) return 1e6; }
  let lo = hi / 2;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (fail(mid) < tol) hi = mid; else lo = mid; }
  return hi;
}

// S[h] = P(goal not met after h hits), h = 0…H, with S[H] < tol
export function poolNotMet(plan, tol, Hmax = MAX_POOL_HITS) {
  if (plan.guaranteedAt != null) {
    // totals over the whole pool: the count is exactly h
    return Float64Array.from({ length: plan.guaranteedAt + 1 }, (_, h) => (h >= plan.guaranteedAt ? 0 : 1));
  }
  // rounding floor of the marker transform (about 1e-16 per value summed)
  const P = plan.rows.reduce((m, r) => m * (r.type === "distinct" && r.k > 1 && r.k < r.set.length ? r.set.length + 1 : 1), 1);
  Hmax = Math.min(Hmax, MAX_POOL_HITS);
  tol = Math.max(tol, P > 1 ? P * MARKER_ROUNDING : 0);
  for (let H = Math.max(8, hitsBound(plan, tol, "met")); ; H *= 2) {
    const S = notMetCurve(plan, H);
    if (S[H] < tol || (plan.worstHits != null && H >= plan.worstHits)) {
      let end = H;
      while (end > 0 && S[end - 1] < tol) end--;
      const out = S.slice(0, end + 1);
      if (plan.worstHits != null && plan.worstHits < out.length) out.fill(0, plan.worstHits);
      return out;
    }
    if (H >= Hmax) throw new EngineError("tooManyHits", { limit: Hmax }, `Too big: the pool goal needs more than ${Hmax.toLocaleString("en")} hits.`);
  }
}

// Budget pieces per number of hits h ≤ min(Hcap, maxed point) (knownNotMet: poolNotMet's result):
//   D[row][h] = distribution of the row's progress, E[row][h] its mean, G[h] = P(not met)
export function poolBudget(plan, Hcap, knownNotMet = null) {
  const { rows, n, own } = plan;
  // up to where every row is at its maximum progress
  let H = Hcap;
  for (let h0 = Math.max(8, hitsBound(plan, NEGLIGIBLE, "maxed")); ; h0 *= 2) {
    const Hn = Math.min(Hcap, h0);
    const full = probOf(plan, systemFor(plan, allWant(plan, "maxed")), Hn);
    if (full[Hn] >= 1 - MAXED_OUT || Hn >= Hcap) {
      let end = Hn;
      while (end > 0 && full[end - 1] >= 1 - MAXED_OUT) end--;
      H = end;
      break;
    }
  }
  // P(not met) per h: reuse the curve the distribution already computed when it reaches far
  // enough (past its end it is below the cut-off: 0)
  const G = knownNotMet && knownNotMet.length > 0
    ? Array.from({ length: H + 1 }, (_, h) => (h < knownNotMet.length ? knownNotMet[h] : 0))
    : Array.from(notMetCurve(plan, H));
  const D = [], E = [];
  rows.forEach((r, ri) => {
    const d = [], e = [];
    if (r.type === "distinct") {
      const sys = systemFor(plan, plan.rows.map((_, j) => (j === ri ? "marginal" : "free")));
      const { out } = evaluate(sys, H);
      for (let h = 0; h <= H; h++) {
        const dist = Float64Array.from(out[h]);
        d.push(dist);
        e.push(dist.reduce((s, p, v) => s + p * v, 0));
      }
    } else {
      // binomial: the item (1/n) or the subset (s/n) gets a share of the h hits
      const share = r.type === "specific" ? 1 / n : r.set.length / n;
      const base = r.type === "specific" ? own[r.item] : r.base;
      for (let h = 0; h <= H; h++) {
        const dist = new Float64Array(r.max + 1);
        const pmf = binomPmf(h, share);
        pmf.forEach((p, j) => { dist[Math.min(base + j, r.max)] += p; });
        d.push(dist);
        e.push(dist.reduce((s, p, v) => s + p * v, 0));
      }
    }
    D.push(d); E.push(e);
  });
  return { D, E, G };
}

function binomPmf(h, p) {
  if (p >= 1) { const a = new Float64Array(h + 1); a[h] = 1; return a; }
  const out = new Float64Array(h + 1);
  const buf = new Float64Array(h + 2); buf.tmp = new Float64Array(h + 2);
  const [lo, len] = binomWindow(h, p, Math.log(p), Math.log1p(-p), buf);
  for (let i = 0; i < len; i++) out[lo + i] = buf[i];
  return out;
}

// Rough size of the state chain this pool goal would need (for choosing a method)
export function chainSizeEstimate(plan) {
  const { rows, n } = plan;
  let est = 1;
  const specCap = new Map();
  let dcap = 0;
  for (const r of rows) {
    if (r.type === "specific") specCap.set(r.item, Math.max(specCap.get(r.item) ?? 0, r.copies));
    else if (r.type === "distinct") dcap = Math.max(dcap, r.copies);
    else est *= r.copies + 1;
  }
  // named items with the same target are merged into one histogram by the joint method: C(m+c, c)
  const byCap = new Map();
  for (const c of specCap.values()) { const cap = Math.max(c, dcap); byCap.set(cap, (byCap.get(cap) ?? 0) + 1); }
  for (const [cap, m] of byCap) { let c = 1; for (let i = 1; i <= cap; i++) c = c * (m + i) / i; est *= c; }
  const m = n - specCap.size;
  if (dcap && m > 0) { // multiset count C(m + dcap, dcap)
    let c = 1;
    for (let i = 1; i <= dcap; i++) c = c * (m + i) / i;
    est *= c;
  }
  return est;
}
