import assert from "node:assert/strict";
import test from "node:test";

import { pieceErrors } from "./line-pieces.ts";
import {
  addPieceDraft,
  countConfirmText,
  newPieceDraft,
  pieceDraftCount,
  pieceDraftPricedTogether,
  pieceRowSumText,
  piecesDraftCount,
  piecesEditorText,
  priceForAllLabel,
  priceTogetherText,
  reprintLabelsText,
  setPieceDraftCount,
  setPieceDraftPriceFor,
  parseInches,
  pieceDraftProblems,
  pieceDraftsFromLine,
  pieceHeading,
  pieceKindLabel,
  piecesCountText,
  piecesDifferFromLine,
  piecesDraftTotalCents,
  piecesPayload,
  piecesTotalText,
  readPiecePrice,
  removePieceDraft,
  savePrintLabelsText,
  updatePieceDraft,
  type PieceDraft,
} from "./piece-drafts.ts";

const piece = (over: Partial<PieceDraft> = {}): PieceDraft => ({ ...newPieceDraft(), ...over });

test("a piece's price is dollars as typed: blank is no price, zero is a price, junk is refused", () => {
  assert.equal(readPiecePrice(""), null);
  assert.equal(readPiecePrice("0"), 0);
  assert.equal(readPiecePrice("45,50"), 4550);
  assert.equal(readPiecePrice("1,200.50"), 120050);
  assert.ok(Number.isNaN(readPiecePrice("-3")));
  assert.ok(Number.isNaN(readPiecePrice("abc")));
  assert.ok(Number.isNaN(readPiecePrice("12.505")));
  assert.equal(parseInches("18,5"), 18.5);
  assert.ok(Number.isNaN(parseInches("601")));
});

test("the payload is what the server's normalizePieces takes, ids kept and new ones blank", () => {
  const drafts = [
    piece({ id: "p3", kind: "barrel", price: "100" }),
    piece({ kind: "box", description: " Clothes ", lengthIn: "20", widthIn: "20,5", heightIn: "18", price: "0" }),
    piece({ kind: "other", description: "TV", lengthIn: "", widthIn: "", heightIn: "" }),
  ];
  assert.deepEqual(piecesPayload(drafts), [
    { id: "p3", kind: "barrel", description: "", sizeIn: null, priceCents: 10000 },
    { id: "", kind: "box", description: "Clothes", sizeIn: { l: 20, w: 20.5, h: 18 }, priceCents: 0 },
    { id: "", kind: "other", description: "TV", sizeIn: null, priceCents: null },
  ]);
  // Whatever the form sends, the server's own rule finds nothing wrong with it.
  assert.deepEqual(pieceErrors(piecesPayload(drafts)), []);
  assert.equal(piecesDraftTotalCents(drafts), 10000);
});

test("problems are the server's codes, once each, and each piece knows its own", () => {
  assert.deepEqual(pieceDraftProblems([]), { codes: ["pieces_required"], byPiece: [] });
  const drafts = [
    piece({ kind: "barrel" }),
    piece({ kind: "box" }),
    piece({ kind: "other", description: "TV", lengthIn: "40" }),
    piece({ kind: "other", description: "Bike", price: "x" }),
    piece({ kind: "box", description: "y".repeat(121) }),
  ];
  const problems = pieceDraftProblems(drafts);
  assert.deepEqual(problems.byPiece, [
    [],
    ["piece_description_required"],
    ["piece_size_invalid"],
    ["piece_price_invalid"],
    ["piece_description_too_long"],
  ]);
  assert.deepEqual(problems.codes.sort(), [
    "piece_description_required", "piece_description_too_long", "piece_price_invalid", "piece_size_invalid",
  ]);
  const tooMany = Array.from({ length: 61 }, () => piece());
  assert.deepEqual(pieceDraftProblems(tooMany).codes, ["pieces_too_many"]);
  assert.deepEqual(pieceDraftProblems(tooMany.slice(0, 60)).codes, []);
});

test("a stored line opens as drafts: ids, sizes and prices back as typed; a legacy line expanded", () => {
  const drafts = pieceDraftsFromLine({
    kind: "other",
    pieces: [
      { id: "p1", kind: "box", description: "Clothes", sizeIn: { l: 20, w: 20.5, h: 18 }, priceCents: 4550 },
      { id: "p2", kind: "barrel", description: "", sizeIn: null, priceCents: 0 },
    ],
  });
  assert.deepEqual(drafts.map((d) => [d.id, d.kind, d.description, d.lengthIn, d.widthIn, d.heightIn, d.price]), [
    ["p1", "box", "Clothes", "20", "20.5", "18", "45.50"],
    ["p2", "barrel", "", "", "", "", "0"],
  ]);
  assert.equal(new Set(drafts.map((d) => d.key)).size, 2, "every row has its own key");
  // A legacy total that does not divide: the two barrels are one row, priced together.
  const legacy = pieceDraftsFromLine({ kind: "barrels", quantity: 2, priceCents: 15001 });
  assert.deepEqual(legacy.map((d) => [d.id, d.moreIds, d.kind, d.count, d.priceFor, d.price]), [["p1", ["p2"], "barrel", "2", "all", "150.01"]]);
  // A car has no pieces to edit; switching it to pieces starts on one barrel.
  assert.deepEqual(pieceDraftsFromLine({ kind: "car" }).map((d) => d.kind), ["barrel"]);
});

test("a legacy line reads as unchanged until a piece really changes", () => {
  const legacy = { kind: "other", quantity: 2, description: "Tires", priceCents: 9000 };
  const drafts = pieceDraftsFromLine(legacy);
  // Two tires that read the same: one row, "How many" 2.
  assert.deepEqual(drafts.map((d) => [d.count, d.price]), [["2", "45"]]);
  assert.equal(piecesDifferFromLine(legacy, drafts), false);
  assert.equal(piecesDifferFromLine(legacy, updatePieceDraft(drafts, drafts[0].key, { price: "46" })), true);
  assert.equal(piecesDifferFromLine(legacy, addPieceDraft(drafts)), true);
  assert.equal(piecesDifferFromLine(legacy, setPieceDraftCount(drafts, drafts[0].key, 1)), true);
  // The two priced together for $90 in all: the same pieces, nothing to rewrite.
  assert.equal(piecesDifferFromLine(legacy, updatePieceDraft(drafts, drafts[0].key, { priceFor: "all", price: "90" })), false);
});

test("adding takes the last piece's kind; removing keeps at least one", () => {
  const one = [piece({ kind: "box", description: "Clothes" })];
  const two = addPieceDraft(one);
  assert.equal(two.length, 2);
  assert.equal(two[1].kind, "box");
  assert.equal(two[1].description, "", "a new piece starts blank");
  assert.deepEqual(removePieceDraft(one, one[0].key), one, "the last piece stays");
  assert.deepEqual(removePieceDraft(two, two[0].key).map((d) => d.key), [two[1].key]);
  assert.equal(updatePieceDraft(two, two[1].key, { kind: "other" })[1].kind, "other");
  assert.equal(addPieceDraft([])[0].kind, "barrel");
});

test("the words with a number in them are built per language", () => {
  assert.equal(pieceHeading(0, "en"), "Piece 1");
  assert.equal(pieceHeading(2, "fr"), "Colis 3");
  assert.equal(piecesCountText(1, "en"), "1 piece");
  assert.equal(piecesCountText(3, "fr"), "3 colis");
  assert.equal(savePrintLabelsText(1, "en"), "Save and print 1 label");
  assert.equal(savePrintLabelsText(3, "en"), "Save and print 3 labels");
  assert.equal(savePrintLabelsText(3, "fr"), "Enregistrer et imprimer 3 étiquettes");
  assert.equal(piecesTotalText(24500, "en"), "Total: $245.00");
  assert.equal(piecesTotalText(null, "fr"), "Total : pas encore de prix");
  assert.equal(pieceKindLabel("box", "en"), "Box");
  assert.equal(pieceKindLabel("box", "fr"), "Carton");
  assert.equal(pieceKindLabel("barrel", "fr"), "Baril");
});

test("a customer's package needs every piece priced and the pieces over $0 (docs/PACKAGE_PRICE_REQUIRED.md)", () => {
  const required = { priceRequired: true };
  const barrel = (price: string) => piece({ kind: "barrel", price });
  // Off (stock): no price is fine, as before.
  assert.deepEqual(pieceDraftProblems([barrel("")]).codes, []);
  // A piece with no price typed is its own problem; the others stay clean.
  const missing = pieceDraftProblems([barrel("150"), barrel("")], required);
  assert.deepEqual(missing.codes, ["piece_price_required"]);
  assert.deepEqual(missing.byPiece, [[], ["piece_price_required"]]);
  // Whitespace is no price.
  assert.deepEqual(pieceDraftProblems([barrel("  ")], required).codes, ["piece_price_required"]);
  // $0 is a price: a bundle can be priced on one piece.
  assert.deepEqual(pieceDraftProblems([barrel("150"), barrel("0")], required), { codes: [], byPiece: [[], []] });
  // All $0 is no package price; that is the package's problem, not a piece's.
  const zero = pieceDraftProblems([barrel("0"), barrel("0.00")], required);
  assert.deepEqual(zero.codes, ["package_price_required"]);
  assert.deepEqual(zero.byPiece, [[], []]);
  // A price typed wrong keeps its own error, with no "required" on top (the server's rule).
  const wrong = pieceDraftProblems([barrel("abc"), barrel("")], required);
  assert.deepEqual(wrong.codes, ["piece_price_invalid"]);
  assert.deepEqual(wrong.byPiece, [["piece_price_invalid"], []]);
  // An empty list is `pieces_required`, nothing about prices.
  assert.deepEqual(pieceDraftProblems([], required), { codes: ["pieces_required"], byPiece: [] });
  // The editor's total keeps the pickup fee out of it: fee alone is no package price.
  assert.equal(piecesDraftTotalCents([barrel("0")], 2500), 2500);
  assert.deepEqual(pieceDraftProblems([barrel("0")], required).codes, ["package_price_required"]);
});

// ---------------------------------------------------------------------------
// "How many" and a row priced all together (docs/WAITING_PACKAGES.md, owner 2026-11-16).
// ---------------------------------------------------------------------------

const boxes = (count: string, price = "", over: Partial<PieceDraft> = {}) => piece({ kind: "box", description: "Clothes", price, count, ...over });
const together = (count: string, price = "", over: Partial<PieceDraft> = {}) => boxes(count, price, { priceFor: "all", ...over });

test("how many: a row of several is that many pieces, each its own piece once sent", () => {
  assert.equal(pieceDraftCount(piece()), 1);
  assert.equal(pieceDraftCount(piece({ count: "" })), 1, "blank while typing reads as one");
  assert.equal(pieceDraftCount(piece({ count: "abc" })), 1);
  assert.equal(pieceDraftCount(piece({ count: "0" })), 1);
  assert.equal(pieceDraftCount(piece({ count: "999" })), 60, "never more than a package holds");
  const drafts = [boxes("3", "45", { id: "p1", moreIds: ["p2"] }), piece({ price: "120" })];
  assert.equal(piecesDraftCount(drafts), 4);
  assert.deepEqual(piecesPayload(drafts).map((p) => [p.id, p.kind, p.description, p.priceCents]), [
    ["p1", "box", "Clothes", 4500],
    ["p2", "box", "Clothes", 4500],
    // A piece added by raising the count has no id yet: the server gives it one.
    ["", "box", "Clothes", 4500],
    ["", "barrel", "", 12000],
  ]);
  assert.equal(piecesDraftTotalCents(drafts), 25500);
  // Each sent piece has its own size object (nothing shared between pieces).
  const sized = piecesPayload([boxes("2", "45", { lengthIn: "20", widthIn: "20", heightIn: "18" })]);
  assert.deepEqual(sized[0].sizeIn, sized[1].sizeIn);
  assert.notEqual(sized[0].sizeIn, sized[1].sizeIn);
});

test("how many: the count is checked against the package's 60 pieces, and a problem is the row's", () => {
  assert.deepEqual(pieceDraftProblems([boxes("60", "1")]).codes, []);
  assert.deepEqual(pieceDraftProblems([boxes("60", "1"), piece({ price: "1" })]).codes, ["pieces_too_many"]);
  const problems = pieceDraftProblems([boxes("3", "", { description: "" }), piece({ price: "5" })], { priceRequired: true });
  assert.deepEqual(problems.byPiece, [["piece_description_required", "piece_price_required"], []]);
});

test("how many: setting it keeps the row inside the package's room, and its stored ids", () => {
  const drafts = [boxes("3", "45", { id: "p1", moreIds: ["p2", "p3"] }), piece({ count: "10" })];
  const fewer = setPieceDraftCount(drafts, drafts[0].key, 2);
  assert.equal(fewer[0].count, "2");
  // Two pieces are sent, the first two ids; the third id is not.
  assert.deepEqual(piecesPayload(fewer).slice(0, 2).map((p) => p.id), ["p1", "p2"]);
  assert.equal(piecesPayload(fewer).some((p) => p.id === "p3"), false);
  // Lowered and raised again (a number retyped): every piece keeps its id.
  const again = setPieceDraftCount(setPieceDraftCount(drafts, drafts[0].key, 1), drafts[0].key, 3);
  assert.deepEqual(piecesPayload(again).slice(0, 3).map((p) => p.id), ["p1", "p2", "p3"]);
  assert.equal(setPieceDraftCount(drafts, drafts[0].key, 0)[0].count, "1", "never below one");
  // 10 pieces are taken by the other row: 50 are left.
  assert.equal(setPieceDraftCount(drafts, drafts[0].key, 99)[0].count, "50");
  assert.deepEqual(setPieceDraftCount(drafts, "nope", 5).map((d) => d.count), ["3", "10"], "an unknown row changes nothing");
});

test("a row priced all together shares its amount among its own pieces only", () => {
  // The owner's case: 3 boxes for $200 together, a barrel at $100, 2 more boxes at $20 each.
  const drafts = [together("3", "200"), piece({ price: "100" }), boxes("2", "20", { description: "Shoes" })];
  assert.deepEqual(piecesPayload(drafts).map((p) => [p.kind, p.priceCents]), [
    // The odd cents go to the first pieces; the three add up to exactly $200.
    ["box", 6667], ["box", 6667], ["box", 6666],
    // The barrel keeps its own price: no share of another row's amount.
    ["barrel", 10000],
    ["box", 2000], ["box", 2000],
  ]);
  assert.equal(piecesDraftTotalCents(drafts), 34000);
  assert.equal(piecesDraftTotalCents(drafts, 2500), 36500, "a pickup fee is added on top, never spread");
  assert.deepEqual(pieceDraftProblems(drafts, { priceRequired: true }), { codes: [], byPiece: [[], [], []] });
  // A row of one is always priced each, whatever the switch was left on.
  assert.equal(pieceDraftPricedTogether(together("1", "200")), false);
  assert.deepEqual(piecesPayload([together("1", "200")]).map((p) => p.priceCents), [20000]);
  // No price typed on the row: its pieces have none, and a customer's package is refused on that row.
  assert.deepEqual(piecesPayload([together("3")]).map((p) => p.priceCents), [null, null, null]);
  assert.deepEqual(pieceDraftProblems([together("3"), piece({ price: "100" })], { priceRequired: true }).byPiece, [["piece_price_required"], []]);
  assert.deepEqual(pieceDraftProblems([together("3", "abc")], { priceRequired: true }).codes, ["piece_price_invalid"]);
  assert.deepEqual(pieceDraftProblems([together("3", "0")], { priceRequired: true }).codes, ["package_price_required"]);
});

test("a saved package opens with identical pieces that follow each other as one row", () => {
  const line = {
    kind: "other",
    pieces: [
      { id: "p1", kind: "box", description: "Clothes", sizeIn: null, priceCents: 4500 },
      { id: "p2", kind: "box", description: "Clothes", sizeIn: null, priceCents: 4500 },
      { id: "p3", kind: "barrel", description: "", sizeIn: null, priceCents: 12000 },
      // The same as the first two, but not next to them: its own row, so the order (and the labels' numbers) is kept.
      { id: "p4", kind: "box", description: "Clothes", sizeIn: null, priceCents: 4500 },
      // Another price, and not a cent's share of one amount: its own row.
      { id: "p5", kind: "box", description: "Clothes", sizeIn: null, priceCents: 5000 },
    ],
  };
  const drafts = pieceDraftsFromLine(line);
  assert.deepEqual(drafts.map((d) => [d.id, d.moreIds, d.count, d.priceFor, d.price]), [
    ["p1", ["p2"], "2", "each", "45"],
    ["p3", [], "1", "each", "120"],
    ["p4", [], "1", "each", "45"],
    ["p5", [], "1", "each", "50"],
  ]);
  // Opened and saved untouched: exactly the pieces it had, ids and order.
  assert.deepEqual(piecesPayload(drafts).map((p) => [p.id, p.priceCents]), line.pieces.map((p) => [p.id, p.priceCents]));
  assert.equal(piecesDifferFromLine(line, drafts), false);
  assert.equal(pieceHeading(0, "en", 2), "Pieces 1\u20132");
  assert.equal(pieceHeading(2, "fr", 3), "Colis 3\u20135");
});

test("a saved row priced together opens on its amount; the barrel beside it on its own price", () => {
  const line = {
    kind: "other",
    pickupFeeCents: 2500,
    priceCents: 32500,
    pieces: [
      ...[6667, 6667, 6666].map((priceCents, i) => ({ id: `p${i + 1}`, kind: "box", description: "Clothes", sizeIn: null, priceCents })),
      { id: "p4", kind: "barrel", description: "", sizeIn: null, priceCents: 10000 },
    ],
  };
  const drafts = pieceDraftsFromLine(line);
  // The three boxes' prices are $200 shared evenly: one row, "all 3 together", $200.
  assert.deepEqual(drafts.map((d) => [d.id, d.moreIds, d.count, d.priceFor, d.price]), [
    ["p1", ["p2", "p3"], "3", "all", "200"],
    ["p4", [], "1", "each", "100"],
  ]);
  assert.equal(piecesDifferFromLine(line, drafts), false);
  // A fourth box on that row: the row's $200 is shared in four; the barrel is untouched.
  const four = setPieceDraftCount(drafts, drafts[0].key, 4);
  assert.deepEqual(piecesPayload(four).map((p) => [p.id, p.priceCents]), [["p1", 5000], ["p2", 5000], ["p3", 5000], ["", 5000], ["p4", 10000]]);
  // Prices that are not one shared amount (one was changed by hand) stay separate rows.
  const edited = { ...line, pieces: line.pieces.map((p, i) => (i === 0 ? { ...p, priceCents: 9000 } : p)) };
  assert.deepEqual(pieceDraftsFromLine(edited).map((d) => [d.count, d.priceFor, d.price]), [["1", "each", "90"], ["2", "all", "133.33"], ["1", "each", "100"]]);
  // Pieces with no price yet are one row too, with no price.
  const unpriced = { kind: "other", pieces: [1, 2].map((n) => ({ id: `p${n}`, kind: "barrel", description: "", sizeIn: null, priceCents: null })) };
  assert.deepEqual(pieceDraftsFromLine(unpriced).map((d) => [d.count, d.priceFor, d.price]), [["2", "each", ""]]);
});

test("a row's price switch keeps the number typed and changes what it is for", () => {
  // $200 typed, then "all 3 together": $200 for the three, not $600.
  const each = [boxes("3", "200", { id: "p1", moreIds: ["p2", "p3"] }), piece({ price: "100" })];
  assert.equal(piecesDraftTotalCents(each), 70000);
  const all = setPieceDraftPriceFor(each, each[0].key, "all");
  assert.deepEqual(all.map((d) => [d.count, d.priceFor, d.price]), [["3", "all", "200"], ["1", "each", "100"]]);
  assert.equal(piecesDraftTotalCents(all), 30000);
  assert.deepEqual(piecesPayload(all).map((p) => [p.id, p.priceCents]), [["p1", 6667], ["p2", 6667], ["p3", 6666], ["", 10000]]);
  // And back: $200 each again. The other row is never touched.
  const back = setPieceDraftPriceFor(all, all[0].key, "each");
  assert.deepEqual(back.map((d) => [d.priceFor, d.price]), [["each", "200"], ["each", "100"]]);
  assert.deepEqual(setPieceDraftPriceFor(each, "nope", "all"), each, "an unknown row changes nothing");
  // Chosen before any price is typed: only the switch moves.
  const blank = [boxes("3")];
  assert.deepEqual(setPieceDraftPriceFor(blank, blank[0].key, "all").map((d) => [d.priceFor, d.price]), [["all", ""]]);
});

test("the editor's words are built per language", () => {
  assert.equal(piecesEditorText("each", "en"), "Each piece");
  assert.equal(piecesEditorText("each", "fr"), "Par colis");
  assert.equal(piecesEditorText("howMany", "fr"), "Combien");
  assert.equal(priceTogetherText(3, "en"), "All 3 together");
  assert.equal(priceTogetherText(3, "fr"), "Les 3 ensemble");
  assert.equal(priceForAllLabel(3, "en"), "Price for all 3 ($)");
  assert.equal(priceForAllLabel(3, "fr"), "Prix pour les 3 ($)");
  assert.equal(pieceRowSumText(boxes("3", "45"), "en"), "3 \u00d7 $45.00 = $135.00");
  assert.equal(pieceRowSumText(boxes("1", "45")), "", "one piece needs no sum");
  assert.equal(pieceRowSumText(boxes("3", "abc")), "");
  assert.equal(pieceRowSumText(together("3", "150"), "en"), "$50.00 each");
  assert.equal(pieceRowSumText(together("3", "200"), "en"), "2 at $66.67, 1 at $66.66");
  assert.match(pieceRowSumText(together("3", "200"), "fr"), /^2 \u00e0 66,67\s?\$, 1 \u00e0 66,66\s?\$$/u);
  assert.equal(reprintLabelsText(3, 2, "en"), "The number of pieces changes from 3 to 2: print the labels again.");
  assert.match(reprintLabelsText(3, 2, "fr"), /de 3 \u00e0 2/u);
  assert.equal(countConfirmText(30, "en"), "Make this 30 pieces? It prints 30 labels.");
  assert.match(countConfirmText(30, "fr"), /30 colis/u);
});
