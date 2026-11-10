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

describe("package price list, box sizes (shared cases)", () => {
  const box = fixture.boxSizes;
  it("has its cases", () => {
    assert.ok(box.sizeFor.length >= 20);
    assert.ok(box.dims.length >= 5);
    assert.ok(box.routes.length >= 10);
    assert.ok(box.pieces.length >= 20);
    assert.ok(box.baskets.length >= 3);
  });
  it("lists the four sizes Laawol sets", () => {
    assert.deepEqual(pl.BOX_SIZES.map((b) => b.id),
        ["small", "medium", "large", "xl"]);
    assert.equal(pl.BOX_SLACK_IN, 1);
    assert.equal(pl.BOX_DIM_MAX_IN, 120);
    assert.equal(pl.BOX_SIZES[3].maxIn, null);
  });
  for (const c of box.sizeFor) {
    it(`size: ${c.name}`, () => {
      assert.equal(pl.boxSizeFor(c.dims), c.expect);
    });
  }
  for (const c of box.dims) {
    it(`dims: ${c.name}`, () => {
      assert.deepEqual(pl.cleanDims(c.raw), c.expect);
    });
  }
  for (const c of box.routes) {
    it(`box route: ${c.name}`, () => {
      assert.deepEqual(pl.validateRoute(c.raw, c.mode), c.expect);
    });
  }
  for (const c of box.pieces) {
    it(`box piece: ${c.name}`, () => {
      assert.deepEqual(pl.pricePiece(c.route, c.piece, c.ctx || {}),
          c.expect);
    });
  }
  for (const c of box.baskets) {
    it(`box basket: ${c.name}`, () => {
      assert.deepEqual(pl.priceBasket(c.route, c.pieces, c.ctx), c.expect);
    });
  }
});

describe("package price list, box sizes (the rules)", () => {
  const route = {items: [], perLbCents: {}, departure: null,
    boxPricesCents: {small: 2500, medium: 3500, large: 5500}};
  const stored = (piece, at) => {
    const out = pl.pricePiece(at, piece);
    return {id: "p1", ...piece, price: out.price,
      estimateCents: out.estimateCents};
  };

  it("a whole list refuses box prices on an air route", () => {
    const {routes, errors} = pl.validatePriceList({routes: {gn: {
      air: {boxPricesCents: {small: 2500}},
      sea: {boxPricesCents: {small: 2500}}}}}, ["gn"]);
    assert.equal(routes, null);
    assert.deepEqual(errors, ["box_sizes_sea_only"]);
  });

  it("a whole list keeps Sea box prices", () => {
    const {routes, errors} = pl.validatePriceList({routes: {gn: {
      sea: {boxPricesCents: {small: 2500, medium: 3500}}}}}, ["gn"]);
    assert.deepEqual(errors, []);
    assert.deepEqual(routes.gn.sea.boxPricesCents,
        {small: 2500, medium: 3500});
  });

  it("the new refusals have messages", () => {
    for (const code of ["box_sizes_sea_only", "box_price_invalid",
      "box_size_invalid", "dims_invalid"]) {
      assert.ok(pl.PRICE_LIST_MESSAGES[code], code);
    }
  });

  it("the counter does not move a box price", () => {
    const {price} = pl.pricePiece(route, {kind: "box", boxSize: "medium",
      quantity: 2});
    assert.equal(pl.counterPriceCents(price, 99), 7000);
  });

  it("re-prices a box at today's list", () => {
    const before = [stored({kind: "box", boxSize: "medium", quantity: 2},
        route)];
    const dearer = {...route, boxPricesCents: {...route.boxPricesCents,
      medium: 4000}};
    const out = pl.repricePieces(before, dearer);
    assert.equal(out.changed, true);
    assert.equal(out.wentUp, true);
    assert.equal(out.cents.get("p1"), 8000);
    assert.equal(out.pieces[0].price.unitCents, 4000);
    assert.equal(pl.repricePieces(before, route).changed, false);
  });

  it("a box whose size left the list keeps its price", () => {
    const before = [stored({kind: "box", boxSize: "medium"}, route)];
    const out = pl.repricePieces(before, {...route, boxPricesCents: {}});
    assert.equal(out.changed, false);
    assert.equal(out.pieces[0].estimateCents, 3500);
  });
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

it("a per-pound piece is described in the customer's language", () => {
  const route = {items: [], perLbCents: {clothing: 300}, departure: null};
  const piece = {categoryId: "clothing", weightLb: 50};
  assert.equal(pl.pricePiece(route, piece, {lang: "fr"}).description,
      "Vêtements et tissus · 50 lb");
  const en = pl.pricePiece(route, piece, {});
  assert.equal(en.description, "Clothes and fabric · 50 lb");
  assert.equal(pl.pricePiece(route, piece, {lang: "fr"}).price.label,
      en.price.label);
});

describe("package price list, kilos (shared cases)", () => {
  const k = fixture.kilos;
  it("has its cases", () => {
    assert.ok(k.lists.length >= 8);
    assert.ok(k.pieces.length >= 15);
    assert.ok(k.baskets.length >= 2);
    assert.ok(k.counter.length >= 4);
    assert.ok(k.reprice.length >= 4);
    assert.ok(k.convert.length >= 6);
    assert.ok(k.rates.length >= 4);
    assert.ok(k.weightIn.length >= 5);
    assert.ok(k.weights.length >= 10);
    assert.ok(k.weightText.length >= 6);
  });
  for (const c of k.lists) {
    it(`kilo list: ${c.name}`, () => {
      assert.deepEqual(pl.validatePriceList(c.raw, c.countryIds), c.expect);
    });
  }
  for (const c of k.pieces) {
    it(`kilo piece: ${c.name}`, () => {
      assert.deepEqual(pl.pricePiece(c.route, c.piece, c.ctx || {}),
          c.expect);
    });
  }
  for (const c of k.baskets) {
    it(`kilo basket: ${c.name}`, () => {
      assert.deepEqual(pl.priceBasket(c.route, c.pieces, c.ctx), c.expect);
    });
  }
  for (const c of k.counter) {
    it(`kilo counter: ${c.name}`, () => {
      assert.equal(pl.counterPriceCents(c.price, c.weighed), c.expect);
    });
  }
  for (const c of k.reprice) {
    it(`kilo reprice: ${c.name}`, () => {
      const out = pl.repricePieces(c.pieces, c.route);
      assert.deepEqual({pieces: out.pieces, changed: out.changed,
        wentUp: out.wentUp, cents: Object.fromEntries(out.cents)}, c.expect);
    });
  }
  for (const c of k.convert) {
    it(`convert: ${c.name}`, () => {
      assert.equal(pl.convertWeight(c.value, c.from, c.to), c.expect);
    });
  }
  for (const c of k.rates) {
    it(`rate in: ${c.name}`, () => {
      assert.equal(pl.rateIn(c.cents, c.from, c.to), c.expect);
    });
  }
  for (const c of k.weightIn) {
    it(`weight in: ${c.name}`, () => {
      assert.equal(pl.weightIn(c.unit, c.line), c.expect);
    });
  }
});

describe("package price list, kilos (the rules, pinned by hand)", () => {
  const kg = fixture.kilos.route;
  it("$25/kg x 10 kg is exactly $250.00", () => {
    const out = pl.pricePiece(kg, {categoryId: "general", weightLb: 10});
    assert.equal(out.estimateCents, 25000);
    assert.equal(out.price.unit, "kg");
    assert.equal(out.price.weightLb, 10);
    assert.equal(out.description, "General goods · 10 kg");
  });

  it("a pounds list and its routes carry no unit key anywhere", () => {
    const {routes} = pl.validatePriceList({weightUnit: "lb", routes: {gn: {
      sea: {perLbCents: {general: 450}, items: [{label: "Phone",
        categoryId: "electronics", priceCents: 4000, includedLb: 2}]}}}},
    ["gn"]);
    assert.ok(!JSON.stringify(routes).includes("unit"));
    const piece = pl.pricePiece(routes.gn.sea, {categoryId: "general",
      weightLb: 50});
    assert.ok(!("unit" in piece.price));
    const item = pl.pricePiece(routes.gn.sea, {priceItemId: "i_phone"});
    assert.ok(!("unit" in item.price));
  });

  it("a pounds-only basket is byte-identical with and without the unit", () => {
    const route = fixture.route;
    const pieces = [{priceItemId: "i_phone", quantity: 2},
      {categoryId: "clothing", weightLb: 50}];
    assert.deepEqual(
        pl.priceBasket(route, pieces.map((p) => p.categoryId ?
          {...p, weightUnit: "lb"} : p), {}),
        pl.priceBasket(route, pieces, {}));
  });

  it("the rounding is to a tenth, before pricing", () => {
    // 10 lb = 4.5359 kg -> 4.5 kg, not 4.5359 (which would price 11339.8).
    const out = pl.pricePiece(kg, {categoryId: "general", weightLb: 10,
      weightUnit: "lb"});
    assert.equal(out.price.weightLb, 4.5);
    assert.equal(out.estimateCents, 11250);
  });

  it("a weight is checked in the unit it was typed in", () => {
    const lbRoute = fixture.kilos.lbRoute;
    assert.equal(pl.pricePiece(lbRoute, {categoryId: "general",
      weightLb: 901, weightUnit: "kg"}).error, "weight_kg_invalid");
    assert.equal(pl.pricePiece(lbRoute, {categoryId: "general",
      weightLb: 901}).error, "");
    assert.equal(pl.pricePiece(kg, {categoryId: "general",
      weightLb: 901}).error, "weight_kg_invalid");
  });

  it("each refusal has a message; the kilo list names kilos", () => {
    for (const code of ["unit_invalid", "weight_kg_invalid"]) {
      assert.ok(pl.PRICE_LIST_MESSAGES[code], code);
    }
    assert.match(pl.priceListMessage("per_lb_invalid", "kg"), /per kilo/);
    assert.match(pl.priceListMessage("per_lb_invalid", "lb"), /per pound/);
    assert.match(pl.priceListMessage("included_invalid", "kg"), /kg/);
    assert.equal(pl.priceListMessage("price_invalid", "kg"),
        pl.PRICE_LIST_MESSAGES.price_invalid);
    assert.equal(pl.priceListMessage("nope"), "");
  });

  it("the size presets have a kilo weight", () => {
    assert.deepEqual(pl.SIZE_PRESETS.map((p) => p.kg), [5, 23, 32]);
    assert.deepEqual(pl.SIZE_PRESETS.map((p) => p.lb), [10, 50, 70]);
    assert.equal(pl.LIMIT.WEIGHT_KG, 900);
    assert.equal(pl.KG_TO_LB, 2.20462);
  });

  it("unitOf answers kg only for a kilo route, snapshot or list", () => {
    assert.equal(pl.unitOf(kg), "kg");
    assert.equal(pl.unitOf({weightUnit: "kg"}), "kg");
    assert.equal(pl.unitOf(fixture.route), "lb");
    assert.equal(pl.unitOf(null), "lb");
    assert.equal(pl.unitOf({unit: "oz"}), "lb");
  });

  it("a counter price in kilos for a line weighed in the other unit", () => {
    const {price} = pl.pricePiece(kg, {categoryId: "general", weightLb: 10});
    // Staff weighed 27.6 lb: the caller converts to the price's unit first.
    const weighed = pl.weightIn(pl.unitOf(price), {weightLb: 27.6});
    assert.equal(weighed, 12.5);
    assert.equal(pl.counterPriceCents(price, weighed), 31250);
  });
});
