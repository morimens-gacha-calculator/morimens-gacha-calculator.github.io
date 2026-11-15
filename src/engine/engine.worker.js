// Runs the calculation off the main thread.
// Message in:  { id, mode: "budget" | "pulls", desired (0–100), ...solve query }
// Messages out: { id, progress: {...} } while working (at most every 120 ms),
//               then { id, ok, result } where result = solve() output plus, in "pulls"
//               mode, requiredPulls and the budget report at that many pulls.
// To cancel, the page terminates the worker.
import { solve, budgetOnly } from "./banner-engine.js";

function transferables(x, out = []) {
  if (ArrayBuffer.isView(x)) out.push(x.buffer);
  else if (x && typeof x === "object") for (const v of Object.values(x)) transferables(v, out);
  return out;
}

self.onmessage = ({ data }) => {
  const { id, mode, desired, ...query } = data;
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
      result = solve({ ...query, budget: null, onProgress });
      const q = Math.min(1, Math.max(0, desired / 100));
      let pulls = null;
      if (q >= 1) pulls = result.max; // 100% only exists with a hard guarantee
      else for (let t = 0; t < result.cdf.length; t++) if (result.cdf[t] >= q - 1e-12) { pulls = t; break; }
      result.requiredPulls = pulls;
      result.budget = pulls == null ? null : budgetOnly({ ...query, budget: pulls, onProgress });
    }
    self.postMessage({ id, ok: true, result }, [...new Set(transferables(result))]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: err.message });
  }
};
