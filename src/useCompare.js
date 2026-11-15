import { useEffect, useRef, useState } from "react";
import { buildQuery } from "./model.js";
import { getStrings } from "./i18n/index.js";

// Calculates every saved setup in the comparison list, several at a time (one worker per
// setup, up to half the CPU cores), each on one core. Results are cached by the setup's
// contents, so only new or changed setups run.
export function useCompare(items, lang) { // eslint-disable-line no-unused-vars
  const [results, setResults] = useState({}); // id → { key, status, result?, error? }
  const doneRef = useRef({});                  // id → key of the finished calculation

  useEffect(() => {
    const todo = items.filter((it) => doneRef.current[it.id] !== JSON.stringify(it.snapshot));
    if (!todo.length) return undefined;
    let cancelled = false;
    const cores = navigator.hardwareConcurrency || 2;
    const parallel = Math.max(1, Math.min(todo.length, Math.floor(cores / 2), 4));
    const workers = [];
    let i = 0;
    const finish = (it, key, value) => {
      doneRef.current[it.id] = key;
      setResults((r) => ({ ...r, [it.id]: { key, ...value } }));
    };
    const runNext = (worker) => {
      if (cancelled) return;
      if (i >= todo.length) { worker.terminate(); return; }
      const it = todo[i++];
      const key = JSON.stringify(it.snapshot);
      let query;
      try { query = buildQuery(it.snapshot); }
      catch (e) { finish(it, key, { status: "error", error: e.message }); runNext(worker); return; }
      setResults((r) => ({ ...r, [it.id]: { ...r[it.id], key, status: "busy" } }));
      worker.onmessage = ({ data }) => {
        if (cancelled || data.progress) return;
        finish(it, key, data.ok ? { status: "ok", result: data.result } : { status: "error", error: data.error, errorCode: data.code, errorValues: data.values });
        runNext(worker);
      };
      worker.onerror = (e) => {
        finish(it, key, { status: "error", error: e.message || getStrings().errors.crashed });
        runNext(worker);
      };
      worker.postMessage({ id: 1, mode: "budget", ...query, budget: null, threads: false });
    };
    for (let w = 0; w < parallel; w++) {
      const worker = new Worker(new URL("./engine/engine.worker.js", import.meta.url), { type: "module" });
      workers.push(worker);
      runNext(worker);
    }
    return () => { cancelled = true; workers.forEach((w) => w.terminate()); };
  }, [items]);

  return results;
}
