import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  TODAY_METHOD_LABELS,
  TODAY_OWED_ROWS,
  TODAY_SERVICE_LABELS,
  formatTodayMoney,
  todayAttention,
  todayMoneyBreakdown,
  todayMoneyComplete,
  todayOwedRows,
  todayTiles,
  type BusinessToday,
} from "./business-today.ts";
import { previewBusinessToday } from "./business-today-preview.ts";
import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { screenStrings } from "./screen-strings.ts";

function emptyToday(): BusinessToday {
  return {
    month: "2026-10",
    previousMonth: "2026-09",
    timeZone: "America/New_York",
    viewer: {},
    activity: null,
    containers: null,
    queues: {},
    owed: { packagesCents: null, invoicesCents: null, parkingCents: null, shopCreditCents: null, totalCents: null },
    money: null,
    shop: null,
    parking: null,
    listings: null,
    unavailable: [],
  };
}

const ALL = new Set(["barrelShipping", "freight", "carSales", "carTransport", "carParking", "inventory"]);

test("a shipping business leads with what came in and went out, then the money", () => {
  const tiles = todayTiles(previewBusinessToday(ALL, new Date("2026-10-21T15:00:00Z")));
  assert.deepEqual(tiles.map((tile) => tile.key), [
    "packages", "barrels", "carsShipped", "containers", "collected", "owed", "shopSales", "inLot", "listings",
  ]);
  const containers = tiles.find((tile) => tile.key === "containers");
  assert.equal(containers?.note?.label, "Open now");
  assert.equal(containers?.note?.value, 3);
  const owed = tiles.find((tile) => tile.key === "owed");
  assert.equal(owed?.compares, false, "a balance has no month to compare with");
  assert.equal(owed?.kind, "money");
});

test("only the sections the business runs and the viewer may see", () => {
  // A shop: no Volume, no containers, no listings, no lot.
  const shop = todayTiles(previewBusinessToday(new Set(["inventory"])));
  assert.deepEqual(shop.map((tile) => tile.key), ["collected", "owed", "shopSales"]);
  // A staff member with no money and no tabs that count: nothing to tile.
  assert.deepEqual(todayTiles(emptyToday()), []);
  assert.deepEqual(todayTiles(null), []);
});

test("Needs attention lists only what is waiting, each with the tab that acts on it", () => {
  const today = emptyToday();
  today.queues = { packageRequests: 3, waitingPackages: 0, supportRequests: 1, openInvoices: 2, barrelOrders: null };
  today.owed = { packagesCents: 12500, invoicesCents: 4000, parkingCents: 0, shopCreditCents: null, totalCents: 16500 };
  const items = todayAttention(today);
  assert.deepEqual(
    items.map((item) => [item.key, item.count, item.amountCents, item.tab, item.view]),
    [
      ["packageRequests", 3, null, "containers", "requests"],
      ["supportRequests", 1, null, "cases", ""],
      ["packagesOwed", null, 12500, "containers", ""],
      ["openInvoices", 2, 4000, "invoices", ""],
    ],
  );
  // Waiting packages open the waiting list.
  today.queues.waitingPackages = 4;
  assert.equal(todayAttention(today).find((item) => item.key === "waitingPackages")?.view, "waiting");
  // Nothing waiting: an empty list, so the page says so.
  assert.deepEqual(todayAttention(emptyToday()), []);
});

test("money rows: largest first, empty ones dropped, shares for the bars", () => {
  const breakdown = todayMoneyBreakdown({
    totalCents: 10000,
    payments: 4,
    byService: { packages: 6000, invoices: 0, online: 4000 },
    byMethod: { cash: 2500, zelle: 3500, online: 4000, other: 0 },
  });
  assert.equal(breakdown.totalCents, 10000);
  assert.deepEqual(breakdown.services.map((row) => [row.label, row.cents, row.percent]), [
    ["Barrels & packages", 6000, 60],
    ["Online orders", 4000, 40],
  ]);
  assert.deepEqual(breakdown.methods.map((row) => row.label), ["Online (card)", "Zelle", "Cash"]);
  assert.deepEqual(todayMoneyBreakdown(null), { totalCents: 0, services: [], methods: [] });
});

test("the preview's money splits add up to its total", () => {
  const today = previewBusinessToday(ALL);
  const month = today.money!.current;
  const sum = (values: Record<string, number>) => Object.values(values).reduce((a, b) => a + b, 0);
  assert.equal(sum(month.byService), month.totalCents);
  assert.equal(sum(month.byMethod), month.totalCents);
  const owed = todayOwedRows(today).reduce((total, row) => total + row.cents, 0);
  assert.equal(owed, today.owed.totalCents);
});

test("a money read that failed is said, not hidden", () => {
  const today = emptyToday();
  assert.equal(todayMoneyComplete(today), true);
  today.unavailable = ["packagePayments"];
  assert.equal(todayMoneyComplete(today), false);
  today.unavailable = ["volume"];
  assert.equal(todayMoneyComplete(today), true, "Volume is not money");
});

test("money reads as US dollars in both languages", () => {
  assert.equal(formatTodayMoney(128450, "en"), "$1,284.50");
  assert.equal(formatTodayMoney(128450, "en", true), "$1,285");
  assert.match(formatTodayMoney(128450, "fr"), /^1\s284,50\s\$US$/);
  assert.equal(formatTodayMoney(-5, "en"), "$0.00");
});

function missingFrench(strings: readonly string[]): string[] {
  return strings.filter((english) => !(english in TEXT_TRANSLATIONS) && !(english in ATTRIBUTE_TRANSLATIONS));
}

test("every word on Today has its French, labels from the lib included", () => {
  const source = readFileSync("src/components/business/today-view.tsx", "utf8");
  const strings = screenStrings(source, "today-view.tsx");
  assert.ok(strings.includes("Needs attention"), "the scan reads the page");
  const tiles = todayTiles(previewBusinessToday(ALL));
  const today = previewBusinessToday(ALL);
  today.queues = Object.fromEntries(Object.keys(today.queues).map((key) => [key, 1]));
  const labels = [
    ...tiles.map((tile) => tile.label),
    ...tiles.flatMap((tile) => (tile.note ? [tile.note.label] : [])),
    ...todayAttention(today).map((item) => item.label),
    ...Object.values(TODAY_SERVICE_LABELS),
    ...Object.values(TODAY_METHOD_LABELS),
    ...TODAY_OWED_ROWS.map((row) => row.label),
  ];
  assert.deepEqual(missingFrench([...strings, ...labels]), []);
  for (const english of labels) {
    const french = translateValue(english, "fr");
    if (english !== "Zelle" && english !== "Venmo" && english !== "Cash App" && english !== "Total") {
      assert.notEqual(french, english, english);
    }
    assert.equal(translateValue(french, "fr"), french, `${english} converges`);
  }
});

test("figures and typed names are never run through the dictionary", () => {
  const source = readFileSync("src/components/business/today-view.tsx", "utf8");
  // A container's name is what staff typed; figures are formatted numbers.
  assert.match(source, /<strong data-no-translate>\{container\.name \|\| "—"\}<\/strong>/);
  assert.match(source, /<strong className=\{tile\.kind === "money" \? "today-figure is-money" : "today-figure"\} data-no-translate>/);
  assert.match(source, /<span data-no-translate>\{destination\}<\/span>/);
});

test("the page works its figures out once per answer, not per row", () => {
  const source = readFileSync("src/components/business/today-view.tsx", "utf8");
  assert.match(source, /const tiles = useMemo\(\(\) => todayTiles\(today\), \[today\]\);/);
  assert.match(source, /const attention = useMemo\(\(\) => todayAttention\(today\), \[today\]\);/);
});
