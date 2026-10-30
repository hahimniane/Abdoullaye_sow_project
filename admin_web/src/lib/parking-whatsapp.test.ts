// Parking customers on WhatsApp, console side (docs/PARKING_WHATSAPP.md §3):
// the pure helpers and the wiring of the switch, the welcome modal and a
// car's message list. The Track page's block is in guest-tracking-parking.test.ts.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import {
  PARKING_MESSAGE_KIND_LABEL,
  PARKING_MESSAGE_STATE_LABEL,
  PARKING_WHATSAPP_COPY,
  PARKING_WHATSAPP_REFUSALS,
  defaultWelcomeSelection,
  parkingMessageLine,
  parkingMessageLines,
  parkingWhatsAppEnabled,
  parkingWhatsAppEverEnabled,
  parkingWhatsAppRefusalText,
  parseWelcomePreview,
  parseWelcomeResult,
  selectAllWelcome,
  setParkingWhatsAppRequest,
  toggleWelcomePhone,
  welcomePreviewRequest,
  welcomeResultText,
  welcomeSelectionText,
  welcomeSendRequest,
  welcomeSendText,
} from "./parking-whatsapp.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const component = read("../components/business/parking-whatsapp.tsx");
const panels = read("../components/business/operations-panels.tsx");
const profile = read("../components/business/profile-support-people.tsx");
const consoleSource = read("../components/business-console.tsx");

// ---------------------------------------------------------------------------
// The switch
// ---------------------------------------------------------------------------

test("the switch is off unless the business says it is on", () => {
  assert.equal(parkingWhatsAppEnabled(null), false);
  assert.equal(parkingWhatsAppEnabled({}), false);
  assert.equal(parkingWhatsAppEnabled({ parkingWhatsApp: { enabled: false } }), false);
  assert.equal(parkingWhatsAppEnabled({ parkingWhatsApp: { enabled: "yes" } }), false);
  assert.equal(parkingWhatsAppEnabled({ parkingWhatsApp: { enabled: true, enabledAtMs: 1 } }), true);
  // A switch that was on once keeps the car's message list worth showing.
  assert.equal(parkingWhatsAppEverEnabled({ parkingWhatsApp: { enabled: false, enabledAtMs: 1_790_000_000_000 } }), true);
  assert.equal(parkingWhatsAppEverEnabled({}), false);
});

test("the switch request is the contract's, and a refusal reads in words", () => {
  assert.deepEqual(setParkingWhatsAppRequest("biz1", true), { businessId: "biz1", action: "set_parking_whatsapp", enabled: true });
  assert.deepEqual(setParkingWhatsAppRequest("biz1", false), { businessId: "biz1", action: "set_parking_whatsapp", enabled: false });
  for (const reason of ["parking_whatsapp_off", "welcome_owner_only", "parking_whatsapp_owner_only"]) {
    const text = parkingWhatsAppRefusalText({ code: "functions/failed-precondition", details: { reason } });
    assert.equal(text, PARKING_WHATSAPP_REFUSALS[reason]);
    assert.doesNotMatch(text, /_/, "never the raw reason");
  }
  assert.equal(parkingWhatsAppRefusalText({ code: "functions/permission-denied" }), PARKING_WHATSAPP_REFUSALS.parking_whatsapp_owner_only);
  assert.equal(parkingWhatsAppRefusalText(new Error("INTERNAL: boom")), PARKING_WHATSAPP_REFUSALS.unknown);
  assert.equal(parkingWhatsAppRefusalText(undefined), PARKING_WHATSAPP_REFUSALS.unknown);
});

test("the switch sits with the parking settings, saves on its own, and is the owner's", () => {
  // In the parking settings article, after the reservations choice.
  assert.ok(profile.indexOf("Accept online reservations from customers") < profile.indexOf("<ParkingWhatsAppSwitch"));
  assert.match(profile, /<ParkingWhatsAppSwitch\s+businessId=\{businessId\}\s+business=\{business\}\s+canChange=\{canSetParkingWhatsApp\}/);
  // Owner or platform admin, never in a preview.
  assert.match(consoleSource, /canSetParkingWhatsApp=\{\s*\(profile\.role === "businessOwner" \|\| profile\.role === "admin"\) && !previewMode/);
  // Its own callable, not the services form's draft.
  assert.match(component, /updateBusinessParkingEntry/);
  assert.match(component, /setParkingWhatsAppRequest\(businessId, next\)/);
  assert.match(component, /disabled=\{!canChange \|\| busy \|\| !businessId\}/);
  assert.match(component, /checked=\{enabled\}/);
  assert.match(component, /parkingWhatsAppEnabled\(business\)/);
  assert.match(PARKING_WHATSAPP_COPY.switchTitle, /^Send WhatsApp messages to parking customers$/);
});

// ---------------------------------------------------------------------------
// The welcome to current customers
// ---------------------------------------------------------------------------

const PREVIEW = {
  recipients: [
    { phone: "+12075550101", name: "Awa Diallo", cars: [{ id: "c1", label: "2014 Toyota Corolla", trackingCode: "PK-1" }, { id: "c2", label: "2016 RAV4", trackingCode: "PK-2" }], alreadyWelcomed: false },
    { phone: "+12075550102", name: "Moussa", cars: [{ id: "c3", label: "2019 Honda Civic", trackingCode: "PK-3" }], alreadyWelcomed: true },
    { phone: "+12075550101", name: "A duplicate number", cars: [], alreadyWelcomed: false },
    { name: "No phone", cars: [] },
    "not a row",
  ],
};

test("the preview lists each number once with its cars, and only those not yet welcomed are ticked", () => {
  const list = parseWelcomePreview(PREVIEW);
  assert.deepEqual(list.map((r) => r.phone), ["+12075550101", "+12075550102"]);
  assert.deepEqual(list[0].cars.map((c) => c.label), ["2014 Toyota Corolla", "2016 RAV4"]);
  assert.equal(list[1].alreadyWelcomed, true);
  assert.deepEqual(defaultWelcomeSelection(list), ["+12075550101"]);
  assert.deepEqual(selectAllWelcome(list), ["+12075550101", "+12075550102"]);
  assert.deepEqual(toggleWelcomePhone(["+12075550101"], "+12075550102"), ["+12075550101", "+12075550102"]);
  assert.deepEqual(toggleWelcomePhone(["+12075550101"], "+12075550101"), []);
  assert.deepEqual(parseWelcomePreview(null), []);
  assert.deepEqual(parseWelcomePreview({ recipients: "x" }), []);
});

test("the welcome requests and the result summary follow the contract", () => {
  assert.deepEqual(welcomePreviewRequest("biz1"), { businessId: "biz1", action: "welcome_preview" });
  assert.deepEqual(welcomeSendRequest("biz1", ["+12075550101"]), { businessId: "biz1", action: "welcome_send", phones: ["+12075550101"] });
  assert.deepEqual(parseWelcomeResult({ sent: 2, skipped: 1, failed: "0" }), { sent: 2, skipped: 1, failed: 0 });
  assert.deepEqual(parseWelcomeResult(undefined), { sent: 0, skipped: 0, failed: 0 });
  assert.equal(welcomeResultText({ sent: 2, skipped: 1, failed: 1 }, "en"), "2 sent · 1 skipped · 1 failed");
  assert.equal(welcomeResultText({ sent: 1, skipped: 0, failed: 0 }, "en"), "1 sent");
  assert.equal(welcomeResultText({ sent: 2, skipped: 1, failed: 1 }, "fr"), "2 messages envoyés · 1 ignoré · 1 échec");
  assert.equal(welcomeSelectionText(1, 2, "en"), "1 of 2 selected");
  assert.equal(welcomeSelectionText(2, 2, "fr"), "2 sur 2 sélectionnés");
  assert.equal(welcomeSendText(1, "en"), "Send to 1 customer");
  assert.equal(welcomeSendText(3, "en"), "Send to 3 customers");
  assert.equal(welcomeSendText(3, "fr"), "Envoyer à 3 clients");
});

test("the parking panel offers the welcome only when the switch is on, and to the owner", () => {
  assert.match(panels, /canSendParkingWelcome && whatsappOn && \(\s*<button[^>]*onClick=\{\(\) => setWelcomeOpen\(true\)\}>[\s\S]*?Send welcome to current customers<\/button>/);
  assert.match(panels, /welcomeOpen && canSendParkingWelcome && whatsappOn && \(\s*<ParkingWelcomeDialog businessId=\{businessId\}/);
  assert.match(panels, /const whatsappOn = parkingWhatsAppEnabled\(business\)/);
  assert.match(consoleSource, /canSendParkingWelcome=\{\s*\(profile\.role === "businessOwner" \|\| profile\.role === "admin"\) && !previewMode/);
});

test("the welcome modal previews first, sends only what is ticked, and every wait ends", () => {
  assert.match(component, /welcomePreviewRequest\(businessId\)/);
  assert.match(component, /welcomeSendRequest\(businessId, selected\)/);
  // Already welcomed: muted, unticked by default, still selectable.
  assert.match(component, /person\.alreadyWelcomed \? "muted"/);
  assert.match(component, /defaultWelcomeSelection\(list\)/);
  assert.match(component, /COPY\.alreadyWelcomed/);
  // Select / deselect everyone.
  assert.match(component, /selectAllWelcome\(recipients\)/);
  assert.match(component, /onClick=\{\(\) => setSelected\(\[\]\)\}/);
  // Nothing ticked, nothing sent.
  assert.match(component, /disabled=\{sending \|\| selected\.length === 0 \|\| !recipients\}/);
  // The result summary replaces the list.
  assert.match(component, /welcomeResultText\(result, language\)/);
  // Loading states always resolve: both calls have a timeout, an error
  // leaves the dialog usable (Try again) and `finally` ends the sending state.
  assert.match(component, /httpsCallable\(functions, "updateBusinessParkingEntry", \{ timeout \}\)/);
  assert.match(component, /parkingEntryCall\(PARKING_WHATSAPP_TIMEOUT_MS\)\(welcomePreviewRequest/);
  assert.match(component, /parkingEntryCall\(PARKING_WELCOME_SEND_TIMEOUT_MS\)\(welcomeSendRequest/);
  assert.match(component, /\.catch\(\(failure\) => \{\s*if \(active\) setLoadError/);
  assert.match(component, /finally \{\s*setSending\(false\);/);
  assert.match(component, /setAttempt\(\(n\) => n \+ 1\)/);
  assert.ok(PARKING_WHATSAPP_COPY.welcomeButton === "Send welcome to current customers");
});

// ---------------------------------------------------------------------------
// A car's WhatsApp messages
// ---------------------------------------------------------------------------

test("a message reads as its kind, its time and its tick; a sent one moves on to delivered / read / failed", () => {
  const parked = parkingMessageLine({ id: "m1", kind: "parked", status: "sent", phone: "+1207", sentAt: { seconds: 1_790_000_000 }, createdAt: { seconds: 1_789_999_990 } });
  assert.equal(parked?.kindLabel, "Car parked message");
  assert.equal(parked?.state, "sent");
  assert.equal(parked?.tick, "single");
  assert.equal(parked?.atMs, 1_790_000_000_000);

  const read = parkingMessageLine({ id: "m2", kind: "receipt", status: "sent", deliveryStatus: "read", sentAt: 5000 });
  assert.equal(read?.state, "read");
  assert.equal(read?.tick, "double-read");
  assert.equal(read?.stateLabel, "Read");
  assert.equal(parkingMessageLine({ id: "m3", kind: "receipt", status: "sent", deliveryStatus: "delivered" })?.tick, "double");

  // A message that never left keeps the server's word, and failure says why.
  const failed = parkingMessageLine({ id: "m4", kind: "welcome", status: "failed", error: "Re-engagement message", createdAt: 7000 });
  assert.equal(failed?.state, "failed");
  assert.equal(failed?.tick, "cross");
  assert.equal(failed?.error, "Re-engagement message");
  // The delivery failing after a send also shows the error.
  assert.equal(parkingMessageLine({ id: "m5", kind: "parked", status: "sent", deliveryStatus: "failed", error: "Undeliverable" })?.error, "Undeliverable");
  // No error text on a message that did not fail.
  assert.equal(parkingMessageLine({ id: "m6", kind: "parked", status: "sent", error: "old" })?.error, "");
  assert.equal(parkingMessageLine({ id: "m7", kind: "receipt", status: "stopped" })?.state, "stopped");
  assert.equal(parkingMessageLine({ id: "m8", kind: "receipt", status: "skipped" })?.state, "skipped");
  assert.equal(parkingMessageLine({ id: "m9", kind: "receipt", status: "queued" })?.tick, "clock");
  // An unknown kind (a newer server) is left out, an unknown status reads as waiting.
  assert.equal(parkingMessageLine({ id: "x", kind: "promo", status: "sent" }), null);
  assert.equal(parkingMessageLine({ id: "y", kind: "parked", status: "weird" })?.state, "queued");
});

test("a car's messages list newest first", () => {
  const lines = parkingMessageLines([
    { id: "a", kind: "parked", status: "sent", sentAt: 1000 },
    { id: "b", kind: "receipt", status: "sent", sentAt: 3000 },
    { id: "c", kind: "receipt", status: "failed", createdAt: 2000 },
    { id: "d", kind: "nope" },
  ]);
  assert.deepEqual(lines.map((l) => l.id), ["b", "c", "a"]);
});

test("the list is one equality query on the car, opened on demand, and it always resolves", () => {
  assert.match(component, /collection\(db, "parkingMessages"\)/);
  assert.match(component, /where\("businessId", "==", businessId\),\s*where\("parkedCarId", "==", parkedCarId\)/);
  assert.doesNotMatch(component, /parkingMessages"\)[\s\S]{0,200}(orderBy|limit)\(/, "equalities only: no composite index");
  assert.match(component, /if \(!open \|\| !businessId \|\| !parkedCarId\) return undefined/);
  // An error and a silent listener both end the loading state.
  assert.match(component, /MESSAGES_LOAD_TIMEOUT_MS/);
  assert.match(component, /\(\) => \{\s*settled\.current = true;\s*setError\(true\);\s*setLoading\(false\);/);
  // The date uses the US helper; the error text is shown only on a failed line.
  assert.match(component, /formatDateTime\(line\.atMs\)/);
  assert.match(component, /\{line\.error && /);
  // Shown on each card once the business has used the switch.
  assert.match(panels, /parkingWhatsAppEverEnabled\(business\) && \(\s*<ParkingCarMessages businessId=\{businessId\} parkedCarId=\{String\(row\.id\)\}/);
});

// ---------------------------------------------------------------------------
// French (guardrails §5)
// ---------------------------------------------------------------------------

test("every string this feature shows has its French", () => {
  const strings = [
    ...Object.values(PARKING_WHATSAPP_COPY),
    ...Object.values(PARKING_WHATSAPP_REFUSALS),
    ...Object.values(PARKING_MESSAGE_KIND_LABEL),
    ...Object.values(PARKING_MESSAGE_STATE_LABEL),
    "Retry",
    "Cancel",
    "Close",
  ];
  const missing = strings.filter((value) => !TEXT_TRANSLATIONS[value]);
  assert.deepEqual(missing, []);
  assert.equal(translateValue("Send WhatsApp messages to parking customers", "fr"), "Envoyer des messages WhatsApp aux clients du stationnement");
  assert.equal(translateValue("Already welcomed", "fr"), "Déjà accueilli");
});

test("the component's own JSX text is all in the dictionary", () => {
  const missing: string[] = [];
  for (const match of component.matchAll(/(?<!=)>\s*([A-Z][A-Za-z' ,.…()—:-]{2,})\s*</g)) {
    const value = match[1].trim();
    if (value === "WhatsApp") continue;
    if (!TEXT_TRANSLATIONS[value]) missing.push(value);
  }
  for (const match of component.matchAll(/(?:placeholder|aria-label|title)="([^"]+)"/g)) {
    if (!TEXT_TRANSLATIONS[match[1]]) missing.push(match[1]);
  }
  assert.deepEqual(missing, []);
});
