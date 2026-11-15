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
  const samplesRef = useRef([]);   // recent progress messages of the current step
  const timerRef = useRef(null);   // pending start (the short pause after typing)

  const makeWorker = () => {
    const w = new Worker(new URL("./engine/engine.worker.js", import.meta.url), { type: "module" });
    w.onmessage = ({ data }) => {
      if (data.id !== idRef.current) return;
      if (data.progress) {
        const progress = estimate(data.progress, samplesRef.current, startRef.current);
        setRes((prev) => (prev.status === "busy" ? { ...prev, progress } : prev));
        return;
      }
      busyRef.current = false;
      setRes(data.ok
        ? { status: "ok", result: data.result, error: null, ms: performance.now() - startRef.current, progress: null }
        : (prev) => ({ ...prev, status: "error", error: data.error, errorCode: data.code, errorValues: data.values, progress: null }));
    };
    w.onerror = (e) => {
      busyRef.current = false;
      setRes((prev) => ({ ...prev, status: "error", error: e.message || getStrings().errors.crashed, errorCode: null, errorValues: null, progress: null }));
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
  const { decimals, ...calcSettings } = settings; // eslint-disable-line no-unused-vars -- display only
  const calcKey = JSON.stringify({ banner, goal, goalMode, start, settings: calcSettings, mode, budget, desired });

  useEffect(() => {
    let query;
    try {
      query = buildQuery(state);
    } catch (e) {
      setRes((prev) => ({ ...prev, status: "error", error: e.message, errorCode: null, errorValues: null, progress: null }));
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
// Turns a progress message from the worker into what the page shows: phase, step i of n, and an
// estimate of the time left in this step (null until there is enough to go on).
//   calc / events — the chance still left shrinks about geometrically: extrapolate it to eps
//   plan / combine / budget — done of total: extrapolate the recent rate
// samples: this step's recent messages (cleared when the phase changes).
export function estimate(p, samples, startedAt) {
  const elapsed = p.at - startedAt;
  if (samples.phase !== p.phase || samples.step !== p.step) { samples.length = 0; samples.phase = p.phase; samples.step = p.step; }
  samples.push({ ...p });
  while (samples.length > 2 && p.at - samples[0].at > 1500) samples.shift(); // ~1.5 s of history
  const out = { phase: p.phase, step: p.step ?? null, steps: p.steps ?? null, elapsed, eta: null };
  const first = samples[0];
  if (p.phase === "build" || p.phase === "reduce") return { ...out, states: p.states };
  if (p.phase === "calc" || p.phase === "events") {
    // only once half the probability is accounted for; earlier the tail's shape is unknown
    if (p.t > first.t && p.remaining < 0.5 && p.remaining > 0 && first.remaining > p.remaining && p.eps > 0) {
      const rate = (p.t - first.t) / (p.at - first.at);                         // steps per ms
      const perStep = Math.log(p.remaining / first.remaining) / (p.t - first.t); // log-shrink per step
      out.eta = Math.max(0, Math.log(p.eps / p.remaining) / perStep) / rate / 1000;
    }
    return { ...out, t: p.t, name: p.name ?? null };
  }
  // done of total
  if (p.total > 0 && p.done > first.done && p.at > first.at) {
    const rate = (p.done - first.done) / (p.at - first.at);
    out.eta = (p.total - p.done) / rate / 1000;
  }
  return { ...out, done: p.done, total: p.total };
}
