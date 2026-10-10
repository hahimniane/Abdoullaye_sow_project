import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CONTAINER_MESSAGES } from "./container-manifest.ts";
import { translateValue } from "./french-dom.ts";
import {
  MAX_PACKAGE_INCHES,
  PACKAGE_PAYMENT_LABELS,
  PACKAGE_PAYMENT_TONES,
  addWaitingPackagePayload,
  assignLinesRequest,
  assignSelectionRefusal,
  assignableLines,
  assignedText,
  assignmentBlockText,
  assignmentRefusal,
  defaultWaitingDestination,
  emptyPackagePaymentDraft,
  emptyWaitingPackageDraft,
  filterWaitingPackages,
  mainDestinationChanges,
  nextPackageForSameCustomer,
  packageMethodLabel,
  packagePayment,
  packagePaymentEntries,
  packagePaymentMessage,
  packagePriceChanged,
  packageSize,
  parseInches,
  readPackagePrice,
  recordPackagePaymentRequest,
  revertPackagePaymentRequest,
  runPackageCall,
  savedPackageStub,
  selectAllMatching,
  selectedCountText,
  setPackagePriceRequest,
  sortWaitingNewestFirst,
  updateWaitingPackageRequest,
  validatePackagePaymentDraft,
  validatePackagePrice,
  validateWaitingPackage,
  volumeCubicFeet,
  waitingCountText,
  waitingPackageDraftFromRow,
  waitingPackageMessage,
  waitingPackageRow,
  wholeBalanceInput,
  type WaitingPackageDraft,
} from "./waiting-packages.ts";

const guinea = { id: "guinea", name: "Guinea" };

/** A complete barrels draft; each test changes what it is about. */
function draft(over: Partial<WaitingPackageDraft> = {}): WaitingPackageDraft {
  return {
    ...emptyWaitingPackageDraft(guinea),
    kind: "barrels",
    quantity: "2",
    customerName: "Fatou Diallo",
    customerPhone: "+1 (207) 555-0101",
    receiverName: "Mariama Bah",
    receiverPhone: "+224 620 11 22 33",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Size.
// ---------------------------------------------------------------------------

test("sides are inches: blank is nothing, a typo is NaN, and a decimal comma is a point", () => {
  assert.equal(parseInches(""), null);
  assert.equal(parseInches("  "), null);
  assert.equal(parseInches("24"), 24);
  assert.equal(parseInches("18,5"), 18.5);
  assert.equal(parseInches("18.555"), 18.56);
  for (const bad of ["abc", "0", "-3", "1e3", "12 in", `${MAX_PACKAGE_INCHES + 1}`]) {
    assert.ok(Number.isNaN(parseInches(bad)), `${bad} is not a size`);
  }
  assert.equal(parseInches(`${MAX_PACKAGE_INCHES}`), MAX_PACKAGE_INCHES);
});

test("the cap on a side is the server's", () => {
  const server = readFileSync(new URL("../../../my_flutter_app/functions/container_manifest.js", import.meta.url), "utf8");
  assert.match(server, new RegExp(`const MAX_DIMENSION_IN = ${MAX_PACKAGE_INCHES};`));
});

test("volume is length x width x height over 1728, in cubic feet", () => {
  assert.equal(volumeCubicFeet(12, 12, 12), 1);
  assert.equal(volumeCubicFeet(40, 30, 20), 13.89);
  assert.equal(volumeCubicFeet(24, 24, 24), 8);
  assert.equal(volumeCubicFeet(null, 12, 12), null);
  assert.equal(volumeCubicFeet(12, 0, 12), null);
  assert.equal(volumeCubicFeet("x", 12, 12), null);
});

test("a package's size reads back as dimensions and volume, or not at all", () => {
  const size = packageSize({ lengthIn: 40, widthIn: 30, heightIn: 20.5 });
  assert.equal(size?.dimensionsText, "40 × 30 × 20.5 in");
  assert.equal(size?.volumeText, "14.24 ft³");
  assert.equal(packageSize({ lengthIn: 40, widthIn: 30 }), null);
  assert.equal(packageSize({}), null);
});

// ---------------------------------------------------------------------------
// Payments.
// ---------------------------------------------------------------------------

test("payment status: unpaid, partial, paid, pay on arrival, and no price yet", () => {
  const status = (row: object) => packagePayment(row).status;
  assert.equal(status({}), "no_price");
  assert.equal(status({ priceCents: 0 }), "no_price", "a price of zero is no price");
  assert.equal(status({ priceCents: 5000 }), "unpaid");
  assert.equal(status({ priceCents: 5000, paidCents: 1 }), "partial");
  assert.equal(status({ priceCents: 5000, paidCents: 5000 }), "paid");
  assert.equal(status({ priceCents: 5000, paidCents: 6000 }), "paid", "never negative");
  assert.equal(status({ priceCents: 5000, payOnArrival: true }), "pay_on_arrival");
  assert.equal(status({ payOnArrival: true }), "pay_on_arrival", "promised before it is priced");
  // Money on account outranks the promise; the line still says payOnArrival.
  const part = packagePayment({ priceCents: 5000, paidCents: 2000, payOnArrival: true });
  assert.equal(part.status, "partial");
  assert.equal(part.payOnArrival, true);
  assert.equal(status({ priceCents: 5000, paidCents: 5000, payOnArrival: true }), "paid");
});

test("balance is what is left of the price, or unknown without one", () => {
  assert.equal(packagePayment({ priceCents: 5000, paidCents: 1999 }).balanceCents, 3001);
  assert.equal(packagePayment({ priceCents: 5000, paidCents: 9000 }).balanceCents, 0);
  assert.equal(packagePayment({}).balanceCents, null);
});

test("every chip has a word and a tone the status pill knows", () => {
  for (const status of ["no_price", "unpaid", "partial", "paid", "pay_on_arrival"] as const) {
    assert.ok(PACKAGE_PAYMENT_LABELS[status]);
    assert.ok(["ok", "warn", "navy", "muted"].includes(PACKAGE_PAYMENT_TONES[status]));
  }
  assert.equal(PACKAGE_PAYMENT_LABELS.pay_on_arrival, "Pay on arrival");
});

test("the status names are the server's", () => {
  const server = readFileSync(new URL("../../../my_flutter_app/functions/container_payments.js", import.meta.url), "utf8");
  const block = server.match(/const PAYMENT_STATUS = Object\.freeze\(\{([\s\S]*?)\}\);/);
  assert.ok(block, "server PAYMENT_STATUS not found");
  const names = [...block[1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(names, Object.keys(PACKAGE_PAYMENT_LABELS).sort());
});

test("a price is dollars as typed and cents on the wire, read by the one money reader", () => {
  assert.deepEqual(readPackagePrice(""), { cents: null, error: null });
  assert.deepEqual(readPackagePrice("45"), { cents: 4500, error: null });
  assert.deepEqual(readPackagePrice("45,50"), { cents: 4550, error: null });
  assert.deepEqual(readPackagePrice("$1,200.50"), { cents: 120050, error: null });
  for (const bad of ["0", "-5", "abc", "12.505", "9999999999"]) {
    assert.equal(readPackagePrice(bad).error, "price_invalid", bad);
  }
});

test("a price never goes below what was paid, and cannot be taken away once money is in", () => {
  assert.deepEqual(validatePackagePrice("50", 2000), []);
  assert.deepEqual(validatePackagePrice("20", 2000), []);
  assert.deepEqual(validatePackagePrice("19.99", 2000), ["price_below_paid"]);
  assert.deepEqual(validatePackagePrice("", 2000), ["price_below_paid"]);
  assert.deepEqual(validatePackagePrice("", 0), []);
  assert.deepEqual(validatePackagePrice("oops", 0), ["price_invalid"]);
  assert.deepEqual(setPackagePriceRequest(" biz ", "w1", "45,50", true), { businessId: "biz", lineId: "w1", priceCents: 4550, payOnArrival: true });
  assert.deepEqual(setPackagePriceRequest("biz", "w1", "", false), { businessId: "biz", lineId: "w1", priceCents: null, payOnArrival: false });
});

test("a payment is refused the way the server refuses it", () => {
  const owing = packagePayment({ priceCents: 5000, paidCents: 2000 });
  const ok = { ...emptyPackagePaymentDraft, amount: "30" };
  assert.deepEqual(validatePackagePaymentDraft(ok, owing), []);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, amount: "30.01" }, owing), ["payment_exceeds_balance"]);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, amount: "" }, owing), ["amount_required"]);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, amount: "0" }, owing), ["amount_required"]);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, amount: "-5" }, owing), ["amount_required"]);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, amount: "x" }, owing), ["amount_required"]);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, method: "bitcoin" as never }, owing), ["payment_method_invalid"]);
  assert.deepEqual(validatePackagePaymentDraft(ok, packagePayment({})), ["price_required"], "nothing to pay against");
  assert.deepEqual(validatePackagePaymentDraft(ok, packagePayment({ priceCents: 5000, paidCents: 5000 })), ["payment_exceeds_balance"]);
  assert.equal(packagePaymentMessage(["price_required"]), CONTAINER_MESSAGES.price_required);
});

test("pay the whole balance fills the amount with what is left", () => {
  assert.equal(wholeBalanceInput(packagePayment({ priceCents: 5000, paidCents: 1999 })), "30.01");
  assert.equal(wholeBalanceInput(packagePayment({ priceCents: 5000, paidCents: 2000 })), "30");
  assert.equal(wholeBalanceInput(packagePayment({ priceCents: 5000, paidCents: 5000 })), "");
  assert.equal(wholeBalanceInput(packagePayment({})), "");
  // And what it fills is accepted by the validator.
  const payment = packagePayment({ priceCents: 5000, paidCents: 1999 });
  assert.deepEqual(validatePackagePaymentDraft({ ...emptyPackagePaymentDraft, amount: wholeBalanceInput(payment) }, payment), []);
});

test("the payment requests carry whole cents, the method id and a bounded note", () => {
  assert.deepEqual(
    recordPackagePaymentRequest(" biz ", "w1", { amount: "12,50", method: "zelle", note: "  deposit " }),
    { businessId: "biz", lineId: "w1", amountCents: 1250, method: "zelle", note: "deposit" },
  );
  assert.equal(recordPackagePaymentRequest("b", "l", { amount: "1", method: "cash", note: "x".repeat(500) }).note.length, 200);
  assert.deepEqual(revertPackagePaymentRequest(" biz ", " p1 "), { businessId: "biz", paymentId: "p1" });
  assert.equal(packageMethodLabel("card_in_person"), "Card in person");
  assert.equal(packageMethodLabel("mystery"), "mystery");
});

test("payment history keeps reverted rows, marked, newest first, with who took and who reverted", () => {
  const entries = packagePaymentEntries([
    { id: "a", amountCents: 1000, method: "cash", createdAt: new Date("2026-10-01T10:00:00Z"), receivedByStaffId: "s1" },
    { id: "b", amountCents: 500, method: "zelle", createdAt: new Date("2026-10-03T10:00:00Z"), receivedByStaffId: "s2", reverted: true, revertedByStaffId: "s1" },
    { id: "c", amountCents: 700, method: "check", createdAt: { seconds: Math.floor(new Date("2026-10-02T10:00:00Z").getTime() / 1000) }, receivedByStaffId: "s1", note: " ref 4 " },
  ]);
  assert.deepEqual(entries.map((e) => e.id), ["b", "c", "a"]);
  assert.equal(entries[0].reverted, true);
  assert.equal(entries[0].revertedByStaffId, "s1");
  assert.equal(entries[0].methodLabel, "Zelle");
  assert.equal(entries[1].note, "ref 4");
  assert.equal(entries[2].reverted, false);
});

// ---------------------------------------------------------------------------
// Where it is going.
// ---------------------------------------------------------------------------

test("a new package opens on the main destination, else the first one listed", () => {
  const rows = [
    { id: "senegal", name: "Senegal" },
    { id: "guinea", name: "Guinea", isMain: true },
    { id: "mali", name: "Mali" },
  ];
  assert.deepEqual(defaultWaitingDestination(rows), { id: "guinea", name: "Guinea" });
  assert.deepEqual(
    defaultWaitingDestination([{ id: "senegal", name: "Senegal" }, { id: "mali", name: "Mali" }]),
    { id: "mali", name: "Mali" },
    "first by name, not by arrival order",
  );
  assert.equal(defaultWaitingDestination([]), null);
  assert.equal(defaultWaitingDestination([{ name: "No id" }]), null);
});

test("only one destination is main: turning one on turns the previous one off", () => {
  const rows = [{ id: "guinea", isMain: true }, { id: "senegal" }, { id: "mali", isMain: false }];
  assert.deepEqual(mainDestinationChanges(rows, "senegal"), [
    { id: "guinea", isMain: false },
    { id: "senegal", isMain: true },
  ]);
  assert.deepEqual(mainDestinationChanges(rows, "guinea"), [], "already main: nothing to write");
  assert.deepEqual(mainDestinationChanges(rows, ""), [{ id: "guinea", isMain: false }], "clearing");
  // Two flagged by an older write are healed.
  assert.deepEqual(
    mainDestinationChanges([{ id: "a", isMain: true }, { id: "b", isMain: true }], "b"),
    [{ id: "a", isMain: false }],
  );
});

const forGuinea = { id: "w1", destinationCountryId: "guinea", destinationCountryName: "Guinea" };
const forSenegal = { id: "w2", destinationCountryId: "senegal", destinationCountryName: "Senegal" };
const noCountry = { id: "w3" };
const guineaBox = { id: "box1", status: "loading", destinationCountryId: "guinea", destinationCountryName: "Guinea" };

test("a container takes a package for its own country and refuses another one", () => {
  assert.equal(assignmentRefusal(forGuinea, guineaBox), null);
  assert.equal(assignmentRefusal(forSenegal, guineaBox), "destination_mismatch");
  // The server's rule: a line that names no country rides anywhere; one that does needs a decided box.
  assert.equal(assignmentRefusal(noCountry, guineaBox), null);
  assert.equal(assignmentRefusal(noCountry, { id: "x" }), null);
  assert.equal(assignmentRefusal(forGuinea, { id: "x", status: "loading" }), "container_destination_required");
});

test("the reason a row is disabled names both countries, in the reader's language", () => {
  assert.equal(assignmentBlockText(forSenegal, guineaBox, "en"), "For Senegal, this container goes to Guinea.");
  const french = assignmentBlockText(forSenegal, guineaBox, "fr");
  assert.equal(french, "Pour Sénégal ; ce conteneur va vers Guinée.");
  // Already French: the dictionary leaves it as it is.
  assert.equal(translateValue(french, "fr"), french);
  assert.equal(assignmentBlockText(forGuinea, guineaBox, "en"), "");
  assert.equal(assignmentBlockText(forGuinea, { id: "x" }, "en"), CONTAINER_MESSAGES.container_destination_required);
});

test("every waiting package is listed against a container with the reason it cannot go", () => {
  const entries = assignableLines([forGuinea, forSenegal, noCountry], guineaBox);
  assert.deepEqual(entries.map((e) => [e.id, e.refusal]), [["w1", null], ["w2", "destination_mismatch"], ["w3", null]]);
});

test("select all matching ticks what the container can take, keeps what was ticked, and stops at 100", () => {
  const entries = assignableLines([forGuinea, forSenegal, noCountry], guineaBox);
  assert.deepEqual(selectAllMatching(entries, []), ["w1", "w3"]);
  assert.deepEqual(selectAllMatching(entries, ["w3"]), ["w3", "w1"]);
  const many = assignableLines(Array.from({ length: 150 }, (_, i) => ({ id: `p${i}`, destinationCountryId: "guinea" })), guineaBox);
  assert.equal(selectAllMatching(many, []).length, 100);
  assert.equal(selectAllMatching(many, Array.from({ length: 98 }, (_, i) => `p${i}`)).length, 100);
});

test("the assign request is deduplicated and a long selection is refused before it is sent", () => {
  assert.deepEqual(
    assignLinesRequest(" biz ", " box1 ", ["a", "b", "a", " "]),
    { businessId: "biz", containerId: "box1", lineIds: ["a", "b"] },
  );
  assert.equal(assignSelectionRefusal(100), null);
  assert.equal(assignSelectionRefusal(101), CONTAINER_MESSAGES.line_ids_invalid);
});

test("the filter narrows waiting packages by customer, receiver, phone, VIN or code", () => {
  const rows = [
    { id: "a", customerName: "Fatou Diallo", customerPhone: "+12075550101", trackingCode: "CL-K7M4P2" },
    { id: "b", customerName: "Ousmane Bah", receiverName: "Mariama", receiverPhone: "+224620112233", kind: "car", vinNumber: "1HGCM82633A004352" },
  ];
  const ids = (q: string) => filterWaitingPackages(rows, q).map((r) => r.id);
  assert.deepEqual(ids(""), ["a", "b"]);
  assert.deepEqual(ids("f"), ["a", "b"], "under two characters shows everything");
  assert.deepEqual(ids("fatou"), ["a"]);
  assert.deepEqual(ids("mariama"), ["b"]);
  assert.deepEqual(ids("620 112"), ["b"]);
  assert.deepEqual(ids("4352"), ["b"]);
  assert.deepEqual(ids("k7m4"), ["a"]);
  assert.deepEqual(ids("zzz"), []);
});

test("sentences with counts and names are built per language", () => {
  assert.equal(selectedCountText(3, "en"), "3 selected");
  assert.equal(selectedCountText(1, "fr"), "1 sélectionné");
  assert.equal(selectedCountText(3, "fr"), "3 sélectionnés");
  assert.equal(waitingCountText(1, "en"), "1 package waiting");
  assert.equal(waitingCountText(4, "en"), "4 packages waiting");
  assert.equal(waitingCountText(4, "fr"), "4 colis en attente");
  assert.equal(assignedText(2, "MSKU1234567", "en"), "Added 2 packages to MSKU1234567.");
  assert.equal(assignedText(1, "MSKU1234567", "en"), "Added 1 package to MSKU1234567.");
  assert.equal(assignedText(2, "MSKU1234567", "fr"), "2 colis ajoutés à MSKU1234567.");
});

// ---------------------------------------------------------------------------
// The register form.
// ---------------------------------------------------------------------------

test("a blank package opens on the destination it is given, with the WhatsApp switches on", () => {
  const blank = emptyWaitingPackageDraft(guinea);
  assert.equal(blank.destinationCountryId, "guinea");
  assert.equal(blank.destinationCountryName, "Guinea");
  assert.equal(blank.notifyCustomer, true);
  assert.equal(blank.payOnArrival, false);
  assert.equal(emptyWaitingPackageDraft(null).destinationCountryId, "");
});

test("add another for the same customer keeps the people, the country and the switches, and clears the box", () => {
  const first = draft({
    kind: "other", description: "tires", quantity: "4", destinationCountryId: "senegal", destinationCountryName: "Senegal",
    lengthIn: "40", widthIn: "30", heightIn: "20", price: "45", payOnArrival: true,
    notifyCustomer: false, notifyReceiver: true, vinNumber: "ignored", carMake: "Toyota",
  });
  const next = nextPackageForSameCustomer(first);
  for (const kept of ["kind", "customerName", "customerPhone", "receiverName", "receiverPhone", "notifyCustomer", "notifyReceiver", "destinationCountryId", "destinationCountryName"] as const) {
    assert.equal(next[kept], first[kept], kept);
  }
  for (const cleared of ["description", "lengthIn", "widthIn", "heightIn", "price", "vinNumber", "carMake", "carModel", "carYear"] as const) {
    assert.equal(next[cleared], "", cleared);
  }
  assert.equal(next.payOnArrival, false);
  assert.equal(next.quantity, "1");
});

test("a package needs what a line needs, a country, a whole size and a sane price", () => {
  assert.deepEqual(validateWaitingPackage(draft()), []);
  assert.deepEqual(validateWaitingPackage(draft({ customerName: "" })), ["customer_name_required"]);
  assert.deepEqual(validateWaitingPackage(draft({ quantity: "" })), ["quantity_required"]);
  assert.deepEqual(validateWaitingPackage(draft({ kind: "car", vinNumber: "123" })), ["vin_required"]);
  assert.deepEqual(validateWaitingPackage(draft({ kind: "other", description: "", quantity: "1" })), ["description_required"]);
  assert.deepEqual(validateWaitingPackage(draft({ customerPhone: "call me" })), ["customer_phone_invalid"]);
  assert.deepEqual(validateWaitingPackage(draft({ destinationCountryId: "" })), ["package_destination_required"]);
  assert.deepEqual(validateWaitingPackage(draft({ lengthIn: "40", widthIn: "30", heightIn: "20" })), []);
  assert.deepEqual(validateWaitingPackage(draft({ lengthIn: "40" })), ["size_invalid"], "two sides are no size");
  assert.deepEqual(validateWaitingPackage(draft({ lengthIn: "40", widthIn: "x", heightIn: "20" })), ["size_invalid"]);
  assert.deepEqual(validateWaitingPackage(draft({ price: "-3" })), ["price_invalid"]);
  assert.deepEqual(validateWaitingPackage(draft({ price: "45.50", payOnArrival: true })), []);
  // Every problem at once, in the server's sentences.
  const everything = validateWaitingPackage(draft({ customerName: "", destinationCountryId: "", lengthIn: "9", price: "x" }));
  assert.deepEqual(everything, ["customer_name_required", "package_destination_required", "size_invalid", "price_invalid"]);
  assert.equal(
    waitingPackageMessage(["customer_name_required", "size_invalid"]),
    `${CONTAINER_MESSAGES.customer_name_required} ${CONTAINER_MESSAGES.size_invalid}`,
  );
});

test("the add request carries what the server stores, and only what was entered", () => {
  assert.deepEqual(
    addWaitingPackagePayload(" biz ", draft({ lengthIn: "40", widthIn: "30", heightIn: "20", price: "45,50", payOnArrival: true })),
    {
      businessId: "biz",
      kind: "barrels",
      vinNumber: "",
      carMake: "",
      carModel: "",
      carYear: "",
      quantity: 2,
      description: "",
      ownerKind: "customer",
      customerName: "Fatou Diallo",
      customerPhone: "+12075550101",
      receiverName: "Mariama Bah",
      receiverPhone: "+224620112233",
      notifyCustomer: true,
      notifyReceiver: true,
      destinationCountryId: "guinea",
      destinationCountryName: "Guinea",
      lengthIn: 40,
      widthIn: 30,
      heightIn: 20,
      priceCents: 4550,
      payOnArrival: true,
    },
  );
  const bare = addWaitingPackagePayload("biz", draft());
  assert.equal("lengthIn" in bare, false, "no size typed, none sent");
  assert.equal("priceCents" in bare, false, "no price typed, none sent");
  assert.equal(bare.payOnArrival, false);
});

test("a car goes with its VIN, cleaned, and counts as one", () => {
  const car = addWaitingPackagePayload("biz", draft({ kind: "car", vinNumber: " 1hgcm82633a004352 ", carMake: "Honda", carModel: "Accord", carYear: "2003", quantity: "" }));
  assert.equal(car.kind, "car");
  assert.equal(car.vinNumber, "1HGCM82633A004352");
  assert.equal(car.quantity, 1);
  assert.equal(car.carMake, "Honda");
});

test("a switch with no number is sent off", () => {
  const payload = addWaitingPackagePayload("biz", draft({ receiverPhone: "", notifyReceiver: true, customerPhone: "+12075550101", notifyCustomer: false }));
  assert.equal(payload.notifyReceiver, false);
  assert.equal(payload.notifyCustomer, false);
});

test("a waiting package opens back into the form it was saved from", () => {
  const original = draft({ lengthIn: "40", widthIn: "30.5", heightIn: "20", price: "45.50", payOnArrival: true });
  const stored = {
    ...addWaitingPackagePayload("biz", original),
    id: "w1",
    containerId: "",
    containerStatus: "waiting",
    paidCents: 0,
  };
  const reopened = waitingPackageDraftFromRow(stored);
  assert.equal(reopened.kind, "barrels");
  assert.equal(reopened.quantity, "2");
  assert.equal(reopened.customerName, "Fatou Diallo");
  assert.equal(reopened.destinationCountryId, "guinea");
  assert.equal(reopened.lengthIn, "40");
  assert.equal(reopened.widthIn, "30.5");
  assert.equal(reopened.price, "45.50");
  assert.equal(reopened.payOnArrival, true);
  assert.deepEqual(validateWaitingPackage(reopened), []);
  // A line from before sizes and prices existed opens empty there.
  const old = waitingPackageDraftFromRow({ id: "l", kind: "barrels", quantity: 3, customerName: "A" });
  assert.equal(old.lengthIn, "");
  assert.equal(old.price, "");
});

test("an edit has no container and leaves the price to setContainerLinePrice", () => {
  const request = updateWaitingPackageRequest(" biz ", " w1 ", draft({ price: "45", payOnArrival: true, lengthIn: "40", widthIn: "30", heightIn: "20" }));
  assert.equal(request.businessId, "biz");
  assert.equal(request.lineId, "w1");
  assert.equal(request.containerId, "");
  assert.equal("priceCents" in request.line, false);
  assert.equal(request.line.destinationCountryId, "guinea");
  assert.equal(request.line.lengthIn, 40);
  assert.equal(request.line.quantity, 2);
});

test("a price call is made only when the price or the switch changed", () => {
  const line = { priceCents: 4550, payOnArrival: false };
  assert.equal(packagePriceChanged(line, draft({ price: "45.50" })), false);
  assert.equal(packagePriceChanged(line, draft({ price: "46" })), true);
  assert.equal(packagePriceChanged(line, draft({ price: "45.50", payOnArrival: true })), true);
  assert.equal(packagePriceChanged(line, draft({ price: "" })), true);
  assert.equal(packagePriceChanged({}, draft({ price: "" })), false);
});

test("a saved package is usable by the labels dialog before the live list catches up", () => {
  const stub = savedPackageStub({ lineId: "w9", trackingCode: "CL-K7M4P2" }, draft());
  assert.equal(stub.id, "w9");
  assert.equal(stub.trackingCode, "CL-K7M4P2");
  assert.equal(stub.containerId, "");
  assert.equal(stub.quantity, 2);
});

// ---------------------------------------------------------------------------
// The list.
// ---------------------------------------------------------------------------

test("the list is newest drop-off first", () => {
  const rows = [
    { id: "old", createdAt: new Date("2026-10-01") },
    { id: "new", createdAt: { toMillis: () => new Date("2026-10-05").getTime() } },
    { id: "mid", createdAt: { seconds: Math.floor(new Date("2026-10-03").getTime() / 1000) } },
    { id: "none" },
  ];
  assert.deepEqual(sortWaitingNewestFirst(rows).map((r) => r.id), ["new", "mid", "old", "none"]);
});

test("a list row is read once: line, size, money and VIN", () => {
  const row = waitingPackageRow({
    id: "w1", kind: "car", vinNumber: "1hgcm82633a004352", lengthIn: 180, widthIn: 70, heightIn: 60,
    priceCents: 80000, paidCents: 80000, containerId: "", containerStatus: "waiting",
  });
  assert.equal(row.vin, "1HGCM82633A004352");
  assert.equal(row.payment.status, "paid");
  assert.equal(row.size?.volumeText, "437.5 ft³");
  assert.equal(row.line.containerStatus, "waiting");
});

// ---------------------------------------------------------------------------
// Calling the server.
// ---------------------------------------------------------------------------

test("a package call keeps the busy flag honest and hands a refusal over with its details", async () => {
  const busy: boolean[] = [];
  let done = false;
  await runPackageCall((value) => busy.push(value), async () => { done = true; }, () => assert.fail("no failure expected"));
  assert.equal(done, true);
  assert.deepEqual(busy, [true, false]);

  const failures: Array<{ message: string; offendingLineIds: string[] }> = [];
  await runPackageCall(
    (value) => busy.push(value),
    async () => {
      throw Object.assign(new Error(CONTAINER_MESSAGES.destination_mismatch), {
        details: { reason: "destination_mismatch", lineIds: ["w2"] },
      });
    },
    (failure) => failures.push(failure),
  );
  assert.deepEqual(failures.map((f) => [f.message, f.offendingLineIds]), [[CONTAINER_MESSAGES.destination_mismatch, ["w2"]]]);
  assert.deepEqual(busy.slice(2), [true, false], "busy resolves on the failing path too");
});
