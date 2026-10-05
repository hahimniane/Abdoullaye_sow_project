import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Regression: the staff/admin support thread read
// `orderBy("createdAt", "asc"), limit(200)`, which returns the OLDEST 200
// messages. Once a case passed 200 messages, every new reply was invisible to
// the person handling it. Any ascending message query must window from the end.
test("support threads show the newest messages, oldest first", () => {
  for (const file of [
    "src/components/support/support-cases-panel.tsx",
    "src/components/customer-support.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    const ascendingWithLimit =
      /orderBy\("createdAt",\s*"asc"\),\s*(?:\/\/[^\n]*\n\s*)*limit\(/;
    assert.doesNotMatch(
      source,
      ascendingWithLimit,
      `${file} pairs an ascending order with limit(); use limitToLast().`,
    );
  }
  const panel = readFileSync("src/components/support/support-cases-panel.tsx", "utf8");
  assert.match(panel, /orderBy\("createdAt", "asc"\),\s*limitToLast\(200\)/);
});
