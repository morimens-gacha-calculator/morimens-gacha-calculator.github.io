// FFT helpers and the renewal computations of the layered method.
// Events are a renewal process: the first gap has distribution gap1, later gaps gap. The time of
// the m-th event, τ_m, has generating function G1(z)·G(z)^(m−1). Everything the budget report
// needs over pulls is a sum over m of such terms, evaluated with one FFT (no m × t table):
//   Σ_m P(exactly m events by t)·f(m) = f(0) + Σ_{m≥1} P(τ_m ≤ t)·(f(m) − f(m−1))   (summation by parts)
// and P(τ_m ≤ B) for every m from Parseval: Σ_t τ_m(t)·[t ≤ B] = (1/L) Σ_z Τ_m(z)·conj(I(z)).
// The FFT length is longer than τ of the last event that matters, so nothing wraps around.
import { RENEWAL_KERNEL_B64 } from "./wasm-kernels.js";
import { stopIfCancelled } from "./cancel.js";
import { EVENTS_GUESS_FACTOR, EVENTS_GUESS_MARGIN, EVENTS_GUESS_SD, MAX_FFT_LENGTH, NEGLIGIBLE } from "./settings.js";
import { EngineError } from "./errors.js";

export function fft(re, im, inverse) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; }
  }
  // twiddles computed directly (not by repeated multiplication) to keep rounding at ~1e-16
  const half = n >> 1, cosT = new Float64Array(half), sinT = new Float64Array(half);
  for (let k = 0; k < half; k++) { cosT[k] = Math.cos(2 * Math.PI * k / n); sinT[k] = (inverse ? 1 : -1) * Math.sin(2 * Math.PI * k / n); }
  for (let len = 2; len <= n; len <<= 1) {
    const h = len >> 1, stride = n / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < h; k++) {
        const cr = cosT[k * stride], ci = sinT[k * stride];
        const a = i + k, b = a + h;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
      }
    }
  }
  if (inverse) for (let i = 0; i < n; i++) { re[i] /= n; im[i] /= n; }
}

export function fftLength(gap1, gap, M, B) {
  const len = Math.max(B + 1, (gap1.length - 1) + Math.max(0, M - 1) * (gap.length - 1) + 1);
  let L = 2;
  while (L < len) L <<= 1;
  if (L > MAX_FFT_LENGTH) throw new EngineError("budgetTooLong", { limit: MAX_FFT_LENGTH }, "Too big: the budget spans too many pulls for the report.");
  return L;
}

export function transformed(arr, L) {
  const re = new Float64Array(L), im = new Float64Array(L);
  arr.forEach((v, i) => { if (i < L) re[i] = v; });
  fft(re, im, false);
  return { re, im };
}

// A number of events surely enough for B pulls: mean + 10 standard deviations + margin
export function eventsBound(gap, B) {
  let mu = 0, m2 = 0;
  gap.forEach((p, t) => { mu += p * t; m2 += p * t * t; });
  const v = Math.max(0, m2 - mu * mu);
  return Math.min(B + 1, Math.ceil(EVENTS_GUESS_FACTOR * B / mu + EVENTS_GUESS_SD * Math.sqrt(B * v / (mu * mu * mu) + 1) + EVENTS_GUESS_MARGIN));
}

// P(τ_m ≤ B) for m = 1, 2, … by Parseval against the indicator of t ≤ B, over half the
// frequencies (the rest mirror them). Stops at the first m that is negligible (mCount); asks for more
// events than the estimate if none is that small yet.
export function eventsByPull(gap1, gap, B, tick = null) {
  for (let M = eventsBound(gap, B); ; M = Math.min(B + 1, M * 2)) {
    const L = fftLength(gap1, gap, M, B);
    const G = transformed(gap, L), G1 = transformed(gap1, L);
    const I = transformed(Array.from({ length: B + 1 }, () => 1), L);
    // W = G1·conj(I) per frequency
    const W = { re: new Float64Array(L / 2 + 1), im: new Float64Array(L / 2 + 1) };
    for (let z = 0; z <= L / 2; z++) {
      const hr = G1.re[z], hi = G1.im[z];
      W.re[z] = hr * I.re[z] + hi * I.im[z];
      W.im[z] = hi * I.re[z] - hr * I.im[z];
    }
    const acc = parsevalHalf(M, G, W, L, (z) => { stopIfCancelled(); tick?.(z / (L / 2)); });
    const tauB = Float64Array.from(acc, (v, m) => (m === 0 ? 1 : Math.min(1, Math.max(0, v / L))));
    // first count that can't happen within B pulls; later values are rounding noise around 0
    let k = 1;
    while (k <= M && tauB[k] >= NEGLIGIBLE) k++;
    if (k <= M || M >= B + 1) {
      const mCount = Math.min(k, M);
      return { tauB: Float64Array.from({ length: mCount + 1 }, (_, m) => (m < k ? tauB[m] : 0)), mCount };
    }
  }
}

// For each per-event sequence f (f[m], m = 0…M), the curve Σ_m P(exactly m events by t)·f(m),
// t = 0…B: Horner on the differences over half the frequencies, an inverse FFT, a running sum.
export function curvesByPull(gap1, gap, B, M, fs, tick = null) {
  const L = fftLength(gap1, gap, M, B);
  const G = transformed(gap, L), G1 = transformed(gap1, L);
  return fs.map((f, c) => {
    const d = Float64Array.from({ length: M + 1 }, (_, m) => (m === 0 ? 0 : f[m] - f[m - 1]));
    const { outR, outI } = hornerHalf(d, M, 0, G, G1, L, (z) => { stopIfCancelled(); tick?.((c + z / (L / 2)) / fs.length); });
    fft(outR, outI, true);
    const curve = new Float64Array(B + 1);
    let run = f[0];
    for (let t = 0; t <= B; t++) { run += outR[t]; curve[t] = run; }
    return curve;
  });
}

// ── The two inner loops, in WebAssembly SIMD when available ─────────────────────────────────
// Both run over the frequencies z = 0 … L/2 (the rest mirror them), in blocks so progress and
// cancel checks still happen. The SIMD kernel (renewal-simd.wat) does two frequencies at a time
// with the same operations in the same order, so results are identical either way.
const BLOCK = 1024;
let simdModule; // undefined = not tried, null = unavailable
function simdKernel(bytes) {
  if (simdModule === undefined) {
    try {
      const bin = typeof atob === "function"
        ? Uint8Array.from(atob(RENEWAL_KERNEL_B64), (ch) => ch.charCodeAt(0))
        : Uint8Array.from(Buffer.from(RENEWAL_KERNEL_B64, "base64"));
      simdModule = new WebAssembly.Module(bin);
    } catch { simdModule = null; }
  }
  if (!simdModule) return null;
  const inst = new WebAssembly.Instance(simdModule, {});
  const { mem } = inst.exports;
  const need = Math.ceil((bytes + 64) / 65536) - mem.buffer.byteLength / 65536;
  if (need > 0) mem.grow(need);
  let top = 0;
  const alloc = (n) => { top = (top + 15) & ~15; const at = top; top += 8 * n; return at; };
  return { ...inst.exports, alloc, f64: (at, n) => new Float64Array(mem.buffer, at, n) };
}

// out(z) = c0 + H(z)·Σ_{m=1…M} c[m]·G(z)^(m−1) (Horner), for z = 0 … L/2, mirrored into L − z.
// G, H: transforms { re, im } of length L. onBlock(zDone) between blocks.
export function hornerHalf(c, M, c0, G, H, L, onBlock = null) {
  const half = L / 2, outR = new Float64Array(L), outI = new Float64Array(L);
  const k = half >= 2 ? simdKernel(8 * (M + 1 + 6 * half) + 256) : null;
  let z = 0;
  if (k) {
    const at = { c: k.alloc(M + 1), gr: k.alloc(half), gi: k.alloc(half), hr: k.alloc(half), hi: k.alloc(half), or: k.alloc(half), oi: k.alloc(half) };
    k.f64(at.c, M + 1).set(c.subarray ? c.subarray(0, M + 1) : c.slice(0, M + 1));
    k.f64(at.gr, half).set(G.re.subarray(0, half)); k.f64(at.gi, half).set(G.im.subarray(0, half));
    k.f64(at.hr, half).set(H.re.subarray(0, half)); k.f64(at.hi, half).set(H.im.subarray(0, half));
    for (; z < half; z += BLOCK) {
      onBlock?.(z);
      k.horner(at.c, M, c0, at.gr, at.gi, at.hr, at.hi, at.or, at.oi, z, Math.min(half, z + BLOCK));
    }
    outR.set(k.f64(at.or, half)); outI.set(k.f64(at.oi, half));
    z = half; // the kernel did 0 … half − 1
  }
  for (; z <= half; z++) { // without SIMD all of them; with it, only z = L/2
    if ((z % BLOCK) === 0) onBlock?.(z);
    const gr = G.re[z], gi = G.im[z];
    let xr = 0, xi = 0;
    for (let m = M; m >= 1; m--) {
      const nr = xr * gr - xi * gi + c[m];
      xi = xr * gi + xi * gr;
      xr = nr;
    }
    outR[z] = xr * H.re[z] - xi * H.im[z] + c0;
    outI[z] = xr * H.im[z] + xi * H.re[z];
  }
  for (let j = 1; j < half; j++) { outR[L - j] = outR[j]; outI[L - j] = -outI[j]; }
  return { outR, outI };
}

// acc[m] = Σ_z wt(z)·Re(W(z)·G(z)^(m−1)), m = 1 … M, over z = 0 … L/2 (wt = 1 at both ends,
// 2 between: the mirrored half counted twice). W: { re, im } of length ≥ L/2 + 1.
export function parsevalHalf(M, G, W, L, onBlock = null) {
  const half = L / 2, acc = new Float64Array(M + 1);
  const k = half >= 2 ? simdKernel(8 * (M + 1 + 5 * half) + 256) : null;
  let z = 0;
  if (k) {
    const at = { acc: k.alloc(M + 1), gr: k.alloc(half), gi: k.alloc(half), wr: k.alloc(half), wi: k.alloc(half), wt: k.alloc(half) };
    k.f64(at.gr, half).set(G.re.subarray(0, half)); k.f64(at.gi, half).set(G.im.subarray(0, half));
    k.f64(at.wr, half).set(W.re.subarray(0, half)); k.f64(at.wi, half).set(W.im.subarray(0, half));
    const wt = k.f64(at.wt, half); wt.fill(2); wt[0] = 1;
    for (; z < half; z += BLOCK) {
      onBlock?.(z);
      k.parseval(at.acc, M, at.gr, at.gi, at.wr, at.wi, at.wt, z, Math.min(half, z + BLOCK));
    }
    acc.set(k.f64(at.acc, M + 1));
    z = half; // the kernel did 0 … half − 1
  }
  for (; z <= half; z++) {
    if ((z % BLOCK) === 0) onBlock?.(z);
    const gr = G.re[z], gi = G.im[z];
    const wgt = z === 0 || z === half ? 1 : 2;
    let wr = W.re[z], wi = W.im[z];
    for (let m = 1; m <= M; m++) {
      acc[m] += wgt * wr;
      const nr = wr * gr - wi * gi;
      wi = wr * gi + wi * gr;
      wr = nr;
    }
  }
  return acc;
}
