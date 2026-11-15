// Every number that sets the engine's accuracy, its limits, or its speed trade-offs, in one place,
// with the reason for its value. Accuracy settings change results (within the stated precision;
// `npm test` shows by how much); limits and speed settings never change a result, only whether or
// how fast it is computed.

// ── Accuracy ────────────────────────────────────────────────────────────────────────────────
// A calculation stops once the chance of not being done yet is below eps. Its parts stop at a
// fraction of eps, so that their leftovers together stay well below it.
export const DEFAULT_EPS = 1e-13;
export const poolTolerance = (eps) => eps / 1000;   // a pool's "not met after n hits" curve
export const gapTolerance = (eps) => eps / 100;     // the distribution of the gap between events (SSRs)
export const eventTolerance = (eps) => eps / 10;    // the walk over events (SSR counts)

// Chances this small are treated as 0: the chance-left curve once it gets there, numbers of
// events that can't fit into a budget, rows that are certain to be maxed out.
export const NEGLIGIBLE = 1e-15;
// A budget row counts as maxed out (its progress can't change any more) when the chance it isn't
// is below this.
export const MAXED_OUT = 1e-14;
// Rounding floor of the formulas' marker transform ("k different" rows): about this much per
// point, times the number of points, so their cut-off can't be stricter than that.
export const MARKER_ROUNDING = 8e-16;
// Binomial weights below this are skipped in the pool formulas (every value they multiply is at
// most 1 in size, so the total skipped is far below 1e-15).
export const BINOMIAL_CUTOFF = 1e-21;

// A percentile counts as reached when the chance is within this of it (rounding in the sums).
export const PERCENTILE_SLACK = 1e-12;
// The chances at one point of a banner must add up to 1 (or stay ≤ 1 before "rest") within this.
export const CHANCE_SUM_TOLERANCE = 1e-9;
// Two chain states are merged when their transitions agree within this (exact lumping).
export const LUMPING_TOLERANCE = 1e-12;

// ── Limits (protect the browser tab) ────────────────────────────────────────────────────────
// The first two are the defaults of the Settings tab; "No limits" lifts them.
// Chain states: building one peaks at about 0.5–0.6 KB (115 bytes kept), so 2 million states
// need about the 1.1–1.2 GB that 1 million did before chain building was made leaner.
export const DEFAULT_MAX_STATES = 2e6;
export const DEFAULT_MAX_PULLS = 1e6;
// Event-layer cells (about 40–50 bytes each): allowed per max state (10 million at the default),
// and never more than this in total.
export const EVENT_CELLS_PER_STATE = 5;
export const MAX_EVENT_CELLS = 4e7;
export const MAX_EVENTS = 1e6;               // events (SSRs) a goal may need
export const MAX_PULL_SPAN = 1 << 23;        // pulls the layered result may span (FFT length)
export const MAX_FFT_LENGTH = 1 << 24;       // FFT length for a budget report
export const MAX_POOL_HITS = 32768;          // hits a pool formula may need
export const MAX_CHAIN_HITS = 1e5;           // the same, for the small-chain fallback
export const MAX_GAP = 1e6;                  // pulls between two events
export const MAX_GROUPS = 7;                 // pools in the layered method (transition labels have 3 bits)

// ── Method choice (speed only; every method is exact) ───────────────────────────────────────
// Below this estimated joint-chain size the joint method is used: as fast, and it also gives
// the exact worst case.
export const TINY_JOINT_CHAIN = 3000;
// The split method is used only if (hits it tracks) × this < estimated joint states per pool.
export const SPLIT_ADVANTAGE = 4;

// ── Speed ───────────────────────────────────────────────────────────────────────────────────
export const CACHE_MAX_BYTES = 200e6;        // memory the kept pieces may take together (~200 MB)
export const CACHE_ENTRIES = 64;             // and never more pieces than this
export const WEIGHT_CACHE_CELLS = 2e6;       // binomial weights kept by the pool formulas (~16 MB)
export const PARALLEL_MIN_EDGES = 150000;    // smaller chains run on one core (syncing costs more)
export const THREAD_TRIAL_PULLS = 24;        // pulls timed on all cores, then on one, before choosing
export const HELPER_START_MS = 3000;         // helper threads must pick a job up within this
export const HELPER_IDLE_MS = 1000;          // helpers re-check for a new job this often
// How many events fit into B pulls, as a first guess (checked exactly afterwards): mean
// × EVENTS_GUESS_FACTOR + EVENTS_GUESS_SD standard deviations + EVENTS_GUESS_MARGIN.
export const EVENTS_GUESS_FACTOR = 1.05;
export const EVENTS_GUESS_SD = 12;
export const EVENTS_GUESS_MARGIN = 20;
