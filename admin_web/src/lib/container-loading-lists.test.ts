import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  LOADING_FILTERS,
  LOADING_LIST_DOM_STRINGS,
  addedHowText,
  filterLabel,
  groupByCustomer,
  groupHeaderText,
  lineAddedMs,
  lineAddedVia,
  linePieceTotal,
  lineNotScanned,
  lineScannedPieces,
  loadingFiltersFor,
  loadingView,
  packagesText,
  scanProgressText,
  sortRecentlyAdded,
  stillGroupHeaderText,
  stillToLoad,
  stillWaitingText,
  takeOffConfirmText,
} from "./container-loading-lists.ts";
import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const panelSource = read("../components/business/containers-panel.tsx");

const at = (ms: number) => ({ toDate: () => new Date(ms) });

function line(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    kind: "other",
    trackingCode: `CL-${id.toUpperCase()}`,
    customerName: "",
    receiverName: "",
    pieceCount: 1,
    ...extra,
  };
}

test("lines carry when, who and how they went on; rows without the field read as none", () => {
  const withField = line("a", { containerAssignedAt: at(5000), containerAssignedVia: "scan", containerAssignedByStaffId: "s1" });
  assert.equal(lineAddedMs(withField), 5000);
  assert.equal(lineAddedVia(withField), "scan");
  assert.equal(lineAddedMs(line("b")), 0);
  assert.equal(lineAddedVia(line("b")), "");
  assert.equal(lineAddedVia(line("c", { containerAssignedVia: "teleport" })), "");
  // ms and ISO strings read too, as the scan answers carry ms.
  assert.equal(lineAddedMs(line("d", { containerAssignedAt: 7000 })), 7000);
});

test("Recently added: newest first, the rows with no record last in their own order", () => {
  const rows = [
    line("old1"),
    line("mid", { containerAssignedAt: at(2000) }),
    line("old2"),
    line("new", { containerAssignedAt: at(9000) }),
  ];
  assert.deepEqual(sortRecentlyAdded(rows).map((r) => r.id), ["new", "mid", "old1", "old2"]);
  assert.deepEqual(rows.map((r) => r.id), ["old1", "mid", "old2", "new"], "the input is not reordered");
  assert.deepEqual(loadingView(rows, "recent", "").groups[0].lines.map((r) => r.id), ["new", "mid", "old1", "old2"]);
});

test("All keeps the order the lines came in", () => {
  const rows = [line("b"), line("a"), line("c")];
  const view = loadingView(rows, "all", "");
  assert.equal(view.groups.length, 1);
  assert.equal(view.groups[0].group, null);
  assert.deepEqual(view.groups[0].lines.map((r) => r.id), ["b", "a", "c"]);
  assert.equal(view.count, 3);
});

test("Not scanned yet: loadScannedPieces 0 or absent", () => {
  const rows = [
    line("none"),
    line("zero", { loadScannedPieces: 0 }),
    line("some", { loadScannedPieces: 1, pieceCount: 3 }),
    line("done", { loadScannedPieces: 2, pieceCount: 2 }),
  ];
  assert.deepEqual(loadingView(rows, "unscanned", "").groups[0].lines.map((r) => r.id), ["none", "zero"]);
  assert.equal(lineNotScanned(rows[0]), true);
  assert.equal(lineNotScanned(rows[2]), false);
});

test("pieces: the package's own count, scanned never past it", () => {
  assert.equal(linePieceTotal(line("a", { pieceCount: 4 })), 4);
  assert.equal(linePieceTotal({ id: "x", kind: "car" }), 1);
  assert.equal(lineScannedPieces(line("a", { pieceCount: 2, loadScannedPieces: 5 })), 2);
  assert.equal(lineScannedPieces(line("a", { pieceCount: 2 })), 0);
  assert.equal(lineScannedPieces(line("a", { pieceCount: 2, loadScannedPieces: -1 })), 0);
});

test("By customer: sender, else receiver; counts packages, pieces and pieces scanned", () => {
  const rows = [
    line("1", { customerName: "Moussa Diallo", pieceCount: 3, loadScannedPieces: 2 }),
    line("2", { receiverName: "Aissatou Bah", pieceCount: 1 }),
    line("3", { customerName: "moussa diallo", pieceCount: 2, loadScannedPieces: 2 }),
    line("4", { ownerKind: "stock", pieceCount: 1 }),
    line("5", { customerName: "Aissatou Bah", pieceCount: 1, loadScannedPieces: 1 }),
  ];
  const groups = groupByCustomer(rows);
  assert.deepEqual(groups.map((g) => g.name), ["Aissatou Bah", "Moussa Diallo", ""], "alphabetical, stock last");
  const moussa = groups.find((g) => g.name === "Moussa Diallo")!;
  assert.deepEqual([moussa.packages, moussa.pieces, moussa.scanned], [2, 5, 4]);
  const aissatou = groups[0];
  assert.deepEqual([aissatou.packages, aissatou.pieces, aissatou.scanned], [2, 2, 1]);
  assert.deepEqual(loadingView(rows, "customer", "").groups.map((g) => g.group?.name), ["Aissatou Bah", "Moussa Diallo", ""]);
});

test("the search narrows every chip by code, name and phone", () => {
  const rows = [
    line("k7m4p2", { customerName: "Moussa Diallo", customerPhone: "+1 (207) 555-0101" }),
    line("zzzzzz", { customerName: "Aissatou Bah", customerPhone: "+1 (207) 555-0199" }),
  ];
  assert.deepEqual(loadingView(rows, "all", "moussa").groups[0].lines.map((r) => r.id), ["k7m4p2"]);
  assert.deepEqual(loadingView(rows, "all", "CL-ZZZZ").groups[0].lines.map((r) => r.id), ["zzzzzz"]);
  assert.deepEqual(loadingView(rows, "all", "555-0199").groups[0].lines.map((r) => r.id), ["zzzzzz"]);
  assert.equal(loadingView(rows, "customer", "nobody").count, 0);
  assert.equal(loadingView(rows, "all", "m").count, 2, "one character is no search");
});

test("Still to load: only waiting packages whose destination is the container's", () => {
  const container = { id: "c1", destinationCountryId: "GN", destinationCountryName: "Guinea" };
  const waiting = [
    line("a", { customerName: "Moussa Diallo", destinationCountryId: "GN" }),
    line("b", { customerName: "Moussa Diallo", destinationCountryId: "GN" }),
    line("c", { customerName: "Fatou Ba", destinationCountryId: "SN" }),
    line("d", { customerName: "Fatou Ba" }),
    line("e", { customerName: "Fatou Ba", destinationCountryId: "GN" }),
  ];
  const result = stillToLoad(waiting, container);
  assert.equal(result.hasDestination, true);
  assert.equal(result.total, 3, "Senegal's package and the one with no destination are not listed");
  assert.deepEqual(result.groups.map((g) => [g.name, g.packages]), [["Fatou Ba", 1], ["Moussa Diallo", 2]]);
  assert.deepEqual(result.groups.flatMap((g) => g.lines.map((r) => r.id)).sort(), ["a", "b", "e"]);
  // A container with no destination lists nothing, whatever is waiting.
  const none = stillToLoad(waiting, { id: "c2" });
  assert.deepEqual([none.hasDestination, none.total, none.groups.length], [false, 0, 0]);
  assert.equal(stillToLoad([], container).total, 0);
});

test("the unscanned chip belongs to a container that is loading", () => {
  assert.deepEqual(loadingFiltersFor(true).map((f) => f.id), ["all", "recent", "customer", "unscanned"]);
  assert.deepEqual(loadingFiltersFor(false).map((f) => f.id), ["all", "recent", "customer"]);
  assert.deepEqual(LOADING_FILTERS.map((f) => f.label), ["All", "Recently added", "By customer", "Not scanned yet"]);
});

test("the sentences, in both languages", () => {
  assert.equal(groupHeaderText("Moussa Diallo", 3, 4, 7, "en"), "Moussa Diallo · 3 packages · 4 of 7 pieces scanned");
  assert.equal(groupHeaderText("Moussa Diallo", 1, 0, 1, "en"), "Moussa Diallo · 1 package · 0 of 1 piece scanned");
  assert.equal(groupHeaderText("Moussa Diallo", 3, 4, 7, "fr"), "Moussa Diallo · 3 colis · 4 sur 7 pièces scannées");
  assert.equal(groupHeaderText("", 1, 1, 1, "en"), "Business stock · 1 package · 1 of 1 piece scanned");
  assert.equal(stillGroupHeaderText("Fatou Ba", 2, "en"), "Fatou Ba · 2 packages");
  assert.equal(stillWaitingText(12, "Guinea", "en"), "12 still waiting for Guinea");
  assert.equal(stillWaitingText(12, "Guinée", "fr"), "12 encore en attente pour Guinée");
  assert.equal(stillWaitingText(2, "", "en"), "2 still waiting");
  assert.equal(scanProgressText(2, 5, "en"), "2 of 5 scanned");
  assert.equal(scanProgressText(0, 5, "fr"), "Pas encore scanné");
  assert.equal(packagesText(1, "fr"), "1 colis");
  assert.equal(takeOffConfirmText(line("k7m4p2"), "Container 12", "en"), "Take CL-K7M4P2 off Container 12? It goes back to waiting.");
  assert.equal(takeOffConfirmText(line("k7m4p2"), "Conteneur 12", "fr"), "Retirer CL-K7M4P2 de Conteneur 12 ? Il retourne en attente.");
  assert.deepEqual(
    (["scan", "hand", "move", ""] as const).map((via) => addedHowText(via, "en")),
    ["Scanned", "By hand", "Moved", "Added earlier"],
  );
});

test("every new string has its French", () => {
  const missing = LOADING_LIST_DOM_STRINGS.filter((english) => !(english in TEXT_TRANSLATIONS) && !(english in ATTRIBUTE_TRANSLATIONS));
  assert.deepEqual(missing, []);
  for (const english of LOADING_LIST_DOM_STRINGS) assert.notEqual(translateValue(english, "fr"), english);
  // The strings the page builds per language really change in French.
  for (const filter of LOADING_FILTERS) assert.notEqual(filterLabel(filter.id, "fr"), filterLabel(filter.id, "en"));
  for (const via of ["scan", "hand", "move", ""] as const) assert.notEqual(addedHowText(via, "fr"), addedHowText(via, "en"));
  // ...and the page uses those strings: the placeholder, the labels and the buttons.
  for (const english of ["Search code, name or phone", "Filter packages", "Take off", "Still to load"]) {
    assert.ok(panelSource.includes(`"${english}"`) || panelSource.includes(`>${english}<`), `${english} is on the page`);
  }
});

test("the page wires the lists: Take off reuses the one callable, Add reuses assignContainerLines", () => {
  assert.match(panelSource, /httpsCallable\(functions, "unassignContainerLine"\)\(\{ businessId, lineId: String\(row\.id\) \}\)/);
  assert.match(panelSource, /takeOffConfirmText\(row, containerTitle\(selected\), "en"\)/);
  // The same request as before; a sender's problem is acknowledged on a second call (docs/AIR_PACKAGES.md §4.8).
  assert.match(panelSource, /const request = assignLinesRequest\(businessId, selectedId, \[id\], \{\}, waiting\.rows\);/);
  assert.match(panelSource, /httpsCallable\(functions, "assignContainerLines"\)\(acknowledgeProblems \? \{ \.\.\.request, acknowledgeProblems: true \} : request\)/);
  // Take off is a visible text button on every row of a container that is loading, however the row got there, and only then.
  assert.match(panelSource, /\{selectedOpen && \(\s*<button className="lst-btn ghost ctn-takeoff" type="button" disabled=\{busy\} onClick=\{\(\) => void sendBackToWaiting\(row\)\}>Take off<\/button>\s*\)\}/);
  assert.equal((panelSource.match(/sendBackToWaiting\(row\)/g) ?? []).length, 1);
  assert.equal(translateValue("Take off", "fr"), "Retirer");
  assert.equal(translateValue("Retirer", "en"), "Remove");
  // The panel never writes a document itself.
  assert.doesNotMatch(panelSource, /\b(setDoc|updateDoc|addDoc|deleteDoc)\(/);
  // The header line and the box come from the same waiting list the tab reads.
  assert.match(panelSource, /stillToLoad\(waiting\.rows, selected\)/);
  assert.match(panelSource, /stillWaitingText\(still\.total, destinationLabel\(selected\), lang\)/);
  assert.match(panelSource, /still && still\.hasDestination && \(/);
  assert.match(panelSource, /Set this container&apos;s destination|Set this container's destination to see what's still waiting\./);
});

test("a row's French scan progress agrees in number", () => {
  assert.equal(scanProgressText(1, 1, "fr"), "1 sur 1 scannée");
  assert.equal(scanProgressText(2, 5, "fr"), "2 sur 5 scannées");
  assert.equal(scanProgressText(1, 3, "en"), "1 of 3 scanned");
});
