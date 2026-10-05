import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Regression: notify() started a fresh 4.2 s timer per toast and never
// cleared the previous one, so a second toast shown 4 s after the first was
// wiped by the first toast's timer after ~0.2 s.
test("the admin toast clears its previous timer before starting a new one", () => {
  const source = readFileSync("src/components/admin-console.tsx", "utf8");
  const notify = /const notify = useCallback\(\(type: Toast\["type"\], message: string\) => \{([\s\S]*?)\n  \}, \[\]\);/.exec(source);
  assert.ok(notify, "notify() not found");
  const body = notify[1];
  assert.match(body, /window\.clearTimeout\(toastTimerRef\.current\)/);
  assert.ok(
    body.indexOf("clearTimeout") < body.indexOf("setTimeout"),
    "the previous timer must be cleared before the new one starts",
  );
  assert.match(body, /toastTimerRef\.current = window\.setTimeout\(/);
});
