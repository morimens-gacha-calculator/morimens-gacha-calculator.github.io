// FFT helpers and the renewal computations of the layered method.
// Events are a renewal process: the first gap has distribution gap1, later gaps gap. The time of
// the m-th event, τ_m, has generating function G1(z)·G(z)^(m−1). Everything the budget report
// needs over pulls is a sum over m of such terms, evaluated with one FFT (no m × t table):
//   Σ_m P(exactly m events by t)·f(m) = f(0) + Σ_{m≥1} P(τ_m ≤ t)·(f(m) − f(m−1))   (summation by parts)
// and P(τ_m ≤ B) for every m from Parseval: Σ_t τ_m(t)·[t ≤ B] = (1/L) Σ_z Τ_m(z)·conj(I(z)).
// The FFT length is longer than τ of the last event that matters, so nothing wraps around.
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
    const acc = new Float64Array(M + 1);
    for (let z = 0; z <= L / 2; z++) {
      if ((z & 2047) === 0) { stopIfCancelled(); tick?.(z / (L / 2)); }
      const gr = G.re[z], gi = G.im[z], hr = G1.re[z], hi = G1.im[z];
      const wgt = z === 0 || z === L / 2 ? 1 : 2;
      let wr = hr * I.re[z] + hi * I.im[z], wi = hi * I.re[z] - hr * I.im[z]; // G1·conj(I)
      for (let m = 1; m <= M; m++) {
        acc[m] += wgt * wr;
        const nr = wr * gr - wi * gi;
        wi = wr * gi + wi * gr;
        wr = nr;
      }
    }
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
    const outR = new Float64Array(L), outI = new Float64Array(L);
    for (let z = 0; z <= L / 2; z++) {
      if ((z & 2047) === 0) { stopIfCancelled(); tick?.((c + z / (L / 2)) / fs.length); }
      const gr = G.re[z], gi = G.im[z];
      let xr = 0, xi = 0;
      for (let m = M; m >= 1; m--) {
        const nr = xr * gr - xi * gi + d[m];
        xi = xr * gi + xi * gr;
        xr = nr;
      }
      const hr = G1.re[z], hi = G1.im[z];
      const r = xr * hr - xi * hi, i = xr * hi + xi * hr;
      outR[z] = r; outI[z] = i;
      if (z > 0 && z < L / 2) { outR[L - z] = r; outI[L - z] = -i; }
    }
    fft(outR, outI, true);
    const curve = new Float64Array(B + 1);
    let run = f[0];
    for (let t = 0; t <= B; t++) { run += outR[t]; curve[t] = run; }
    return curve;
  });
}
