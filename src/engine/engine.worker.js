// Runs the calculation off the main thread.
// Message in:  { id, mode: "budget" | "pulls", desired (0–100), ...solve query }
// Messages out: { id, progress: {...} } while working (at most every 120 ms),
//               then { id, ok, result } where result = solve() output plus, in "pulls"
//               mode, requiredPulls and the budget report at that many pulls.
// To cancel, the page terminates the worker (and with it its helper threads).
// threads: false in a message keeps that calculation on one core (comparisons run several
// workers side by side instead).
import { PERCENTILE_SLACK } from "./settings.js";
import { solve, budgetOnly, setCancelCheck } from "./banner-engine.js";
import { setThreadPool, createPoolMemory } from "./chain-step.js";

// Helper threads for big chains. Only on cross-origin isolated pages (SharedArrayBuffer) with
// 4+ cores. Started once per worker, before any calculation: a worker can neither start helpers
// nor message them while it is busy calculating, so they get their shared memory now.
let poolReady = null;
function startPool() {
  if (poolReady) return poolReady;
  const cores = (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 1;
  const shared = self.crossOriginIsolated && cores >= 4 ? createPoolMemory() : null;
  if (!shared) return (poolReady = Promise.resolve(null));
  const T = Math.min(cores - 1, 7);
  const helper = (slot) => new Promise((resolve) => {
    let w;
    try { w = new Worker(new URL("./step-thread.js", import.meta.url), { type: "module" }); }
    catch { resolve(null); return; }
    const timer = setTimeout(() => { w.terminate(); resolve(null); }, 4000);
    w.onmessage = ({ data }) => {
      if (data?.type === "ready") w.postMessage({ type: "init", mem: shared.mem, ctrl: shared.ctrl, slot });
      if (data?.type === "initialised") { clearTimeout(timer); w.onmessage = null; resolve(w); }
    };
    w.onerror = () => { clearTimeout(timer); resolve(null); };
  });
  poolReady = Promise.all(Array.from({ length: T }, (_, i) => helper(i + 1))).then((ws) => {
    // slots must be 1…T with no gaps: use the pool only if every helper came up
    if (ws.some((w) => !w)) { ws.forEach((w) => w?.terminate()); return null; }
    return { mem: shared.mem, ctrl: shared.ctrl, size: T, workers: ws };
  });
  return poolReady;
}

function transferables(x, out = []) {
  if (ArrayBuffer.isView(x)) out.push(x.buffer);
  else if (x && typeof x === "object") for (const v of Object.values(x)) transferables(v, out);
  return out;
}

// Cancelling in place: the page shares one number, the id of the job it currently wants
// ({ type: "cancel-channel", sab }). The engine checks it in its long loops and stops cleanly
// when it changes; the worker answers { id, cancelled: true } and is ready for the next job, with
// its cache and helper threads intact. (Messages can't do this: a busy worker doesn't receive them.)
let wanted = null;

self.onmessage = async ({ data }) => {
  if (data?.type === "cancel-channel") { wanted = new Int32Array(data.sab); return; }
  const { id, mode, desired, threads = true, ...query } = data;
  setThreadPool(threads ? await startPool() : null);
  const stillWanted = () => !wanted || Atomics.load(wanted, 0) === id;
  if (!stillWanted()) { self.postMessage({ id, cancelled: true }); return; }
  setCancelCheck(wanted ? () => Atomics.load(wanted, 0) !== id : null);
  let last = 0;
  const onProgress = (p) => {
    const now = performance.now();
    if (now - last < 120) return;
    last = now;
    self.postMessage({ id, progress: { ...p, at: now } });
  };
  try {
    let result;
    if (mode === "budget") {
      result = solve({ ...query, onProgress });
    } else {
      result = solve({ ...query, budget: null, budgetAfter: true, onProgress });
      const q = Math.min(1, Math.max(0, desired / 100));
      let pulls = null;
      if (q >= 1) pulls = result.max; // 100% only exists with a hard guarantee
      else for (let t = 0; t < result.cdf.length; t++) if (result.cdf[t] >= q - PERCENTILE_SLACK) { pulls = t; break; }
      result.requiredPulls = pulls;
      result.budget = pulls == null ? null : budgetOnly({ ...query, budget: pulls, onProgress });
    }
    self.postMessage({ id, ok: true, result }, [...new Set(transferables(result))]);
  } catch (err) {
    if (err.code === "cancelled") self.postMessage({ id, cancelled: true });
    // code + values let the page show the message in the reader's language (errors.engine)
    else self.postMessage({ id, ok: false, error: err.message, code: err.code ?? null, values: err.values ?? null });
  } finally {
    setCancelCheck(null);
  }
};
