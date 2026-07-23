import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  barrelShippingEstimate,
  barrelDestinationCountries,
  barrelProvidersForCountry,
  buildBarrelShipmentPayload,
  buildFreightSettlementPayload,
  buildFreightShipmentPayload,
  buildTransportRequestPayload,
  freightShippingEstimate,
  freightSettlementIsPayable,
  pickupDetailsAreComplete,
  shippingProviderRate,
  shippingCountryDisplayName,
} from "./customer-shipping.ts";

const disclosure = {
  accepted: true,
  version: "marketplace-provider-responsibility-v1",
  locale: "en-US",
} as const;

test("barrel payload matches the mobile callable and omits pickup details when disabled", () => {
  assert.deepEqual(
    buildBarrelShipmentPayload(
      {
        senderName: " Sender ",
        receiverName: " Receiver ",
        receiverPhone: " +224620000000 ",
        destinationCountryId: "gn",
        businessId: "business-1",
        quantity: 2,
        pickup: {
          requested: false,
          address: "ignored",
          borough: "ignored",
        },
        useWalletBalance: true,
      },
      disclosure,
    ),
    {
      senderName: "Sender",
      receiverName: "Receiver",
      receiverPhone: "+224620000000",
      destinationCountryId: "gn",
      businessId: "business-1",
      quantity: 2,
      pickupRequested: false,
      useWalletBalance: true,
      marketplaceDisclosure: disclosure,
    },
  );
});

test("freight payload preserves the server-authoritative mode, weight, and pickup fields", () => {
  assert.deepEqual(
    buildFreightShipmentPayload(
      {
        senderName: "A",
        receiverName: "B",
        receiverPhone: "+12025550123",
        destinationCountryId: "sn",
        businessId: "business-2",
        mode: "sea",
        weightKg: 18.5,
        pickup: {
          requested: true,
          address: " 123 Main St ",
          borough: " Bronx ",
          dateTime: "2030-01-02T15:00:00.000Z",
        },
        useWalletBalance: false,
      },
      disclosure,
    ),
    {
      senderName: "A",
      receiverName: "B",
      receiverPhone: "+12025550123",
      destinationCountryId: "sn",
      businessId: "business-2",
      mode: "sea",
      weightKg: 18.5,
      pickupRequested: true,
      pickupAddress: "123 Main St",
      pickupBorough: "Bronx",
      pickupDateTime: "2030-01-02T15:00:00.000Z",
      useWalletBalance: false,
      marketplaceDisclosure: disclosure,
    },
  );
});

test("transport and settlement builders use the exact callable keys", () => {
  assert.deepEqual(
    buildTransportRequestPayload({
      businessId: "b1",
      destinationCountryId: "ci",
      destinationCountryName: "Côte d’Ivoire",
      ownerName: " Mariama ",
      carMake: "Toyota",
      carModel: "RAV4",
      carYear: "2022",
      customerPhone: "+16465550123",
      vinNumber: "",
      pickupAddress: "",
      notes: "",
      preferredDate: "2030-05-05T12:00:00.000Z",
    }),
    {
      businessId: "b1",
      destinationCountryId: "ci",
      destinationCountryName: "Côte d’Ivoire",
      ownerName: "Mariama",
      carMake: "Toyota",
      carModel: "RAV4",
      carYear: "2022",
      customerPhone: "+16465550123",
      vinNumber: "",
      pickupAddress: "",
      notes: "",
      preferredDate: "2030-05-05T12:00:00.000Z",
    },
  );
  assert.deepEqual(buildFreightSettlementPayload(" freight-1 ", disclosure), {
    shipmentId: "freight-1",
    marketplaceDisclosure: disclosure,
  });
});

test("only a positive verified freight balance is payable", () => {
  assert.equal(
    freightSettlementIsPayable({
      priceSettlementStatus: "balance_due",
      balanceDueCents: 2500,
    }),
    true,
  );
  assert.equal(
    freightSettlementIsPayable({
      priceSettlementStatus: "awaiting_weight",
      balanceDueCents: 2500,
    }),
    false,
  );
  assert.equal(
    freightSettlementIsPayable({
      priceSettlementStatus: "balance_due",
      balanceDueCents: 0,
    }),
    false,
  );
});

test("selected barrel providers expose their own rate and quantity estimate", () => {
  const first = {
    barrelShippingPrice: 125,
    serviceAvailability: { barrelShipping: true },
  };
  const second = {
    barrelShippingPrice: 175,
    serviceAvailability: { barrelShipping: true },
  };

  assert.deepEqual(barrelShippingEstimate(first, 2), {
    rate: 125,
    quantity: 2,
    subtotal: 250,
  });
  assert.deepEqual(barrelShippingEstimate(second, 2), {
    rate: 175,
    quantity: 2,
    subtotal: 350,
  });
  assert.equal(
    shippingProviderRate(
      {
        barrelShippingPrice: 125,
        serviceAvailability: { barrelShipping: false },
      },
      "barrel",
    ),
    null,
  );
});

test("barrel flow presents unique countries before providers for that country", () => {
  const options = [
    {
      id: "gn-b",
      businessId: "b",
      businessName: "Zulu Shipping",
      country: {
        id: "gn",
        code: "GN",
        name: "Guinea",
        barrelShippingPrice: 80,
      },
    },
    {
      id: "sl-a",
      businessId: "a",
      businessName: "Sierra Cargo",
      country: {
        id: "sl",
        code: "SL",
        name: "Sierra Leone",
        barrelShippingPrice: 95,
      },
    },
    {
      id: "gn-a",
      businessId: "a",
      businessName: "Alpha Cargo",
      country: {
        id: "gn",
        code: "GN",
        name: "Guinea",
        barrelShippingPrice: 75,
      },
    },
    {
      id: "gm-freight",
      businessId: "freight",
      businessName: "Freight only",
      country: {
        id: "gm",
        code: "GM",
        name: "Gambia",
        barrelShippingPrice: 0,
        freightAirPricePerKg: 5,
      },
    },
  ];

  assert.deepEqual(
    barrelDestinationCountries(options).map((country) => country.id),
    ["gn", "sl"],
  );
  assert.deepEqual(
    barrelProvidersForCountry(options, "gn").map(
      (option) => option.businessName,
    ),
    ["Alpha Cargo", "Zulu Shipping"],
  );
});

test("pickup details require a recognized NYC borough and a future appointment", () => {
  const now = new Date("2030-01-01T12:00:00.000Z").getTime();
  assert.equal(
    pickupDetailsAreComplete(
      {
        requested: true,
        address: "123 Grand Concourse, Bronx, NY",
        borough: "Bronx",
        dateTime: "2030-01-02T12:00:00.000Z",
      },
      now,
    ),
    true,
  );
  assert.equal(
    pickupDetailsAreComplete(
      {
        requested: true,
        address: "123 Main St",
        borough: "Albany",
        dateTime: "2030-01-02T12:00:00.000Z",
      },
      now,
    ),
    false,
  );
  assert.equal(
    pickupDetailsAreComplete(
      {
        requested: true,
        address: "123 Main St",
        borough: "Queens",
        dateTime: "2029-12-31T12:00:00.000Z",
      },
      now,
    ),
    false,
  );
});

test("shipping countries render from their ISO code in both languages", () => {
  assert.equal(
    shippingCountryDisplayName({ code: "GN", name: "Guinea" }, "en"),
    "Guinea",
  );
  assert.equal(
    shippingCountryDisplayName({ code: "GN", name: "Guinea" }, "fr"),
    "Guinée",
  );
  assert.equal(
    shippingCountryDisplayName({ name: "Legacy destination" }, "fr"),
    "Legacy destination",
  );
});

test("selected freight providers expose mode-specific rates and estimates", () => {
  const country = {
    freightAirPricePerKg: 8.5,
    freightSeaPricePerKg: 3.25,
    serviceAvailability: { freightAir: true, freightSea: true },
  };

  assert.deepEqual(
    freightShippingEstimate({
      country,
      mode: "air",
      pickupRequested: false,
      weightKg: 10,
    }),
    {
      rate: 8.5,
      weightKg: 10,
      subtotal: 85,
      pickupFee: 0,
      pickupPending: false,
      total: 85,
    },
  );
  assert.deepEqual(
    freightShippingEstimate({
      country,
      mode: "sea",
      pickupQuote: 20,
      pickupRequested: true,
      weightKg: 10,
    }),
    {
      rate: 3.25,
      weightKg: 10,
      subtotal: 32.5,
      pickupFee: 20,
      pickupPending: false,
      total: 52.5,
    },
  );
});

test("shipping estimates never present unavailable or pending prices as zero", () => {
  assert.equal(
    shippingProviderRate({ freightAirPricePerKg: 0 }, "freight", "air"),
    null,
  );
  assert.equal(
    shippingProviderRate(
      {
        freightSeaPricePerKg: Number.POSITIVE_INFINITY,
      },
      "freight",
      "sea",
    ),
    null,
  );
  assert.equal(barrelShippingEstimate({ barrelShippingPrice: -5 }, 1), null);
  assert.equal(
    freightShippingEstimate({
      country: { freightAirPricePerKg: 7 },
      mode: "air",
      pickupRequested: false,
      weightKg: Number.NaN,
    }),
    null,
  );
  assert.deepEqual(
    freightShippingEstimate({
      country: { freightAirPricePerKg: 7 },
      mode: "air",
      pickupRequested: true,
      weightKg: 2,
    }),
    {
      rate: 7,
      weightKg: 2,
      subtotal: 14,
      pickupFee: null,
      pickupPending: true,
      total: null,
    },
  );
});

test("shipping UI uses the canonical server option, quote, request, and checkout rails", () => {
  const source = readFileSync(
    new URL("../components/customer-shipping-services.tsx", import.meta.url),
    "utf8",
  );
  [
    "listActiveBarrelDestinationOptions",
    "suggestPickupAddresses",
    "quoteFreightPickup",
    "listTransportBusinessOptions",
    "createTransportRequest",
  ].forEach((callable) => assert.match(source, new RegExp(`"${callable}"`)));
  assert.match(source, /startCheckout\(\s*"barrelShipment"/);
  assert.match(source, /startCheckout\(\s*"freightShipment"/);
  assert.match(source, /startCheckout\(\s*"freightSettlement"/);
  assert.match(source, /<DestinationPicker/);
  assert.match(source, /<ShippingPriceSummary/);
  assert.match(source, /Price provided after review/);
  assert.doesNotMatch(source, /unit_amount|price_data|estimatedTotal:/);
});

test("one unavailable shipping service does not hide the other service options", () => {
  const source = readFileSync(
    new URL("../components/customer-shipping-services.tsx", import.meta.url),
    "utf8",
  );
  assert.doesNotMatch(
    source,
    /Promise\.all\(\s*\[\s*callFunction<[\s\S]*listActiveBarrelDestinationOptions[\s\S]*listTransportBusinessOptions/,
  );
  assert.match(source, /async function loadDestinationOptions\(\)/);
  assert.match(source, /async function loadTransportOptions\(\)/);
  assert.match(source, /setDestinationOptionsError\(/);
  assert.match(source, /setTransportOptionsError\(/);
  assert.match(source, /actionLabel="Retry"/);
});

test("barrel UI reveals personal details only after country and provider selection", () => {
  const source = readFileSync(
    new URL("../components/customer-shipping-services.tsx", import.meta.url),
    "utf8",
  );
  const countryStage = source.indexOf("Where are you sending the barrel?");
  const providerStage = source.indexOf("Approved businesses shipping to");
  const detailsStage = source.indexOf("Tell us who is sending and receiving.");
  const senderField = source.indexOf("Sender name", detailsStage);

  assert.ok(countryStage > 0);
  assert.ok(providerStage > countryStage);
  assert.ok(detailsStage > providerStage);
  assert.ok(senderField > detailsStage);
  assert.match(
    source,
    /\{selectedCountry && \([\s\S]*\{destination && \(/,
  );
  assert.match(source, /type="radio"/);
  assert.match(source, /initialCountryCode=\{selectedCountry\?\.code \|\| "US"\}/);
  assert.match(source, /This receiver uses a WhatsApp number from another country/);
});
