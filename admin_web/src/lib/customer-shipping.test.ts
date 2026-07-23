import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildBarrelShipmentPayload,
  buildFreightSettlementPayload,
  buildFreightShipmentPayload,
  buildTransportRequestPayload,
  freightSettlementIsPayable,
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
