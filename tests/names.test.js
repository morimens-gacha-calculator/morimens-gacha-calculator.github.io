// Your own names for a built-in banner (Edit names): kept as overrides, so the banner stays that
// built-in banner (pity carries over, links stay short) and the names survive a language change.
import { test } from "node:test";
import assert from "node:assert/strict";
import { allAlts, applyNames, freshState, itemNames, namesDiff, newStage, planTitle, presets, removeStage, sharesPity, stageView, withPresetNames, writeStage } from "../src/model.js";
import { decodeSetup, encodeSetup } from "../src/share.js";
import { setLocale } from "../src/i18n/index.js";

const renamed = (key) => {
  const base = presets()[key].banner;
  const tree = structuredClone(base);
  const pool = allAlts(tree).find((a) => a.isPool);
  allAlts(tree)[0].alt.name = "Gold";
  const names = itemNames(pool.alt); names[1] = "Second one";
  pool.alt.items = names.join(", ");
  return { base, tree, pool: pool.key };
};

test("names: overrides read back the same names, and nothing when unchanged", () => {
  const { base, tree, pool } = renamed("kaleido1");
  const names = namesDiff(base, tree);
  assert.deepEqual(names.o, { 0: "Gold" });
  assert.equal(names.i[pool][1], "Second one");
  assert.deepEqual(applyNames(base, names), tree);
  assert.equal(namesDiff(base, structuredClone(base)), null);
});

test("names: a renamed banner keeps sharing pity with the next one", () => {
  const { base, tree } = renamed("kaleido1");
  const s = { ...freshState("kaleido1"), names: namesDiff(base, tree), banner: tree, stages: [newStage("kaleido2")] };
  assert.ok(sharesPity(s, stageView(s, 1)));
});

test("names: kept over a language change, the rest follow the language", () => {
  try {
    setLocale("en");
    const { base, tree } = renamed("kaleido1");
    const s = { ...freshState("kaleido1"), title: "Spring rerun", names: namesDiff(base, tree), banner: tree };
    setLocale("ru");
    const ru = withPresetNames(s);
    assert.equal(ru.banner.alts[0].name, "Gold");
    assert.equal(ru.banner.alts[1].name, presets().kaleido1.banner.alts[1].name); // not renamed: Russian
    assert.equal(planTitle(ru), "Spring rerun");
  } finally {
    setLocale("en");
  }
});

test("names: plan name and names go through a share link, the banner stays built-in", async () => {
  const { base, tree } = renamed("kaleido1");
  const st = newStage("kaleido2");
  const s = { ...freshState("kaleido1"), title: "Mine", names: namesDiff(base, tree), banner: tree, stages: [{ ...st, title: "Next" }] };
  const back = await decodeSetup(await encodeSetup(s));
  assert.equal(back.preset, "kaleido1");
  assert.equal(back.title, "Mine");
  assert.deepEqual(back.banner, tree);
  assert.equal(back.stages[0].title, "Next");
  assert.equal(back.stages[0].preset, "kaleido2");
});

test("names: stage edits and removing banner plan 1 carry the plan's own names", () => {
  const { base, tree } = renamed("kaleido2");
  let s = { ...freshState("kaleido1"), stages: [newStage("kaleido2")] };
  s = writeStage(s, 1, { ...stageView(s, 1), title: "Two", names: namesDiff(base, tree), banner: tree });
  assert.equal(stageView(s, 1).title, "Two");
  assert.equal(stageView(s, 0).title, undefined); // banner plan 1 doesn't take plan 2's name
  const first = removeStage(s, 0);
  assert.equal(first.title, "Two");
  assert.equal(first.banner.alts[0].name, "Gold");
});
