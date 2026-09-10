const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");
const {publicParkingOption} = require("../public_service_options");

const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

/**
 * A customer who does not already know the name of a town cannot search for
 * one. City was required and matched exactly, so "Bronx" or "NYC" found
 * nothing while a lot sat a mile away, and there was no way to simply look.
 */
describe("finding a place to park", () => {
  const search = source.slice(
      source.indexOf("async function parkingOptionsForRequest"),
  );
  const body = search.slice(0, search.indexOf("\n}\n"));

  it("asks for nothing: no city, no state, no dates", () => {
    assert.ok(
        !/Parking city is required/.test(source),
        "a customer must be able to browse without naming a town",
    );
    assert.match(body, /const hasWindow = Boolean\(startDate\)/);
  });

  it("narrows only by what the customer actually chose", () => {
    assert.match(body, /normalizedCity && businessCity !== normalizedCity/);
    assert.match(body, /normalizedState && businessState !== normalizedState/);
  });

  it("still refuses a window that ends before it starts", () => {
    assert.match(body, /Parking end date must be after the start date/);
  });

  it("shows a lot full today while browsing, not once dates exist", () => {
    // Browsing has no dates, so "no room today" is not a reason to hide a
    // lot the customer may want next week.
    assert.match(body, /!hasWindow \|\| option\.availableSpaces > 0/);
    assert.match(body, /quotedForDates: hasWindow/);
  });

  it("puts the nearest lot first when it knows where they are", () => {
    assert.match(body, /Number\(a\.distanceMiles\) - Number\(b/);
  });

  it("carries the state, so they can pick one and then a town", () => {
    assert.match(source, /state: business\.parkingState \|\| business\.state/);
    const option = publicParkingOption({
      businessId: "b1",
      businessName: "Keren",
      city: "New York",
      state: "NY",
      availableSpaces: 4,
      dailyRate: 12,
      quotedForDates: true,
    });
    assert.equal(option.state, "NY");
    assert.equal(option.quotedForDates, true);
    // Browsing is honest about not being a quote.
    const browsing = publicParkingOption({businessId: "b1"});
    assert.equal(browsing.quotedForDates, false);
    // And the signed-out listing still hides what it always hid.
    for (const secret of ["phone", "email", "latitude", "longitude"]) {
      assert.equal(Object.hasOwn(option, secret), false, secret);
    }
  });
});
