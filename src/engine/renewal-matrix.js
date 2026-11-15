// The renewal computations of the layered method for banners whose timing doesn't restart at
// every event (Markov renewal). Example: an SR guarantee every 10 pulls that keeps counting
// through SSRs. After an SSR the banner can then be in one of several states ("entries": SR
// counter 0…9); the next gap depends on which, and decides which entry comes next.
//   Q_ij(z) = Σ_t P(from entry i, the next event comes at pull t and lands in entry j)·z^t
//   A_j(z)  = the same from the starting state (the first event)
// The m-th event's time τ_m then has generating function Aᵀ·Q^(m−1)·1: the single-entry formula
// G1·G^(m−1) with matrices. The event count and the event kinds stay independent of the timing
// (they come from the event subtree), so everything else is unchanged.
// Same three computations as renewal.js, per frequency with J×J complex matrices:
//   combine:  p_0 + Aᵀ·(Σ_{m≥1} p_m·Q^(m−1))·1     (Horner on vectors: x ← Q·x + p_m·1)
//   Parseval: P(τ_m ≤ B) = (1/L) Σ_z Aᵀ(z)·Q(z)^(m−1)·1·conj(I(z))   (row vector r ← r·Q)
// Powers are taken in blocks of about √M, so the work per frequency is about M·J + 2√M·J²
// (the single-entry case: M).
import { stopIfCancelled } from "./cancel.js";
import { MAX_FFT_LENGTH, MAX_TIMING_BYTES, NEGLIGIBLE } from "./settings.js";
import { EngineError } from "./errors.js";
import { eventsBound, fft, transformed } from "./renewal.js";

const BLOCK = 64; // frequencies between progress and cancel checks

const maxLen = (pmfs) => pmfs.reduce((m, f) => Math.max(m, f.length), 1);

export function matLength(T, M, B) {
  const lenA = maxLen(T.A), lenQ = maxLen(T.Q.flat());
  const len = Math.max(B + 1, (lenA - 1) + Math.max(0, M - 1) * (lenQ - 1) + 1);
  let L = 2;
  while (L < len) L <<= 1;
  return { L, len };
}

// Half the spectrum (z = 0 … L/2) of every Q_ij and A_j, stored per frequency
export function matSpectrum(T, L) {
  const { J } = T, H = L / 2 + 1, JJ = J * J;
  const bytes = H * (JJ + J) * 16;
  if (L > MAX_FFT_LENGTH || bytes > MAX_TIMING_BYTES)
    throw new EngineError("timingTooBig", { entries: J, mb: Math.ceil(bytes / 1e6), limit: Math.round(MAX_TIMING_BYTES / 1e6) },
      `Too big: ${J} timing states after an event need ${Math.ceil(bytes / 1e6)} MB (limit ${Math.round(MAX_TIMING_BYTES / 1e6)} MB).`);
  const qr = new Float64Array(H * JJ), qi = new Float64Array(H * JJ), ar = new Float64Array(H * J), ai = new Float64Array(H * J);
  const put = (pmf, re, im, at, stride) => {
    if (!pmf.some((v) => v)) return;
    const f = transformed(pmf, L);
    for (let z = 0; z < H; z++) { re[z * stride + at] = f.re[z]; im[z * stride + at] = f.im[z]; }
  };
  for (let i = 0; i < J; i++) {
    stopIfCancelled();
    for (let j = 0; j < J; j++) put(T.Q[i][j], qr, qi, i * J + j, JJ);
    put(T.A[i], ar, ai, i, J);
  }
  return { J, H, qr, qi, ar, ai };
}

// Per frequency, powers are taken in blocks of s (Paterson–Stockmeyer): the column vectors
// w_i = Q^i·1 (i < s) and the matrix Qs = Q^s. Then
//   Σ_{m≥1} c_m·Q^(m−1)·1 = Σ_k Qs^k·b_k,  b_k = Σ_{i<s} c_{ks+i+1}·w_i      (Horner over k)
//   Aᵀ·Q^(ks+i)·1 = (Aᵀ·Qs^k)·w_i                                            (Parseval)
// s is a power of two near √M, so Q^s takes only log₂ s squarings: about
// M·J + (s + M/s)·J² + J³·log₂ s work per frequency instead of M·J².
const blockSize = (M) => { let s = 1; while (s * s * 2 <= M) s *= 2; return s; };

function workspace(J, s) {
  const JJ = J * J, mat = () => [new Float64Array(JJ), new Float64Array(JJ)], vec = () => [new Float64Array(J), new Float64Array(J)];
  return { q: mat(), p: mat(), u: mat(), w: [new Float64Array(s * J), new Float64Array(s * J)], x: vec(), y: vec() };
}

// C = A·B (J×J complex, row-major)
function matMul(J, ar, ai, br, bi, cr, ci) {
  for (let i = 0; i < J; i++) {
    for (let j = 0; j < J; j++) {
      let sr = 0, si = 0;
      for (let k = 0; k < J; k++) {
        const xr = ar[i * J + k], xi = ai[i * J + k], yr = br[k * J + j], yi = bi[k * J + j];
        sr += xr * yr - xi * yi;
        si += xr * yi + xi * yr;
      }
      cr[i * J + j] = sr; ci[i * J + j] = si;
    }
  }
}

// For frequency z: Q into W.q, w_i = Q^i·1 into W.w, and Q^s (returned as [re, im])
function prepare(S, z, s, W) {
  const { J } = S, JJ = J * J, o0 = z * JJ;
  const [qr, qi] = W.q, [wr, wi] = W.w;
  for (let e = 0; e < JJ; e++) { qr[e] = S.qr[o0 + e]; qi[e] = S.qi[o0 + e]; }
  for (let j = 0; j < J; j++) { wr[j] = 1; wi[j] = 0; }
  for (let i = 1; i < s; i++) {
    const o = i * J, p = o - J;
    for (let r = 0; r < J; r++) {
      let sr = 0, si = 0;
      for (let c = 0; c < J; c++) {
        const gr = qr[r * J + c], gi = qi[r * J + c], vr = wr[p + c], vi = wi[p + c];
        sr += gr * vr - gi * vi;
        si += gr * vi + gi * vr;
      }
      wr[o + r] = sr; wi[o + r] = si;
    }
  }
  // Q^s by squaring (s is a power of two)
  let [pr, pi] = W.p, [ur, ui] = W.u;
  pr.set(qr); pi.set(qi);
  for (let n = s; n > 1; n >>= 1) { matMul(J, pr, pi, pr, pi, ur, ui); [pr, ur] = [ur, pr]; [pi, ui] = [ui, pi]; }
  return [pr, pi];
}

// out(z) = c0 + Aᵀ(z)·Σ_{m=1…M} c[m]·Q(z)^(m−1)·1 for z = 0 … L/2, mirrored into L − z;
// several coefficient sequences cs at once (sharing the powers), c0s their constants
export function matHornerHalf(cs, M, c0s, S, L, onBlock = null) {
  const { J, H, ar, ai } = S;
  const outs = cs.map(() => ({ outR: new Float64Array(L), outI: new Float64Array(L) }));
  const s = blockSize(M), K = Math.ceil(M / s), W = workspace(J, s);
  const [wr, wi] = W.w;
  let [xr, xi] = W.x, [yr, yi] = W.y;
  for (let z = 0; z < H; z++) {
    if (z % BLOCK === 0) onBlock?.(z);
    const [pr, pi] = prepare(S, z, s, W);
    for (let q = 0; q < cs.length; q++) {
    const c = cs[q], { outR, outI } = outs[q];
    xr.fill(0); xi.fill(0);
    for (let k = K - 1; k >= 0; k--) {
      // y = Qs·x + b_k
      for (let r = 0; r < J; r++) {
        let sr = 0, si = 0;
        if (k < K - 1) {
          for (let col = 0; col < J; col++) {
            const gr = pr[r * J + col], gi = pi[r * J + col];
            sr += gr * xr[col] - gi * xi[col];
            si += gr * xi[col] + gi * xr[col];
          }
        }
        const m0 = k * s + 1;
        for (let i = 0; i < s && m0 + i <= M; i++) {
          const cm = c[m0 + i];
          sr += cm * wr[i * J + r];
          si += cm * wi[i * J + r];
        }
        yr[r] = sr; yi[r] = si;
      }
      [xr, yr] = [yr, xr]; [xi, yi] = [yi, xi];
    }
    let re = c0s[q], im = 0;
    for (let j = 0; j < J; j++) {
      const hr = ar[z * J + j], hi = ai[z * J + j];
      re += hr * xr[j] - hi * xi[j];
      im += hr * xi[j] + hi * xr[j];
    }
    outR[z] = re; outI[z] = im;
    }
  }
  for (const { outR, outI } of outs) for (let j = 1; j < L / 2; j++) { outR[L - j] = outR[j]; outI[L - j] = -outI[j]; }
  return outs;
}

// acc[m] = Σ_z wt(z)·Re(Aᵀ·Q^(m−1)·1·conj(I)), m = 1 … M (wt = 1 at both ends, 2 between)
function matParsevalHalf(M, S, I, L, onBlock = null) {
  const { J, H, ar, ai } = S;
  const acc = new Float64Array(M + 1);
  const s = blockSize(M), K = Math.ceil(M / s), W = workspace(J, s);
  const [wr, wi] = W.w;
  let [ur, ui] = W.x, [vr, vi] = W.y;
  for (let z = 0; z < H; z++) {
    if (z % BLOCK === 0) onBlock?.(z);
    const [pr, pi] = prepare(S, z, s, W);
    const wgt = z === 0 || z === H - 1 ? 1 : 2;
    const Ir = I.re[z], Ii = -I.im[z]; // conj(I)
    for (let j = 0; j < J; j++) {
      const hr = ar[z * J + j], hi = ai[z * J + j];
      ur[j] = hr * Ir - hi * Ii; ui[j] = hr * Ii + hi * Ir;
    }
    for (let k = 0; k < K; k++) {
      // u = Aᵀ·conj(I)·Qs^k: the terms m = ks + i + 1
      const m0 = k * s + 1;
      for (let i = 0; i < s && m0 + i <= M; i++) {
        let re = 0;
        for (let j = 0; j < J; j++) re += ur[j] * wr[i * J + j] - ui[j] * wi[i * J + j];
        acc[m0 + i] += wgt * re;
      }
      if (k === K - 1) break;
      for (let col = 0; col < J; col++) {
        let sr = 0, si = 0;
        for (let r = 0; r < J; r++) {
          const gr = pr[r * J + col], gi = pi[r * J + col];
          sr += ur[r] * gr - ui[r] * gi;
          si += ur[r] * gi + ui[r] * gr;
        }
        vr[col] = sr; vi[col] = si;
      }
      [ur, vr] = [vr, ur]; [ui, vi] = [vi, ui];
    }
  }
  return acc;
}

// A number of events surely enough for B pulls, from the entry with the shortest gaps
function matEventsBound(T, B) {
  let best = 1;
  for (const row of T.Q) {
    const g = new Float64Array(maxLen(row));
    for (const f of row) f.forEach((v, t) => { g[t] += v; });
    best = Math.max(best, eventsBound(g, B));
  }
  return best;
}

// P(τ_m ≤ B) for m = 1, 2, … (see eventsByPull in renewal.js)
export function matEventsByPull(T, B, tick = null) {
  for (let M = matEventsBound(T, B); ; M = Math.min(B + 1, M * 2)) {
    const { L } = matLength(T, M, B);
    const S = matSpectrum(T, L);
    const I = transformed(Array.from({ length: B + 1 }, () => 1), L);
    const acc = matParsevalHalf(M, S, I, L, (z) => { stopIfCancelled(); tick?.(z / (L / 2)); });
    const tauB = Float64Array.from(acc, (v, m) => (m === 0 ? 1 : Math.min(1, Math.max(0, v / L))));
    let k = 1;
    while (k <= M && tauB[k] >= NEGLIGIBLE) k++;
    if (k <= M || M >= B + 1) {
      const mCount = Math.min(k, M);
      return { tauB: Float64Array.from({ length: mCount + 1 }, (_, m) => (m < k ? tauB[m] : 0)), mCount };
    }
  }
}

// Σ_m P(exactly m events by t)·f(m) for t = 0…B (see curvesByPull in renewal.js)
export function matCurvesByPull(T, B, M, fs, tick = null) {
  const { L } = matLength(T, M, B);
  const S = matSpectrum(T, L);
  const ds = fs.map((f) => Float64Array.from({ length: M + 1 }, (_, m) => (m === 0 ? 0 : f[m] - f[m - 1])));
  const outs = matHornerHalf(ds, M, fs.map(() => 0), S, L, (z) => { stopIfCancelled(); tick?.(z / (L / 2)); });
  return fs.map((f, c) => {
    const { outR, outI } = outs[c];
    fft(outR, outI, true);
    const curve = new Float64Array(B + 1);
    let run = f[0];
    for (let t = 0; t <= B; t++) { run += outR[t]; curve[t] = run; }
    return curve;
  });
}
