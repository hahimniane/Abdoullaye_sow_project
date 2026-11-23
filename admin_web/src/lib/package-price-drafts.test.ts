import assert from "node:assert/strict";
import test from "node:test";

import {
  newPieceDraft,
  onePriceChangeNote,
  storedPiecesTotalCents,
  onePriceCountText,
  onePriceFromLine,
  onePriceLabel,
  packagePricingOf,
  pieceDraftProblems,
  pieceDraftsFromLine,
  piecesDifferFromLine,
  piecesDraftTotalCents,
  piecesPayload,
  storedPiecePrices,
  type PieceDraft,
} from "./piece-drafts.ts";
import {
  containerLineDraftFromRow,
  containerLinePayload,
  editedLinePayload,
  validateContainerLineDraft,
} from "./container-manifest.ts";
import {
  addWaitingPackagePayload,
  emptyWaitingPackageDraft,
  updateWaitingPackageRequest,
  waitingDraftTotalCents,
  waitingPackageDraftFromRow,
} from "./waiting-packages.ts";
import { receivePayload, receivePrefillOnePrice } from "./package-requests.ts";

// A saved package of three pieces priced item by item: $120 + $120 + $60.
const savedLine = {
  id: "line-1",
  kind: "other",
  quantity: 3,
  ownerKind: "customer",
  customerName: "Fatou Diallo",
  customerPhone: "+1 646 555 0100",
  receiverName: "Aissatou Diallo",
  receiverPhone: "+224 620 555 010",
  pieces: [
    { id: "p1", kind: "barrel", description: "clothes", sizeIn: null, priceCents: 12000 },
    { id: "p2", kind: "barrel", description: "clothes", sizeIn: null, priceCents: 12000 },
    { id: "p3", kind: "box", description: "shoes", sizeIn: { l: 20, w: 10, h: 10 }, priceCents: 6000 },
  ],
};

const rows = (drafts: PieceDraft[]) => drafts.map((d) => ({ kind: d.kind, description: d.description, count: d.count, price: d.price, priceFor: d.priceFor }));
const pricesOf = (drafts: PieceDraft[], onePrice: string, stored = storedPiecePrices(savedLine)) =>
  piecesPayload(drafts, { onePrice, stored }).map((p) => p.priceCents);

test("package mode groups a saved line by shape only, prices ignored", () => {
  const drafts = pieceDraftsFromLine(savedLine, { priceMode: "package" });
  assert.deepEqual(rows(drafts), [
    { kind: "barrel", description: "clothes", count: "2", price: "", priceFor: "each" },
    { kind: "box", description: "shoes", count: "1", price: "", priceFor: "each" },
  ]);
  assert.deepEqual(drafts[0].moreIds, ["p2"]);
});

test("piece mode is unchanged: prices that are not an even share keep rows apart", () => {
  const drafts = pieceDraftsFromLine({ ...savedLine, pieces: [
    { id: "p1", kind: "barrel", description: "clothes", sizeIn: null, priceCents: 12000 },
    { id: "p2", kind: "barrel", description: "clothes", sizeIn: null, priceCents: 6000 },
  ] });
  assert.equal(drafts.length, 2);
  assert.deepEqual(rows(pieceDraftsFromLine(savedLine)).map((r) => [r.count, r.price]), [["2", "120"], ["1", "60"]]);
  // An even share of one amount is the same line as before.
  const even = pieceDraftsFromLine({ ...savedLine, pieces: savedLine.pieces.slice(0, 2) });
  assert.deepEqual(rows(even).map((r) => [r.count, r.price, r.priceFor]), [["2", "120", "each"]]);
});

test("the price field opens on the sum of the stored prices, blank when none", () => {
  assert.equal(onePriceFromLine(savedLine), "300");
  assert.equal(onePriceFromLine({ ...savedLine, pieces: [{ id: "p1", kind: "box", description: "x", sizeIn: null, priceCents: 4550 }] }), "45.50");
  assert.equal(onePriceFromLine({ ...savedLine, pieces: [{ id: "p1", kind: "box", description: "x", sizeIn: null, priceCents: null }] }), "");
  assert.equal(onePriceFromLine({ kind: "car", priceCents: 100 }), "");
});

test("payload: a new package shares the one price in form order", () => {
  const drafts = [{ ...newPieceDraft("barrel"), description: "clothes", count: "3" }];
  assert.deepEqual(piecesPayload(drafts, { onePrice: "100", stored: null }).map((p) => p.priceCents), [3334, 3333, 3333]);
  assert.deepEqual(piecesPayload(drafts, { onePrice: "", stored: null }).map((p) => p.priceCents), [null, null, null]);
  assert.deepEqual(piecesPayload(drafts, { onePrice: "-5", stored: null }).map((p) => p.priceCents), [null, null, null]);
});

test("payload: an edit saved untouched keeps the item prices", () => {
  const drafts = pieceDraftsFromLine(savedLine, { priceMode: "package" });
  assert.deepEqual(pricesOf(drafts, onePriceFromLine(savedLine)), [12000, 12000, 6000]);
  assert.deepEqual(piecesPayload(drafts, { onePrice: "300", stored: storedPiecePrices(savedLine) }).map((p) => p.id), ["p1", "p2", "p3"]);
  assert.equal(piecesDifferFromLine(savedLine, drafts, { onePrice: "300", stored: storedPiecePrices(savedLine) }), false);
});

test("payload: a piece added, removed or a price changed shares the total again", () => {
  const drafts = pieceDraftsFromLine(savedLine, { priceMode: "package" });
  const added = drafts.map((d, i) => (i === 1 ? { ...d, count: "2" } : d));
  assert.deepEqual(pricesOf(added, "300"), [7500, 7500, 7500, 7500]);
  assert.deepEqual(piecesPayload(added, { onePrice: "300", stored: storedPiecePrices(savedLine) }).map((p) => p.id), ["p1", "p2", "p3", ""]);
  const removed = drafts.map((d, i) => (i === 0 ? { ...d, count: "1" } : d));
  assert.deepEqual(pricesOf(removed, "300"), [15000, 15000]);
  assert.deepEqual(pricesOf(drafts, "330"), [11000, 11000, 11000]);
  assert.equal(piecesDifferFromLine(savedLine, drafts, { onePrice: "330", stored: storedPiecePrices(savedLine) }), true);
});

test("problems: a customer's package needs more than $0 at the price field", () => {
  const drafts = [{ ...newPieceDraft("box"), description: "TV" }];
  const customer = (onePrice: string) => pieceDraftProblems(drafts, { priceRequired: true, pricing: { onePrice, stored: null } });
  assert.deepEqual(customer("").codes, ["package_price_required"]);
  assert.deepEqual(customer("0").codes, ["package_price_required"]);
  assert.deepEqual(customer("abc").codes, ["piece_price_invalid"]);
  assert.deepEqual(customer("-3").codes, ["piece_price_invalid"]);
  assert.deepEqual(customer("45,50").codes, []);
  assert.deepEqual(customer("").byPiece, [[]]);
});

test("problems: the business's own stock may have no price, but not a bad one", () => {
  const drafts = [{ ...newPieceDraft("box"), description: "TV" }];
  const stock = (onePrice: string) => pieceDraftProblems(drafts, { priceRequired: false, pricing: { onePrice, stored: null } });
  assert.deepEqual(stock("").codes, []);
  assert.deepEqual(stock("0").codes, []);
  assert.deepEqual(stock("x").codes, ["piece_price_invalid"]);
  assert.deepEqual(piecesPayload(drafts, { onePrice: "", stored: null }).map((p) => p.priceCents), [null]);
});

test("problems: a hidden row price never counts in package mode", () => {
  const drafts = [{ ...newPieceDraft("box"), description: "TV", price: "garbage" }];
  assert.deepEqual(pieceDraftProblems(drafts, { priceRequired: true, pricing: { onePrice: "50", stored: null } }).codes, []);
  assert.deepEqual(piecesPayload(drafts, { onePrice: "50", stored: null }).map((p) => p.priceCents), [5000]);
});

test("total is the one price plus the pickup fee", () => {
  const drafts = [{ ...newPieceDraft("barrel"), count: "2" }];
  assert.equal(piecesDraftTotalCents(drafts, 2000, { onePrice: "300", stored: null }), 32000);
  assert.equal(piecesDraftTotalCents(drafts, 0, { onePrice: "", stored: null }), null);
  assert.equal(piecesDraftTotalCents(drafts, 2000, { onePrice: "", stored: null }), null);
});

test("the count line and the label, in both languages", () => {
  assert.equal(onePriceLabel("en"), "Price for everything ($)");
  assert.equal(onePriceLabel("fr"), "Prix pour le tout ($)");
  assert.equal(onePriceCountText(3, "en"), "3 pieces, one price");
  assert.equal(onePriceCountText(3, "fr"), "3 pièces, un seul prix");
  assert.equal(onePriceCountText(1, "en"), "1 piece, one price");
  assert.equal(onePriceCountText(1, "fr"), "1 pièce, un seul prix");
});

test("the added/removed note, with its money in the language's format", () => {
  assert.equal(onePriceChangeNote(3, 4, 30000, "en"), "You added 1 piece. Still $300.00 for all 4? Change it here if not.");
  assert.equal(onePriceChangeNote(3, 4, 30000, "fr"), "Vous avez ajouté 1 pièce. Toujours 300,00 $ pour les 4 ? Sinon, modifiez-le ici.");
  assert.equal(onePriceChangeNote(2, 4, 30000, "en"), "You added 2 pieces. Still $300.00 for all 4? Change it here if not.");
  assert.equal(onePriceChangeNote(2, 4, 30000, "fr"), "Vous avez ajouté 2 pièces. Toujours 300,00 $ pour les 4 ? Sinon, modifiez-le ici.");
  assert.equal(onePriceChangeNote(3, 2, 30000, "en"), "You removed 1 piece. Still $300.00 for the 2 left? Change it here if not.");
  assert.equal(onePriceChangeNote(3, 2, 30000, "fr"), "Vous avez retiré 1 pièce. Toujours 300,00 $ pour les 2 restantes ? Sinon, modifiez-le ici.");
  assert.equal(onePriceChangeNote(4, 2, 123456, "fr"), "Vous avez retiré 2 pièces. Toujours 1 234,56 $ pour les 2 restantes ? Sinon, modifiez-le ici.");
  // No note: same count, nothing saved yet, no price typed.
  assert.equal(onePriceChangeNote(3, 3, 30000, "en"), "");
  assert.equal(onePriceChangeNote(undefined, 3, 30000, "en"), "");
  assert.equal(onePriceChangeNote(3, 4, null, "en"), "");
});

test("a line draft in package mode: prefill, validation and payload", () => {
  const draft = containerLineDraftFromRow(savedLine, "package");
  assert.equal(draft.priceMode, "package");
  assert.equal(draft.onePrice, "300");
  assert.equal(draft.pieces.length, 2);
  assert.deepEqual(validateContainerLineDraft(draft, savedLine), []);
  assert.deepEqual(containerLinePayload(draft).pieces?.map((p) => p.priceCents), [12000, 12000, 6000]);
  assert.deepEqual(editedLinePayload(savedLine, { ...draft, onePrice: "330" }).pieces?.map((p) => p.priceCents), [11000, 11000, 11000]);
  const blank = { ...draft, onePrice: "" };
  assert.deepEqual(validateContainerLineDraft(blank, savedLine), ["package_price_required"]);
  assert.deepEqual(validateContainerLineDraft({ ...blank, ownerKind: "stock" }, savedLine), []);
});

test("piece mode output is unchanged for the same drafts", () => {
  const drafts = pieceDraftsFromLine(savedLine);
  const before = piecesPayload(drafts);
  assert.deepEqual(before.map((p) => p.priceCents), [12000, 12000, 6000]);
  assert.deepEqual(piecesPayload(drafts, undefined), before);
  assert.equal(packagePricingOf({ priceMode: "piece", onePrice: "5" }), undefined);
  assert.equal(packagePricingOf({}), undefined);
  assert.deepEqual(pieceDraftProblems(drafts, { priceRequired: true }).codes, []);
  assert.equal(piecesDraftTotalCents(drafts, 2000), 32000);
  // A customer's piece with no price typed is still its own refusal in piece mode.
  const noPrice = [{ ...newPieceDraft("box"), description: "TV" }];
  assert.deepEqual(pieceDraftProblems(noPrice, { priceRequired: true }).byPiece, [["piece_price_required"]]);
});

test("receiving a request: prefilled with the estimate's total, sent shared", () => {
  const request = {
    id: "req-1",
    handoff: "collect",
    pieces: [
      { id: "p1", kind: "barrel", description: "clothes", estimateCents: 10000 },
      { id: "p2", kind: "box", description: "shoes", estimateCents: 5000 },
    ],
    estimate: { version: 1, totalCents: 20000, pickupFeeCents: 2000, pieces: [{ id: "p1", cents: 12000 }, { id: "p2", cents: 6000 }] },
  };
  // The estimate's pieces, the pickup fee left out.
  assert.equal(receivePrefillOnePrice(request), "180");
  // Without an estimate, the pieces' own estimates; when one has none, blank.
  assert.equal(receivePrefillOnePrice({ ...request, estimate: undefined }), "150");
  assert.equal(receivePrefillOnePrice({ ...request, estimate: undefined, pieces: [request.pieces[0], { ...request.pieces[1], estimateCents: null }] }), "");
  const drafts = [
    { ...newPieceDraft("barrel"), id: "p1", description: "clothes" },
    { ...newPieceDraft("box"), id: "p2", description: "shoes" },
  ];
  const sent = receivePayload(drafts, "20", { onePrice: "181", stored: null });
  assert.equal(sent.error, "");
  assert.deepEqual(sent.pieces.map((p) => p.priceCents), [9050, 9050]);
  assert.equal(sent.pickupFeeCents, 2000);
  assert.equal(receivePayload(drafts, null, { onePrice: "", stored: null }).error, "package_price_required");
  assert.equal(receivePayload(drafts, null, { onePrice: "oops", stored: null }).error, "piece_price_invalid");
});

test("a waiting package in package mode: edit prefill, request and total", () => {
  const draft = waitingPackageDraftFromRow(savedLine, "package");
  assert.equal(draft.onePrice, "300");
  assert.equal(waitingDraftTotalCents(draft), 30000);
  assert.equal(waitingDraftTotalCents({ ...draft, pickupFee: "20" }), 32000);
  const request = updateWaitingPackageRequest("biz-1", "line-1", { ...draft, onePrice: "330" }, savedLine);
  assert.deepEqual(request.line.pieces?.map((p) => p.priceCents), [11000, 11000, 11000]);
  const piece = waitingPackageDraftFromRow(savedLine);
  assert.equal(piece.priceMode, undefined);
  assert.equal(waitingDraftTotalCents(piece), 30000);
  const fresh = { ...emptyWaitingPackageDraft(null), priceMode: "package" as const, onePrice: "90", pieces: [{ ...newPieceDraft("barrel"), count: "3" }] };
  assert.deepEqual(addWaitingPackagePayload("biz-1", fresh).pieces?.map((p) => p.priceCents), [3000, 3000, 3000]);
});

// Seen in the browser check (2026-11-23): with 250 typed over a saved $300 the
// note read "Still $250.00 for the 3 left?" - a question already answered.
test("the added/removed note goes once another price is typed", () => {
  assert.match(onePriceChangeNote(3, 4, 30000, "en", 30000), /^You added 1 piece\. Still \$300\.00 for all 4\?/);
  assert.equal(onePriceChangeNote(3, 4, 25000, "en", 30000), "");
  assert.equal(onePriceChangeNote(3, 2, 25000, "fr", 30000), "");
  // Without the saved price (or a package saved with none) it behaves as before.
  assert.notEqual(onePriceChangeNote(3, 4, 25000, "en"), "");
  assert.notEqual(onePriceChangeNote(3, 4, 25000, "en", null), "");
  assert.equal(storedPiecesTotalCents([{ id: "p1", priceCents: 9000 }, { id: "p2", priceCents: 4000 }]), 13000);
  assert.equal(storedPiecesTotalCents([{ id: "p1", priceCents: null }, { id: "p2", priceCents: 4000 }]), 4000);
  assert.equal(storedPiecesTotalCents([{ id: "p1", priceCents: null }]), null);
  assert.equal(storedPiecesTotalCents(null), null);
});
