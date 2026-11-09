// "Send on WhatsApp" on a parked car (docs/PARKING_LEFT_WHATSAPP.md §2, §4):
// who is offered it, what it sends, the sentences for every outcome, the last
// status line, the note after a corrected number, and the wiring on the card.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { PARKING_MESSAGE_KIND_LABEL, PARKING_WHATSAPP_REFUSALS, parkingMessageLine } from "./parking-whatsapp.ts";
import {
  PARKING_WHATSAPP_SEND_COPY,
  PARKING_CONTACT_REFUSALS,
  changedContactFields,
  contactDraftReasons,
  contactSaveResends,
  customerPhoneChanged,
  parkingContactRefusalText,
  parkingSaveRoute,
  parseContactResult,
  updateContactRequest,
  lastStatusLine,
  lastStatusRequest,
  parseLastStatus,
  parseSendResult,
  parkingWhatsAppSendVisible,
  phoneChangeResends,
  sendRefusalText,
  sendResultText,
  sendWhatsAppRequest,
  statusFromSend,
  whatsappMomentText,
} from "./parking-whatsapp-send.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const component = read("../components/business/parking-whatsapp.tsx");
const panels = read("../components/business/operations-panels.tsx");

const on = { parkingWhatsApp: { enabled: true } };
const lotCar = { id: "c1", source: "business", status: "active" };

// ---------------------------------------------------------------------------
// Visibility
// ---------------------------------------------------------------------------

test("the button is offered only with the switch on, on a car the business enters, not voided, not a team car", () => {
  assert.equal(parkingWhatsAppSendVisible(on, lotCar), true);
  assert.equal(parkingWhatsAppSendVisible(on, { enteredByBusiness: true }), true);
  // Switch off, absent or null.
  assert.equal(parkingWhatsAppSendVisible({ parkingWhatsApp: { enabled: false } }, lotCar), false);
  assert.equal(parkingWhatsAppSendVisible({}, lotCar), false);
  assert.equal(parkingWhatsAppSendVisible(null, lotCar), false);
  // Team member's own car, voided, cancelled, online booking, no car.
  assert.equal(parkingWhatsAppSendVisible(on, { ...lotCar, forStaffId: "uid1" }), false);
  assert.equal(parkingWhatsAppSendVisible(on, { ...lotCar, voided: true }), false);
  assert.equal(parkingWhatsAppSendVisible(on, { ...lotCar, status: "cancelled" }), false);
  assert.equal(parkingWhatsAppSendVisible(on, { id: "c2", source: "online" }), false);
  assert.equal(parkingWhatsAppSendVisible(on, null), false);
  assert.equal(parkingWhatsAppSendVisible(on, {}), false);
});

// ---------------------------------------------------------------------------
// Requests and answers
// ---------------------------------------------------------------------------

test("the requests are the spec's callable actions", () => {
  assert.deepEqual(sendWhatsAppRequest("b1", "c1"), { action: "send_whatsapp", businessId: "b1", carId: "c1" });
  assert.deepEqual(lastStatusRequest("b1", "c1"), { action: "whatsapp_status", businessId: "b1", carId: "c1" });
});

test("the send answer is read defensively; only a confirmed send reads as sent", () => {
  assert.deepEqual(parseSendResult({ success: true, kind: "left", status: "sent", error: "" }), { kind: "left", status: "sent", error: "" });
  assert.equal(parseSendResult({ kind: "parked", status: "stopped" }).status, "stopped");
  assert.equal(parseSendResult({ kind: "parked", status: "failed", error: "Undeliverable" }).error, "Undeliverable");
  assert.equal(parseSendResult({ status: "weird" }).status, "failed");
  assert.equal(parseSendResult(null).status, "failed");
  assert.equal(parseSendResult(undefined).kind, "parked");
});

test("every outcome has a sentence: sent, paused, not delivered", () => {
  assert.equal(sendResultText({ kind: "parked", status: "sent", error: "" }), "Sent on WhatsApp.");
  assert.equal(sendResultText({ kind: "left", status: "failed", error: "x" }), "Not delivered. Check the number.");
  assert.equal(sendResultText({ kind: "left", status: "stopped", error: "" }), "This customer asked to stop WhatsApp messages.");
});

test("every refusal reason reads as the spec's sentence, never a raw error", () => {
  const refusal = (reason: string) => sendRefusalText({ code: "functions/failed-precondition", message: "raw server text", details: { reason } });
  assert.equal(refusal("parking_whatsapp_off"), "Turn on WhatsApp messages for parking customers first.");
  assert.equal(refusal("car_not_messageable"), "This car's customer can't be messaged (a team member's car, a voided car, or an online booking).");
  assert.equal(refusal("no_phone"), "Add the customer's WhatsApp number first.");
  assert.equal(refusal("needs_country_code"), "Add the country code to the number.");
  assert.equal(refusal("send_limit"), "This car's message was sent 5 times today. Try again tomorrow.");
  assert.equal(refusal("something_new"), "That did not work. Try again.");
  assert.equal(sendRefusalText(new Error("raw")), "That did not work. Try again.");
});

// ---------------------------------------------------------------------------
// The last status line
// ---------------------------------------------------------------------------

// 2026-11-09 19:05 UTC = 2:05 PM in New York.
const AT = Date.UTC(2026, 10, 9, 19, 5);
const NY = "America/New_York";

test("a moment is month first and 12-hour in English, and as the app writes it in French", () => {
  assert.equal(whatsappMomentText(AT, "en", NY), "Nov 9, 2026, 2:05 PM");
  assert.equal(whatsappMomentText(AT, "fr", NY), "9 nov. 2026 à 14 h 05");
  assert.equal(whatsappMomentText(Number.NaN, "en"), "");
});

test("the status line: sent with its time, not delivered, paused, nothing yet", () => {
  const sent = parseLastStatus({ kind: "parked", status: "sent", error: "", atMs: AT });
  assert.equal(lastStatusLine(sent, "en", NY), "WhatsApp: sent Nov 9, 2026, 2:05 PM");
  assert.equal(lastStatusLine(sent, "fr", NY), "WhatsApp : envoyé le 9 nov. 2026 à 14 h 05");
  const failed = parseLastStatus({ kind: "left", status: "failed", error: "Undeliverable", atMs: AT });
  assert.equal(lastStatusLine(failed, "en", NY), "WhatsApp: not delivered. Check the number.");
  assert.equal(lastStatusLine(failed, "fr", NY), "WhatsApp : non distribué. Vérifiez le numéro.");
  assert.equal(lastStatusLine(parseLastStatus({ status: "stopped" }), "en"), "WhatsApp: paused, the customer asked to stop");
  assert.equal(lastStatusLine(parseLastStatus({ status: "delivered", atMs: AT }), "en", NY), "WhatsApp: delivered Nov 9, 2026, 2:05 PM");
  assert.equal(lastStatusLine(parseLastStatus({ status: "read", atMs: AT }), "fr", NY), "WhatsApp : lu le 9 nov. 2026 à 14 h 05");
  // No time known: the line still reads.
  assert.equal(lastStatusLine(parseLastStatus({ status: "sent" }), "en"), "WhatsApp: sent");
  // Nothing ever sent.
  assert.equal(parseLastStatus({}), null);
  assert.equal(parseLastStatus(null), null);
  assert.equal(lastStatusLine(null, "en"), "WhatsApp: nothing sent yet");
  assert.equal(lastStatusLine(null, "fr"), "WhatsApp : aucun message envoyé");
});

test("a send updates the line at once with what the server answered", () => {
  const line = lastStatusLine(statusFromSend({ kind: "left", status: "sent", error: "" }, AT), "en", NY);
  assert.equal(line, "WhatsApp: sent Nov 9, 2026, 2:05 PM");
});

// ---------------------------------------------------------------------------
// A corrected number
// ---------------------------------------------------------------------------

test("a corrected number is a change in digits, not in formatting", () => {
  assert.equal(customerPhoneChanged("+1 207 555 0100", "+12075550101"), true);
  assert.equal(customerPhoneChanged("+1 (207) 555-0100", "+12075550100"), false);
  assert.equal(customerPhoneChanged("", "+12075550100"), true);
  assert.equal(customerPhoneChanged("+12075550100", ""), false);
  assert.equal(customerPhoneChanged(undefined, undefined), false);
});

test("the resend note shows only when the switch is on, the car is messaged and the number changed", () => {
  assert.equal(phoneChangeResends(on, lotCar, "+12075550100", "+12075550101"), true);
  assert.equal(phoneChangeResends({}, lotCar, "+12075550100", "+12075550101"), false);
  assert.equal(phoneChangeResends(on, { ...lotCar, forStaffId: "u" }, "+12075550100", "+12075550101"), false);
  assert.equal(phoneChangeResends(on, { ...lotCar, voided: true }, "+12075550100", "+12075550101"), false);
  assert.equal(phoneChangeResends(on, lotCar, "+12075550100", "+1 207 555 0100"), false);
});

// ---------------------------------------------------------------------------
// Which callable a save uses
// ---------------------------------------------------------------------------

const before = {
  whose: "other", forStaffId: "", ownerName: "Awa Diop", customerPhone: "+12075550100", customerEmail: "awa@example.com",
  carMake: "Toyota", carModel: "Corolla", carYear: "2014", vinNumber: "VIN1", startDate: "2026-11-01", endDate: "", paymentMethod: "direct",
};

test("a save that changes only the contact uses update_contact", () => {
  assert.equal(parkingSaveRoute(before, { ...before, customerPhone: "+12075550101" }, false), "contact");
  assert.equal(parkingSaveRoute(before, { ...before, ownerName: "Awa Ndiaye" }, false), "contact");
  assert.equal(parkingSaveRoute(before, { ...before, customerEmail: "NEW@example.com" }, false), "contact");
  // Formatting of the same number is not a change.
  assert.equal(parkingSaveRoute(before, { ...before, customerPhone: "+1 (207) 555-0100" }, false), "full");
});

test("a save that changes the car or the stay, with or without contact, uses the full edit", () => {
  assert.equal(parkingSaveRoute(before, { ...before, endDate: "2026-11-09" }, false), "full");
  assert.equal(parkingSaveRoute(before, { ...before, carYear: "2015", customerPhone: "+12075550101" }, false), "full");
  assert.equal(parkingSaveRoute(before, { ...before, paymentMethod: "payment_link" }, false), "full");
  assert.equal(parkingSaveRoute(before, { ...before, whose: "team", forStaffId: "u1" }, false), "full");
  // Nothing changed (the status may have): the full edit, as before.
  assert.equal(parkingSaveRoute(before, { ...before }, false), "full");
});

test("a paid car can only save its contact; anything else is blocked or nothing", () => {
  assert.equal(parkingSaveRoute(before, { ...before, customerPhone: "+12075550101" }, true), "contact");
  assert.equal(parkingSaveRoute(before, { ...before }, true), "none");
  assert.equal(parkingSaveRoute(before, { ...before, endDate: "2026-11-09" }, true), "blocked");
  assert.equal(parkingSaveRoute(before, { ...before, endDate: "2026-11-09", customerPhone: "+12075550101" }, true), "blocked");
});

test("update_contact sends only the fields that changed, under the server's names", () => {
  assert.deepEqual(
    updateContactRequest("b1", "c1", before, { ...before, customerPhone: "+12075550101", customerEmail: " NEW@Example.com " }),
    { action: "update_contact", businessId: "b1", carId: "c1", customerPhone: "+12075550101", customerEmail: "new@example.com" },
  );
  assert.deepEqual(
    updateContactRequest("b1", "c1", before, { ...before, ownerName: "Awa Ndiaye" }),
    { action: "update_contact", businessId: "b1", carId: "c1", customerName: "Awa Ndiaye" },
  );
  assert.deepEqual(changedContactFields(before, { ...before }), []);
});

test("a contact save keeps a name and a phone; the answer lists what changed", () => {
  assert.deepEqual(contactDraftReasons({ ...before, ownerName: " " }), ["customer_name_required"]);
  assert.deepEqual(contactDraftReasons({ ...before, customerPhone: "" }), ["customer_phone_required"]);
  assert.deepEqual(contactDraftReasons(before), []);
  assert.deepEqual(parseContactResult({ success: true, entryId: "c1", changed: ["customerPhone", "customerName"] }).changed, ["customerPhone", "customerName"]);
  assert.deepEqual(parseContactResult(null).changed, []);
});

test("the resend note shows only when the server changed the phone on a messaged car", () => {
  assert.equal(contactSaveResends(on, lotCar, ["customerPhone"]), true);
  assert.equal(contactSaveResends(on, lotCar, ["customerName"]), false);
  assert.equal(contactSaveResends({}, lotCar, ["customerPhone"]), false);
  assert.equal(contactSaveResends(on, { ...lotCar, voided: true }, ["customerPhone"]), false);
});

test("every update_contact refusal reads as a sentence with its French", () => {
  const reasons = ["nothing_to_change", "customer_phone_required", "customer_name_required", "customer_email_invalid", "team_car", "not_business_entered", "car_voided"];
  for (const reason of reasons) {
    const message = parkingContactRefusalText({ details: { reason } });
    assert.equal(message, PARKING_CONTACT_REFUSALS[reason]);
    assert.ok(TEXT_TRANSLATIONS[message], `missing French for: ${message}`);
  }
  assert.equal(parkingContactRefusalText({ details: { reason: "car_voided" } }), "This car was voided.");
  assert.equal(parkingContactRefusalText(new Error("raw")), "The parking record could not be updated.");
  assert.ok(TEXT_TRANSLATIONS[PARKING_CONTACT_REFUSALS.unknown]);
  assert.ok(TEXT_TRANSLATIONS["This car is paid. You can only correct the customer's name, phone and email."]);
  assert.ok(TEXT_TRANSLATIONS["Edit contact"]);
});

test("the save wires the route: contact fixes go to update_contact, and a paid car's form is read-only", () => {
  assert.match(panels, /route === "contact" && existing/);
  assert.match(panels, /updateContactRequest\(businessId, draft\.id, parkingDraftOf\(existing\), draft\)/);
  assert.match(panels, /contactSaveResends\(business, existing, changed\)/);
  assert.match(panels, /disabled=\{busy \|\| editingPaid\}/);
  assert.match(panels, /<input disabled=\{editingPaid\} value=\{draft\.vinNumber\}/);
});

// ---------------------------------------------------------------------------
// The car-left kind reads like the others
// ---------------------------------------------------------------------------

test("a car-left message is listed on the car's messages", () => {
  assert.equal(PARKING_MESSAGE_KIND_LABEL.left, "Car left message");
  const line = parkingMessageLine({ id: "c1_left_20261109", kind: "left", status: "sent", sentAt: AT });
  assert.equal(line?.kindLabel, "Car left message");
});

// ---------------------------------------------------------------------------
// The wiring on the card
// ---------------------------------------------------------------------------

test("the card offers the button through one visibility rule, before the message list", () => {
  assert.match(panels, /parkingWhatsAppSendVisible\(business, row\) && \(\s*<ParkingCarSendWhatsApp businessId=\{businessId\} carId=\{String\(row\.id\)\}/);
  assert.ok(
    panels.indexOf("<ParkingCarSendWhatsApp") < panels.indexOf("<ParkingCarMessages"),
    "the button sits above the message list",
  );
});

test("the send and the status always resolve and never reach for raw server text", () => {
  assert.match(component, /httpsCallable\(functions, "updateBusinessParkingEntry", \{ timeout \}\)/);
  assert.match(component, /parkingEntryCall\(PARKING_WHATSAPP_SEND_TIMEOUT_MS\)\(sendWhatsAppRequest\(businessId, carId\)\)/);
  // The status read is one function, behind the callable action.
  assert.match(component, /export async function fetchLastWhatsAppStatus/);
  assert.match(component, /parkingEntryCall\(PARKING_WHATSAPP_SEND_TIMEOUT_MS\)\(lastStatusRequest\(businessId, carId\)\)/);
  // Busy ends on every path; a status that cannot load leaves the button usable.
  assert.match(component, /finally \{\s*if \(alive\.current\) setBusy\(false\);/);
  assert.match(component, /disabled=\{busy\}/);
  assert.match(component, /sendRefusalText\(failure\)/);
  // Read when the card is on screen, not for thirty cards at once.
  assert.match(component, /new IntersectionObserver/);
  // The status line carries a date in the page's language: not run through the dictionary.
  assert.match(component, /<small className="pk-wa-last" data-no-translate>\{lastStatusLine\(last, language\)\}/);
});

test("saving a corrected number says the message will be resent", () => {
  assert.match(panels, /phoneChangeResends\(business, existing, existing\?\.customerPhone, draft\.customerPhone\)/);
  assert.match(panels, /"Saved\. The last message will be resent to the new number\."/);
});

// ---------------------------------------------------------------------------
// French (guardrails §5)
// ---------------------------------------------------------------------------

test("every string this feature shows has its French", () => {
  const strings = [
    ...Object.values(PARKING_WHATSAPP_SEND_COPY),
    ...Object.values(PARKING_WHATSAPP_REFUSALS),
    "Sending…",
  ];
  assert.deepEqual(strings.filter((value) => !TEXT_TRANSLATIONS[value]), []);
  assert.equal(translateValue("Send on WhatsApp", "fr"), "Envoyer sur WhatsApp");
  assert.equal(translateValue("Sent on WhatsApp.", "fr"), "Envoyé sur WhatsApp.");
  assert.equal(
    translateValue("Saved. The last message will be resent to the new number.", "fr"),
    "Enregistré. Le dernier message sera renvoyé au nouveau numéro.",
  );
  assert.equal(translateValue("Car left message", "fr"), "Message de sortie de voiture");
});
