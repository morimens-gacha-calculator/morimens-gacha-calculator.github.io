import { useEffect, useRef, useState } from "react";
import { buildQuery } from "./model.js";
import { getStrings } from "./i18n/index.js";

// Calculates every saved setup in the comparison list, one after another, in its own
// worker. Results are cached by the setup's contents, so only new or changed setups run.
export function useCompare(items, lang) { // eslint-disable-line no-unused-vars
  const [results, setResults] = useState({}); // id → { key, status, result?, error? }
  const doneRef = useRef({});                  // id → key of the finished calculation

  useEffect(() => {
    const todo = items.filter((it) => doneRef.current[it.id] !== JSON.stringify(it.snapshot));
    if (!todo.length) return undefined;
    let cancelled = false;
    const worker = new Worker(new URL("./engine/engine.worker.js", import.meta.url), { type: "module" });
    let i = 0;
    const next = () => {
      if (cancelled) return;
      if (i >= todo.length) { worker.terminate(); return; }
      const it = todo[i++];
      const key = JSON.stringify(it.snapshot);
      let query;
      try { query = buildQuery(it.snapshot); }
      catch (e) {
        doneRef.current[it.id] = key;
        setResults((r) => ({ ...r, [it.id]: { key, status: "error", error: e.message } }));
        next();
        return;
      }
      setResults((r) => ({ ...r, [it.id]: { ...r[it.id], key, status: "busy" } }));
      worker.onmessage = ({ data }) => {
        if (cancelled) return;
        doneRef.current[it.id] = key;
        setResults((r) => ({ ...r, [it.id]: data.ok ? { key, status: "ok", result: data.result } : { key, status: "error", error: data.error } }));
        next();
      };
      worker.onerror = (e) => {
        doneRef.current[it.id] = key;
        setResults((r) => ({ ...r, [it.id]: { key, status: "error", error: e.message || getStrings().errors.crashed } }));
        next();
      };
      worker.postMessage({ id: 1, mode: "budget", ...query, budget: null });
    };
    next();
    return () => { cancelled = true; worker.terminate(); };
  }, [items]);

  return results;
}
