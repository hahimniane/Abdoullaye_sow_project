"use strict";

// Business price lists for "Send a package" (docs/PACKAGE_PRICE_LIST.md).
// The shared fixture is also run by the console and the app, so the three
// price a basket the same way.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const pl = require("../package_price_list");
const fixture = require("./fixtures/package-price-list-cases.json");

describe("package price list, the shared cases", () => {
  it("has its cases", () => {
    assert.ok(fixture.baskets.length >= 6);
    assert.ok(fixture.counter.length >= 5);
    assert.ok(fixture.departures.length >= 6);
    assert.ok(fixture.routes.length >= 4);
  });
  for (const c of fixture.baskets) {
    it(`basket: ${c.name}`, () => {
      assert.deepEqual(pl.priceBasket(c.route, c.pieces, c.ctx), c.expect);
    });
  }
  for (const c of fixture.counter) {
    it(`counter: ${c.name}`, () => {
      assert.equal(pl.counterPriceCents(c.price, c.weighedLb), c.expect);
    });
  }
  for (const c of fixture.departures) {
    it(`departure: ${c.name}`, () => {
      assert.deepEqual(pl.nextDeparture(c.input), c.expect);
    });
  }
  for (const sort of pl.SORTS) {
    it(`rank: ${sort}`, () => {
      assert.deepEqual(pl.rankOptions(fixture.rank.options, sort)
          .map((o) => o.businessId), fixture.rank.expect[sort]);
    });
  }
  for (const c of fixture.routes) {
    it(`route: ${c.name}`, () => {
      assert.deepEqual(pl.validateRoute(c.raw), c.expect);
    });
  }
});

describe("package price list, the rules", () => {
  it("prices a phone box packed out with shoes at the excess rate", () => {
    const {price} = pl.pricePiece(fixture.route, {priceItemId: "i_phone"});
    assert.equal(price.excessPerLbCents, 450,
        "electronics has no rate: general");
    assert.equal(pl.counterPriceCents(price, 2), 4000);
    assert.equal(pl.counterPriceCents(price, 6), 4000 + 4 * 450);
  });

  it("a whole list refuses countries the business does not ship to", () => {
    const {routes, errors} = pl.validatePriceList({routes: {
      gn: {air: {items: [{label: "Phone", categoryId: "electronics",
        priceCents: 4000}]}},
      zz: {sea: {perLbCents: {food: 300}}},
    }}, ["gn"]);
    assert.equal(routes, null);
    assert.deepEqual(errors, ["country_unknown"]);
  });

  it("a whole list keeps only priced modes and countries", () => {
    const {routes, errors} = pl.validatePriceList({routes: {
      gn: {air: {perLbCents: {clothing: 700}}, sea: null},
      sn: {sea: {items: []}},
    }}, ["gn", "sn"]);
    assert.deepEqual(errors, []);
    assert.deepEqual(Object.keys(routes), ["gn"]);
    assert.deepEqual(Object.keys(routes.gn), ["air"]);
    assert.equal(pl.routeOf({routes}, "gn", "air").perLbCents.clothing, 700);
    assert.equal(pl.routeOf({routes}, "gn", "sea"), null);
  });

  it("an unknown mode is refused", () => {
    const {errors} = pl.validatePriceList({routes: {gn: {train: {}}}},
        ["gn"]);
    assert.deepEqual(errors, ["mode_invalid"]);
  });

  it("item ids come from names and stay stable", () => {
    assert.equal(pl.itemIdFor("Télé 43\""), "i_tele_43");
    assert.equal(pl.itemIdFor("   "), "i_item");
  });

  it("found via: anything but business is Laawol", () => {
    assert.equal(pl.foundVia("business"), "business");
    assert.equal(pl.foundVia(""), "laawol");
    assert.equal(pl.foundVia("other"), "laawol");
  });

  it("every 2 weeks skips the off week", () => {
    const departure = {weekdays: ["sat"], everyWeeks: 2,
      anchorDate: "2026-11-07"};
    assert.equal(pl.nextScheduledDate(departure, "2026-11-08"), "2026-11-21");
    assert.equal(pl.nextScheduledDate(departure, "2026-11-07"), "2026-11-07");
  });
});

describe("re-pricing open requests at today's prices", () => {
  const stored = (piece, route) => {
    const r = pl.pricePiece(route, piece);
    return {id: "p1", estimateCents: r.estimateCents, price: r.price};
  };
  it("moves list-priced pieces and says when the total went up", () => {
    const before = [stored({priceItemId: "i_phone", quantity: 2},
        fixture.route),
    {id: "p2", kind: "barrel", estimateCents: 12500,
      price: {source: "barrel", unitCents: 12500}},
    {id: "p3", kind: "box", estimateCents: null, price: null}];
    const dearer = {...fixture.route, items: fixture.route.items.map((i) =>
      i.id === "i_phone" ? {...i, priceCents: 4500} : i)};
    const out = pl.repricePieces(before, dearer);
    assert.equal(out.changed, true);
    assert.equal(out.wentUp, true);
    assert.equal(out.pieces[0].estimateCents, 9000);
    assert.equal(out.pieces[1], before[1]);
    assert.equal(out.pieces[2], before[2]);
    assert.deepEqual([...out.cents], [["p1", 9000]]);
  });
  it("a cheaper price changes without going up; no change is no change", () => {
    const before = [stored({categoryId: "clothing", weightLb: 50},
        fixture.route)];
    const cheaper = {...fixture.route, perLbCents: {clothing: 500}};
    const out = pl.repricePieces(before, cheaper);
    assert.equal(out.changed, true);
    assert.equal(out.wentUp, false);
    assert.equal(out.pieces[0].estimateCents, 25000);
    assert.equal(pl.repricePieces(before, fixture.route).changed, false);
  });
  it("an item taken off the list keeps its price", () => {
    const before = [stored({priceItemId: "i_laptop"}, fixture.route)];
    const out = pl.repricePieces(before, {...fixture.route, items: []});
    assert.equal(out.changed, false);
    assert.equal(out.pieces[0].estimateCents, 7000);
  });
});
