// The Track page for a parked car (docs/PARKING_WHATSAPP.md §2-§3): the money
// block - daily rate, parked since, days so far, amount so far, paid, balance
// owed now or Paid in full - and the "Get the Laawol app" offer right after it.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TEXT_TRANSLATIONS } from "./french-dom.ts";
import { APP_STORE_URL, PLAY_STORE_URL } from "./app-store-links.ts";
import {
  GUEST_PARKING_COPY,
  guestParkingRows,
  parseGuestParking,
  parseGuestTrackingResponse,
} from "./guest-tracking.ts";
import { parkingBalanceNow } from "./parking-balance.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../components/guest-tracking.tsx");
const banner = read("../components/get-app-banner.tsx");

const OWING = {
  dailyRateCents: 1200,
  sinceDayKey: "2026-10-27",
  leftDayKey: "",
  days: 3,
  accruedCents: 3600,
  paidCents: 1200,
  balanceCents: 2400,
  paidInFull: false,
  stillParked: true,
};

const answer = (parking: unknown, service = "parking") => ({
  version: 1,
  found: true,
  record: { trackingCode: "PK-ABC123", service, stage: "in_transit", updatedAtMs: 1_790_000_000_000, parking },
});

test("a parked car's answer carries its money block, every figure read as whole numbers", () => {
  const parsed = parseGuestTrackingResponse(answer(OWING));
  assert.ok(parsed.found);
  if (parsed.found) assert.deepEqual(parsed.record.parking, OWING);
});

test("the block is dropped, never half-shown, when a figure or the day is malformed", () => {
  for (const bad of [
    { ...OWING, sinceDayKey: "Oct 27" },
    { ...OWING, sinceDayKey: "" },
    { ...OWING, leftDayKey: "tomorrow" },
    { ...OWING, balanceCents: -5 },
    { ...OWING, accruedCents: 36.5 },
    { ...OWING, days: "three" },
    { ...OWING, paidCents: null },
    { ...OWING, dailyRateCents: undefined },
    null,
    "owing",
    [],
  ]) {
    assert.equal(parseGuestParking("parking", bad), undefined, JSON.stringify(bad));
  }
  const parsed = parseGuestTrackingResponse(answer({ ...OWING, balanceCents: -5 }));
  assert.ok(parsed.found);
  if (parsed.found) assert.equal("parking" in parsed.record, false, "an older or odd answer reads as before");
});

test("only a parked car carries the block, and an older server's answer still parses", () => {
  assert.equal(parseGuestParking("barrel", OWING), undefined);
  assert.equal(parseGuestParking("container", OWING), undefined);
  const parsed = parseGuestTrackingResponse(answer(undefined));
  assert.ok(parsed.found);
  if (parsed.found) assert.equal(parsed.record.parking, undefined);
  const other = parseGuestTrackingResponse(answer(OWING, "barrel"));
  assert.ok(other.found);
  if (other.found) assert.equal(other.record.parking, undefined);
});

test("paidInFull and stillParked are derived when an answer leaves them out", () => {
  const { paidInFull: _a, stillParked: _b, ...bare } = { ...OWING, paidCents: 3600, balanceCents: 0 };
  const parsed = parseGuestParking("parking", bare);
  assert.equal(parsed?.paidInFull, true);
  assert.equal(parsed?.stillParked, true);
  assert.equal(parseGuestParking("parking", { ...bare, leftDayKey: "2026-10-28" })?.stillParked, false);
});

test("the rows read in order, month first, and end on the balance owed now", () => {
  const rows = guestParkingRows(OWING, "en");
  assert.deepEqual(rows.map((r) => [r.label, r.value]), [
    ["Daily rate", "$12.00"],
    ["Parked since", "Oct 27, 2026"],
    ["Days so far", "3"],
    ["Amount so far", "$36.00"],
    ["Paid", "$12.00"],
    ["Balance owed now", "$24.00"],
  ]);
  assert.equal(rows[rows.length - 1].emphasis, "owed");
});

test("a car paid up says Paid in full instead of a zero", () => {
  const rows = guestParkingRows({ ...OWING, paidCents: 3600, balanceCents: 0, paidInFull: true }, "en");
  const last = rows[rows.length - 1];
  assert.deepEqual([last.label, last.value, last.emphasis], ["Balance owed now", "Paid in full", "settled"]);
});

test("a car that has left reads Left on / Days parked / Total, in French too", () => {
  const left = { ...OWING, leftDayKey: "2026-10-28", stillParked: false, days: 2, accruedCents: 2400, paidCents: 0, balanceCents: 2400 };
  const rows = guestParkingRows(left, "en");
  assert.deepEqual(rows.map((r) => r.label), ["Daily rate", "Parked since", "Left on", "Days parked", "Total", "Paid", "Balance owed now"]);
  assert.equal(rows[2].value, "Oct 28, 2026");
  const fr = guestParkingRows(left, "fr");
  assert.equal(fr[0].value, "12,00 $");
  assert.equal(fr[1].value, "27 oct. 2026");
});

test("the server's block and the console's own balance helper agree on the same car", () => {
  const car = { parkingDate: "2026-10-27", dailyRate: 12, amountPaidCents: 1200 };
  const mine = parkingBalanceNow(car, new Date("2026-10-29T15:00:00Z"));
  // The server's shape: no leave day is null; the page reads it as "".
  assert.deepEqual(mine, { ...OWING, leftDayKey: null });
  assert.deepEqual(parseGuestParking("parking", mine), OWING);
});

test("the page shows the money block, then offers the app with both stores", () => {
  assert.match(page, /\{record\.parking && \(\s*<section[^>]*className="guest-tracking-payment guest-tracking-parking"/);
  assert.match(page, /guestParkingRows\(record\.parking, lang\)/);
  // The app comes straight after the block, and the top-of-page banner steps aside for a parked car.
  assert.match(page, /\{record\.parking && offerApp && <GetAppBanner variant="parking" \/>\}/);
  assert.match(page, /\{!record\?\.parking && <GetAppBanner variant=\{arrivedWithCode \? "track" : "follow"\} \/>\}/);
  assert.ok(page.indexOf("guestParkingRows(record.parking") < page.indexOf('<GetAppBanner variant="parking"'));
  // The banner names the app and links both stores (App Store + Google Play).
  assert.match(banner, /variant === "parking"/);
  assert.match(banner, /Get the Laawol app/);
  assert.match(read("./app-store-links.ts"), /export function storeLinksFor/);
  assert.match(APP_STORE_URL, /^https:\/\/apps\.apple\.com\//);
  assert.match(PLAY_STORE_URL, /^https:\/\/play\.google\.com\//);
  // Guests see it with the code: no sign-in gate around the block.
  const block = page.slice(page.indexOf("{record.parking && ("), page.indexOf('<GetAppBanner variant="parking"'));
  assert.doesNotMatch(block, /authenticated/);
});

test("the block and the offer have their French", () => {
  const strings = [
    ...Object.values(GUEST_PARKING_COPY),
    "See your car, what you owe and every receipt in the app. Sign in with your WhatsApp number.",
    "For your privacy, only the booking status and the parking balance are shown here.",
    "Get the Laawol app",
  ];
  assert.deepEqual(strings.filter((value) => !TEXT_TRANSLATIONS[value]), []);
});
