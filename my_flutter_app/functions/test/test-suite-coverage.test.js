const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

/**
 * The npm scripts name every test file individually, so a new test file runs
 * only if someone remembers to add it. Four had been silently skipped -
 * including 29 tests written the same day someone reported them as passing.
 * A test that never runs is worse than no test: it reports safety it is not
 * providing.
 */
describe("the test suite runs every test file", () => {
  it("leaves no test file unreferenced by an npm script", () => {
    const root = path.join(__dirname, "..");
    const scripts = JSON.parse(
        fs.readFileSync(path.join(root, "package.json"), "utf8"),
    ).scripts;
    const referenced = new Set(
        (Object.values(scripts).join(" ")
            .match(/test\/[a-z0-9-]+\.test\.js/g) || [])
            .map((entry) => entry.replace("test/", "")),
    );
    const onDisk = fs.readdirSync(__dirname)
        .filter((name) => name.endsWith(".test.js"));
    const orphaned = onDisk.filter((name) => !referenced.has(name));
    assert.deepEqual(
        orphaned,
        [],
        `these test files never run - add them to an npm test script: ${
          orphaned.join(", ")}`,
    );
  });
});
