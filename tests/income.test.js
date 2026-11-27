// Pull income: the numbers against the spreadsheet it comes from
import { test } from "node:test";
import assert from "node:assert/strict";
import { CODE_PATTERN, RATIOS, cleanIncome, decodeIncome, defaultIncome, dTideSilver, encodeIncome, incomeTotals, loadIncome, rowPer28, saveIncome } from "../src/income/income.js";

const close = (a, b, tol = 1e-9, msg = "") => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${msg} ${a} vs ${b}`);
// the spreadsheet: every source counted, D-Tide at 450 points, no paid wheel (it had none)
const sheet = () => {
  const inc = defaultIncome();
  inc.rows = inc.rows.map((r) => (r.key === "wheelEventPaid" ? { ...r, on: false } : r.key === "dTide" ? { ...r, on: true, points: 450, silver: dTideSilver(450) } : { ...r, on: true }));
  return inc;
};

test("the spreadsheet's totals", () => {
  const t = incomeTotals(sheet());
  close(t.per28.silver, 24540); close(t.per28.limited, 44); close(t.per28.standard, 203);
  close(t.perDay.silver, 876.4285714285714); close(t.perDay.limited, 44 / 28); close(t.perDay.standard, 7.25);
  close(t.perWeek.silver, 6135); close(t.perWeek.limited, 11); close(t.perWeek.standard, 50.75);
  close(t.per28.pulls, 166.7); close(t.perDay.pulls, 166.7 / 28); close(t.perWeek.pulls, 41.675);
  close(t.per28.withStandard, 166.7 + 203 * 19 / 90, 1e-12); // the sheet shows 209.56
  close(t.per28.sediment, 744.092640437, 1e-11);
  close(t.per28.sedimentWithStandard, 1650.216251767, 1e-11);
});

test("each row over 28 days, in limited pulls (the sheet's last column)", () => {
  const per = Object.fromEntries(sheet().rows.map((r) => [r.key, rowPer28(r).pulls]));
  const want = { dailyDrills: 8.4, weeklyTrials: 10, assignments: 2.8, dailyGift: 2.8, sedimentShop: 5, awakenerTrials: 4.4, mythagGifts: 11, wheelEvent: 0, event1: 10.5, event2: 10.5, dTide: 27, arcade: 1.25, pDive: 1.25, traphaseAll: 1.25, traphaseDraft: 1.25, curriculumFree: 0, curriculumBasic: 24.5, curriculumPremium: 16.8, moonphaseVigil: 28, wheelEventPaid: 60 };
  for (const [k, v] of Object.entries(want)) close(per[k], v, 1e-12, k);
});

test("D-Tide: 300 silver for each tier reached", () => {
  assert.equal(dTideSilver(0), 0);
  assert.equal(dTideSilver(50), 300);
  assert.equal(dTideSilver(425), 2400);
  assert.equal(dTideSilver(450), 2700);
});

test("defaults: paid sources and D-Tide's last tier left out", () => {
  const inc = defaultIncome();
  const off = inc.rows.filter((r) => !r.on).map((r) => r.key);
  assert.deepEqual(off, ["wheelEventPaid", "curriculumBasic", "curriculumPremium", "moonphaseVigil"]);
  assert.equal(inc.rows.find((r) => r.key === "dTide").points, 425);
  const t = incomeTotals(inc);
  close(t.per28.silver, 24540 - 300 * 2 - 2500 - 3360 - 200 * 28);
  close(t.per28.limited, 32); close(t.per28.standard, 147);
  close(t.per28.pulls, 12480 / 200 + 32);
});

test("the standard-to-limited ratios", () => {
  close(RATIOS.characters.none, 4.73684210526316, 1e-14); close(RATIOS.characters.wanted, 2.49307479224377, 1e-14); close(RATIOS.characters.unwanted, 5.26315789473684, 1e-14);
  close(RATIOS.wheels.none, 6.66666666666667, 1e-14); close(RATIOS.wheels.wanted, 4.52380952380952, 1e-14); close(RATIOS.wheels.unwanted, 7.03703703703704, 1e-14);
  const inc = { ...defaultIncome(), ratio: { target: "wheels", offRate: "wanted" } };
  const t = incomeTotals(inc);
  close(t.per28.withStandard, t.per28.pulls + t.per28.standard * 21 / 95);
});

test("links: the defaults are short, changes come back", () => {
  assert.equal(encodeIncome(defaultIncome()), "1e30");
  const inc = defaultIncome();
  inc.rows = inc.rows.map((r) => (r.key === "dTide" ? { ...r, points: 150, silver: 900, days: 7 } : r.key === "moonphaseVigil" ? { ...r, on: true } : r.key === "event1" ? { ...r, silver: 1000 } : r));
  inc.rows.push({ id: "x", name: "Промокоды ✓", on: true, silver: 300, limited: 1.5, standard: 0, days: 60 });
  inc.sediment = 5; inc.ratio = { target: "wheels", offRate: "unwanted" };
  const code = encodeIncome(inc);
  assert.match(code, CODE_PATTERN);
  const back = decodeIncome(code);
  assert.deepEqual(back.rows.map(({ id, ...r }) => r), inc.rows.map(({ id, ...r }) => r));
  assert.equal(back.sediment, 5); assert.deepEqual(back.ratio, inc.ratio);
  close(incomeTotals(back).per28.withStandard, incomeTotals(inc).per28.withStandard);
  assert.equal(decodeIncome("1!!"), null);
  assert.equal(decodeIncome("1" + btoa("[1]")), null);
});

test("saved income: read back, bad values replaced", () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.deepEqual(loadIncome(storage), defaultIncome());
  const inc = defaultIncome();
  inc.rows[0] = { ...inc.rows[0], silver: 70 };
  saveIncome(inc, storage);
  assert.equal(loadIncome(storage).rows[0].silver, 70);
  const bad = cleanIncome({ rows: [{ key: "dailyDrills", silver: -5, days: 0 }, { key: "dTide", points: 123 }], sediment: "x", ratio: { target: "nope" } });
  assert.equal(bad.rows[0].silver, 60); assert.equal(bad.rows[0].days, 1);
  assert.equal(bad.rows.find((r) => r.key === "dTide").points, 425);
  assert.deepEqual(bad.ratio, { target: "characters", offRate: "none" });
  store.set("income-v1", "{broken");
  assert.deepEqual(loadIncome(storage), defaultIncome());
});
