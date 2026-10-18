import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canStepForward,
  currentVolumeMonth,
  formatVolumeAverage,
  formatVolumeChange,
  formatVolumeCount,
  formatVolumeMonth,
  formatVolumeMonthShort,
  isVolumeMonth,
  shiftVolumeMonth,
  stepVolumeMonth,
  volumeChangeTone,
  volumeCsv,
  volumeCsvCell,
  volumeCsvFilename,
  volumeTrendBars,
  type PlatformVolumeResponse,
} from "./volume.ts";

test("the default month is New York's, not the viewer's UTC day", () => {
  // 11:30 PM on Oct 31 in New York is already Nov 1 in UTC.
  assert.equal(currentVolumeMonth(new Date("2026-11-01T03:30:00Z")), "2026-10");
  assert.equal(currentVolumeMonth(new Date("2026-11-01T04:00:00Z")), "2026-11");
});

test("the month picker steps back freely and never past this month", () => {
  assert.equal(shiftVolumeMonth("2026-01", -1), "2025-12");
  assert.equal(shiftVolumeMonth("2026-12", 1), "2027-01");
  assert.equal(shiftVolumeMonth("bad", 1), "");
  assert.equal(stepVolumeMonth("2026-10", -1, "2026-10"), "2026-09");
  assert.equal(stepVolumeMonth("2026-10", 1, "2026-10"), "2026-10");
  assert.equal(stepVolumeMonth("2026-09", 1, "2026-10"), "2026-10");
  assert.equal(stepVolumeMonth("nonsense", -1, "2026-10"), "2026-09");
  assert.equal(canStepForward("2026-09", "2026-10"), true);
  assert.equal(canStepForward("2026-10", "2026-10"), false);
  assert.equal(isVolumeMonth("2026-10"), true);
  assert.equal(isVolumeMonth("2026-13"), false);
});

test("months read as people say them, in both languages", () => {
  assert.equal(formatVolumeMonth("2026-10", "en"), "October 2026");
  assert.equal(formatVolumeMonth("2026-10", "fr"), "octobre 2026");
  assert.equal(formatVolumeMonthShort("2026-10", "en"), "Oct");
  assert.equal(formatVolumeMonthShort("2027-01", "en"), "Jan 2027");
  assert.equal(formatVolumeMonth("nope", "en"), "nope");
});

test("counts, averages and changes are formatted, never NaN", () => {
  assert.equal(formatVolumeCount(1284, "en"), "1,284");
  assert.equal(formatVolumeCount(1284, "fr").replace(/\s/g, " "), "1 284");
  assert.equal(formatVolumeCount(undefined, "en"), "0");
  assert.equal(formatVolumeAverage(42.5, "en"), "42.5");
  assert.equal(formatVolumeAverage(42.5, "fr"), "42,5");
  assert.equal(formatVolumeAverage(null, "en"), "—");
  assert.equal(formatVolumeChange(12.4, "en"), "+12%");
  assert.equal(formatVolumeChange(-8, "en"), "−8%");
  assert.equal(formatVolumeChange(0, "en"), "0%");
  assert.equal(formatVolumeChange(null, "en"), "");
  assert.equal(formatVolumeChange(12, "fr"), "+12 %");
  assert.equal(volumeChangeTone(3), "up");
  assert.equal(volumeChangeTone(-3), "down");
  assert.equal(volumeChangeTone(null), "flat");
});

test("trend bars scale to the busiest month and survive an empty year", () => {
  assert.deepEqual(volumeTrendBars([{ month: "2026-09", pieces: 50 }, { month: "2026-10", pieces: 100 }]), [
    { month: "2026-09", pieces: 50, ratio: 0.5 },
    { month: "2026-10", pieces: 100, ratio: 1 },
  ]);
  assert.deepEqual(volumeTrendBars([{ month: "2026-10", pieces: 0 }]), [
    { month: "2026-10", pieces: 0, ratio: 0 },
  ]);
});

const answer: PlatformVolumeResponse = {
  month: "2026-10",
  timeZone: "America/New_York",
  totals: {
    businesses: 2,
    pieces: 40,
    barrels: 36,
    packages: 3,
    cars: 1,
    customerLines: 13,
    containersShipped: 3,
    containerPieces: 39,
    avgPerContainer: 13,
    previousPieces: 20,
    piecesChangePct: 100,
  },
  businesses: [
    {
      businessId: "gone",
      name: "",
      pieces: 30,
      barrels: 30,
      packages: 0,
      cars: 0,
      customerLines: 9,
      containersShipped: 1,
      containerPieces: 30,
      avgPerContainer: 30,
    },
    {
      businessId: "b1",
      name: '=HYPERLINK("x") "Express"',
      pieces: 10,
      barrels: 6,
      packages: 3,
      cars: 1,
      customerLines: 4,
      containersShipped: 2,
      containerPieces: 9,
      avgPerContainer: 4.5,
    },
  ],
  trend: [],
  computedAtMs: 0,
};

test("the CSV has one row per business and a totals row", () => {
  const lines = volumeCsv(answer, "en").replace(/^﻿/, "").trimEnd().split("\r\n");
  assert.equal(lines.length, 4);
  assert.equal(
    lines[0],
    '"Month","Business","Business ID","Barrels","Packages","Cars","Pieces","Customer lines","Containers shipped","Pieces in containers","Avg pieces / container"',
  );
  // A business with no name is shown by its id.
  assert.equal(lines[1], '"2026-10","gone","gone","30","0","0","30","9","1","30","30"');
  // A typed name cannot run as a spreadsheet formula, and quotes stay quotes.
  assert.equal(lines[2], '"2026-10","\'=HYPERLINK(""x"") ""Express""","b1","6","3","1","10","4","2","9","4.5"');
  assert.equal(lines[3], '"2026-10","Total","","36","3","1","40","13","3","39","13"');
});

test("the CSV speaks French on a French page and starts with a BOM", () => {
  const csv = volumeCsv({ ...answer, totals: { ...answer.totals, avgPerContainer: null } }, "fr");
  assert.ok(csv.startsWith("﻿\"Mois\",\"Entreprise\""));
  assert.match(csv, /"Total","","36","3","1","40","13","3","39",""\r\n$/);
  assert.equal(volumeCsvFilename("2026-10"), "laawol-volume-2026-10.csv");
  assert.equal(volumeCsvCell("-5"), "\"'-5\"");
  assert.equal(volumeCsvCell(12), '"12"');
});

test("every Volume screen string has a French translation", async () => {
  const { TEXT_TRANSLATIONS, ATTRIBUTE_TRANSLATIONS } = await import("./french-dom.ts");
  const source = readFileSync("src/components/volume-views.tsx", "utf8");
  // The plain copy the component renders between tags or as quoted props.
  const copy = [
    "Pieces received",
    "Barrels · Packages · Cars",
    "Containers shipped",
    "Customer lines",
    "By business",
    "Business",
    "Barrels",
    "Packages",
    "Cars",
    "Pieces",
    "Containers",
    "Avg / container",
    "Download CSV",
    "Pieces received, last 12 months",
    "Your volume this month",
    "Containers shipped in",
    "No containers shipped in",
    "Nothing was received or shipped in",
    "vs previous month",
    "No earlier month to compare",
    "avg pieces per container",
    "customer loads received",
    "containers in",
    "Recount the last 12 months",
    "Recounting…",
    "Recounted.",
    "Could not recount. Try again.",
    "Show these numbers as a table",
    "Previous month",
    "Next month",
    "Close",
    "Showing the first 200 containers.",
    "Pieces count in the month they were received; containers in the month they sailed (New York time).",
    "Pieces by month",
    "Month",
    "Total",
    "Shipped",
    "Arrived",
  ];
  for (const english of copy) {
    assert.ok(
      TEXT_TRANSLATIONS[english] || ATTRIBUTE_TRANSLATIONS[english],
      `"${english}" has no French translation`,
    );
    assert.ok(source.includes(english), `"${english}" is no longer on the Volume screens - drop it from this list`);
  }
});
