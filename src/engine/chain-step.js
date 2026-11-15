// Stepping a state chain one pull at a time — the hot loop of the joint and split methods.
// Uses a small WebAssembly kernel when available (about 1.6× faster than the same loop in
// JS, same arithmetic in the same order, so identical results); plain JS otherwise.
//
//   const st = makeStepper(chain);  // chain: { N, rowStart, col, prob, startIndex }
//   st.cur                          // Float64Array: current distribution over states
//   st.step()                       // one pull; returns the mass that reached state 0 this pull
//                                   // (then cleared); st.remaining = mass in states 1…N−1
//   const w = st.weights(f64array); st.dot(w)   // Σ cur[k]·w[k], k ≥ 1
//
// With a thread pool (setThreadPool; needs a cross-origin isolated page), big chains are
// split across cores: helper threads each compute a range of states (chain-pull.wat).
// st.close() releases the helpers; call it when done stepping.
//
// Kernels: chain-step.wat / chain-pull.wat, compiled into wasm-kernels.js by `npm run build:wasm`.
import { HELPER_IDLE_MS, HELPER_START_MS, PARALLEL_MIN_EDGES, THREAD_TRIAL_PULLS } from "./settings.js";
import { pullKernel, CTRL, CTRL_WORDS, MAX_WEIGHTS } from "./step-thread-core.js";
import { STEP_KERNEL_B64 as KERNEL_B64 } from "./wasm-kernels.js";
import { internalError } from "./errors.js";


let compiled; // undefined = not tried, null = unavailable
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
function kernelModule() {
  if (compiled !== undefined) return compiled;
  try {
    const bin = typeof atob === "function"
      ? Uint8Array.from(atob(KERNEL_B64), (ch) => ch.charCodeAt(0))
      : Uint8Array.from(Buffer.from(KERNEL_B64, "base64"));
    compiled = new WebAssembly.Module(bin);
  } catch {
    compiled = null;
  }
  return compiled;
}

// Helper threads, set up by setThreadPool(pool) with pool = { mem, ctrl, size } where the helpers
// already serve that shared memory and control block (see step-thread-core.js / initPool).
let pool = null;
export function setThreadPool(p) { pool = p && p.size ? p : null; }
export { PARALLEL_MIN_EDGES }; // (from settings.js)

// For the side that owns the helpers: one growable shared memory + control block, sent to each
// helper with { type: "init", mem, ctrl, slot }. Returns null where shared memory isn't allowed.
export function createPoolMemory() {
  if (typeof SharedArrayBuffer === "undefined") return null;
  for (const maximum of [32768, 16384, 8192]) { // up to 2 GB / 1 GB / 512 MB, as the browser allows
    try {
      const mem = new WebAssembly.Memory({ initial: 16, maximum, shared: true });
      return { mem, ctrl: new SharedArrayBuffer(4 * CTRL_WORDS), maxBytes: maximum * 65536 };
    } catch { /* try smaller */ }
  }
  return null;
}

export function makeStepper(c, { useWasm = true, threads = true, minEdges = PARALLEL_MIN_EDGES } = {}) {
  const mod = useWasm ? kernelModule() : null;
  if (mod && threads && pool && c.col.length >= minEdges) {
    try { return parallelStepper(c, pool, mod); } catch { /* fall back below */ }
  }
  return mod ? wasmStepper(c, mod) : jsStepper(c);
}

function jsStepper({ N, rowStart, col, prob, startIndex }) {
  let cur = new Float64Array(N), next = new Float64Array(N);
  cur[startIndex] = 1;
  const st = {
    cur, remaining: startIndex === 0 ? 0 : 1, kind: "js",
    step() {
      next.fill(0);
      for (let k = 1; k < N; k++) {
        const m = cur[k];
        if (m === 0) continue;
        for (let e = rowStart[k], end = rowStart[k + 1]; e < end; e++) next[col[e]] += m * prob[e];
      }
      const sink = next[0];
      next[0] = 0;
      let s = 0;
      for (let k = 1; k < N; k++) s += next[k];
      [cur, next] = [next, cur];
      st.cur = cur;
      st.remaining = s;
      return sink;
    },
    weights: (w) => w,
    dot(w) { let s = 0; for (let k = 1; k < N; k++) s += cur[k] * w[k]; return s; },
    close() {},
  };
  return st;
}

function wasmStepper({ N, rowStart, col, prob, startIndex }, mod, init = null) {
  const inst = new WebAssembly.Instance(mod, {});
  const { mem, step, dot } = inst.exports;
  const nnz = col.length;
  let top = 0;
  const layout = [];
  const alloc = (bytes) => { top = (top + 7) & ~7; const at = top; top += bytes; layout.push(at); return at; };
  const rs = alloc(4 * (N + 1)), cp = alloc(4 * nnz), pp = alloc(8 * nnz);
  let a = alloc(8 * N), b = alloc(8 * N);
  const reserve = (bytes) => {
    const need = Math.ceil((top + bytes + 64) / 65536) - mem.buffer.byteLength / 65536;
    if (need > 0) mem.grow(need);
  };
  reserve(0);
  new Int32Array(mem.buffer, rs, N + 1).set(rowStart);
  new Int32Array(mem.buffer, cp, nnz).set(col);
  new Float64Array(mem.buffer, pp, nnz).set(prob);
  const view = (at) => new Float64Array(mem.buffer, at, N);
  if (init) view(a).set(init); else view(a)[startIndex] = 1;
  const st = {
    cur: view(a), remaining: startIndex === 0 ? 0 : 1, kind: "wasm",
    step() {
      st.remaining = step(rs, cp, pp, a, b, N);
      const nb = view(b); // memory never grows after weights() calls during stepping
      const sink = nb[0];
      nb[0] = 0;
      [a, b] = [b, a];
      st.cur = nb;
      return sink;
    },
    weights(w) {
      reserve(8 * N);
      const at = alloc(8 * N);
      view(at).set(w);
      st.cur = view(a); // views may have been detached by grow
      return at;
    },
    dot: (at) => dot(a, at, N),
    close() {},
  };
  return st;
}

// Several cores: the chain in pull form (incoming edges per state) in the pool's shared memory.
// This thread takes the first range, helpers the others. One step = bump GEN, everyone computes
// its range, helpers bump DONE; this thread waits for all, then adds up the partial sums.
function parallelStepper(c, p, mod) {
  const { N, rowStart, col, prob, startIndex } = c;
  const T = p.size;
  const ctl = new Int32Array(p.ctrl), mem = p.mem;
  // transpose: for each target j, the (source, probability) pairs; sources are states 1…N−1
  const cnt = new Int32Array(N + 1);
  for (let k = 1; k < N; k++) for (let e = rowStart[k]; e < rowStart[k + 1]; e++) cnt[col[e] + 1]++;
  for (let j = 0; j < N; j++) cnt[j + 1] += cnt[j];
  const nnz = cnt[N];

  let top = 0;
  const alloc = (bytes) => { top = (top + 7) & ~7; const at = top; top += bytes; return at; };
  const at = { rs: alloc(4 * (N + 1)), src: alloc(4 * nnz), prob: alloc(8 * nnz), A: alloc(8 * N), B: alloc(8 * N), sums: alloc(8 * 64 * (1 + MAX_WEIGHTS)) };
  const ensure = () => {
    const need = Math.ceil((top + 64) / 65536) - mem.buffer.byteLength / 65536;
    if (need > 0) mem.grow(need); // throws past the maximum: caller falls back to one core
  };
  ensure();
  const buf = () => mem.buffer;
  const rs = new Int32Array(buf(), at.rs, N + 1), src = new Int32Array(buf(), at.src, nnz), tp = new Float64Array(buf(), at.prob, nnz);
  rs.set(cnt);
  const fill = Int32Array.from(cnt);
  for (let k = 1; k < N; k++) for (let e = rowStart[k]; e < rowStart[k + 1]; e++) { const x = fill[col[e]]++; src[x] = k; tp[x] = prob[e]; }
  new Float64Array(buf(), at.A, N).fill(0);
  new Float64Array(buf(), at.B, N).fill(0);
  new Float64Array(buf(), at.A, N)[startIndex] = 1;
  const { pull } = new WebAssembly.Instance(pullKernel(), { env: { mem } }).exports;

  // ranges with about the same number of incoming edges each
  const bounds = [0];
  for (let s = 1; s <= T; s++) {
    const target = (nnz * s) / (T + 1);
    let j = bounds[s - 1];
    while (j < N && cnt[j] < target) j++;
    bounds.push(Math.max(j, bounds[s - 1]));
  }
  bounds.push(N);

  const weightsList = [];
  let gen = 0, started = false, fallback = null;
  // Measure before committing: TRIAL pulls on all threads, then TRIAL on this one alone; keep
  // the faster (memory-bound loops don't always scale with cores).
  const TRIAL = THREAD_TRIAL_PULLS;
  let phase = "parallel-trial", tPar = 0, tOne = 0, single = null, trialCount = 0, t0 = 0;

  const start = () => {
    started = true;
    const nW = weightsList.length;
    ctl[CTRL.RS] = at.rs; ctl[CTRL.SRC] = at.src; ctl[CTRL.PROB] = at.prob; ctl[CTRL.A] = at.A; ctl[CTRL.B] = at.B;
    ctl[CTRL.N] = N; ctl[CTRL.NW] = nW; ctl[CTRL.SUMS] = at.sums;
    weightsList.forEach((w, i) => { ctl[CTRL.W0 + i] = w.at; });
    for (let s = 1; s <= T; s++) { ctl[CTRL.RANGE0 + 2 * s] = bounds[s]; ctl[CTRL.RANGE0 + 2 * s + 1] = bounds[s + 1]; }
    Atomics.store(ctl, CTRL.STOP, 0);
    Atomics.store(ctl, CTRL.READY, 0);
    Atomics.store(ctl, CTRL.GEN, 0);
    Atomics.add(ctl, CTRL.JOB, 1);
    Atomics.notify(ctl, CTRL.JOB);
    // wait for the helpers to pick the job up; if they don't, step here alone
    const until = Date.now() + HELPER_START_MS;
    while (Atomics.load(ctl, CTRL.READY) < T) {
      const seen = Atomics.load(ctl, CTRL.READY);
      if (Date.now() > until) { Atomics.store(ctl, CTRL.STOP, 1); Atomics.notify(ctl, CTRL.GEN); return false; }
      Atomics.wait(ctl, CTRL.READY, seen, 50);
    }
    return true;
  };

  const st = {
    cur: new Float64Array(buf(), at.A, N), remaining: startIndex === 0 ? 0 : 1, kind: `wasm × ${T + 1} threads`,
    step() {
      if (!fallback && !started && !start()) {
        // helpers unavailable: continue on one core from the same (initial) state
        fallback = wasmStepper(c, mod);
        weightsList.forEach((x) => { x.fb = fallback.weights(x.values()); });
        st.kind = fallback.kind;
      }
      if (fallback) {
        const sink = fallback.step();
        st.cur = fallback.cur; st.remaining = fallback.remaining;
        return sink;
      }
      if (phase === "one-trial" || phase === "one") {
        if (phase === "one-trial" && trialCount === 0) t0 = now();
        const sink = single.step();
        st.cur = single.cur; st.remaining = single.remaining;
        if (phase === "one-trial" && ++trialCount === TRIAL) {
          tOne = now() - t0;
          if (tOne <= tPar) {
            phase = "one"; // one core is as fast here: let the helpers go
            fallback = single;
            st.kind = "wasm (1 thread was faster)";
            Atomics.store(ctl, CTRL.STOP, 1); Atomics.notify(ctl, CTRL.GEN);
          } else {
            // back to all threads, from where the single-thread trial got to
            gen += TRIAL;
            new Float64Array(buf(), gen & 1 ? at.B : at.A, N).set(single.cur);
            phase = "parallel";
            st.cur = new Float64Array(buf(), gen & 1 ? at.B : at.A, N);
          }
        }
        return sink;
      }
      if (phase === "parallel-trial" && trialCount === 0) t0 = now();
      gen++;
      Atomics.store(ctl, CTRL.DONE, 0);
      Atomics.store(ctl, CTRL.GEN, gen);
      Atomics.notify(ctl, CTRL.GEN);
      const curAt = gen & 1 ? at.A : at.B, nextAt = gen & 1 ? at.B : at.A;
      let remaining = pull(at.rs, at.src, at.prob, curAt, nextAt, bounds[0], bounds[1]);
      const next = new Float64Array(buf(), nextAt, N);
      const own = weightsList.map((x) => { const wv = x.values(); let s = 0; for (let j = 1; j < bounds[1]; j++) s += next[j] * wv[j]; return s; });
      for (;;) {
        const d = Atomics.load(ctl, CTRL.DONE);
        if (d >= T) break;
        Atomics.wait(ctl, CTRL.DONE, d, HELPER_IDLE_MS);
      }
      const stride = 1 + weightsList.length;
      const sums = new Float64Array(buf(), at.sums, stride * 64);
      for (let i = 1; i <= T; i++) remaining += sums[i * stride];
      weightsList.forEach((x, w) => { let s = own[w]; for (let i = 1; i <= T; i++) s += sums[i * stride + 1 + w]; x.dot = s; });
      const sink = next[0];
      next[0] = 0;
      st.cur = next;
      st.remaining = remaining;
      if (phase === "parallel-trial" && ++trialCount === TRIAL) {
        tPar = now() - t0;
        phase = "one-trial";
        trialCount = 0;
        single = wasmStepper(c, mod, next);
        weightsList.forEach((x) => { x.one = single.weights(x.values()); });
        single.remaining = remaining;
      }
      return sink;
    },
    weights(w) {
      if (started) throw internalError("weights() must come before the first step()");
      if (weightsList.length >= MAX_WEIGHTS) throw internalError("too many weight vectors");
      const wat = alloc(8 * N);
      ensure();
      new Float64Array(buf(), wat, N).set(w);
      const h = { at: wat, values: () => new Float64Array(buf(), wat, N), dot: null, fb: null };
      weightsList.push(h);
      st.cur = new Float64Array(buf(), at.A, N);
      return h;
    },
    dot(h) {
      if (fallback === single && single) return single.dot(h.one);
      if (fallback) return fallback.dot(h.fb);
      if (phase === "one-trial") return single.dot(h.one);
      if (gen === 0) { const wv = h.values(); let s = 0; for (let k = 1; k < N; k++) s += st.cur[k] * wv[k]; return s; }
      return h.dot;
    },
    close() {
      if (started && !fallback) { Atomics.store(ctl, CTRL.STOP, 1); Atomics.notify(ctl, CTRL.GEN); }
    },
  };
  return st;
}
