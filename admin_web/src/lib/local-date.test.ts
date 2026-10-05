import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

import { todayKey } from "./invoice-ledger.ts";
import { localDateKey, localDateKeyInDays, localDateTimeKey } from "./local-date.ts";

test("local keys follow the local calendar, not UTC", () => {
  // 9:30 p.m. on Oct 5 local time. In New York that instant is already
  // Oct 6 in UTC, which is the day toISOString() used to report.
  const evening = new Date(2026, 9, 5, 21, 30);
  assert.equal(localDateKey(evening), "2026-10-05");
  assert.equal(localDateTimeKey(evening), "2026-10-05T21:30");
  assert.equal(localDateKeyInDays(1, evening), "2026-10-06");
  assert.equal(localDateKeyInDays(14, evening), "2026-10-19");
  assert.equal(localDateKeyInDays(1, new Date(2026, 11, 31, 23, 59)), "2027-01-01");
  assert.equal(todayKey(), localDateKey());
});

// The same check in a zone where the bug shows: run a child process in
// New York at 9:30 p.m. local and compare against what toISOString reports.
test("in New York at night, today is still today", () => {
  const script = `
    import { localDateKey } from "./src/lib/local-date.ts";
    const evening = new Date("2026-10-06T01:30:00Z"); // 9:30 p.m. EDT, Oct 5
    process.stdout.write(JSON.stringify([localDateKey(evening), evening.toISOString().slice(0, 10)]));
  `;
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
    env: { ...process.env, TZ: "America/New_York" },
    encoding: "utf8",
  });
  assert.deepEqual(JSON.parse(output), ["2026-10-05", "2026-10-06"]);
});

// Regression: date pickers floored their `min` at the UTC day, so every
// evening in the Americas they refused today's date (and east of Greenwich
// they accepted a day that had already ended).
test("no form floors a date picker at the UTC day", () => {
  for (const file of [
    "src/components/customer-parking-pools.tsx",
    "src/components/customer-cars.tsx",
    "src/components/customer-shipping-services.tsx",
    "src/components/business/operations-panels.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source,
      /new Date\(\)\s*\.toISOString\(\)\s*\.slice\(0, (?:10|16)\)/,
      `${file} computes a "today" key from toISOString(); use lib/local-date.`,
    );
    assert.doesNotMatch(source, /Date\.now\(\) \+ [^)]*\)\s*\.toISOString\(\)\s*\.slice\(0, 10\)/);
  }
});
