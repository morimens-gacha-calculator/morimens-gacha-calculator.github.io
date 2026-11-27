// Covenant rerolls: the exact averages against formulas worked out by hand
import { test } from "node:test";
import assert from "node:assert/strict";
import { linesToLock, solveCovenant } from "../src/covenant/engine.js";
import { LEVELS, SUBSTATS } from "../src/covenant/rates.js";

const close = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg ?? ""} ${a} vs ${b}`);
const way = (r, key) => r.ways.find((w) => w.key === key);
const junk = [{ stat: "dmgAmp", level: 1 }, { stat: "dmgAmp", level: 1 }, { stat: "dmgAmp", level: 1 }];
const P8 = (1 / 8) * (2 / 100); // one line: a given substat at Lv 8

test("one Lv 8 goal, no locks: a geometric wait over 3 lines", () => {
  const r = solveCovenant({ lines: junk, goals: [{ stat: "critRate", level: 8 }] });
  const p = 1 - (1 - P8) ** 3;
  close(way(r, "none").rerolls, 1 / p, 1e-12);
  // locking can't help: nothing matches until it's done
  close(way(r, "fewest2").rerolls, 1 / p, 1e-12);
  assert.equal(way(r, "none").median, Math.ceil(Math.log(0.5) / Math.log(1 - p)));
  assert.equal(way(r, "none").p90, Math.ceil(Math.log(0.1) / Math.log(1 - p)));
});

test("three Crit. Rate Lv 8 lines, locking up to 2: the Markov chain by hand", () => {
  const p = P8;
  const e2 = 1 / p;
  const e1 = (1 + 2 * p * (1 - p) * e2) / (1 - (1 - p) ** 2);
  const e0 = (1 + 3 * p * (1 - p) ** 2 * e1 + 3 * p * p * (1 - p) * e2) / (1 - (1 - p) ** 3);
  const goals = [0, 1, 2].map(() => ({ stat: "critRate", level: 8 }));
  const r = solveCovenant({ lines: junk, goals });
  close(way(r, "fewest2").rerolls, e0, 1e-10);
  close(way(r, "asTheyCome").rerolls, e0, 1e-10, "locking each match as it comes is the same chain");
  close(e0, 732.9162842439387, 1e-12, "the reference figure");
});

test("no locks with several goals: the chance a whole reroll meets them, by brute force", () => {
  const goals = [{ stat: "critRate", level: 3 }, { stat: "critRate", level: 1 }, { stat: "dmgAmp", level: 5 }];
  // every way 3 lines can come out (8 substats × 8 levels each)
  const lineP = [];
  for (const s of SUBSTATS) for (const l of LEVELS) lineP.push({ stat: s.key, level: l.level, p: (1 / 8) * (l.weight / 100) });
  const ok = (ls) => {
    const rec = (g, used) => g === goals.length || ls.some((x, i) => !used.has(i) && x.stat === goals[g].stat && x.level >= goals[g].level && rec(g + 1, new Set([...used, i])));
    return rec(0, new Set());
  };
  let p = 0;
  for (const a of lineP) for (const b of lineP) for (const c of lineP) if (ok([a, b, c])) p += a.p * b.p * c.p;
  const r = solveCovenant({ lines: junk, goals });
  close(way(r, "none").rerolls, 1 / p, 1e-11);
});

test("the ways are ordered as they should be, and the materials add up", () => {
  const lines = [{ stat: "critRate", level: 8 }, { stat: "keyflareRegen", level: 6 }, { stat: "critRate", level: 5 }];
  const goals = [{ stat: "critRate", level: 6 }, { stat: "critDmg", level: 5 }, { stat: "dmgAmp", level: 5 }];
  const r = solveCovenant({ lines, goals });
  const [cheapest, two, one, none] = ["cheapest", "fewest2", "fewest1", "none"].map((k) => way(r, k));
  assert.ok(two.rerolls <= one.rerolls + 1e-9 && one.rerolls <= none.rerolls + 1e-9);
  for (const w of [two, one, none]) assert.ok(cheapest.materials.inQuills <= w.materials.inQuills + 1e-9, w.key);
  for (const w of r.ways) {
    close(w.materials.roseScript, 7500 * w.rerolls, 1e-12);
    close(w.materials.quills, w.byLocks[1] + 10 * w.byLocks[2], 1e-12);
    close(w.materials.inQuills, w.materials.quills + (3 * w.rerolls) / 20, 1e-12);
    assert.ok(w.survival(w.median) <= 0.5 && w.survival(w.median - 1) > 0.5);
  }
  assert.deepEqual(none.byLocks.slice(1), [0, 0]);
  assert.equal(one.byLocks[2], 0);
  // the first thing to lock: the Crit. Rate Lv 8 line
  assert.deepEqual(linesToLock(lines, goals, cheapest.first), [0]);
});

test("cheapest can mean no locks when the goal is easy", () => {
  const lines = [{ stat: "dmgAmp", level: 2 }, { stat: "keyflareRegen", level: 1 }, { stat: "critRate", level: 2 }];
  const goals = [{ stat: "critRate", level: 3 }, { stat: "critDmg", level: 2 }];
  const r = solveCovenant({ lines, goals });
  assert.equal(way(r, "cheapest").byLocks[1] + way(r, "cheapest").byLocks[2], 0);
  assert.ok(way(r, "fewest2").rerolls < way(r, "cheapest").rerolls);
});

test("already done: nothing to reroll", () => {
  const r = solveCovenant({ lines: [{ stat: "critRate", level: 8 }, { stat: null, level: 1 }, { stat: "dmgAmp", level: 1 }], goals: [{ stat: "critRate", level: 7 }] });
  assert.equal(r.done, true);
  for (const w of r.ways) assert.equal(w.rerolls, 0);
});

test("very long waits stay fast and exact", () => {
  const goals = [0, 1, 2].map(() => ({ stat: "critRate", level: 8 }));
  const t = performance.now();
  const r = solveCovenant({ lines: junk, goals });
  const none = way(r, "none");
  close(none.rerolls, 1 / P8 ** 3, 1e-9); // all three at once: (1/400)^3 per reroll
  assert.equal(none.median, Math.ceil(Math.log(0.5) / Math.log(1 - P8 ** 3)));
  assert.ok(performance.now() - t < 2000);
});

// Shared links: "#c=" + "1" + 2 digits (substat, level) per line and goal
import { decodeCovenant, encodeCovenant, CODE_PATTERN } from "../src/covenant/share.js";
import { readFileSync } from "node:fs";
test("a covenant goes through a link and back", () => {
  const s = { lines: [{ stat: "critRate", level: 8 }, { stat: "keyflareRegen", level: 6 }, { stat: "critRate", level: 5 }], goals: [{ stat: "critRate", level: 6 }, { stat: "critDmg", level: 5 }] };
  assert.equal(encodeCovenant(s), "10856050615");
  assert.deepEqual(decodeCovenant("10856050615"), s);
  assert.deepEqual(decodeCovenant(encodeCovenant({ ...s, goals: [] })), { ...s, goals: [] });
  for (const bad of ["", "0085605", "1085605061", "108560506150615", "1885605", "1095605", "1x85605"]) assert.equal(decodeCovenant(bad), null, bad);
  // the server checks codes the same way
  const server = readFileSync(new URL("../functions/api/share.js", import.meta.url), "utf8");
  assert.ok(server.includes(String(CODE_PATTERN)), "functions/api/share.js: the same pattern for covenant codes");
});

test("lock as they come: keeps what meets goals, never lets it go, and costs no less than the cheapest", () => {
  const lines = [{ stat: "critRate", level: 8 }, { stat: "keyflareRegen", level: 6 }, { stat: "critRate", level: 5 }];
  const goals = [{ stat: "critRate", level: 6 }, { stat: "critDmg", level: 6 }, { stat: "dmgAmp", level: 7 }];
  const r = solveCovenant({ lines, goals });
  const w = way(r, "asTheyCome");
  assert.ok(way(r, "cheapest").materials.inQuills <= w.materials.inQuills + 1e-9);
  assert.ok(w.plan.length > 1 && w.plan[0].start);
  for (const step of w.plan) {
    // it locks as many goals as the lines meet (at most 2)
    assert.equal(r.matched(step.kept), Math.min(2, r.matched(step.masks)), JSON.stringify(step));
    assert.ok(step.rerollsLeft > 0);
  }
  close(w.plan[0].rerollsLeft, w.rerolls, 1e-12);
});
