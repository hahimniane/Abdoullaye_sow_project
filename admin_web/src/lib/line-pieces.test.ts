import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import * as pieces from "./line-pieces.ts";

// The mirror discipline (docs/WAITING_PACKAGES.md "Pieces"): the server's
// `functions/line_pieces.js` is the authority, and its shared cases are run
// here exactly as the server and the app run them.

const fixtureUrl = new URL("../../../my_flutter_app/functions/test/fixtures/line-pieces-cases.json", import.meta.url);
const serverUrl = new URL("../../../my_flutter_app/functions/line_pieces.js", import.meta.url);
const { cases } = JSON.parse(readFileSync(fixtureUrl, "utf8")) as {
  cases: Array<{ fn: string; args: unknown[]; note: string; expected: unknown }>;
};
const serverSource = readFileSync(serverUrl, "utf8");

// JSON has no undefined: the fixture's null stands for both.
const plain = (value: unknown) => JSON.parse(JSON.stringify(value ?? null));
const fns = pieces as unknown as Record<string, (...args: unknown[]) => unknown>;

test("the shared fixture covers every rule the mirror keeps", () => {
  assert.ok(cases.length >= 60, "expected the full shared fixture");
  const covered = new Set(cases.map((c) => c.fn));
  for (const fn of [
    "pieceErrors", "normalizePieces", "distributeCents", "linePieces", "lineCounts", "piecesTotalCents",
    "piecesSummaryFields", "pieceSummaryText", "linePiecesWhat", "lineGroupSummary", "paidFloorForLine",
    "splitPieces", "nextPartIndex", "partTrackingCode", "lineTotalCents", "pickupFeeOf", "pickupFeeErrors",
    "linePickupFeeCents", "lineHasPickupFee", "piecesLineFields",
  ]) {
    assert.ok(covered.has(fn), `${fn} has no shared case`);
  }
});

for (const c of cases) {
  test(`shared case ${c.fn}: ${c.note}`, () => {
    const fn = fns[c.fn];
    assert.equal(typeof fn, "function", `${c.fn} is not exported by line-pieces.ts`);
    assert.deepEqual(plain(fn(...c.args)), c.expected);
  });
}

test("every name the server module exports is exported here too", () => {
  const block = serverSource.match(/module\.exports = \{([\s\S]*?)\};/);
  assert.ok(block, "server exports not found");
  const names = block[1].split(/[\s,]+/).map((name) => name.trim()).filter(Boolean);
  assert.ok(names.length >= 30, "expected the whole server vocabulary");
  const mirror = pieces as unknown as Record<string, unknown>;
  assert.deepEqual(names.filter((name) => !(name in mirror)), []);
});

test("the constants match the server's", () => {
  const constant = (name: string) => {
    const match = serverSource.match(new RegExp(`const ${name} = (\\d+);`));
    assert.ok(match, `${name} not found on the server`);
    return Number(match[1]);
  };
  assert.equal(pieces.MAX_PIECES, constant("MAX_PIECES"));
  assert.equal(pieces.MAX_LEGACY_PIECES, constant("MAX_LEGACY_PIECES"));
  assert.equal(pieces.MAX_PIECE_DESCRIPTION, constant("MAX_PIECE_DESCRIPTION"));
  assert.equal(pieces.MAX_PIECE_INCHES, constant("MAX_PIECE_INCHES"));
  assert.deepEqual([...pieces.PIECE_KINDS], ["barrel", "box", "other"]);
  assert.deepEqual([...pieces.LINE_SOURCES], ["counter", "request", "card_order"]);
});

test("labels name each piece and its size, as the server prints them", () => {
  assert.equal(pieces.pieceLabelName({ kind: "barrel" }), "Barrel");
  assert.equal(pieces.pieceLabelName({ kind: "barrel", description: "Rice" }), "Barrel · Rice");
  assert.equal(pieces.pieceLabelName({ kind: "box", description: "Clothes" }), "Clothes");
  assert.equal(pieces.pieceLabelName({ kind: "box" }), "Box");
  assert.equal(pieces.pieceLabelName({ kind: "other" }), "Package");
  assert.equal(pieces.pieceSizeText({ sizeIn: { l: 40, w: 30, h: 20 } }), "40 × 30 × 20 in");
  assert.equal(pieces.pieceSizeText({ sizeIn: { l: 40, w: 30 } }), "");
  assert.equal(pieces.lineSourceOf("request"), "request");
  assert.equal(pieces.lineSourceOf("anything"), "counter");
});
