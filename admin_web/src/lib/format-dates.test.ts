import assert from "node:assert/strict";
import test from "node:test";

import { formatDayKey } from "./format.ts";
import { invoiceDayLabel } from "./invoice-ledger.ts";
import { dayLabel } from "./parking-month-statement.ts";

test("a calendar day reads month first in English, and never slips a day", () => {
  assert.equal(formatDayKey("2026-09-01", "en"), "Sep 1, 2026");
  assert.equal(formatDayKey("2026-12-31", "en"), "Dec 31, 2026");
  assert.equal(formatDayKey("2026-09-01", "fr"), "1 sept. 2026");
});

test("the shared bill and invoice text use the same US day", () => {
  assert.equal(dayLabel("2026-09-01"), "Sep 1, 2026");
  assert.equal(dayLabel("not a day"), "not a day");
  assert.equal(invoiceDayLabel("2026-10-15"), "Oct 15, 2026");
  assert.equal(invoiceDayLabel(""), "");
});
