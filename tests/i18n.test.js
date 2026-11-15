// Every language has the same keys as English.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";

test("translations have all keys", () => {
  const out = execFileSync(process.execPath, [new URL("../scripts/check-i18n.mjs", import.meta.url).pathname], { encoding: "utf8" });
  assert.doesNotMatch(out, /missing|extra|mismatch/i, out);
});
