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
  emptyIntakeMoney,
  emptyWaitingPackageDraft,
  filterWaitingPackages,
  firstInvalidWaitingPackageField,
  WAITING_PACKAGE_FIELD_ORDER,
  intakeMoneyAvailable,
  intakePaymentPayload,
  mainDestinationChanges,
  nextPackageForSameSender,
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
  switchIntakeMoney,
  updateWaitingPackageRequest,
  validateIntakeMoney,
  validatePackagePaymentDraft,
  validatePackagePrice,
  validateWaitingPackage,
  volumeCubicFeet,
  waitingCountText,
  waitingPackageDraftFromRow,
  waitingPackageFieldMessage,
  waitingPackageMessage,
  waitingPackageRow,
  wholeBalanceInput,
  assignAnswerFrom,
  buildLineGroups,
  clampPiecesGoing,
  editPriceRequest,
  groupForLine,
  groupMoneyNote,
  groupPayment,
  labelCountText,
  labelsPieceCount,
  linePaidFloor,
  partHintText,
  partLabelStubs,
  partsCreatedText,
  piecesGoingText,
  piecesStayText,
  previewPartCode,
  splitPreviewRows,
  splittablePieceCount,
  waitingDraftLabelCount,
  waitingDraftTotalCents,
  type WaitingPackageDraft,
} from "./waiting-packages.ts";
import { newPieceDraft, type PieceDraft } from "./piece-drafts.ts";
import { revealField } from "./reveal-field.ts";

const guinea = { id: "guinea", name: "Guinea" };

/** A barrel, priced as typed. */
function barrel(price = ""): PieceDraft {
  return { ...newPieceDraft("barrel"), price };
}

/** A box that says what is in it. */
function box(description: string, price = ""): PieceDraft {
  return { ...newPieceDraft("box"), description, price };
}

/** A complete two-barrel draft; each test changes what it is about. */
function draft(over: Partial<WaitingPackageDraft> = {}): WaitingPackageDraft {
  return {
    ...emptyWaitingPackageDraft(guinea),
    kind: "barrels",
    pieces: [barrel(), barrel()],
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
  const ok = { ...emptyPackagePaymentDraft, amount: "30", receivedByStaffId: "s1" };
  assert.deepEqual(validatePackagePaymentDraft(ok, owing), []);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, amount: "30.01" }, owing), ["payment_exceeds_balance"]);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, amount: "" }, owing), ["amount_required"]);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, amount: "0" }, owing), ["amount_required"]);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, amount: "-5" }, owing), ["amount_required"]);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, amount: "x" }, owing), ["amount_required"]);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, method: "bitcoin" as never }, owing), ["payment_method_invalid"]);
  assert.deepEqual(validatePackagePaymentDraft(ok, packagePayment({})), ["price_required"], "nothing to pay against");
  // Who took the money is required, blank by default, as for parking; every problem at once, in the server's order.
  assert.equal(emptyPackagePaymentDraft.receivedByStaffId, "");
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, receivedByStaffId: "" }, owing), ["received_by_required"]);
  assert.deepEqual(validatePackagePaymentDraft({ ...ok, receivedByStaffId: "   " }, owing), ["received_by_required"]);
  assert.deepEqual(
    validatePackagePaymentDraft({ ...emptyPackagePaymentDraft, amount: "", method: "bitcoin" as never }, owing),
    ["amount_required", "payment_method_invalid", "received_by_required"],
  );
  assert.equal(packagePaymentMessage(["received_by_required"]), "Say which staff member took the payment.");
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
  assert.deepEqual(
    validatePackagePaymentDraft({ ...emptyPackagePaymentDraft, amount: wholeBalanceInput(payment), receivedByStaffId: "s1" }, payment),
    [],
  );
});

test("the payment requests carry whole cents, the method id, who took it and a bounded note", () => {
  assert.deepEqual(
    recordPackagePaymentRequest(" biz ", "w1", { amount: "12,50", method: "zelle", note: "  deposit ", receivedByStaffId: " s1 " }),
    { businessId: "biz", lineId: "w1", amountCents: 1250, method: "zelle", receivedByStaffId: "s1", note: "deposit" },
  );
  assert.equal(
    recordPackagePaymentRequest("b", "l", { amount: "1", method: "cash", note: "x".repeat(500), receivedByStaffId: "s1" }).note.length,
    200,
  );
  assert.deepEqual(revertPackagePaymentRequest(" biz ", " p1 "), { businessId: "biz", paymentId: "p1" });
  assert.equal(packageMethodLabel("card_in_person"), "Card in person");
  assert.equal(packageMethodLabel("mystery"), "mystery");
});

test("the server's payment validator asks for the same things, in the same order", () => {
  const server = readFileSync(new URL("../../../my_flutter_app/functions/container_payments.js", import.meta.url), "utf8");
  const codes = [...server.matchAll(/errors\.push\("([a-z_]+)"\)/g)].map((m) => m[1]);
  const client = readFileSync(new URL("./waiting-packages.ts", import.meta.url), "utf8");
  const start = client.indexOf("export function validatePackagePaymentDraft");
  const end = client.indexOf("export function wholeBalanceInput");
  const mirrored = [...client.slice(start, end).matchAll(/errors\.push\("([a-z_]+)"\)/g)].map((m) => m[1]);
  // The client answers a missing price before anything else, so it never pushes that code.
  assert.deepEqual(mirrored, codes.filter((code) => code !== "price_required"));
  assert.ok(mirrored.includes("received_by_required"));
});

test("payment history keeps reverted rows, marked, newest first, with who took, who entered and who reverted", () => {
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
  // Held by one person, typed in by another; older rows have no recorder.
  const [held] = packagePaymentEntries([{ id: "d", amountCents: 100, method: "cash", receivedByStaffId: "cashier", recordedByStaffId: "owner" }]);
  assert.equal(held.receivedByStaffId, "cashier");
  assert.equal(held.recordedByStaffId, "owner");
  assert.equal(entries[0].recordedByStaffId, "");
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

test("save & add another keeps only the sender, for a different receiver or country", () => {
  const first = draft({
    pieces: [barrel("75"), box("Clothes", "45")], destinationCountryId: "senegal", destinationCountryName: "Senegal",
    payOnArrival: true, notifyCustomer: false, notifyReceiver: false,
  });
  const next = nextPackageForSameSender(first, guinea);
  for (const kept of ["customerName", "customerPhone", "notifyCustomer"] as const) {
    assert.equal(next[kept], first[kept], kept);
  }
  assert.equal(next.receiverName, "");
  assert.equal(next.receiverPhone, "");
  assert.equal(next.notifyReceiver, true, "the next receiver starts switched on");
  assert.equal(next.destinationCountryId, "guinea", "back on the main destination");
  assert.equal(next.payOnArrival, false);
  assert.equal(next.kind, "barrels");
  assert.equal(next.pieces.length, 1);
  assert.equal(next.pieces[0].kind, "barrel");
  assert.equal(next.pieces[0].price, "");
  assert.deepEqual(next.money, emptyIntakeMoney());
});

test("sender is the receiver: one person on both sides, and the next package keeps them as sender", () => {
  const same = draft({ customerName: "", customerPhone: "", senderIsReceiver: true });
  assert.deepEqual(validateWaitingPackage(same), []);
  const payload = addWaitingPackagePayload("biz", same);
  assert.equal(payload.senderIsReceiver, true);
  assert.equal(payload.customerName, "Mariama Bah");
  assert.equal(payload.customerPhone, "+224620112233");
  // Save & add another: the next package goes to someone else, from them.
  const next = nextPackageForSameSender(same, guinea);
  assert.equal(next.senderIsReceiver, false);
  assert.equal(next.customerName, "Mariama Bah");
  assert.equal(next.customerPhone, "+224 620 11 22 33");
  assert.equal(next.receiverName, "");
  // Reopened, the box is ticked and the sender fields are blank.
  const reopened = waitingPackageDraftFromRow({ id: "w", ...payload });
  assert.equal(reopened.senderIsReceiver, true);
  assert.equal(reopened.customerName, "");
});

test("a package needs pieces that say what they are, a country, and a car its VIN, size and price", () => {
  assert.deepEqual(validateWaitingPackage(draft()), []);
  // The sender is optional (owner, 2026-10-21); the receiver's name is not.
  assert.deepEqual(validateWaitingPackage(draft({ customerName: "", customerPhone: "" })), []);
  assert.deepEqual(validateWaitingPackage(draft({ receiverName: " " })), ["receiver_name_required"]);
  assert.deepEqual(validateWaitingPackage(draft({ pieces: [] })), ["pieces_required"]);
  assert.deepEqual(validateWaitingPackage(draft({ pieces: [box("")] })), ["piece_description_required"]);
  assert.deepEqual(validateWaitingPackage(draft({ pieces: [barrel("-3")] })), ["piece_price_invalid"]);
  assert.deepEqual(validateWaitingPackage(draft({ pieces: [barrel("0")] })), [], "zero is a price");
  assert.deepEqual(validateWaitingPackage(draft({ pieces: [{ ...box("TV"), lengthIn: "40" }] })), ["piece_size_invalid"], "two sides are no size");
  assert.deepEqual(validateWaitingPackage(draft({ kind: "car", vinNumber: "123" })), ["vin_required"]);
  assert.deepEqual(validateWaitingPackage(draft({ customerPhone: "call me" })), ["customer_phone_invalid"]);
  assert.deepEqual(validateWaitingPackage(draft({ destinationCountryId: "" })), ["package_destination_required"]);
  // A car keeps its own size and price.
  const car = { kind: "car" as const, vinNumber: "1HGCM82633A004352" };
  assert.deepEqual(validateWaitingPackage(draft({ ...car, lengthIn: "40", widthIn: "30", heightIn: "20" })), []);
  assert.deepEqual(validateWaitingPackage(draft({ ...car, lengthIn: "40" })), ["size_invalid"]);
  assert.deepEqual(validateWaitingPackage(draft({ ...car, price: "-3" })), ["price_invalid"]);
  // Pieces ignore the car-only fields entirely.
  assert.deepEqual(validateWaitingPackage(draft({ lengthIn: "40", price: "x" })), []);
  // Every problem at once, in the server's sentences.
  const everything = validateWaitingPackage(draft({ receiverName: "", destinationCountryId: "", pieces: [box("", "x")] }));
  assert.deepEqual(everything, ["piece_price_invalid", "piece_description_required", "receiver_name_required", "package_destination_required"]);
  assert.equal(
    waitingPackageMessage(["receiver_name_required", "piece_size_invalid"]),
    `${CONTAINER_MESSAGES.receiver_name_required} ${CONTAINER_MESSAGES.piece_size_invalid}`,
  );
  assert.equal(firstInvalidWaitingPackageField(["receiver_name_required"]), "wpk-receiver-name");
});

test("the add request sends the pieces (ids, kinds, sizes, cents) and the summary older servers read", () => {
  const payload = addWaitingPackagePayload(" biz ", draft({
    pieces: [barrel("100"), { ...box("Clothes", "45,50"), lengthIn: "20", widthIn: "20", heightIn: "18,5" }],
    payOnArrival: true,
    // Car-only fields are not sent for pieces.
    lengthIn: "40", widthIn: "30", heightIn: "20", price: "99",
  }));
  assert.deepEqual(payload, {
    businessId: "biz",
    kind: "other",
    vinNumber: "",
    carMake: "",
    carModel: "",
    carYear: "",
    ownerKind: "customer",
    customerName: "Fatou Diallo",
    customerPhone: "+12075550101",
    receiverName: "Mariama Bah",
    receiverPhone: "+224620112233",
    notifyCustomer: true,
    notifyReceiver: true,
    senderIsReceiver: false,
    quantity: 2,
    description: "Barrel, Clothes",
    pieces: [
      { id: "", kind: "barrel", description: "", sizeIn: null, priceCents: 10000 },
      { id: "", kind: "box", description: "Clothes", sizeIn: { l: 20, w: 20, h: 18.5 }, priceCents: 4550 },
    ],
    destinationCountryId: "guinea",
    destinationCountryName: "Guinea",
    payOnArrival: true,
  });
  const barrels = addWaitingPackagePayload("biz", draft());
  assert.equal(barrels.kind, "barrels");
  assert.equal(barrels.description, "");
  assert.equal("priceCents" in barrels, false, "the server sums the pieces");
  assert.deepEqual(barrels.pieces?.map((p) => p.priceCents), [null, null]);
});

test("the total is the sum of the priced pieces; a car's is its price", () => {
  assert.equal(waitingDraftTotalCents(draft()), null);
  assert.equal(waitingDraftTotalCents(draft({ pieces: [barrel("100"), barrel(""), box("TV", "45.50")] })), 14550);
  assert.equal(waitingDraftTotalCents(draft({ pieces: [barrel("0")] })), null, "nothing to pay is no price");
  assert.equal(waitingDraftTotalCents(draft({ pieces: [barrel("x")] })), null);
  assert.equal(waitingDraftTotalCents(draft({ kind: "car", price: "800" })), 80000);
  assert.equal(waitingDraftLabelCount(draft({ pieces: [barrel(), barrel(), box("TV")] })), 3);
  assert.equal(waitingDraftLabelCount(draft({ kind: "car" })), 1);
});

// ---------------------------------------------------------------------------
// "Money received now?" at registration.
// ---------------------------------------------------------------------------

const STAFF = ["owner", "cashier"];

/** Pieces priced at $150 in all, with the money section switched on. */
function paidDraft(money: Partial<WaitingPackageDraft["money"]> = {}, over: Partial<WaitingPackageDraft> = {}): WaitingPackageDraft {
  const on = switchIntakeMoney(draft({ pieces: [barrel("100"), box("Clothes", "50")], ...over }), true);
  return { ...on, money: { ...on.money, receivedByStaffId: "cashier", ...money } };
}

test("money received now opens only on a total, on the full total, cash, nobody chosen", () => {
  const blank = emptyWaitingPackageDraft(guinea);
  assert.deepEqual(blank.money, { received: false, ...emptyPackagePaymentDraft });
  assert.equal(intakeMoneyAvailable(draft()), false);
  assert.equal(intakeMoneyAvailable(draft({ pieces: [barrel("x")] })), false);
  assert.equal(intakeMoneyAvailable(draft({ pieces: [barrel("45,50")] })), true);
  assert.equal(intakeMoneyAvailable(draft({ kind: "car", price: "45,50" })), true);
  // No price: the switch does nothing.
  const unpriced = draft();
  assert.equal(switchIntakeMoney(unpriced, true), unpriced);
  const on = switchIntakeMoney(draft({ pieces: [barrel("40"), barrel("5,50")] }), true);
  assert.deepEqual(on.money, { received: true, amount: "45.50", method: "cash", note: "", receivedByStaffId: "" });
  // Off forgets what was typed.
  const off = switchIntakeMoney({ ...on, money: { ...on.money, amount: "10", receivedByStaffId: "cashier" } }, false);
  assert.deepEqual(off.money, emptyIntakeMoney());
});

test("money received now is judged against the total, the way the server refuses a payment", () => {
  assert.deepEqual(validateWaitingPackage(paidDraft(), STAFF), []);
  assert.deepEqual(validateWaitingPackage(paidDraft({ amount: "40" }), STAFF), [], "part now, the rest later");
  assert.deepEqual(validateWaitingPackage(paidDraft({ receivedByStaffId: "" }), STAFF), ["received_by_required"]);
  assert.deepEqual(validateWaitingPackage(paidDraft({ receivedByStaffId: "stranger" }), STAFF), ["received_by_invalid"]);
  assert.deepEqual(validateWaitingPackage(paidDraft({ amount: "150.01" }), STAFF), ["payment_exceeds_balance"]);
  assert.deepEqual(validateWaitingPackage(paidDraft({ amount: "0" }), STAFF), ["amount_required"]);
  assert.deepEqual(validateWaitingPackage(paidDraft({ amount: "" }), STAFF), ["amount_required"]);
  assert.deepEqual(validateWaitingPackage(paidDraft({ method: "barter" as never }), STAFF), ["payment_method_invalid"]);
  // The prices taken away after the switch was turned on.
  assert.deepEqual(validateWaitingPackage({ ...paidDraft(), pieces: [barrel(""), box("Clothes", "")] }, STAFF), ["price_required"]);
  // Switched off: nothing about money is checked.
  assert.deepEqual(validateWaitingPackage(draft({ money: { ...emptyIntakeMoney(), amount: "999" } }), STAFF), []);
  assert.deepEqual(validateIntakeMoney(paidDraft({ receivedByStaffId: "stranger" })), [], "no list, no membership check");
  assert.equal(
    waitingPackageMessage(["received_by_invalid"]),
    "Choose someone on your team as the person who took the payment.",
  );
});

test("the add request carries the money as payment, in cents, only when it was received", () => {
  const payload = addWaitingPackagePayload("biz", paidDraft({ amount: "60", method: "zelle", note: "  at the counter " }));
  assert.deepEqual(payload.payment, { amountCents: 6000, method: "zelle", receivedByStaffId: "cashier", note: "at the counter" });
  assert.deepEqual(payload.pieces?.map((p) => p.priceCents), [10000, 5000]);
  assert.deepEqual(intakePaymentPayload(paidDraft()), { amountCents: 15000, method: "cash", receivedByStaffId: "cashier" }, "no note, none sent");
  // Switched off, or never on: the request is what it always was.
  const before = addWaitingPackagePayload("biz", draft({ pieces: [barrel("150")] }));
  assert.equal("payment" in before, false);
  assert.equal(intakePaymentPayload(draft({ money: { ...emptyIntakeMoney(), amount: "60", receivedByStaffId: "cashier" } })), null);
  // An edit never sends money: that is "Record a payment".
  assert.equal("payment" in updateWaitingPackageRequest("biz", "w1", paidDraft()).line, false);
});

test("money is per package: add another, and reopening a saved one, start with none", () => {
  const next = nextPackageForSameSender(paidDraft({ amount: "60" }), guinea);
  assert.deepEqual(next.money, emptyIntakeMoney());
  const reopened = waitingPackageDraftFromRow({ id: "w1", kind: "barrels", quantity: 2, priceCents: 15000, paidCents: 6000 });
  assert.deepEqual(reopened.money, emptyIntakeMoney());
});

test("a car goes with its VIN, cleaned, its size and price, and counts as one", () => {
  const car = addWaitingPackagePayload("biz", draft({
    kind: "car", vinNumber: " 1hgcm82633a004352 ", carMake: "Honda", carModel: "Accord", carYear: "2003",
    lengthIn: "180", widthIn: "70", heightIn: "60", price: "800",
  }));
  assert.equal(car.kind, "car");
  assert.equal(car.vinNumber, "1HGCM82633A004352");
  assert.equal(car.quantity, 1);
  assert.equal(car.carMake, "Honda");
  assert.equal("pieces" in car, false, "a car is one implicit piece");
  assert.equal(car.priceCents, 80000);
  assert.equal(car.lengthIn, 180);
});

test("a switch with no number is sent off", () => {
  const payload = addWaitingPackagePayload("biz", draft({ receiverPhone: "", notifyReceiver: true, customerPhone: "+12075550101", notifyCustomer: false }));
  assert.equal(payload.notifyReceiver, false);
  assert.equal(payload.notifyCustomer, false);
});

test("a waiting package opens back into the form with its pieces, ids kept", () => {
  const stored = {
    id: "w1", kind: "other", quantity: 2, containerId: "", containerStatus: "waiting", paidCents: 0,
    customerName: "Fatou Diallo", destinationCountryId: "guinea", destinationCountryName: "Guinea", payOnArrival: true,
    pieces: [
      { id: "p1", kind: "barrel", description: "", sizeIn: null, priceCents: 10000 },
      { id: "p7", kind: "box", description: "Clothes", sizeIn: { l: 20, w: 20.5, h: 18 }, priceCents: 4550 },
    ],
    priceCents: 14550,
  };
  const reopened = waitingPackageDraftFromRow(stored);
  assert.equal(reopened.kind, "other");
  assert.deepEqual(reopened.pieces.map((p) => [p.id, p.kind, p.description, p.lengthIn, p.widthIn, p.heightIn, p.price]), [
    ["p1", "barrel", "", "", "", "", "100"],
    ["p7", "box", "Clothes", "20", "20.5", "18", "45.50"],
  ]);
  assert.equal(reopened.price, "", "no line price for pieces");
  assert.equal(reopened.payOnArrival, true);
  assert.deepEqual(validateWaitingPackage({ ...draft(), ...reopened, customerName: "Fatou Diallo", receiverName: "Mariama Bah" }), []);
  // Saved before the receiver's name was required: an edit that leaves its
  // people alone is not refused; one that changes them asks for it.
  const storedLine = { ...stored, ownerKind: "customer" };
  assert.deepEqual(validateWaitingPackage(reopened, undefined, storedLine), []);
  assert.deepEqual(validateWaitingPackage({ ...reopened, customerPhone: "+16465550100" }, undefined, storedLine), ["receiver_name_required"]);
  // A line from before pieces reads as its pieces: 3 barrels, the price spread.
  const old = waitingPackageDraftFromRow({ id: "l", kind: "barrels", quantity: 3, customerName: "A", priceCents: 10000 });
  assert.deepEqual(old.pieces.map((p) => [p.id, p.kind, p.price]), [["p1", "barrel", "33.34"], ["p2", "barrel", "33.33"], ["p3", "barrel", "33.33"]]);
  // A car keeps its size and price on the line.
  const car = waitingPackageDraftFromRow({ id: "c", kind: "car", vinNumber: "1HGCM82633A004352", lengthIn: 180, widthIn: 70, heightIn: 60, priceCents: 80000 });
  assert.equal(car.lengthIn, "180");
  assert.equal(car.price, "800");
});

test("an edit sends the pieces with their ids and prices, no container and no line price", () => {
  const row = {
    id: "w1", kind: "other", pieces: [
      { id: "p1", kind: "barrel", description: "", sizeIn: null, priceCents: 10000 },
      { id: "p2", kind: "box", description: "Clothes", sizeIn: null, priceCents: 4500 },
    ],
  };
  const edited = waitingPackageDraftFromRow(row);
  const request = updateWaitingPackageRequest(" biz ", " w1 ", { ...edited, pieces: [edited.pieces[0], { ...edited.pieces[1], price: "50" }, box("TV", "")] }, row);
  assert.equal(request.businessId, "biz");
  assert.equal(request.lineId, "w1");
  assert.equal(request.containerId, "");
  assert.equal("priceCents" in request.line, false);
  assert.deepEqual(request.line.pieces?.map((p) => [p.id, p.kind, p.priceCents]), [["p1", "barrel", 10000], ["p2", "box", 5000], ["", "box", null]]);
  assert.equal(request.line.quantity, 3);
});

test("a legacy package edited without touching its pieces is sent in its old form", () => {
  const legacy = { id: "l1", kind: "barrels", quantity: 3, priceCents: 10000, destinationCountryId: "guinea", customerName: "A" };
  const reopened = waitingPackageDraftFromRow(legacy);
  const untouched = updateWaitingPackageRequest("biz", "l1", { ...reopened, receiverName: "Moussa" }, legacy);
  assert.equal("pieces" in untouched.line, false, "the contacts change, the barrels stay as stored");
  assert.equal(untouched.line.kind, "barrels");
  assert.equal(untouched.line.quantity, 3);
  assert.equal(untouched.line.receiverName, "Moussa");
  const changed = updateWaitingPackageRequest("biz", "l1", { ...reopened, pieces: [...reopened.pieces, box("TV", "20")] }, legacy);
  assert.equal(changed.line.pieces?.length, 4, "changed pieces are written as pieces");
  // Only the switch makes a price call, with the stored total.
  assert.equal(editPriceRequest("biz", "l1", legacy, reopened), null);
  assert.deepEqual(editPriceRequest("biz", "l1", legacy, { ...reopened, payOnArrival: true }), {
    businessId: "biz", lineId: "l1", priceCents: 10000, payOnArrival: true,
  });
});

test("a price call is a car's price or the switch; pieces pass their new total unchanged", () => {
  const car = { kind: "car", priceCents: 4550, payOnArrival: false };
  const carDraft = (over: Partial<WaitingPackageDraft>) => draft({ kind: "car", vinNumber: "1HGCM82633A004352", ...over });
  assert.equal(packagePriceChanged(car, carDraft({ price: "45.50" })), false);
  assert.equal(packagePriceChanged(car, carDraft({ price: "46" })), true);
  assert.equal(packagePriceChanged(car, carDraft({ price: "45.50", payOnArrival: true })), true);
  assert.equal(packagePriceChanged(car, carDraft({ price: "" })), true);
  assert.equal(packagePriceChanged({ kind: "car" }, carDraft({ price: "" })), false);
  assert.deepEqual(editPriceRequest("biz", "c1", car, carDraft({ price: "46" })), { businessId: "biz", lineId: "c1", priceCents: 4600, payOnArrival: false });

  const pieced = { kind: "other", priceCents: 14500, payOnArrival: false, pieces: [{ id: "p1", kind: "barrel", priceCents: 14500 }] };
  const piecedDraft = waitingPackageDraftFromRow(pieced);
  // A new piece price travels in updateContainerLine: no price call for it.
  assert.equal(editPriceRequest("biz", "w1", pieced, { ...piecedDraft, pieces: [{ ...piecedDraft.pieces[0], price: "150" }] }), null);
  // The switch: the new total goes back as it is, so the server only toggles it.
  assert.deepEqual(editPriceRequest("biz", "w1", pieced, { ...piecedDraft, pieces: [{ ...piecedDraft.pieces[0], price: "150" }], payOnArrival: true }), {
    businessId: "biz", lineId: "w1", priceCents: 15000, payOnArrival: true,
  });
});

test("a saved package is usable by the labels dialog before the live list catches up", () => {
  const stub = savedPackageStub({ lineId: "w9", trackingCode: "CL-K7M4P2" }, draft({ pieces: [barrel(), barrel(), box("TV")] }));
  assert.equal(stub.id, "w9");
  assert.equal(stub.trackingCode, "CL-K7M4P2");
  assert.equal(stub.containerId, "");
  assert.equal(stub.quantity, 3);
  assert.equal(stub.pieceCount, 3);
  assert.equal(labelsPieceCount([stub]), 3);
  assert.equal(labelCountText(3, 2, "en"), "Prints 6 labels: 3 pieces × 2");
  assert.equal(labelCountText(1, 1, "fr"), "Imprime 1 étiquette : 1 colis × 1");
});

// ---------------------------------------------------------------------------
// Splitting a package across containers.
// ---------------------------------------------------------------------------

const fourPieces = {
  id: "w4", kind: "other", trackingCode: "CL-T9W2QA", containerId: "", containerStatus: "waiting",
  pieces: [
    { id: "p1", kind: "barrel", priceCents: 10000 },
    { id: "p2", kind: "barrel", priceCents: 10000 },
    { id: "p3", kind: "box", description: "Clothes", priceCents: 5000 },
    { id: "p4", kind: "box", description: "Shoes", priceCents: 5000 },
  ],
};

test("the assign request names only the packages sending fewer than all their pieces", () => {
  const car = { id: "c1", kind: "car", vinNumber: "1HGCM82633A004352" };
  const legacy = { id: "l3", kind: "barrels", quantity: 3 };
  const request = assignLinesRequest("biz", "box", ["w4", "c1", "l3", "w4"], { w4: 2, c1: 1, l3: 3 }, [fourPieces, car, legacy]);
  assert.deepEqual(request, { businessId: "biz", containerId: "box", lineIds: ["w4", "c1", "l3"], pieceCounts: { w4: 2 } });
  // All of them going, or no stepper touched: the request it always was.
  assert.deepEqual(assignLinesRequest("biz", "box", ["w4"], { w4: 4 }, [fourPieces]), { businessId: "biz", containerId: "box", lineIds: ["w4"] });
  assert.deepEqual(assignLinesRequest("biz", "box", ["w4"]), { businessId: "biz", containerId: "box", lineIds: ["w4"] });
  // A car is never split; a legacy line splits by its quantity.
  assert.equal(splittablePieceCount(car), 0);
  assert.equal(splittablePieceCount(legacy), 3);
  assert.equal(clampPiecesGoing(0, 4), 1);
  assert.equal(clampPiecesGoing(9, 4), 4);
});

test("the split preview names what goes and the part code that stays", () => {
  assert.equal(piecesGoingText(2, 4, "en"), "Pieces going in: 2 of 4");
  assert.equal(piecesGoingText(2, 4, "fr"), "Colis qui partent : 2 sur 4");
  assert.deepEqual(splitPreviewRows(fourPieces, 2, [fourPieces], "en").map((r) => `${r.code} ${r.text}`), [
    "CL-T9W2QA 2 pieces → this container",
    "CL-T9W2QA-2 2 pieces stay waiting",
  ]);
  assert.deepEqual(splitPreviewRows(fourPieces, 3, [], "fr").map((r) => `${r.code} ${r.text}`), [
    "CL-T9W2QA 3 colis → ce conteneur",
    "CL-T9W2QA-2 1 colis reste en attente",
  ]);
  assert.deepEqual(splitPreviewRows(fourPieces, 4, [fourPieces]), [], "all of it goes: nothing to preview");
  // A part split again takes the next number after the group's highest.
  const part2 = { ...fourPieces, id: "w5", trackingCode: "CL-T9W2QA-2", rootLineId: "w4", partIndex: 2 };
  const root = { id: "w4", trackingCode: "CL-T9W2QA", rootLineId: "w4", lastPartIndex: 3 };
  assert.equal(previewPartCode(part2, [root, part2]), "CL-T9W2QA-4", "a cancelled -3 is never reused");
  assert.equal(previewPartCode(part2, [part2]), "CL-T9W2QA-3", "without the root, read off the part's own code");
});

test("the assign answer is read defensively, and its parts become label stubs", () => {
  assert.deepEqual(assignAnswerFrom({ success: true, assigned: 2 }), { assigned: 2, alreadyAssigned: 0, parts: [] });
  const answer = assignAnswerFrom({
    success: true, assigned: 1, alreadyAssigned: 0,
    parts: [{ lineId: "w4", partLineId: "w9", trackingCode: "CL-T9W2QA-2", pieceCount: 2 }, { lineId: "x" }, null],
  });
  assert.deepEqual(answer.parts, [{ lineId: "w4", partLineId: "w9", trackingCode: "CL-T9W2QA-2", pieceCount: 2 }]);
  const stubs = partLabelStubs(answer.parts);
  assert.deepEqual(stubs.map((s) => [s.id, s.trackingCode, s.containerId]), [["w9", "CL-T9W2QA-2", ""]]);
  assert.equal(labelsPieceCount(stubs), 2);
  assert.equal(partsCreatedText(1, "en"), "1 part stays waiting with a new code.");
  assert.equal(piecesStayText(2, "en"), "2 pieces stay waiting");
  assert.equal(piecesStayText(1, "fr"), "1 colis reste en attente");
});

// ---------------------------------------------------------------------------
// Group money: payments on the root, balance on every part.
// ---------------------------------------------------------------------------

test("a split group's money is read once for all its parts", () => {
  const rows = [
    { id: "r", rootLineId: "r", trackingCode: "CL-K7M4P2", priceCents: 20000, paidCents: 15000, payOnArrival: false, containerId: "box", kind: "barrels", quantity: 2 },
    { id: "p", rootLineId: "r", partIndex: 2, trackingCode: "CL-K7M4P2-2", priceCents: 10000, paidCents: 0, containerId: "", kind: "barrels", quantity: 1 },
    { id: "alone", trackingCode: "CL-BBBBBB", priceCents: 5000, paidCents: 5000, kind: "barrels", quantity: 1 },
  ];
  const groups = buildLineGroups(rows);
  assert.equal(groups.size, 2);
  const part = groupForLine(groups, rows[1]);
  assert.equal(part.partCount, 2);
  assert.equal(part.priceCents, 30000);
  assert.equal(part.paidCents, 15000);
  assert.equal(part.balanceCents, 15000);
  const money = groupPayment(part);
  assert.equal(money.status, "partial");
  assert.equal(money.balanceCents, 15000);
  assert.equal(partHintText(part, rows[1], "en"), "Part 2 of 2");
  assert.equal(partHintText(part, rows[0], "fr"), "Partie 1 sur 2");
  assert.equal(partHintText(groupForLine(groups, rows[2]), rows[2]), "", "a line alone has no part hint");
  assert.equal(groupPayment(groupForLine(groups, rows[2])).status, "paid");
  // A line the index does not hold is its own group.
  assert.equal(groupForLine(groups, { id: "new", priceCents: 100 }).priceCents, 100);
  // The part may not take the group below what the root was paid: $150 paid,
  // the root covers $200, so the part's floor is 0; the root's is $50.
  assert.equal(linePaidFloor(part, rows[1]), 0);
  assert.equal(linePaidFloor(part, rows[0]), 5000);
  assert.match(groupMoneyNote(part, "en"), /^Payments shared by all 2 parts \(CL-K7M4P2, CL-K7M4P2-2\)$/);
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

// ---------------------------------------------------------------------------
// A refused save points at the field to fix.
// ---------------------------------------------------------------------------

test("money received with nobody chosen points at Received by, with its own sentence", () => {
  // The live repro: "Money received now?" on, no "Received by" picked.
  const refused = switchIntakeMoney(draft({ pieces: [barrel("150")] }), true);
  const errors = validateWaitingPackage(refused, ["cashier"]);
  assert.deepEqual(errors, ["received_by_required"]);
  assert.equal(firstInvalidWaitingPackageField(errors), "wpk-received-by");
  assert.equal(waitingPackageFieldMessage(errors, "wpk-received-by"), CONTAINER_MESSAGES.received_by_required);
  assert.equal(waitingPackageFieldMessage(errors, "wpk-price"), "");
});

test("the first invalid field is the first on screen, not the first refusal listed", () => {
  assert.equal(firstInvalidWaitingPackageField(["receiver_phone_invalid", "received_by_required", "price_invalid"]), "wpk-price");
  assert.equal(firstInvalidWaitingPackageField(["customer_name_required", "piece_description_required"]), "wpk-pieces");
  assert.equal(firstInvalidWaitingPackageField(["received_by_invalid", "amount_required"]), "wpk-money-amount");
  // A refusal with no field of its own leaves focus alone; the message is beside the buttons.
  assert.equal(firstInvalidWaitingPackageField(["line_kind_invalid"]), null);
  assert.equal(firstInvalidWaitingPackageField([]), null);
});

test("every refusal the register form can produce that names a field maps to one the form renders", () => {
  const fields = new Set<string>(WAITING_PACKAGE_FIELD_ORDER);
  const everything = validateWaitingPackage(
    {
      ...draft({ kind: "car", vinNumber: "", customerName: "", customerPhone: "12", receiverName: "", receiverPhone: "12", lengthIn: "3", price: "x", destinationCountryId: "" }),
      money: { ...emptyIntakeMoney(), received: true, amount: "", method: "barter" as never, receivedByStaffId: "" },
    },
    ["cashier"],
  );
  assert.ok(everything.length >= 5, everything.join());
  for (const code of everything) {
    const field = firstInvalidWaitingPackageField([code]);
    if (field) assert.ok(fields.has(field), code);
  }
});

test("revealing a field scrolls it into view and then focuses it without a second jump", () => {
  const calls: string[] = [];
  const field = {
    scrollIntoView: (options?: ScrollIntoViewOptions) => calls.push(`scroll:${options?.block}`),
    focus: (options?: FocusOptions) => calls.push(`focus:${options?.preventScroll}`),
  };
  assert.equal(revealField(field), true);
  assert.deepEqual(calls, ["scroll:center", "focus:true"]);
  assert.equal(revealField(null), false);
});
