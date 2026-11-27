// Works the plan out off the page's thread: a long plan can take a moment.
import { solvePlan } from "./engine.js";

self.onmessage = (e) => {
  const { id, query } = e.data;
  self.postMessage({ id, result: solvePlan(query) });
};
