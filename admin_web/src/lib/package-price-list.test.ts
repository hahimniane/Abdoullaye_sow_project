// The shared fixture (docs/PACKAGE_PRICE_LIST.md §2): the server, the console
// and the app run every case, so they price a basket the same way.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BOX_DIM_MAX_IN,
  BOX_SIZES,
  BOX_SLACK_IN,
  CATEGORIES,
  PRICE_LIST_MESSAGES,
  SORTS,
  addDays,
  boxSizeFor,
  cleanDims,
  counterPriceCents,
  dateKeyValid,
  foundVia,
  itemIdFor,
  nextDeparture,
  nextScheduledDate,
  priceBasket,
  pricePiece,
  rankOptions,
  repricePieces,
  routeOf,
  validatePriceList,
  validateRoute,
  weekdayOf,
} from "./package-price-list.ts";

const fixtureUrl = new URL(
  "../../../my_flutter_app/functions/test/fixtures/package-price-list-cases.json",
  import.meta.url,
);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8")) as any;

test("the shared fixture has its cases", () => {
  assert.ok(fixture.baskets.length >= 6);
  assert.ok(fixture.counter.length >= 5);
  assert.ok(fixture.departures.length >= 6);
  assert.ok(fixture.routes.length >= 4);
});

for (const c of fixture.baskets) {
  test(`basket: ${c.name}`, () => {
    assert.deepEqual(priceBasket(c.route, c.pieces, c.ctx), c.expect);
  });
}
for (const c of fixture.counter) {
  test(`counter: ${c.name}`, () => {
    assert.equal(counterPriceCents(c.price, c.weighedLb), c.expect);
  });
}
for (const c of fixture.departures) {
  test(`departure: ${c.name}`, () => {
    assert.deepEqual(nextDeparture(c.input), c.expect);
  });
}
for (const sort of SORTS) {
  test(`rank: ${sort}`, () => {
    assert.deepEqual(
      rankOptions(fixture.rank.options, sort).map((o) => o.businessId),
      fixture.rank.expect[sort],
    );
  });
}
for (const c of fixture.routes) {
  test(`route: ${c.name}`, () => {
    assert.deepEqual(validateRoute(c.raw), c.expect);
  });
}

test("a phone box packed out with shoes is charged at the excess rate", () => {
  const { price } = pricePiece(fixture.route, { priceItemId: "i_phone" });
  assert.equal(price?.excessPerLbCents, 450);
  assert.equal(counterPriceCents(price, 2), 4000);
  assert.equal(counterPriceCents(price, 6), 4000 + 4 * 450);
});

test("a whole list refuses countries the business does not ship to", () => {
  const { routes, errors } = validatePriceList(
    {
      routes: {
        gn: { air: { items: [{ label: "Phone", categoryId: "electronics", priceCents: 4000 }] } },
        zz: { sea: { perLbCents: { food: 300 } } },
      },
    },
    ["gn"],
  );
  assert.equal(routes, null);
  assert.deepEqual(errors, ["country_unknown"]);
});

test("a whole list keeps only priced modes and countries", () => {
  const { routes, errors } = validatePriceList(
    { routes: { gn: { air: { perLbCents: { clothing: 700 } }, sea: null }, sn: { sea: { items: [] } } } },
    ["gn", "sn"],
  );
  assert.deepEqual(errors, []);
  assert.deepEqual(Object.keys(routes ?? {}), ["gn"]);
  assert.equal(routeOf({ routes }, "gn", "air")?.perLbCents.clothing, 700);
  assert.equal(routeOf({ routes }, "gn", "sea"), null);
});

test("helpers: ids, found via, dates, categories", () => {
  assert.equal(itemIdFor('Télé 43"'), "i_tele_43");
  assert.equal(itemIdFor("   "), "i_item");
  assert.equal(foundVia("business"), "business");
  assert.equal(foundVia("other"), "laawol");
  assert.equal(dateKeyValid("2026-02-30"), false);
  assert.equal(addDays("2026-11-30", 1), "2026-12-01");
  assert.equal(weekdayOf("2026-11-03"), "tue");
  assert.equal(CATEGORIES.length, 7);
  const departure = { weekdays: ["sat"], everyWeeks: 2, anchorDate: "2026-11-07" };
  assert.equal(nextScheduledDate(departure, "2026-11-08"), "2026-11-21");
});

test("re-pricing moves list-priced pieces and says when the total went up", () => {
  const stored = (piece: object) => {
    const r = pricePiece(fixture.route, piece);
    return { id: "p1", estimateCents: r.estimateCents, price: r.price };
  };
  const before = [stored({ priceItemId: "i_phone", quantity: 2 })];
  const dearer = {
    ...fixture.route,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    items: fixture.route.items.map((i: any) => (i.id === "i_phone" ? { ...i, priceCents: 4500 } : i)),
  };
  const out = repricePieces(before, dearer);
  assert.equal(out.changed, true);
  assert.equal(out.wentUp, true);
  assert.equal(out.pieces[0].estimateCents, 9000);
});

test("box sizes: the fixture has its cases and the sizes are Laawol's", () => {
  const box = fixture.boxSizes;
  assert.ok(box.sizeFor.length >= 20);
  assert.ok(box.dims.length >= 5);
  assert.ok(box.routes.length >= 10);
  assert.ok(box.pieces.length >= 20);
  assert.ok(box.baskets.length >= 3);
  assert.deepEqual(
    BOX_SIZES.map((b) => b.id),
    ["small", "medium", "large", "xl"],
  );
  assert.equal(BOX_SLACK_IN, 1);
  assert.equal(BOX_DIM_MAX_IN, 120);
  assert.equal(BOX_SIZES[3].maxIn, null);
});
for (const c of fixture.boxSizes.sizeFor) {
  test(`box size: ${c.name}`, () => {
    assert.equal(boxSizeFor(c.dims), c.expect);
  });
}
for (const c of fixture.boxSizes.dims) {
  test(`box dims: ${c.name}`, () => {
    assert.deepEqual(cleanDims(c.raw), c.expect);
  });
}
for (const c of fixture.boxSizes.routes) {
  test(`box route: ${c.name}`, () => {
    assert.deepEqual(validateRoute(c.raw, c.mode), c.expect);
  });
}
for (const c of fixture.boxSizes.pieces) {
  test(`box piece: ${c.name}`, () => {
    assert.deepEqual(pricePiece(c.route, c.piece, c.ctx || {}), c.expect);
  });
}
for (const c of fixture.boxSizes.baskets) {
  test(`box basket: ${c.name}`, () => {
    assert.deepEqual(priceBasket(c.route, c.pieces, c.ctx), c.expect);
  });
}

test("box sizes: a whole list refuses box prices on an air route", () => {
  const air = validatePriceList({ routes: { gn: { air: { boxPricesCents: { small: 2500 } } } } }, ["gn"]);
  assert.equal(air.routes, null);
  assert.deepEqual(air.errors, ["box_sizes_sea_only"]);
  const sea = validatePriceList({ routes: { gn: { sea: { boxPricesCents: { small: 2500 } } } } }, ["gn"]);
  assert.deepEqual(sea.errors, []);
  assert.deepEqual(sea.routes?.gn.sea?.boxPricesCents, { small: 2500 });
  for (const code of ["box_sizes_sea_only", "box_price_invalid", "box_size_invalid", "dims_invalid"]) {
    assert.ok(PRICE_LIST_MESSAGES[code], code);
  }
});

test("box sizes: the counter keeps a box price and re-pricing follows the list", () => {
  const route = { items: [], perLbCents: {}, departure: null, boxPricesCents: { medium: 3500 } };
  const r = pricePiece(route, { kind: "box", boxSize: "medium", quantity: 2 });
  assert.equal(counterPriceCents(r.price, 99), 7000);
  const before = [{ id: "p1", estimateCents: r.estimateCents, price: r.price }];
  const dearer = { ...route, boxPricesCents: { medium: 4000 } };
  const out = repricePieces(before, dearer);
  assert.equal(out.changed, true);
  assert.equal(out.wentUp, true);
  assert.equal(out.cents.get("p1"), 8000);
  assert.equal(repricePieces(before, route).changed, false);
  assert.equal(repricePieces(before, { ...route, boxPricesCents: {} }).changed, false);
});
