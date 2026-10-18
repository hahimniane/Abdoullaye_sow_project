import assert from "node:assert/strict";
import test from "node:test";

import { pieceErrors } from "./line-pieces.ts";
import {
  addPieceDraft,
  newPieceDraft,
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
  const legacy = pieceDraftsFromLine({ kind: "barrels", quantity: 2, priceCents: 15001 });
  assert.deepEqual(legacy.map((d) => [d.id, d.kind, d.price]), [["p1", "barrel", "75.01"], ["p2", "barrel", "75"]]);
  // A car has no pieces to edit; switching it to pieces starts on one barrel.
  assert.deepEqual(pieceDraftsFromLine({ kind: "car" }).map((d) => d.kind), ["barrel"]);
});

test("a legacy line reads as unchanged until a piece really changes", () => {
  const legacy = { kind: "other", quantity: 2, description: "Tires", priceCents: 9000 };
  const drafts = pieceDraftsFromLine(legacy);
  assert.equal(piecesDifferFromLine(legacy, drafts), false);
  assert.equal(piecesDifferFromLine(legacy, updatePieceDraft(drafts, drafts[0].key, { price: "46" })), true);
  assert.equal(piecesDifferFromLine(legacy, addPieceDraft(drafts)), true);
  assert.equal(piecesDifferFromLine(legacy, removePieceDraft(drafts, drafts[1].key)), true);
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
