// Anniversary reruns planner (src/reruns/engine.js): checked against the banner engine and
// against a slow pull-by-pull chain written separately.
import { test } from "node:test";
import assert from "node:assert/strict";
import { solve } from "../src/engine/banner-engine.js";
import { buildQuery, freshState } from "../src/model.js";
import { SSR_CHANCE, SSR_PITY, TYPES, bannerChain, solvePlan, stateIndex } from "../src/reruns/engine.js";
import { assertClose } from "./helpers.js";

const PRESET = { char: "limitedChar", wheel: "limitedWheel" };
// the banner engine's chance curve for `copies` limited ones from pity (k pulls, l standard SSRs)
const engineCdf = (type, copies, k = 0, l = 0) => {
  const s = freshState(PRESET[type]);
  const goal = s.goal.map((g) => ({ ...g, copies }));
  return solve(buildQuery({ ...s, goal, start: { ...s.start, pity: { "0": k, "0,0": l } } })).cdf;
};
const chainCdf = (type, copies, k, l, n) => {
  const { done } = bannerChain(type, stateIndex(k, l), copies, n);
  const cdf = [0];
  for (let t = 1; t <= n; t++) cdf.push(cdf[t - 1] + done[t]);
  return cdf;
};

test("one banner: the same chance curve as the banner engine", () => {
  for (const [type, copies, k, l] of [["char", 1, 0, 0], ["char", 3, 0, 0], ["char", 2, 12, 2], ["char", 1, 29, 1], ["wheel", 1, 0, 0], ["wheel", 4, 7, 1]]) {
    const want = engineCdf(type, copies, k, l);
    const got = chainCdf(type, copies, k, l, want.length + 50);
    for (let t = 0; t < got.length; t++) assertClose(got[t], want[t] ?? 1, 1e-12, `${type} ×${copies} from ${k}/${l}, pull ${t}`);
  }
});

test("mean pulls per copy: 41.99 for a character, 29.84 for a wheel", () => {
  for (const [type, mean] of [["char", 41.99048423535176], ["wheel", 29.83534406196044]]) {
    const { done } = bannerChain(type, 0, 1, 400);
    let m = 0;
    done.forEach((p, n) => { m += p * n; });
    assertClose(m, mean, 1e-9, type);
  }
});

test("one day, enough or not: the plan's chance is the banner's chance within the bank", () => {
  const cdf = engineCdf("char", 2);
  for (const bank of [0, 1, 45, 90.7, 200]) {
    const r = solvePlan({ days: [{ bank }], banners: [{ day: 0, type: "char", copies: 2 }] });
    assertClose(r.chance, cdf[Math.floor(bank)] ?? 1, 1e-12, `bank ${bank}`);
    assertClose(r.banners[0].chance, r.chance, 1e-15);
  }
});

test("two character banners on one day share pity: the same as one banner for both copies", () => {
  const cdf = engineCdf("char", 3);
  const r = solvePlan({ days: [{ bank: 100 }], banners: [{ day: 0, type: "char", copies: 1 }, { day: 0, type: "char", copies: 2 }] });
  assertClose(r.chance, cdf[100], 1e-12);
});

// The slow way: pull by pull over the whole schedule, with everything in the state
function slowPlan({ days, banners, start }) {
  const key = (o) => JSON.stringify(o);
  let states = new Map([[key({ b: 0, spent: 0, ps: { char: start.char, wheel: start.wheel }, got: 0, ok: 1 }), 1]]);
  const chance = banners.map(() => 0);
  const finished = new Map();
  const put = (m, o, p) => m.set(key(o), (m.get(key(o)) ?? 0) + p);
  while (states.size) {
    const next = new Map();
    for (const [k, p] of states) {
      const o = JSON.parse(k);
      if (o.b === banners.length) { put(finished, o, p); continue; }
      const b = banners[o.b];
      if (o.got >= b.copies) { chance[o.b] += p; put(next, { ...o, b: o.b + 1, got: 0 }, p); continue; }
      const cap = Math.floor(days[b.day].bank + 1e-9);
      if (o.spent >= cap) { put(next, { ...o, b: o.b + 1, got: 0, ok: 0 }, p); continue; }
      const s = o.ps[b.type], kk = s % SSR_PITY, l = Math.floor(s / SSR_PITY), G = TYPES[b.type].guarantee;
      const pS = kk === SSR_PITY - 1 ? 1 : SSR_CHANCE, pL = l === G - 1 ? 1 : TYPES[b.type].win;
      const go = (ns, got, q) => q > 0 && put(next, { ...o, spent: o.spent + 1, ps: { ...o.ps, [b.type]: ns }, got }, q);
      go(stateIndex(kk + 1, l), o.got, p * (1 - pS));
      go(0, o.got + 1, p * pS * pL);
      go(stateIndex(0, l + 1), o.got, p * pS * (1 - pL));
    }
    states = next;
  }
  let ok = 0;
  for (const [k, p] of finished) if (JSON.parse(k).ok) ok += p;
  return { chance: ok, banners: chance };
}

test("a schedule of days, both types, pity carried: the same as the slow chain", () => {
  const plan = {
    days: [{ bank: 30.5 }, { bank: 52 }, { bank: 70 }, { bank: 95 }],
    banners: [
      { day: 0, type: "char", copies: 1 }, { day: 0, type: "wheel", copies: 1 },
      { day: 1, type: "char", copies: 0 }, { day: 1, type: "wheel", copies: 1 },
      { day: 2, type: "char", copies: 1 },
      { day: 3, type: "char", copies: 1 }, { day: 3, type: "wheel", copies: 1 },
    ],
    start: { char: stateIndex(20, 1), wheel: stateIndex(3, 0) },
  };
  const fast = solvePlan(plan), slow = slowPlan(plan);
  assertClose(fast.chance, slow.chance, 1e-12, "whole plan");
  fast.banners.forEach((b, i) => assertClose(b.chance, slow.banners[i], 1e-12, `banner ${i}`));
  assert.ok(fast.chance > 0.001 && fast.chance < 0.9);
});

test("pulls left each day: never below 0, the 10/50/90% points in order", () => {
  const r = solvePlan({ days: [{ bank: 80 }, { bank: 120 }, { bank: 160 }], banners: [{ day: 0, type: "char", copies: 2 }, { day: 2, type: "wheel", copies: 2 }] });
  for (const d of r.days) {
    assert.ok(d.p10 >= 0 && d.p10 <= d.p50 && d.p50 <= d.p90);
    assert.ok(d.mean >= d.p10 - 1e-9 && d.mean <= d.p90 + 1e-9);
  }
  assertClose(r.days[2].ok, r.chance, 1e-15);
});

// ── The schedule and the plan (plan.js) ──
import { defaultIncome } from "../src/income/income.js";
import { CHARACTERS, CODE_PATTERN, NAMES, bankByDay, cleanPlan, copiesOn, dateOf, dayOf, decodePlan, defaultPlan, encodePlan, levelBefore, planQuery } from "../src/reruns/plan.js";

test("the days: 30 Nov to 3 Jan, Tulu first and last", () => {
  assert.equal(CHARACTERS.length, 35);
  assert.equal(NAMES.length, 34);
  assert.equal(dayOf(new Date(2026, 10, 30, 23, 59)), 0);
  assert.equal(dayOf(new Date(2026, 10, 27)), -3);
  assert.equal(dateOf(34).toDateString(), new Date(2027, 0, 3).toDateString());
  assert.equal(dateOf(0).getDay(), 1); // a Monday: the calendar starts its weeks there
});

test("what you hold: income after today, on its days, and the event's gifts", () => {
  const plan = { ...defaultPlan(), pulls: 100, silver: 1000 };
  const banks = bankByDay(plan, defaultIncome(), -3); // typed in on 27 Nov
  // 28–30 Nov: dailies 3 × 100 silver; on the 30th weekly 500 silver, the 28-day sources
  // (32 limited + 1,880 silver, and 1,000 silver from the modes), D-Tide 2,400 silver,
  // and Sleepless Oath's 300 (the only reward counted at first)
  assertClose(banks[0], 105 + 1.5 + 2.5 + 46.4 + 12 + 300, 1e-9, "30 Nov");
  assertClose(banks[34], 105 + 18.5 + 12.5 + 92.8 + 36 + 300, 1e-9, "3 Jan");
  // with Echoed Pilgrimage too: 105 pulls + 2,260 silver more
  const both = bankByDay({ ...plan, oneOffs: { ...plan.oneOffs, pilgrimage: true } }, defaultIncome(), -3);
  assertClose(both[0] - banks[0], 116.3, 1e-9, "Echoed Pilgrimage");
  assert.deepEqual(defaultPlan().oneOffs, { oath: true, archives: false, pilgrimage: false });
  // typed in on 5 Dec: the days before have ended, that day holds what you typed
  const later = bankByDay(plan, defaultIncome(), 5);
  assert.equal(later[4], null);
  assert.equal(later[5], 105);
  assertClose(later[7], 105 + 1 + 2.5, 1e-12, "7 Dec: two dailies and the weekly");
});

test("levels: Tulu's second rerun starts from the first's goal, while it hasn't ended", () => {
  const plan = defaultPlan();
  plan.now.char.Tulu = 1;
  plan.goals[0].char = 4;
  plan.goals[34].char = 8;
  assert.equal(levelBefore(plan, "char", 34, -3), 4);
  assert.equal(copiesOn(plan, "char", 0, -3), 3);
  assert.equal(copiesOn(plan, "char", 34, -3), 4);
  // after the first one ended, only what you have now counts
  assert.equal(copiesOn(plan, "char", 34, 2), 7);
  assert.equal(copiesOn(plan, "char", 0, 2), 0);
  const q = planQuery(plan, defaultIncome(), 2);
  assert.equal(q.first, 2);
  assert.equal(q.days.length, 33);
  assert.deepEqual(q.banners.filter((b) => b.copies).map((b) => [b.at, b.type, b.copies]), [[34, "char", 7]]);
});

test("links and saved plans: round trip, bad values refused", () => {
  const plan = defaultPlan();
  Object.assign(plan, { pulls: 1234, silver: 56789 });
  plan.pity = { char: { k: 17, l: 2 }, wheel: { k: 29, l: 1 } };
  plan.oneOffs.archives = true; plan.oneOffs.oath = false;
  plan.now.char.GDoll = 1; plan.now.wheel["“24”"] = 16;
  plan.goals[15] = { char: 8, wheel: 2 };
  const code = encodePlan(plan);
  assert.match(code, CODE_PATTERN);
  assert.deepEqual(decodePlan(code), plan);
  assert.equal(decodePlan(code.replace("-17-2-", "-30-2-")), null);
  assert.equal(decodePlan("1-1-1"), null);
  assert.deepEqual(cleanPlan({ pulls: -4, pity: { char: { k: 40 } }, goals: [{ char: 99 }] }), defaultPlan());
});

test("short links: the server takes the codes this page makes", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../functions/api/share.js", import.meta.url), "utf8");
  const server = new RegExp(src.match(/reruns: \/(.+?)\/ \}/)[1]);
  assert.equal(server.source, CODE_PATTERN.source);
  assert.ok(server.test(encodePlan(defaultPlan())));
});

test("short links: a reruns plan with new numbers gets a new link, the same numbers the same one", async () => {
  const { onRequestPost } = await import("../functions/api/share.js");
  const kv = new Map();
  const env = { LINKS: { get: async (k, type) => (kv.has(k) ? (type === "json" ? JSON.parse(kv.get(k)) : kv.get(k)) : null), put: async (k, v) => kv.set(k, typeof v === "string" ? v : v) } };
  const post = async (body) => {
    const request = new Request("https://example.org/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return (await onRequestPost({ request, env })).json();
  };
  const code = encodePlan(defaultPlan());
  const a = await post({ calc: "reruns", code, title: "50% chance", detail: "a" });
  const again = await post({ calc: "reruns", code, title: "50% chance", detail: "a" });
  const newer = await post({ calc: "reruns", code, title: "61% chance", detail: "b" });
  assert.equal(a.id, again.id);
  assert.notEqual(a.id, newer.id);
  assert.equal(JSON.parse(kv.get(`s:${newer.id}`)).title, "61% chance");
  // other calculators keep one link per setup
  const c1 = await post({ calc: "covenant", code: "10856050615", title: "x", detail: "" });
  const c2 = await post({ calc: "covenant", code: "10856050615", title: "y", detail: "" });
  assert.equal(c1.id, c2.id);
});
