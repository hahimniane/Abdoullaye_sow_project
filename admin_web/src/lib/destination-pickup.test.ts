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
  destinationsMissingPickup,
  e164Phone,
  missingPickupFields,
  pickupAskErrors,
  pickupAskFor,
  PICKUP_ATTENTION_LABEL,
} from "./destination-pickup.ts";
import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS } from "./french-dom.ts";

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
    "Where customers collect their goods. The ready-for-pickup WhatsApp message gives these. Without them, customers are told to ask at your business phone number.",
    "Pickup city (optional)",
    "Pickup address (optional)",
    "Pickup phone (optional)",
    "e.g. Conakry",
    "e.g. Madina, near the market",
    "The pickup city can be at most 80 characters.",
    "The pickup address can be at most 200 characters.",
    "The pickup phone needs its country code, like +224 620 00 00 00.",
    // Asked when a container is marked ready for pickup.
    "Where do customers pick up?",
    "The WhatsApp message tells customers where to collect and which number to call. This destination has no pickup place yet:",
    "Pickup address",
    "Pickup phone",
    "Saved for every package going to this destination. You can change it in Destinations.",
    "Send without it",
    "Save and mark ready",
    "Saving...",
    "Marked ready for pickup.",
    "Add the pickup address.",
    "Add the pickup phone.",
    // Said on Today and in the destination list.
    PICKUP_ATTENTION_LABEL,
    "No pickup place yet",
    "No pickup phone yet",
    "No pickup address yet",
  ]) {
    assert.ok(TEXT_TRANSLATIONS[english], english);
  }
  assert.ok(ATTRIBUTE_TRANSLATIONS["Customers are told to ask at your business phone number."]);
});

// The owner (2026-11-10): "We need to ask the business to provide numbers and
// location for drop off so that the messages sent on WhatsApp is correct."
// A ready-for-pickup message to Guinea gave the business's New York address.

test("a destination is missing its pickup place until it has an address and a phone", () => {
  assert.deepEqual(missingPickupFields({}), ["pickupAddress", "pickupPhone"]);
  assert.deepEqual(missingPickupFields(null), ["pickupAddress", "pickupPhone"]);
  assert.deepEqual(missingPickupFields({ pickupAddress: "Madina" }), ["pickupPhone"]);
  assert.deepEqual(missingPickupFields({ pickupPhone: "+224620000000" }), ["pickupAddress"]);
  // A phone with no country code cannot be sent: still missing.
  assert.deepEqual(missingPickupFields({ pickupAddress: "Madina", pickupPhone: "620000000" }), ["pickupPhone"]);
  // The city is optional.
  assert.deepEqual(missingPickupFields({ pickupAddress: "Madina", pickupPhone: "+224620000000" }), []);
  // The server names the same two fields.
  const server = read("../../../my_flutter_app/functions/destination_pickup.js");
  assert.match(server, /function missingPickupFields\(/);
});

test("the question is asked only for the container's own destination, when it lacks a place", () => {
  const guinea = { id: "guinea", countryName: "Guinea" };
  const senegal = { id: "senegal", pickupAddress: "Plateau", pickupPhone: "+221770000000" };
  const rows = [guinea, senegal];
  assert.equal(pickupAskFor({ destinationCountryId: "guinea" }, rows), guinea);
  assert.equal(pickupAskFor({ destinationCountryId: "senegal" }, rows), null);
  // No destination on the container, or one the business no longer lists:
  // nothing to save against, so nothing is asked.
  assert.equal(pickupAskFor({}, rows), null);
  assert.equal(pickupAskFor({ destinationCountryId: "mali" }, rows), null);
  assert.equal(pickupAskFor(null, rows), null);
});

test("saving from the question needs both the address and the phone", () => {
  assert.deepEqual(pickupAskErrors({ pickupCity: "", pickupAddress: "", pickupPhone: "" }), {
    pickupAddress: "Add the pickup address.",
    pickupPhone: "Add the pickup phone.",
  });
  assert.deepEqual(pickupAskErrors({ pickupCity: "", pickupAddress: "Madina", pickupPhone: "+224 620 00 00 00" }), {});
  // A phone with no country code keeps the message that says how to fix it.
  assert.equal(
    pickupAskErrors({ pickupCity: "", pickupAddress: "Madina", pickupPhone: "620000000" }).pickupPhone,
    "The pickup phone needs its country code, like +224 620 00 00 00.",
  );
});

test("Today counts the active destinations with no pickup place", () => {
  assert.equal(destinationsMissingPickup([]), 0);
  assert.equal(
    destinationsMissingPickup([
      { id: "guinea" },
      { id: "mali", pickupAddress: "Bamako" },
      { id: "senegal", pickupAddress: "Plateau", pickupPhone: "+221770000000" },
      // Switched off: the business no longer ships there.
      { id: "gambia", isActive: false },
    ]),
    2,
  );
});

test("marking a container ready asks for the pickup place first, and saves it through the callable", () => {
  const panel = read("../components/business/containers-panel.tsx");
  // Asked only on the way to "arrived", only when the destination lacks one.
  assert.match(panel, /const pickupDestination = next === "arrived" \? pickupAskFor\(row, destinations\.rows\) : null;/);
  assert.match(panel, /if \(pickupDestination\) \{[\s\S]{0,260}setModal\("pickup"\);\s*return;/);
  const mark = panel.slice(panel.indexOf("async function markReadyForPickup("));
  // The place is saved before the status changes, so the message carries it.
  const save = mark.indexOf('httpsCallable(functions, "setDestinationPickup")');
  const status = mark.indexOf('httpsCallable(functions, "setContainerStatus")');
  assert.ok(save > 0 && status > save);
  assert.match(mark, /if \(savePlace\) \{?\s*await httpsCallable\(functions, "setDestinationPickup"\)\(\{\s*businessId,\s*countryId: text\(row\.destinationCountryId, ""\),\s*\.\.\.destinationPickupPayload\(pickupDraft\),?\s*\}\);/);
  // A refusal is said inside the dialog, which stays open.
  assert.match(mark.slice(0, mark.indexOf("\n  }\n")), /failInModal/);
  // The staff can still send without it, and the destination name is user data.
  assert.match(panel, /onClick=\{\(\) => void markReadyForPickup\(false\)\}/);
  assert.match(panel, /onClick=\{\(\) => void markReadyForPickup\(true\)\}/);
  assert.match(panel, /<strong data-no-translate>\{destinationLabel\(pickupContainer\)\}<\/strong>/);
  assert.match(panel, /<CustomerPhoneField[\s\S]{0,200}id="container-pickup-phone"/);
});

test("Today tells the owner, and the destination list marks the ones with no place", () => {
  const consoleSource = read("../components/business-console.tsx");
  // Read only on Today, only for the owner (Destinations is the owner's page).
  assert.match(consoleSource, /useBusinessDestinations\(\s*businessId,\s*onToday && profile\.role === "businessOwner" && canOpenContainerLists,\s*\)/);
  assert.match(consoleSource, /destinationsMissingPickup\(pickupDestinations\.rows\)/);
  assert.match(consoleSource, /key: "pickupPlaces",\s*label: PICKUP_ATTENTION_LABEL,\s*count: pickupPlacesMissing,\s*amountCents: null,\s*tab: "destinations",/);
  const list = read("../components/business/operations-panels.tsx");
  assert.match(list, /row\.isActive !== false && missingPickupFields\(row\)\.length > 0 && \(\s*<small className="destination-pickup-line missing">/);
});
