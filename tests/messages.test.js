// Every message the engine can raise has a text in every language, and the texts work.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { LOCALES, errorText } from "../src/i18n/index.js";
import { solve } from "../src/engine/banner-engine.js";

const engineDir = new URL("../src/engine/", import.meta.url);
const codes = new Set(["internal"]);
for (const f of readdirSync(engineDir).filter((f) => f.endsWith(".js"))) {
  for (const m of readFileSync(new URL(f, engineDir), "utf8").matchAll(/new EngineError\("([A-Za-z]+)"/g)) codes.add(m[1]);
}

test("the engine raises only coded errors", () => {
  for (const f of readdirSync(engineDir).filter((f) => f.endsWith(".js"))) {
    const src = readFileSync(new URL(f, engineDir), "utf8");
    assert.doesNotMatch(src, /throw new Error\(/, `${f} throws a plain Error (use EngineError or internalError)`);
  }
});

const sample = { where: "SSR › character", value: "abc", sum: 0.95, row: "Lily ×2", item: "Lily", count: 15, items: 3, k: 5, limit: 1000000, n: 12424326, groups: 7, entries: 64, mb: 900, detail: "test detail" };
for (const [lang, T] of Object.entries(LOCALES)) {
  test(`every engine error has a ${lang} text`, () => {
    for (const code of codes) {
      const f = T.errors.engine?.[code];
      assert.equal(typeof f, "function", `${lang}: errors.engine.${code} is missing`);
      const text = f(sample);
      assert.ok(typeof text === "string" && text.length > 10 && !/undefined|NaN|\[object/.test(text), `${lang} ${code}: ${text}`);
      assert.ok(f({ ...sample, where: "" }).length > 10, `${lang} ${code} at the top level`);
    }
  });
}

test("a real engine error comes out translated", () => {
  let err;
  try { solve({ tree: [{ name: "SSR", p: 0.5 }, { name: "other", p: 0.4 }], goal: { "0": 1 } }); } catch (e) { err = e; }
  assert.equal(err?.code, "chancesSum");
  assert.equal(err.values.where, "");
  const info = { error: err.message, errorCode: err.code, errorValues: err.values };
  assert.match(errorText(LOCALES.en, info), /add up to 90%/);
  assert.match(errorText(LOCALES.ru, info), /90%/);
  assert.match(errorText(LOCALES.uk, info), /90%/);
  // a nested place is named by its outcomes
  try { solve({ tree: [{ name: "SSR", p: "rest", children: [{ name: "A", p: "1/2" }, { name: "B", p: "x" }] }], goal: { "0": 1 } }); } catch (e) { err = e; }
  assert.equal(err.code, "badChance");
  assert.equal(err.values.where, "SSR › B");
  // without a code, the message is shown as it is
  assert.equal(errorText(LOCALES.ru, { error: "plain" }), "plain");
});
