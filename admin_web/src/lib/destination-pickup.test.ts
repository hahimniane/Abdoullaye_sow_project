import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  PICKUP_LIMITS,
  destinationPickupChanged,
  destinationPickupDraft,
  destinationPickupErrors,
  destinationPickupPayload,
  destinationPickupSummary,
  e164Phone,
} from "./destination-pickup.ts";
import { TEXT_TRANSLATIONS } from "./french-dom.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("the pickup phone must carry its country code", () => {
  assert.equal(e164Phone("+224 620 00 00 00"), "+224620000000");
  assert.equal(e164Phone("620000000"), "");
  assert.deepEqual(destinationPickupErrors({ pickupCity: "", pickupAddress: "", pickupPhone: "620000000" }), {
    pickupPhone: "The pickup phone needs its country code, like +224 620 00 00 00.",
  });
  assert.deepEqual(destinationPickupErrors({ pickupCity: "", pickupAddress: "", pickupPhone: "" }), {});
});

test("the city and address have the server's limits", () => {
  const errors = destinationPickupErrors({
    pickupCity: "x".repeat(PICKUP_LIMITS.pickupCity + 1),
    pickupAddress: "y".repeat(PICKUP_LIMITS.pickupAddress + 1),
    pickupPhone: "",
  });
  assert.ok(errors.pickupCity && errors.pickupAddress);
  const server = read("../../../my_flutter_app/functions/destination_pickup.js");
  assert.match(server, new RegExp(`pickupCity: ${PICKUP_LIMITS.pickupCity},`));
  assert.match(server, new RegExp(`pickupAddress: ${PICKUP_LIMITS.pickupAddress},`));
  assert.match(server, /const E164 = \/\^\\\+\[1-9\]\\d\{7,14\}\$\/;/);
  // The console says what the server would say.
  for (const message of Object.values(errors)) {
    assert.ok(server.includes(message.split(" at most")[0]), message);
  }
});

test("only a change calls the server, and blanks clear", () => {
  const row = { pickupCity: "Conakry", pickupAddress: "Madina", pickupPhone: "+224620000000" };
  assert.deepEqual(destinationPickupDraft(row), row);
  assert.equal(destinationPickupChanged(row, destinationPickupDraft(row)), false);
  assert.equal(destinationPickupChanged(row, { ...row, pickupPhone: "+224 620 00 00 00" }), false);
  assert.equal(destinationPickupChanged(row, { ...row, pickupAddress: "" }), true);
  assert.equal(destinationPickupChanged({}, { pickupCity: "", pickupAddress: " ", pickupPhone: "" }), false);
  assert.deepEqual(destinationPickupPayload({ pickupCity: " Conakry ", pickupAddress: "Madina\n near", pickupPhone: "+224 620 00 00 00" }), {
    pickupCity: "Conakry",
    pickupAddress: "Madina near",
    pickupPhone: "+224620000000",
  });
  assert.equal(destinationPickupSummary(row), "Conakry · Madina · +224620000000");
  assert.equal(destinationPickupSummary({}), "");
});

test("the destination form saves pickup through the callable, with the shared phone picker", () => {
  const panel = read("../components/business/operations-panels.tsx");
  assert.match(panel, /httpsCallable\(functions, "setDestinationPickup"\)\(\{\s*businessId,\s*countryId: country\.id,\s*\.\.\.destinationPickupPayload\(pickupDraft\),?\s*\}\)/);
  assert.match(panel, /<CustomerPhoneField[\s\S]{0,200}id="destination-pickup-phone"/);
  // The coverage write never carries the pickup fields: only the callable
  // writes them.
  const save = panel.slice(panel.indexOf("async function saveDestination()"), panel.indexOf("async function toggleMainDestination("));
  assert.doesNotMatch(save.slice(0, save.indexOf("setDestinationPickup")), /pickupCity:|pickupAddress:|pickupPhone:/);
  // Typed values are user data.
  assert.match(panel, /<span data-no-translate>\{destinationPickupSummary\(row\)\}<\/span>/);
});

test("every pickup string the console shows has French", () => {
  for (const english of [
    "Pickup in this country",
    "Where customers collect their goods. The ready-for-pickup WhatsApp message gives these. Leave them blank to use your business address and phone.",
    "Pickup city (optional)",
    "Pickup address (optional)",
    "Pickup phone (optional)",
    "e.g. Conakry",
    "e.g. Madina, near the market",
    "The pickup city can be at most 80 characters.",
    "The pickup address can be at most 200 characters.",
    "The pickup phone needs its country code, like +224 620 00 00 00.",
  ]) {
    assert.ok(TEXT_TRANSLATIONS[english], english);
  }
});
