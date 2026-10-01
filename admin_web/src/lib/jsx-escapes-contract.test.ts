import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

// "—" is an escape only inside a JavaScript string. Written as JSX text
// - <small>—</small> - the screen prints the six characters themselves,
// which is how the parking list's "Received by" column showed "—" for
// every car not yet paid. Any escape between tags must be the character
// itself or a quoted string: <small>{"—"}</small>.
function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

test("no unicode escape is written as bare JSX text", () => {
  const root = new URL("../", import.meta.url).pathname;
  const offenders: string[] = [];
  for (const file of tsxFiles(root)) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (/>\s*\\u[0-9A-Fa-f]{4}[^<{"'`]*</.test(line)) offenders.push(`${file.replace(root, "")}:${i + 1}`);
    });
  }
  assert.deepEqual(offenders, []);
});
