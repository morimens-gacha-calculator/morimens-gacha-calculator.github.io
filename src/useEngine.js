import { useCallback, useEffect, useRef, useState } from "react";
import { buildQuery } from "./model.js";
import { getStrings } from "./i18n/index.js";

// Runs the engine in a Web Worker whenever `state` changes (debounced).
// A newer request cancels a running one, so typing never queues up work.
// Returns { status: "busy" | "ok" | "error" | "cancelled", result, error, ms, progress, cancel }.
// progress = { phase, text-ready numbers, eta (seconds or null), elapsed (ms) } while busy.
export function useEngine(state, runToken, lang) {
  const [res, setRes] = useState({ status: "busy", result: null, error: null, progress: null });
  const workerRef = useRef(null);
  const busyRef = useRef(false);
  const idRef = useRef(0);
  const startRef = useRef(0);
  const samplesRef = useRef([]);   // recent { at, t, remaining } during the main calculation
  const budgetRef = useRef(null);  // pulls the budget report will run, if any
  const timerRef = useRef(null);   // pending start (the short pause after typing)

  const makeWorker = () => {
    const w = new Worker(new URL("./engine/engine.worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => {
      if (data.id !== idRef.current) return;
      if (data.progress) {
        const progress = estimate(data.progress, samplesRef.current, budgetRef.current, startRef.current);
        setRes((prev) => (prev.status === "busy" ? { ...prev, progress } : prev));
        return;
      }
      busyRef.current = false;
      setRes(data.ok
        ? { status: "ok", result: data.result, error: null, ms: performance.now() - startRef.current, progress: null }
        : (prev) => ({ ...prev, status: "error", error: data.error, progress: null }));
    };
    w.onerror = (e) => {
      busyRef.current = false;
      setRes((prev) => ({ ...prev, status: "error", error: e.message || getStrings().errors.crashed, progress: null }));
    };
    return w;
  };

  const cancel = useCallback(() => {
    clearTimeout(timerRef.current);
    workerRef.current?.terminate();
    workerRef.current = null;
    busyRef.current = false;
    idRef.current += 1; // ignore anything still in flight
    setRes((prev) => ({ ...prev, status: "cancelled", progress: null }));
  }, []);

  // Only what changes the numbers triggers a new calculation (not chart lines, view, etc.)
  const { banner, goal, goalMode, start, settings, mode, budget, desired } = state;
  const calcKey = JSON.stringify({ banner, goal, goalMode, start, settings, mode, budget, desired });

  useEffect(() => {
    let query;
    try {
      query = buildQuery(state);
    } catch (e) {
      setRes((prev) => ({ ...prev, status: "error", error: e.message, progress: null }));
      return undefined;
    }
    setRes((prev) => ({ ...prev, status: "busy", error: null, progress: null }));
    const timer = timerRef.current = setTimeout(() => {
      if (busyRef.current && workerRef.current) { workerRef.current.terminate(); workerRef.current = null; }
      if (!workerRef.current) workerRef.current = makeWorker();
      idRef.current += 1;
      busyRef.current = true;
      startRef.current = performance.now();
      samplesRef.current = [];
      budgetRef.current = state.mode === "budget" ? state.budget : null;
      workerRef.current.postMessage({
        id: idRef.current,
        mode: state.mode,
        desired: state.desired,
        ...query,
        budget: state.mode === "budget" ? state.budget : null,
      });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcKey, runToken, lang]);

  useEffect(() => () => workerRef.current?.terminate(), []);
  return { ...res, cancel };
}

// Time left, from how fast pulls are being calculated and how fast the
// "not done yet" probability is shrinking (it shrinks roughly geometrically in the tail).
function estimate(p, samples, budget, startedAt) {
  const elapsed = p.at - startedAt;
  if (p.phase === "build" || p.phase === "reduce") return { phase: p.phase, states: p.states, eta: null, elapsed };
  if (p.phase === "budget") {
    const prev = samples.find((s) => s.phase === "budget");
    samples.push({ ...p });
    if (!prev || p.t <= prev.t) return { phase: "budget", eta: null, elapsed };
    const rate = (p.t - prev.t) / (p.at - prev.at); // pulls per ms
    return { phase: "budget", eta: (p.total - p.t) / rate / 1000, elapsed };
  }
  // main calculation
  samples.push({ ...p });
  while (samples.length > 2 && p.at - samples[0].at > 1500) samples.shift(); // keep ~1.5 s of history
  const first = samples.find((s) => s.phase === "calc");
  let eta = null;
  // Only once half the probability is accounted for; earlier the tail's shape is still unknown
  if (first && p.t > first.t && p.remaining < 0.5 && p.remaining > 0 && first.remaining > p.remaining && p.eps > 0) {
    const rate = (p.t - first.t) / (p.at - first.at);                   // pulls per ms
    const perPull = Math.log(p.remaining / first.remaining) / (p.t - first.t); // log-shrink per pull
    const pullsLeft = Math.max(0, Math.log(p.eps / p.remaining) / perPull);
    const extra = budget ? budget : 0;                                  // the budget report runs afterwards
    eta = (pullsLeft + extra) / rate / 1000;
  }
  return { phase: "calc", pulls: p.t, eta, elapsed };
}
