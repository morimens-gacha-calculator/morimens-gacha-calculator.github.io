// Exact odds for a plan over many banners that are paid for day by day.
//
// Every rerun day has a limited character banner and a limited wheel banner with the usual
// limited rules (the limitedChar and limitedWheel presets in src/model.js): an SSR 1 pull in 33,
// always by the 30th pull since the last one; an SSR is the limited one with chance 1/3 (wheels
// 1/2), always after 2 standard ones in a row (wheels: after 1). Character banners share their
// pity and guarantee with each other, wheel banners with each other.
//
// On a banner you pull until you have the copies you planned, or until the pulls you hold that
// day run out. Pulls you hold = floor(bank that day) − pulls spent so far. The answer is the exact
// distribution of (pulls spent, character pity, wheel pity, every banner so far went to plan),
// carried from banner to banner. When a banner's goal is met its last pull was the limited SSR,
// so that type's pity is back at the start; when the pulls run out, its pity is wherever it was.

export const SSR_CHANCE = 1 / 33;
export const SSR_PITY = 30;
export const TYPES = {
  char: { win: 1 / 3, guarantee: 3 }, // limited on 1 SSR in 3; the 3rd after 2 standard ones always
  wheel: { win: 1 / 2, guarantee: 2 },
};
// A pity state: k pulls since the last SSR (0…29) and l standard SSRs in a row (0…guarantee−1)
export const stateIndex = (k, l) => l * SSR_PITY + k;
const statesOf = (type) => TYPES[type].guarantee * SSR_PITY;
const RESET = 0;

// One banner from pity state `start` until `copies` limited ones, for up to `pulls` pulls.
// done[n]: chance the last copy comes on pull n. left(n): for each pity state, the chance of
// not being done after n pulls and being in that state (asked for the n in `want`, ascending).
export function bannerChain(type, start, copies, pulls, want = []) {
  const { win, guarantee: G } = TYPES[type];
  const S = statesOf(type);
  const size = copies * S;
  let v = new Float64Array(size), w = new Float64Array(size);
  v[start] = 1;
  const done = new Float64Array(pulls + 1);
  const left = new Map();
  let wi = 0;
  const snap = (n) => {
    const m = new Float64Array(S);
    for (let g = 0; g < copies; g++) for (let s = 0; s < S; s++) m[s] += v[g * S + s];
    left.set(n, m);
  };
  while (wi < want.length && want[wi] <= 0) snap(want[wi++]);
  // a banner takes at most copies × (30 × guarantee) pulls: after that nothing is left to do
  const last = Math.min(pulls, copies * SSR_PITY * G);
  for (let n = 1; n <= last; n++) {
    w.fill(0);
    let fin = 0;
    for (let g = 0; g < copies; g++) {
      const base = g * S;
      for (let l = 0; l < G; l++) {
        const pLim = l === G - 1 ? 1 : win;
        for (let k = 0; k < SSR_PITY; k++) {
          const p = v[base + l * SSR_PITY + k];
          if (p === 0) continue;
          const pS = k === SSR_PITY - 1 ? 1 : SSR_CHANCE;
          if (pS < 1) w[base + l * SSR_PITY + k + 1] += p * (1 - pS);
          const lim = p * pS * pLim, std = p * pS - lim;
          if (g + 1 === copies) fin += lim;
          else w[base + S] += lim; // next copy, pity back at the start
          if (std > 0) w[base + (l + 1) * SSR_PITY] += std;
        }
      }
    }
    done[n] = fin;
    [v, w] = [w, v];
    while (wi < want.length && want[wi] === n) snap(want[wi++]);
  }
  const none = new Float64Array(S);
  while (wi < want.length) left.set(want[wi++], none);
  return { done, left, last };
}

// The whole plan.
//   days:    [{ bank }]: pulls held that day if nothing were spent (limited pulls + silver / 200)
//   banners: [{ day, type: "char" | "wheel", copies }], in the order they are pulled on
//   start:   { char, wheel }: pity states now (stateIndex)
// Returns per banner its chance; per day the pulls left (mean, 10/50/90%) and the chance that
// everything so far went to plan; the chance of the whole plan and the pulls spent on average.
export function solvePlan({ days, banners, start = { char: RESET, wheel: RESET } }) {
  const top = Math.max(0, ...days.map((d) => Math.floor(d.bank + 1e-9)));
  // entries: (char pity, wheel pity, ok) → spent-pulls distribution over lo…hi (a[s − lo])
  let groups = new Map();
  const add = (map, c, wl, ok, lo, hi) => {
    const key = (c * 128 + wl) * 2 + ok;
    let e = map.get(key);
    if (!e) { e = { c, w: wl, ok, lo, hi, a: new Float64Array(hi - lo + 1) }; map.set(key, e); }
    else if (lo < e.lo || hi > e.hi) {
      const nlo = Math.min(lo, e.lo), nhi = Math.max(hi, e.hi);
      const na = new Float64Array(nhi - nlo + 1);
      na.set(e.a, e.lo - nlo);
      Object.assign(e, { lo: nlo, hi: nhi, a: na });
    }
    return e;
  };
  add(groups, start.char, start.wheel, 1, 0, 0).a[0] = 1;

  const results = banners.map(() => null);
  const byDay = days.map(() => null);
  let bi = 0;
  for (let d = 0; d < days.length; d++) {
    const cap = Math.floor(days[d].bank + 1e-9);
    for (; bi < banners.length && banners[bi].day === d; bi++) {
      const b = banners[bi];
      if (!(b.copies > 0)) { results[bi] = { chance: 1, mean: 0 }; continue; }
      const next = new Map();
      const isChar = b.type === "char";
      const S = statesOf(b.type);
      // the entries by this type's pity state
      const bySigma = new Map();
      for (const e of groups.values()) {
        const sigma = isChar ? e.c : e.w;
        if (!bySigma.has(sigma)) bySigma.set(sigma, []);
        bySigma.get(sigma).push(e);
      }
      let chance = 0, spentMean = 0;
      for (const [sigma, list] of bySigma) {
        let lo = Infinity;
        const avails = new Set();
        for (const e of list) for (let s = e.lo; s <= Math.min(e.hi, cap); s++) if (e.a[s - e.lo] > 0) { lo = Math.min(lo, s); avails.add(cap - s); }
        if (lo === Infinity) continue;
        const want = [...avails].sort((x, y) => x - y);
        const { done, left, last } = bannerChain(b.type, sigma, b.copies, cap - lo, want);
        const cdf = new Float64Array(done.length);
        for (let n = 1; n < done.length; n++) cdf[n] = cdf[n - 1] + done[n]; // flat after `last`
        for (const e of list) {
          const failed = new Float64Array(S);
          const from = e.lo, to = Math.min(e.hi, cap);
          // the goal met on pull n: spent s + n, this type's pity back at the start
          if (from < cap) {
            const ok = add(next, isChar ? RESET : e.c, isChar ? e.w : RESET, e.ok, from + 1, cap);
            for (let s = from; s <= to; s++) {
              const p = e.a[s - from];
              if (!(p > 0)) continue;
              const avail = cap - s, off = s - ok.lo;
              for (let n = 1, top = Math.min(avail, last); n <= top; n++) { const q = p * done[n]; if (q) { ok.a[off + n] += q; spentMean += q * n; } }
            }
          }
          for (let s = from; s <= to; s++) {
            const p = e.a[s - from];
            if (!(p > 0)) continue;
            const avail = cap - s;
            chance += p * cdf[avail];
            // the pulls ran out: spent everything held, pity where it was, the plan not met
            const m = left.get(avail);
            let miss = 0;
            for (let t = 0; t < S; t++) { failed[t] += p * m[t]; miss += m[t]; }
            spentMean += p * miss * avail;
          }
          for (let t = 0; t < S; t++) {
            if (!(failed[t] > 0)) continue;
            const f = add(next, isChar ? t : e.c, isChar ? e.w : t, 0, cap, cap);
            f.a[cap - f.lo] += failed[t];
          }
        }
      }
      results[bi] = { chance, mean: spentMean };
      groups = next;
    }
    // what's held at the end of the day
    const dist = new Float64Array(top + 1);
    let okMass = 0;
    for (const e of groups.values()) for (let s = e.lo; s <= e.hi; s++) { const p = e.a[s - e.lo]; dist[s] += p; if (e.ok) okMass += p; }
    byDay[d] = { ...leftStats(dist, days[d].bank, cap), ok: okMass };
  }
  let ok = 0, spent = 0;
  for (const e of groups.values()) for (let s = e.lo; s <= e.hi; s++) { const p = e.a[s - e.lo]; spent += s * p; if (e.ok) ok += p; }
  return { banners: results, days: byDay, chance: ok, spent };
}

// Pulls left that day: bank − spent, its mean and its 10%, 50% and 90% points (the 10% point is
// the one that 10% of outcomes are below)
function leftStats(dist, bank, cap) {
  let mean = 0, acc = 0;
  const q = { p10: null, p50: null, p90: null };
  // ascending pulls left = descending spent
  for (let s = cap; s >= 0; s--) {
    const p = dist[s];
    mean += p * (bank - s);
    acc += p;
    if (q.p10 == null && acc >= 0.1 - 1e-12) q.p10 = bank - s;
    if (q.p50 == null && acc >= 0.5 - 1e-12) q.p50 = bank - s;
    if (q.p90 == null && acc >= 0.9 - 1e-12) q.p90 = bank - s;
  }
  return { mean, p10: q.p10 ?? bank, p50: q.p50 ?? bank, p90: q.p90 ?? bank };
}
