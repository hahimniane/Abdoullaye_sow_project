const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  normalizeParkingRates,
  parkingRateSelection,
} = require("../business_parking_entry");

/**
 * A lot can charge more than one price - a bigger space, a long-stay deal, a
 * rate for the dealer who brings six cars at once. Staff pick the card when
 * they record the car; the money must follow the card they picked.
 */
describe("a lot with more than one price", () => {
  const business = {
    parkingDailyRate: 12,
    parkingWeeklyRate: 0,
    parkingMonthlyRate: 0,
    parkingMinimumDays: 1,
    parkingRates: [
      {id: "suv", label: "SUV / oversize", dailyRate: 18, minimumDays: 2},
      {id: "long", label: "Long stay", dailyRate: 9, weeklyRate: 55},
    ],
  };

  it("keeps only cards that can actually price a stay", () => {
    const cards = normalizeParkingRates([
      {id: "ok", label: "Standard", dailyRate: 12},
      {id: "", label: "No id", dailyRate: 12},
      {id: "noname", label: "", dailyRate: 12},
      {id: "free", label: "No rate", dailyRate: 0},
      {id: "ok", label: "Duplicate id", dailyRate: 99},
      "not an object",
    ]);
    assert.deepEqual(cards.map((c) => c.id), ["ok"]);
    assert.equal(cards[0].dailyRate, 12);
    // Blank optional numbers settle at zero, and a minimum is at least a day.
    assert.equal(cards[0].weeklyRate, 0);
    assert.equal(cards[0].minimumDays, 1);
  });

  it("prices exactly as before when no card is chosen", () => {
    const {business: view, rate, missing} = parkingRateSelection(business, "");
    assert.equal(missing, false);
    assert.equal(rate, null);
    assert.equal(view.parkingDailyRate, 12, "the lot's own rate is untouched");
  });

  it("lets the chosen card stand in for the lot's rates", () => {
    const {business: view, rate} = parkingRateSelection(business, "suv");
    assert.equal(rate.label, "SUV / oversize");
    assert.equal(view.parkingDailyRate, 18);
    assert.equal(view.parkingMinimumDays, 2);
    // Only the four numbers move; everything else about the lot is the same.
    assert.equal(view.parkingRates, business.parkingRates);
  });

  it("refuses a card the lot does not have, rather than pricing anyway", () => {
    const {missing, rate} = parkingRateSelection(business, "gone");
    assert.equal(missing, true, "a stale card must refuse");
    assert.equal(rate, null);
    // Silently falling back would charge a price nobody chose.
  });

  it("a business with no cards at all still prices", () => {
    const plain = {parkingDailyRate: 25};
    assert.deepEqual(normalizeParkingRates(plain.parkingRates), []);
    assert.equal(parkingRateSelection(plain, "").business.parkingDailyRate, 25);
    assert.equal(parkingRateSelection(plain, "suv").missing, true);
  });
});

// The price cards are worthless if the save drops them. updateBusinessProfile
// built its update from an explicit field list and never included
// parkingRates, so a business could add a price, see it, and lose it on save.
describe("the profile save persists the price cards", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const source = fs.readFileSync(
      path.join(__dirname, "..", "index.js"), "utf8");
  const fn = source.slice(source.indexOf("exports.updateBusinessProfile"));
  const body = fn.slice(0, fn.indexOf("\n);\n"));

  it("reads parkingRates from the request", () => {
    assert.match(body, /\n\s+parkingRates,\n/);
  });
  it("writes normalized rates, keeping the stored ones when absent", () => {
    assert.match(body, /parkingRates: normalizeParkingRates\(/);
    assert.match(
        body,
        /parkingRates === undefined \? current\.parkingRates : parkingRates/,
    );
  });
});
