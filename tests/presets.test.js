// The built-in banners with their default goals. Pinned values: if one of these changes,
// either a banner was edited on purpose (update the numbers) or something broke.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solve } from "../src/engine/banner-engine.js";
import { buildQuery, freshState } from "../src/model.js";
import { assertClose } from "./helpers.js";

// (chance: within the pulls the banners used to start with, kept as a check)
const pinned = {
  limitedChar: { mean: 41.99048423535176, worst: 90, median: 39, budget: 60, chance: 0.7664892745872977 },
  limitedWheel: { mean: 29.83534406196044, worst: 60, median: 30, budget: 40, chance: 0.7627179382309253 },
  anniversary: { mean: 74.58836015490112, worst: 180, median: 72, budget: 150, chance: 0.9926125624525487 },
  kaleido1: { mean: 894.1079635345984, worst: null, median: 729, budget: 600, chance: 0.40428475132646696 },
  kaleido2: { mean: 1136.7087859744856, worst: null, median: 927, budget: 600, chance: 0.30022399877766276 },
};
for (const [key, want] of Object.entries(pinned)) {
  test(`preset ${key}`, () => {
    const st = freshState(key);
    const r = solve({ ...buildQuery(st), budget: want.budget });
    assertClose(r.mean, want.mean, 1e-8, "mean");
    assert.equal(r.max, want.worst, "worst case");
    assert.equal(r.median, want.median, "median");
    assertClose(r.budget.chanceGoal, want.chance, 1e-10, "chance within the pulls");
  });
}
