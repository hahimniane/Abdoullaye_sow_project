import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_SERVICE_SORT,
  MIN_OPTIONS_FOR_SORT,
  SERVICE_SORTS_BY_SERVICE,
  UNKNOWN_SORT_VALUE,
  defaultSortForService,
  serviceOptionDays,
  serviceOptionTotal,
  shouldOfferServiceSort,
  sortServiceOptions,
  sortsForService,
  type RankableServiceOption,
  type ServiceSortInputs,
} from "./service-ranking.ts";

/**
 * A business option shaped like the one listActiveBarrelDestinationOptions
 * sends. The catalogue is what decides a freight price now: a set price
 * stands on its own, and everything else is the route rate times the weight.
 */
const BY_WEIGHT_TABLE = {
  general: {items: [], otherPricingMode: "per_kg"},
};

function option(
  businessId: string,
  {
    airRate = 10,
    airDays,
    airMaxDays,
    coversLoss = false,
    paybackTable = BY_WEIGHT_TABLE,
  }: {
    airRate?: number;
    airDays?: number;
    airMaxDays?: number;
    coversLoss?: boolean;
    paybackTable?: unknown;
  } = {},
): RankableServiceOption & { businessId: string } {
  return {
    businessId,
    freightPaybackTable: paybackTable,
    freightCoverage: { coversLoss },
    country: {
      freightAirPricePerKg: airRate,
      // The delivery estimate, not freightAirDepartureDays - that field holds
      // weekday names for when shipments leave, not a number of days.
      freightAirDeliveryEstimateMinDays: airDays,
      freightAirDeliveryEstimateMaxDays: airMaxDays,
    },
  };
}

const air: ServiceSortInputs = {
  service: "freight",
  mode: "air",
  weightKg: 1,
  itemCategoryId: "general",
};
const ids = (rows: { businessId: string }[]) =>
  rows.map((row) => row.businessId);

test("ranks on the real quote, not the headline rate", () => {
  // A business cheaper per kilo can be dearer for the thing the customer
  // actually picked: a published set price ignores the rate entirely, so
  // ranking on the rate alone would name the wrong winner.
  const inputs = {
    ...air,
    weightKg: 5,
    itemCategoryId: "electronics",
    itemId: "iphone",
  };
  const cheapPerKg = option("cheap-per-kg", {
    airRate: 10,
    paybackTable: {
      electronics: {
        items: [
          {id: "iphone", label: "iPhone",
            pricingMode: "flat", flatPrice: 150},
        ],
      },
    },
  });
  const dearPerKg = option("dear-per-kg", {
    airRate: 12,
    paybackTable: {
      electronics: {
        items: [
          {id: "iphone", label: "iPhone",
            pricingMode: "per_kg"},
        ],
      },
    },
  });
  // A business that has never priced this has no number to be ordered by,
  // and sinks rather than tying with the cheapest.
  const unpriced = option("unpriced", {
    airRate: 1,
    paybackTable: {
      electronics: {
        items: [{id: "iphone", label: "iPhone"}],
      },
    },
  });

  assert.equal(serviceOptionTotal(cheapPerKg, inputs), 150);
  assert.equal(serviceOptionTotal(dearPerKg, inputs), 60);
  assert.equal(serviceOptionTotal(unpriced, inputs), UNKNOWN_SORT_VALUE);
  assert.deepEqual(
    ids(sortServiceOptions([cheapPerKg, dearPerKg, unpriced], inputs)),
    ["dear-per-kg", "cheap-per-kg", "unpriced"],
  );
});

test("cover never touches the price a business is ranked on", () => {
  // The business that stands behind the parcel must not sort as the dearer
  // one: cover is free, and the risk is already inside its per-kg rate.
  const withCover = option("covers", { airRate: 10, coversLoss: true });
  const without = option("bare", { airRate: 10 });
  assert.equal(serviceOptionTotal(withCover, air), 10);
  assert.equal(serviceOptionTotal(without, air), 10);
});

test("reads the delivery estimate, not the departure weekdays", () => {
  const wrongField = option("wrong-field");
  (wrongField.country as Record<string, unknown>).freightAirDepartureDays = [
    "monday",
    "thursday",
  ];
  assert.equal(serviceOptionDays(wrongField, "freight", "air"), UNKNOWN_SORT_VALUE);
  assert.equal(serviceOptionDays(option("x", { airDays: 8 }), "freight", "air"), 8);
});

test("sinks businesses that never stated a delivery time", () => {
  const sorted = sortServiceOptions(
    [option("silent"), option("slow", { airDays: 20 }),
      option("quick", { airDays: 4 })],
    { ...air, sort: "fastest" },
  );
  assert.deepEqual(ids(sorted), ["quick", "slow", "silent"]);
});

test("separates two businesses sharing a lower bound by the upper one", () => {
  const sorted = sortServiceOptions(
    [
      option("wide", { airDays: 2, airMaxDays: 15 }),
      option("tight", { airDays: 2, airMaxDays: 3 }),
    ],
    { ...air, sort: "fastest" },
  );
  assert.deepEqual(ids(sorted), ["tight", "wide"]);
});

test("best cover puts the business that stands behind the parcel first", () => {
  // Deliberately ranks the dearer business first: this sort is about who
  // stands behind the parcel, and the price is on the card either way.
  const sorted = sortServiceOptions(
    [
      option("bare", { airRate: 5 }),
      option("covers", { airRate: 30, coversLoss: true }),
    ],
    { ...air, sort: "coverage" },
  );
  assert.deepEqual(ids(sorted), ["covers", "bare"]);
});

test("cover is one comparison, and price breaks the tie beneath it", () => {
  // There is nothing left to grade a covering business by: cover is a yes or
  // a no, with no figure to rank one yes above another. So the sort falls
  // through to the tiebreakers it always had.
  const sorted = sortServiceOptions(
    [
      option("dear-cover", { airRate: 40, coversLoss: true }),
      option("bare", { airRate: 1 }),
      option("cheap-cover", { airRate: 5, coversLoss: true }),
    ],
    { ...air, sort: "coverage" },
  );
  assert.deepEqual(ids(sorted), ["cheap-cover", "dear-cover", "bare"]);
});

test("gives the same order every time when everything ties", () => {
  // Ties are the norm at this size. A list that reshuffles between loads
  // reads as broken.
  const rows = [option("ccc"), option("aaa"), option("bbb")];
  const first = ids(sortServiceOptions(rows, air));
  const second = ids(sortServiceOptions([...rows].reverse(), air));
  assert.deepEqual(first, second);
  assert.deepEqual(first, ["aaa", "bbb", "ccc"]);
});

test("never mutates the array it was handed", () => {
  const rows = [option("b"), option("a")];
  sortServiceOptions(rows, air);
  assert.deepEqual(ids(rows), ["b", "a"]);
});

test("falls back to the default sort for anything unrecognised", () => {
  const rows = [option("dear", { airRate: 30 }), option("cheap", { airRate: 5 })];
  for (const sort of [undefined, "", "popularity"]) {
    assert.deepEqual(
      ids(sortServiceOptions(rows, { ...air, sort })),
      ["cheap", "dear"],
      String(sort),
    );
  }
  assert.equal(DEFAULT_SERVICE_SORT, "cheapest");
});

test("hides the control until there is enough to order", () => {
  // A sort control over one result advertises a choice that does not exist.
  // Every route had exactly one freight business when this was written.
  assert.equal(shouldOfferServiceSort([], "freight"), false);
  assert.equal(shouldOfferServiceSort([option("a"), option("b")], "freight"), false);
  assert.equal(
    shouldOfferServiceSort(
      Array.from({ length: MIN_OPTIONS_FOR_SORT }, (_, i) => option(`b${i}`)),
      "freight",
    ),
    true,
  );
});

test("only offers cover where a loss policy exists", () => {
  // freightCoverageEnabled is the platform's one loss policy. Offering
  // "best cover" on barrels would rank every business identically.
  for (const service of ["barrelShipping", "sharedBarrels", "carParking"]) {
    assert.equal(sortsForService(service).includes("coverage"), false, service);
  }
  assert.equal(sortsForService("freight").includes("coverage"), true);
});

test("offers rating everywhere, because every business carries one", () => {
  for (const service of Object.keys(SERVICE_SORTS_BY_SERVICE)) {
    assert.equal(sortsForService(service).includes("rated"), true, service);
  }
});

test("starts a service on a sort it can actually answer", () => {
  assert.equal(defaultSortForService("freight"), "cheapest");
  // No price before the bid, so cheapest is not on offer and must not be the
  // starting order either.
  assert.equal(defaultSortForService("carTransport"), "rated");
  assert.equal(defaultSortForService("teleportation"), "");
});

test("hides the control for a service with only one way to order it", () => {
  const enough = Array.from({ length: MIN_OPTIONS_FOR_SORT }, (_, i) =>
    option(`b${i}`),
  );
  assert.equal(shouldOfferServiceSort(enough, "carTransport"), false);
  assert.equal(shouldOfferServiceSort(enough, "carSales"), false);
  assert.equal(shouldOfferServiceSort(enough, "teleportation"), false);
});

test("prices barrels per barrel, times how many", () => {
  const barrel = { businessId: "a", country: { barrelShippingPrice: 120 } };
  assert.equal(
    serviceOptionTotal(barrel, { service: "barrelShipping", quantity: 3 }),
    360,
  );
  // The picker sits above the quantity field; one barrel each is still a fair
  // comparison, and zero would price everything the same.
  assert.equal(serviceOptionTotal(barrel, { service: "barrelShipping" }), 120);
});

test("prices parking on the term the customer chose", () => {
  const lot = {
    businessId: "lot",
    dailyRate: 10,
    weeklyRate: 60,
    monthlyRate: 200,
  };
  const price = (term: "daily" | "weekly" | "monthly", units: number) =>
    serviceOptionTotal(lot, { service: "carParking", term, units });
  assert.equal(price("daily", 3), 30);
  // The search's own total wins when it has one: it already accounts for the
  // minimum stay and whichever rate applies.
  assert.equal(
    serviceOptionTotal(
      { ...lot, estimatedTotal: 27 },
      { service: "carParking", term: "daily", units: 3 },
    ),
    27,
  );
  assert.equal(price("weekly", 2), 120);
  assert.equal(price("monthly", 1), 200);
});

test("cannot price a service that is quoted after the fact", () => {
  // Car transport is bid on, and a car's price is on the listing, not the
  // business. Both must sink rather than pretend to be free.
  for (const service of ["carTransport", "carSales"]) {
    assert.equal(
      serviceOptionTotal(option("a"), { service }),
      UNKNOWN_SORT_VALUE,
      service,
    );
  }
});

test("gives barrels their own delivery estimate, shared or solo", () => {
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

test("orders by rating, treating unrated as average not terrible", () => {
  // The score is Bayesian-damped, so an unrated business sits at the prior.
  // Sinking it would punish every new business on the platform.
  const rated = (businessId: string, reviewWeightedScore: number) => ({
    businessId,
    reviewWeightedScore,
  });
  const sorted = sortServiceOptions(
    [rated("poorly-rated", 2.1), rated("unrated", 3.8), rated("great", 4.6)],
    { service: "carTransport", sort: "rated" },
  );
  assert.deepEqual(
    sorted.map((row) => row.businessId),
    ["great", "unrated", "poorly-rated"],
  );
});

test("treats a business with no review fields at all as average", () => {
  // The aggregate is only written when a review lands, so a business that has
  // never been reviewed has no reviewWeightedScore field rather than a score
  // of 3.8. Reading the absence as zero sank it below a business rated 3.5 -
  // caught on live data, not in this file.
  const sorted = sortServiceOptions(
    [
      { businessId: "rated-3.5", reviewWeightedScore: 3.74 },
      { businessId: "never-reviewed" },
    ],
    { service: "carTransport", sort: "rated" },
  );
  assert.deepEqual(
    sorted.map((row) => row.businessId),
    ["never-reviewed", "rated-3.5"],
  );
});
