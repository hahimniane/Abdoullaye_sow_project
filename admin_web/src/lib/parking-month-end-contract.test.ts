import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { businessTargetForNotification } from "./notification-routing.ts";
import { translateValue } from "./french-dom.ts";

// Month end sits inside Parking: a button in the panel's header, the view it
// opens, and the 1st-of-month notification landing on the right month.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const panels = read("../components/business/operations-panels.tsx");
const view = read("../components/business/parking-month-end.tsx");
const consoleSource = read("../components/business-console.tsx");

test("the parking panel has a Month end button that opens the month's bills", () => {
  assert.match(panels, /<CalendarCheck size=\{16\} \/> Month end<\/button>/);
  assert.match(panels, /<ParkingMonthEnd\s+rows=\{parkedCars\.rows\}/);
  assert.match(panels, /onOpenCar=\{\(row\) => editParking\(row\)\}/, "payments are recorded on the car, as always");
  assert.match(consoleSource, /<ParkingPanel[\s\S]*?focusView=\{notificationFocusView\}[\s\S]*?\/>/);
});

test("the notification on the 1st opens that month", () => {
  assert.deepEqual(
    businessTargetForNotification({ type: "parking_month_end", monthKey: "2026-09" }),
    { tab: "parking", panelView: "month_end:2026-09" },
  );
});

test("the view never writes; every bill is worked out from the cars and activities", () => {
  assert.doesNotMatch(view, /httpsCallable|setDoc\(|updateDoc\(|addDoc\(/);
  // Cars and the ledger's activities, both read, never written.
  assert.match(view, /parkingMonthSummary\(rows, monthKey, new Date\(\), activities\)/);
});

test("its words read in French", () => {
  for (const english of ["Month end", "View the month as PDF", "Print", "Download", "Share", "Open in a new tab", "Cars on the lot", "Who owes", "Every car", "Nobody owes anything for this month."]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});
