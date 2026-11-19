import { useCallback, useEffect, useRef, useState } from "react";
import { buildQuery } from "./model.js";
import { getStrings } from "./i18n/index.js";

const ABORT_GRACE_MS = 1500; // a job asked to stop must confirm within this, or the worker is ended

// Runs the engine in a Web Worker whenever `state` changes (debounced).
// A newer request cancels a running one, so typing never queues up work. Where the page may share
// memory with the worker (cross-origin isolated), cancelling happens in place: the worker stops
// its job and keeps its cache and helper threads. Otherwise, or if the worker doesn't confirm
// within ABORT_GRACE_MS, it is ended and a fresh one started.
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
  const wantedRef = useRef(null);  // Int32Array shared with the worker: the job id wanted now
  const abortRef = useRef(null);   // { id, timer } of a job asked to stop, until it confirms
  const lastJobRef = useRef(null); // the message of the job wanted now (to resend after a restart)

  // Ask the running job to stop. In place when possible; ends the worker if not (or too slow).
  const stopRunning = (nextId) => {
    if (!busyRef.current || !workerRef.current) return;
    const oldId = idRef.current;
    if (!wantedRef.current) { endWorker(); return; }
    Atomics.store(wantedRef.current, 0, nextId);
    clearTimeout(abortRef.current?.timer);
    abortRef.current = {
      id: oldId,
      timer: setTimeout(() => {
        // the job didn't stop in time (a long step without checks): start over with a fresh worker
        abortRef.current = null;
        endWorker();
        if (busyRef.current && lastJobRef.current?.id === idRef.current) {
          workerRef.current = makeWorker();
          workerRef.current.postMessage(lastJobRef.current);
        }
      }, ABORT_GRACE_MS),
    };
  };
  const endWorker = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    wantedRef.current = null;
  };

  const makeWorker = () => {
    const w = new Worker(new URL("./engine/engine.worker.js", import.meta.url), { type: "module" });
    if (typeof SharedArrayBuffer !== "undefined" && self.crossOriginIsolated) {
      const sab = new SharedArrayBuffer(4);
      wantedRef.current = new Int32Array(sab);
      w.postMessage({ type: "cancel-channel", sab });
    } else wantedRef.current = null;
    w.onmessage = ({ data }) => {
      // a job asked to stop has stopped (or finished anyway): no need to end the worker
      if (abortRef.current && data.id === abortRef.current.id && !data.progress) {
        clearTimeout(abortRef.current.timer);
        abortRef.current = null;
      }
      if (data.id !== idRef.current || data.cancelled) return;
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
    stopRunning(0); // 0: no job wanted
    busyRef.current = false;
    idRef.current += 1; // ignore anything still in flight
    setRes((prev) => ({ ...prev, status: "cancelled", progress: null }));
  }, []);

  // Only what changes the numbers triggers a new calculation (not chart lines, view, etc.)
  const { banner, goal, goalMode, start, settings, mode, budget, desired, stages, spend } = state;
  const { decimals, ...calcSettings } = settings; // eslint-disable-line no-unused-vars -- display only
  const calcKey = JSON.stringify({ banner, goal, goalMode, start, settings: calcSettings, mode, budget, desired, stages: stages ?? [], spend });

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
      const id = idRef.current + 1;
      stopRunning(id); // a running job stops; this one queues behind it in the same worker
      if (!workerRef.current) workerRef.current = makeWorker();
      idRef.current = id;
      if (wantedRef.current) Atomics.store(wantedRef.current, 0, id);
      busyRef.current = true;
      startRef.current = performance.now();
      samplesRef.current = [];
      lastJobRef.current = {
        id,
        // each banner with its own pulls has no "pulls needed": that's asked of one shared budget
        mode: query.spend === "fixed" ? "budget" : state.mode,
        desired: state.desired,
        ...query,
        budget: state.mode === "budget" ? state.budget : null,
      };
      workerRef.current.postMessage(lastJobRef.current);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calcKey, runToken, lang]);

  useEffect(() => () => { clearTimeout(abortRef.current?.timer); workerRef.current?.terminate(); }, []);
  return { ...res, cancel };
}

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
