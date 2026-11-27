// Covenant substat rerolls ("Refine"), as the game client sets them up (Config.Constant:
// TrinketSubAttrTypeWeight_1…6, TrinketSubAttrValueWeight, TrinketSubAttrValueLevel,
// TrinketRefineCost*, TrinketRefineLockMaxNum; client Z1G_2026_11_OB, resources 22, build 11).
//
// A covenant piece has 3 substat lines. A reroll draws every unlocked line again: first its
// substat (by the piece's weights below; the same substat can come up on several lines and can
// be the main stat too), then its level (by the level weights). Locked lines stay as they are.
// A substat's value is its level times its step (Crit. Rate Lv 8 = 8 × 0.2% = 1.6%).

// The 8 substats: the game's attribute id, the value of one level, and its unit
export const SUBSTATS = [
  { key: "critRate", id: 18159, step: 0.2, unit: "%" },
  { key: "critDmg", id: 18105, step: 0.3, unit: "%" },
  { key: "realmMastery", id: 18126, step: 0.5, unit: "" },
  { key: "dmgAmp", id: 18142, step: 0.2, unit: "%" },
  { key: "aliemusRegen", id: 22207, step: 0.1, unit: "" },
  { key: "keyflareRegen", id: 18139, step: 0.3, unit: "" },
  { key: "sigilYield", id: 18155, step: 0.15, unit: "%" },
  { key: "deathResist", id: 18151, step: 0.7, unit: "%" },
];

// How likely each substat is, per piece (I…VI); today every substat has weight 1 on every piece
const EVEN = SUBSTATS.map((s) => ({ key: s.key, weight: 1 }));
export const PIECES = [1, 2, 3, 4, 5, 6].map((piece) => ({ piece, substats: EVEN }));

// Levels 1…8: their weights (out of 100) and value multipliers
export const LEVELS = [
  { level: 1, multiplier: 0.5, weight: 23 },
  { level: 2, multiplier: 1, weight: 20 },
  { level: 3, multiplier: 1.5, weight: 17 },
  { level: 4, multiplier: 2, weight: 14 },
  { level: 5, multiplier: 2.5, weight: 11 },
  { level: 6, multiplier: 3, weight: 8 },
  { level: 7, multiplier: 3.5, weight: 5 },
  { level: 8, multiplier: 4, weight: 2 },
];

// What one reroll costs: Rose script and seals every time; a lock on one line costs 1 quill
// more, two locks 10 quills more (not 11). At most 2 lines can be locked. (The game also takes
// 20 fragments instead of the quill for one lock; the calculator counts the quill.)
export const COSTS = { roseScript: 7500, seals: 3, lockQuills: [0, 1, 10], maxLocks: 2 };

// Quills are the currency the cheapest way is counted in: one quill can be made into 20 seals,
// but seals can't be made into quills. (Rose script can't be made from quills, so it's shown
// but not counted.)
export const SEALS_PER_QUILL = 20;

export const LINES = 3; // substat lines on a covenant piece
export const MAX_GOALS = 3;
