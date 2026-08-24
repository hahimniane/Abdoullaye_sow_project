const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  DEFAULT_SERVICE_SORT,
  MIN_OPTIONS_FOR_SORT,
  UNKNOWN_SORT_VALUE,
  serviceOptionTotalCents,
  serviceOptionDays,
  SERVICE_SORTS_BY_SERVICE,
  sortsForService,
  defaultSortForService,
  sortServiceOptions,
  shouldOfferServiceSort,
} = require("../service_ranking");


/**
 * A business option row, shaped like listActiveBarrelDestinationOptions -
 * including freightCategories already resolved to this business's multipliers,
 * which is what the response actually carries.
 *
 * @param {string} id Business id.
 * @param {object} [overrides] Rates, days and coverage for this fixture.
 * @return {object} An option row.
 */
const option = (id, {
  airRate = 10,
  seaRate = 0,
  airDays,
  airMaxDays,
  coversLoss = false,
  ratePct = 0,
  maxDeclaredValue = 0,
  categoryRates,
  paybackTable,
} = {}) => ({
  businessId: id,
  freightCategories: Object.entries(categoryRates || {}).map(
      ([categoryId]) => ({id: categoryId}),
  ),
  // What this business charges for each thing it carries. Ranking reads the
  // same table the booking prices from, so the order of the list and the
  // bill cannot disagree.
  freightPaybackTable: paybackTable,
  freightCoverage: {coversLoss, ratePct, maxDeclaredValue},
  country: {
    freightAirPricePerKg: airRate,
    freightSeaPricePerKg: seaRate,
    // The delivery estimate, not freightAirDepartureDays - that field holds
    // weekday names for when shipments leave, and reading it as a number was
    // a real bug in the first version of this module.
    freightAirDeliveryEstimateMinDays: airDays,
    freightAirDeliveryEstimateMaxDays: airMaxDays,
  },
});

const ids = (rows) => rows.map((row) => row.businessId);

describe("what a parcel actually costs at each business", () => {
  it("prices on the real quote, not the headline rate", () => {
    // The business cheaper per kilo can be dearer for a phone, because it
    // charges a set price for one. Ranking on the rate alone would name the
    // wrong winner.
    const priced = (mode, flatPrice) => ({
      electronics: {
        items: [{
          id: "iphone", label: "iPhone", paybackAmount: 400,
          pricingMode: mode,
          ...(flatPrice ? {flatPrice} : {}),
        }],
        otherPaybackAmount: 0,
      },
    });
    const cheapPerKg = option("cheap-per-kg", {
      airRate: 10,
      paybackTable: priced("flat", 150),
    });
    const dearPerKg = option("dear-per-kg", {
      airRate: 12,
      paybackTable: priced("per_kg"),
    });
    const args = {
      weightKg: 5,
      mode: "air",
      itemCategoryId: "electronics",
      itemId: "iphone",
    };
    const cents = (option) =>
      serviceOptionTotalCents({service: "freight", option, ...args});
    // A set price does not move with weight; the other is 5kg x $12.
    assert.equal(cents(cheapPerKg), 15000);
    assert.equal(cents(dearPerKg), 6000);

    const sorted = sortServiceOptions({
      service: "freight",
      options: [cheapPerKg, dearPerKg],
      sort: "cheapest",
      ...args,
    });
    assert.deepEqual(ids(sorted), ["dear-per-kg", "cheap-per-kg"]);
  });

  it("sinks a business that has not priced the item", () => {
    // An item nobody quoted has no place in a cheapest ordering: it is a
    // price request, not a cheaper option.
    const unpriced = option("unpriced", {airRate: 5});
    assert.equal(
        serviceOptionTotalCents({
          service: "freight",
          option: unpriced,
          weightKg: 5,
          mode: "air",
          itemCategoryId: "electronics",
          itemId: "iphone",
        }),
        UNKNOWN_SORT_VALUE,
    );
  });

  it("never adds a coverage charge, because there is none", () => {
    // Cover costs the customer nothing: the business already priced the item
    // for what it is worth to carry. What a parcel costs is what it costs to
    // ship it, whether or not the business stands behind it.
    const byWeight = {
      general: {
        items: [{
          id: "box", label: "Box", paybackAmount: 100,
          pricingMode: "per_kg",
        }],
        otherPaybackAmount: 0,
      },
    };
    const withCover = option("covers", {
      airRate: 10, coversLoss: true, paybackTable: byWeight,
    });
    const without = option("bare", {airRate: 10, paybackTable: byWeight});
    const args = {
      weightKg: 1,
      mode: "air",
      itemCategoryId: "general",
      itemId: "box",
    };
    assert.equal(
        serviceOptionTotalCents({
          service: "freight", option: withCover, ...args,
        }),
        1000,
    );
    assert.equal(
        serviceOptionTotalCents({service: "freight", option: without, ...args}),
        1000,
    );
  });

  it("ranks cheapest on the shipping price alone", () => {
    const sorted = sortServiceOptions({
      service: "freight",
      options: [
        option("dearer-covers", {airRate: 50, coversLoss: true}),
        option("cheaper-bare", {airRate: 1}),
      ],
      sort: "cheapest",
      weightKg: 1,
      mode: "air",
    });
    assert.deepEqual(ids(sorted), ["cheaper-bare", "dearer-covers"]);
  });

  it("cannot price a route the business does not serve", () => {
    const airOnly = option("air-only", {airRate: 10, seaRate: 0});
    assert.equal(
        serviceOptionTotalCents({
          service: "freight", option: airOnly, weightKg: 5, mode: "sea",
        }),
        UNKNOWN_SORT_VALUE,
    );
  });
});

describe("fastest", () => {
  it("reads the delivery estimate, not the departure weekdays", () => {
    // freight*DepartureDays holds "monday"/"thursday" - which days a shipment
    // leaves. The first version of this module read it as a number of days,
    // which would have made every business unknown and the sort pointless.
    const wrongField = option("wrong-field");
    wrongField.country.freightAirDepartureDays = ["monday", "thursday"];
    assert.equal(
        serviceOptionDays(wrongField, "freight", "air"),
        UNKNOWN_SORT_VALUE,
    );

    const rightField = option("right-field", {airDays: 8});
    rightField.country.freightAirDepartureDays = ["monday"];
    assert.equal(serviceOptionDays(rightField, "freight", "air"), 8);
  });

  it("separates two businesses sharing a lower bound by the upper one", () => {
    // Senegal quotes 2-3 days and Canada 5-15 in the live data; a business
    // quoting 2-15 must not tie with one quoting 2-3.
    const sorted = sortServiceOptions({
      service: "freight",
      options: [
        option("wide", {airDays: 2, airMaxDays: 15}),
        option("tight", {airDays: 2, airMaxDays: 3}),
      ],
      sort: "fastest",
      weightKg: 1,
      mode: "air",
    });
    assert.deepEqual(ids(sorted), ["tight", "wide"]);
  });

  it("treats a missing estimate as unknown, never as zero days", () => {
    // Only some businesses have filled this in. Blank must not read as instant.
    assert.equal(
        serviceOptionDays(option("x"), "freight", "air"),
        UNKNOWN_SORT_VALUE,
    );
    assert.equal(serviceOptionDays(option("y", {airDays: 0}), "freight", "air"),
        UNKNOWN_SORT_VALUE);
    assert.equal(serviceOptionDays(option("z", {airDays: 6}), "freight", "air"),
        6);
  });

  it("sinks businesses that never stated a time below those that did", () => {
    const sorted = sortServiceOptions({
      service: "freight",
      options: [
        option("silent"),
        option("slow", {airDays: 20}),
        option("quick", {airDays: 4}),
      ],
      sort: "fastest",
      weightKg: 5,
      mode: "air",
    });
    assert.deepEqual(ids(sorted), ["quick", "slow", "silent"]);
  });

  it("falls back to price between businesses quoting the same days", () => {
    const sorted = sortServiceOptions({
      service: "freight",
      options: [
        option("same-days-dearer", {airDays: 5, airRate: 20}),
        option("same-days-cheaper", {airDays: 5, airRate: 10}),
      ],
      sort: "fastest",
      weightKg: 1,
      mode: "air",
    });
    assert.deepEqual(ids(sorted), ["same-days-cheaper", "same-days-dearer"]);
  });
});

describe("best coverage", () => {
  it("puts a business that covers loss above one that does not", () => {
    const sorted = sortServiceOptions({
      service: "freight",
      options: [
        option("bare", {airRate: 5}),
        option("covers", {airRate: 30, coversLoss: true, ratePct: 2,
          maxDeclaredValue: 1000}),
      ],
      sort: "coverage",
      weightKg: 1,
      mode: "air",
    });
    // Deliberately ranks the dearer business first: this sort is about who
    // stands behind the parcel, and the price is on the card either way.
    assert.deepEqual(ids(sorted), ["covers", "bare"]);
  });

  it("is one question, so covering businesses keep the list's own order",
      () => {
        // There is no rate or ceiling to break ties on: a covering business
        // pays the full payback it published for the item. Among businesses
        // that cover, the list's remaining tie-breaks decide.
        const sorted = sortServiceOptions({
          service: "freight",
          options: [
            option("covers-a", {coversLoss: true}),
            option("bare", {}),
            option("covers-b", {coversLoss: true}),
          ],
          sort: "coverage",
          weightKg: 1,
          mode: "air",
        });
        assert.equal(ids(sorted)[2], "bare");
        assert.deepEqual(ids(sorted).slice(0, 2).sort(),
            ["covers-a", "covers-b"]);
      });

  it("counts a business that ticks cover, because that is the promise", () => {
    // Ticking the box used to mean nothing without a rate beside it. There
    // is no rate now: a business that says it pays for a lost parcel pays
    // the full payback it published, and ranks above one that pays nothing.
    const sorted = sortServiceOptions({
      service: "freight",
      options: [
        option("bare", {}),
        option("covers", {coversLoss: true}),
      ],
      sort: "coverage",
      weightKg: 1,
      mode: "air",
    });
    assert.deepEqual(ids(sorted), ["covers", "bare"]);
  });
});

describe("stability", () => {
  it("gives the same order every time when everything ties", () => {
    // Ties are the norm at this size. A list that reshuffles between loads
    // reads as broken.
    const rows = [option("ccc"), option("aaa"), option("bbb")];
    const first = ids(sortServiceOptions({
      service: "freight",
      options: rows, sort: "cheapest", weightKg: 5, mode: "air",
    }));
    const second = ids(sortServiceOptions({
      service: "freight",
      options: [...rows].reverse(),
      sort: "cheapest",
      weightKg: 5,
      mode: "air",
    }));
    assert.deepEqual(first, second);
    assert.deepEqual(first, ["aaa", "bbb", "ccc"]);
  });

  it("never mutates the array it was handed", () => {
    const rows = [option("b"), option("a")];
    const before = ids(rows);
    sortServiceOptions({
      service: "freight", options: rows, sort: "cheapest", weightKg: 1,
      mode: "air"});
    assert.deepEqual(ids(rows), before);
  });

  it("falls back to the default sort for anything unrecognised", () => {
    const rows = [
      option("dear", {airRate: 30}),
      option("cheap", {airRate: 5}),
    ];
    for (const sort of [undefined, "", "popularity", null]) {
      assert.deepEqual(
          ids(sortServiceOptions({
            service: "freight", options: rows, sort, weightKg: 1,
            mode: "air"})),
          ["cheap", "dear"],
          String(sort),
      );
    }
    assert.equal(DEFAULT_SERVICE_SORT, "cheapest");
  });
});

describe("whether to offer the control at all", () => {
  const enough = Array.from({length: MIN_OPTIONS_FOR_SORT}, (_, i) =>
    option(`b${i}`));

  it("stays hidden until there is enough to order", () => {
    // A sort control over one result advertises a choice that does not exist.
    // Guinea had exactly one freight business when this was written.
    assert.equal(shouldOfferServiceSort([], "freight"), false);
    assert.equal(shouldOfferServiceSort([option("a")], "freight"), false);
    assert.equal(
        shouldOfferServiceSort([option("a"), option("b")], "freight"),
        false,
    );
  });

  it("appears by itself once a route has real competition", () => {
    assert.equal(shouldOfferServiceSort(enough, "freight"), true);
  });

  it("stays hidden for a service with only one way to order it", () => {
    // Car transport is priced by bid, so rating is the only thing to sort by,
    // and a control offering one choice is not a control.
    assert.deepEqual(sortsForService("carTransport"), ["rated"]);
    assert.equal(shouldOfferServiceSort(enough, "carTransport"), false);
    assert.equal(shouldOfferServiceSort(enough, "carSales"), false);
  });

  it("has nothing to offer for a service it does not know", () => {
    assert.deepEqual(sortsForService("teleportation"), []);
    assert.equal(shouldOfferServiceSort(enough, "teleportation"), false);
  });
});

describe("what each service can be sorted by", () => {
  it("only offers cover where a loss policy exists", () => {
    // freightCoverageEnabled is the platform's one loss policy. Offering
    // "best cover" on barrels would rank every business identically.
    for (const service of ["barrelShipping", "sharedBarrels", "carParking"]) {
      assert.equal(
          sortsForService(service).includes("coverage"),
          false,
          service,
      );
    }
    assert.equal(sortsForService("freight").includes("coverage"), true);
  });

  it("offers rating everywhere, because every business carries one", () => {
    for (const service of Object.keys(SERVICE_SORTS_BY_SERVICE)) {
      assert.equal(sortsForService(service).includes("rated"), true, service);
    }
  });

  it("starts a service on a sort it can actually answer", () => {
    assert.equal(defaultSortForService("freight"), "cheapest");
    assert.equal(defaultSortForService("barrelShipping"), "cheapest");
    // No price before the bid, so cheapest is not on offer and must not be
    // the starting order either.
    assert.equal(defaultSortForService("carTransport"), "rated");
    assert.equal(defaultSortForService("teleportation"), "");
  });
});

describe("pricing each service on its own terms", () => {
  const barrel = (id, price, quantity) => ({
    businessId: id,
    country: {barrelShippingPrice: price},
    quantity,
  });

  it("prices barrels per barrel, times how many", () => {
    assert.equal(
        serviceOptionTotalCents({
          option: barrel("a", 120), service: "barrelShipping", quantity: 3,
        }),
        36000,
    );
  });

  it("compares on one unit before the customer has said how many", () => {
    // The picker sits above the quantity field. One barrel each is still a
    // fair comparison; zero would price everything the same.
    assert.equal(
        serviceOptionTotalCents({
          option: barrel("a", 120), service: "barrelShipping",
        }),
        12000,
    );
  });

  it("prices parking on the term the customer chose", () => {
    const lot = {
      businessId: "lot", dailyRate: 10, weeklyRate: 60, monthlyRate: 200,
    };
    const price = (term, units) => serviceOptionTotalCents({
      option: lot, service: "carParking", term, units,
    });
    assert.equal(price("daily", 3), 3000);
    assert.equal(price("weekly", 2), 12000);
    assert.equal(price("monthly", 1), 20000);
  });

  it("cannot price a service that is quoted after the fact", () => {
    // Car transport is bid on, and a car's price is on the listing, not the
    // business. Both must sink rather than pretend to be free.
    for (const service of ["carTransport", "carSales"]) {
      assert.equal(
          serviceOptionTotalCents({option: option("a"), service}),
          UNKNOWN_SORT_VALUE,
          service,
      );
    }
  });

  it("gives barrels their own delivery estimate, shared or solo", () => {
    const row = {
      businessId: "a",
      country: {
        barrelShippingDeliveryEstimateMinDays: 10,
        barrelShippingDeliveryEstimateMaxDays: 20,
      },
    };
    assert.equal(serviceOptionDays(row, "barrelShipping"), 10);
    // A share rides in the same container as a solo barrel.
    assert.equal(serviceOptionDays(row, "sharedBarrels"), 10);
    // Freight reads its own estimate and finds nothing here.
    assert.equal(serviceOptionDays(row, "freight", "air"), UNKNOWN_SORT_VALUE);
  });
});

describe("ordering by rating", () => {
  const rated = (id, score) => ({businessId: id, reviewWeightedScore: score});

  it("puts the better-reviewed business first", () => {
    const sorted = sortServiceOptions({
      options: [rated("meh", 3.2), rated("great", 4.6), rated("ok", 3.9)],
      service: "carTransport",
      sort: "rated",
    });
    assert.deepEqual(ids(sorted), ["great", "ok", "meh"]);
  });

  it("treats an unrated business as average, not as terrible", () => {
    // The score is Bayesian-damped, so an unrated business sits at the prior.
    // Sinking it would punish every new business on the platform.
    const sorted = sortServiceOptions({
      options: [rated("poorly-rated", 2.1), rated("unrated", 3.8)],
      service: "carTransport",
      sort: "rated",
    });
    assert.deepEqual(ids(sorted), ["unrated", "poorly-rated"]);
  });

  it("treats a business with no review fields at all as average", () => {
    // The aggregate is only written when a review lands, so a business that
    // has never been reviewed has no reviewWeightedScore field rather than a
    // score of 3.8. Reading the absence as zero sank it below a business
    // rated 3.5 - caught on live data, not in this file.
    const sorted = sortServiceOptions({
      options: [
        {businessId: "rated-3.5", reviewWeightedScore: 3.74},
        {businessId: "never-reviewed"},
      ],
      service: "carTransport",
      sort: "rated",
    });
    assert.deepEqual(ids(sorted), ["never-reviewed", "rated-3.5"]);
  });
});
