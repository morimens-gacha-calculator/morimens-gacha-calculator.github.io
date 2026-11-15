// Accuracy settings live in src/engine/settings.js only: no stray tolerances in the engine code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as S from "../src/engine/settings.js";
import { DEFAULT_SETTINGS } from "../src/model.js";

const dir = new URL("../src/engine/", import.meta.url);
test("no tolerances written out in the engine code (they belong in settings.js)", () => {
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".js") && f !== "settings.js")) {
    const code = readFileSync(new URL(f, dir), "utf8").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
    const hits = code.match(/\b\d*\.?\d+e-(?:9|[1-9]\d)\b|\beps\s*\/\s*\d+/g);
    assert.equal(hits, null, `${f}: ${hits}`);
  }
});

test("the page's default settings are the engine's", () => {
  assert.equal(Number(DEFAULT_SETTINGS.eps), S.DEFAULT_EPS);
  assert.equal(DEFAULT_SETTINGS.maxPulls, S.DEFAULT_MAX_PULLS);
  assert.equal(DEFAULT_SETTINGS.maxStates, S.DEFAULT_MAX_STATES);
});

test("the parts of a calculation stop well inside eps", () => {
  const eps = S.DEFAULT_EPS;
  assert.ok(S.poolTolerance(eps) + S.gapTolerance(eps) + S.eventTolerance(eps) < eps / 5);
  assert.ok(S.NEGLIGIBLE < eps / 10 && S.MAXED_OUT < eps);
});
