import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { translateAuditSummary } from "./audit-summaries.ts";
import { translateValue } from "./french-dom.ts";
import { moneyText } from "./invoice-ledger.ts";
import { pieceSummaryText } from "./line-pieces.ts";
import { pieceHeading, pieceKindLabel, piecesTotalText } from "./piece-drafts.ts";

// Release 1.0.17: one French word per piece kind on every surface - barrel
// "baril", box "carton", other "autre" (counted "article"), a piece in
// general "colis" - and French money as "190,00 $" (docs/PACKAGE_REQUESTS.md
// §7 addenda). The app (app_fr.arb) and the server (line_pieces.js,
// package_requests.js, container_updates.js) say the same.

test("piece kinds and the generic piece read one way in French", () => {
  assert.deepEqual(["barrel", "box", "other"].map((k) => pieceKindLabel(k as "barrel", "fr")), ["Baril", "Carton", "Autre"]);
  assert.equal(pieceHeading(0, "fr"), "Colis 1");
  assert.equal(translateValue("Add another piece", "fr"), "Ajouter un autre colis");
  assert.equal(translateValue("Piece", "fr"), "Colis");
  assert.equal(pieceSummaryText([{ kind: "barrel" }, { kind: "barrel" }, { kind: "box" }], "fr"), "2 barils, 1 carton");
  assert.equal(pieceSummaryText([{ kind: "box" }, { kind: "box" }], "fr"), "2 cartons");
  assert.equal(translateAuditSummary("Removed 2 barrels, 1 box"), "Retrait de 2 barils, 1 carton");
});

test("no French copy says fût or pièce for a piece", () => {
  const dictionary = readFileSync(new URL("./french-dom.ts", import.meta.url), "utf8");
  assert.doesNotMatch(dictionary, /fûts?\b/i);
  for (const key of ["Pieces received", "Pieces", "Pieces by month", "avg pieces per container"]) {
    assert.doesNotMatch(translateValue(key, "fr"), /pièce/i, key);
  }
  for (const file of ["../../../my_flutter_app/functions/line_pieces.js", "../../../my_flutter_app/functions/package_requests.js", "../../../my_flutter_app/functions/container_updates.js"]) {
    assert.doesNotMatch(readFileSync(new URL(file, import.meta.url), "utf8"), /fûts?\b/i, file);
  }
});

test("French money reads 190,00 $ on the package screens", () => {
  assert.equal(moneyText(19000, "fr"), "190,00 $");
  assert.equal(moneyText(125000, "fr"), "1 250,00 $");
  assert.equal(moneyText(-500, "fr"), "-5,00 $");
  assert.equal(moneyText(19000), "$190.00");
  assert.equal(piecesTotalText(19000, "fr"), "Total : 190,00 $");
  assert.equal(piecesTotalText(19000, "en"), "Total: $190.00");
  for (const file of [
    "../components/business/waiting-packages-panel.tsx",
    "../components/business/package-payment-dialog.tsx",
    "../components/guest-tracking.tsx",
    "../components/package-staff-view.tsx",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    const bare = [...source.matchAll(/moneyText\(([^()]*)\)/g)].filter((m) => !/, (lang|"fr")$/.test(m[1]) && !m[1].includes("amountCents"));
    assert.deepEqual(bare.map((m) => m[0]), [], file);
  }
});
