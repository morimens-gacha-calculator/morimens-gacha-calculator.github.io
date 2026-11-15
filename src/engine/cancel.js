// Stopping a running calculation from outside, without ending the worker (so its cache and helper
// threads stay warm). The worker sets a check (does the page still want this job?); long loops
// call stopIfCancelled() regularly, which throws EngineError "cancelled". Pieces are cached only
// once complete, so a stopped calculation leaves nothing half-done behind.
import { EngineError } from "./errors.js";

let check = null;
export function setCancelCheck(fn) { check = fn; }
export function stopIfCancelled() {
  if (check !== null && check()) throw new EngineError("cancelled", {}, "Cancelled");
}
