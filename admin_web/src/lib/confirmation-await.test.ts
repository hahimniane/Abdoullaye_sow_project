import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

/**
 * confirmImportantAction returns a Promise since it became an in-page dialog.
 * `!confirmImportantAction(...)` is therefore ALWAYS false — a Promise object
 * is truthy — so a dropped `await` renders the dialog and then performs the
 * action no matter which button the user presses. Cancel stops nothing.
 *
 * Eight irreversible business actions shipped that way. This keeps it from
 * coming back.
 */
function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

test("every confirmImportantAction call is awaited", () => {
  const offenders: string[] = [];
  for (const file of sourceFiles("src")) {
    // Skip the dialog itself and this test, which both name the
    // function in prose and in the scan below.
    if (file.includes("action-confirmation")) continue;
    if (file.endsWith("confirmation-await.test.ts")) continue;
    const source = readFileSync(file, "utf8");
    for (const line of source.split("\n")) {
      if (!line.includes("confirmImportantAction(")) continue;
      if (line.includes("await confirmImportantAction(")) continue;
      offenders.push(`${file}: ${line.trim()}`);
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `Un-awaited confirmImportantAction lets a cancelled action proceed:\n${offenders.join("\n")}`,
  );
});
