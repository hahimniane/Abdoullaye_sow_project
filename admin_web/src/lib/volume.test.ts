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
  isEmptyVolume,
  recentVolumeMonths,
  volumeBusinessOptions,
  volumeMonthOptions,
  volumeTiles,
  type PlatformVolumeResponse,
} from "./volume.ts";
import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { previewBusinessVolume, previewPlatformVolume } from "./volume-preview.ts";
import { screenStrings } from "./screen-strings.ts";

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

function missingFrench(strings: readonly string[]): string[] {
  return strings.filter((english) => !(english in TEXT_TRANSLATIONS) && !(english in ATTRIBUTE_TRANSLATIONS));
}

test("every sentence on the Volume pages has its French, tiles included", () => {
  const source = readFileSync("src/components/volume-views.tsx", "utf8");
  const strings = screenStrings(source, "volume-views.tsx");
  assert.ok(strings.includes("All businesses"), "the scan reads the page");
  assert.ok(strings.includes("Choose a month"), "the scan reads aria-labels");
  // The tile labels live in volumeTiles (lib/volume.ts), not in the JSX.
  const tiles = volumeTiles(answer.totals, { showCustomerLines: true });
  const labels = [...tiles.received, ...tiles.shipped].map((tile) => tile.label);
  assert.deepEqual(missingFrench([...strings, ...labels]), []);
  for (const english of labels) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
    assert.equal(translateValue(french, "fr"), french, `${english} converges`);
  }
});

test("each kind of piece has its own tile, and containers and the average have theirs", () => {
  const tiles = volumeTiles(answer.totals, { showCustomerLines: true });
  assert.deepEqual(
    tiles.received.map((tile) => [tile.key, tile.value]),
    [["pieces", 40], ["barrels", 36], ["packages", 3], ["cars", 1]],
  );
  assert.deepEqual(
    tiles.shipped.map((tile) => [tile.key, tile.value, tile.kind]),
    [["containersShipped", 3, "count"], ["avgPerContainer", 13, "average"], ["customerLines", 13, "count"]],
  );
  // The business console has no customer-lines tile.
  const business = volumeTiles(answer.totals, { showCustomerLines: false });
  assert.deepEqual(business.shipped.map((tile) => tile.key), ["containersShipped", "avgPerContainer"]);
  // Nothing shipped: no average (a dash, not 0 or NaN); bad numbers count as 0.
  const empty = volumeTiles(
    { ...answer.totals, containersShipped: 0, avgPerContainer: null, barrels: Number.NaN, cars: -2 },
    { showCustomerLines: false },
  );
  assert.equal(empty.shipped[1].value, null);
  assert.equal(empty.received[1].value, 0);
  assert.equal(empty.received[3].value, 0);
  assert.equal(isEmptyVolume({ pieces: 0, containersShipped: 0 }), true);
  assert.equal(isEmptyVolume({ pieces: 0, containersShipped: 1 }), false);
  assert.equal(isEmptyVolume(null), false, "not loaded is not empty");
});

test("the month picker lists this month and the 23 before it, newest first", () => {
  const months = recentVolumeMonths("2026-10");
  assert.equal(months.length, 24);
  assert.equal(months[0], "2026-10");
  assert.equal(months[1], "2026-09");
  assert.equal(months[10], "2025-12");
  assert.equal(months[23], "2024-11");
  assert.deepEqual(recentVolumeMonths("bad"), []);
  // Stepped back further with the arrows: the month joins the list at the end.
  assert.deepEqual(volumeMonthOptions("2023-01", "2026-10", 3), ["2026-10", "2026-09", "2026-08", "2023-01"]);
  assert.deepEqual(volumeMonthOptions("2026-09", "2026-10", 3), ["2026-10", "2026-09", "2026-08"]);
});

test("the business picker lists each business once, by name, whatever it was loaded from", () => {
  const options = volumeBusinessOptions(
    [
      { id: "b2", name: "Zeta Cargo" },
      { id: "b1", name: "" },
      { id: "inferred", name: "From an order", _inferred: true },
      { id: "bad/id", name: "Slash" },
      { id: "", name: "Blank" },
    ],
    [
      { businessId: "b1", name: "Alpha Shipping" },
      { businessId: "b3", name: "beta freight" },
      { businessId: "b2", name: "Old name" },
    ],
    { id: "b4", name: "" },
  );
  assert.deepEqual(options, [
    { id: "b1", name: "Alpha Shipping" },
    { id: "b4", name: "b4" },
    { id: "b3", name: "beta freight" },
    { id: "b2", name: "Zeta Cargo" },
  ]);
  assert.deepEqual(volumeBusinessOptions([]), []);
});

test("the preview's numbers add up the way the server's do", () => {
  const platform = previewPlatformVolume("2026-10", "2026-10");
  const sum = (key: "pieces" | "barrels" | "packages" | "cars" | "containersShipped") =>
    platform.businesses.reduce((acc, row) => acc + row[key], 0);
  assert.equal(platform.totals.pieces, sum("pieces"));
  assert.equal(platform.totals.pieces, platform.totals.barrels + platform.totals.packages + platform.totals.cars);
  assert.equal(platform.totals.containersShipped, sum("containersShipped"));
  assert.equal(platform.trend.length, 12);
  assert.equal(platform.trend[11].month, "2026-10");
  assert.equal(platform.trend[11].pieces, platform.totals.pieces);
  // One business has an empty month, and a month older than a year is empty.
  const quiet = previewBusinessVolume("keren_auto_sales", "2026-08", "2026-10");
  assert.equal(isEmptyVolume(quiet.totals), true);
  assert.deepEqual(quiet.containers, []);
  assert.equal(previewPlatformVolume("2025-01", "2026-10").businesses.length, 0);
  // A business's containers hold exactly its month's pieces.
  const busy = previewBusinessVolume("atlantic_exports", "2026-10", "2026-10");
  assert.equal(busy.containers.length, busy.totals.containersShipped);
  assert.equal(busy.containers.reduce((acc, box) => acc + box.pieces, 0), busy.totals.pieces);
  assert.equal(busy.businessName, "Atlantic Exports");
});
