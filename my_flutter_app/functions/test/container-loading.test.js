"use strict";

// Scan to load: the pure decisions (container_loading.js). The callable
// glue is exercised against the emulator in container-callables.test.js
// ("scan to load").

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  LOAD_ACTION,
  LOAD_FIELDS,
  ASSIGN_VIA,
  ASSIGN_FIELDS,
  MIN_LOAD_SCAN_IDS,
  MAX_LOAD_SCAN_IDS,
  loadActionOf,
  scanCodeFrom,
  scanIdOf,
  scannedPiecesOf,
  scanIdsKept,
  appendScanId,
  repeatedScanResult,
  scanDecision,
  undoScanDecision,
  leaveUnscannedDecision,
  loadLineView,
  loadContainerView,
  addCountDeltas,
  loadSummaryOf,
  scanLoadAuditSummary,
  scanUnloadAuditSummary,
  scanMoveBackAuditSummary,
} = require("../container_loading");
const {CONTAINER_MESSAGES} = require("../container_manifest");

const BIZ = "biz-1";
const BOX = "box-1";
const OTHER = "box-2";
const loading = {businessId: BIZ, status: "loading", label: "Box 1",
  destinationCountryId: "gn"};
const waiting = (extra = {}) => ({businessId: BIZ, containerId: "",
  containerStatus: "waiting", kind: "barrels", quantity: 3,
  destinationCountryId: "gn", trackingCode: "CL-K7M4P2", ...extra});
const onBox = (extra = {}) => waiting({containerId: BOX,
  containerStatus: "loading", ...extra});
const scan = (line, extra = {}) => scanDecision({line, lineId: "l1",
  businessId: BIZ, container: loading, containerId: BOX, otherContainer: null,
  scanId: "scan-0001", move: false, ...extra});

describe("loadActionOf", () => {
  it("knows the four actions and nothing else", () => {
    for (const action of Object.values(LOAD_ACTION)) {
      assert.equal(loadActionOf(action), action);
    }
    assert.equal(loadActionOf(" scan "), "scan");
    for (const bad of ["", "deliver", null, undefined, 3, "SCAN"]) {
      assert.equal(loadActionOf(bad), "");
    }
  });
});

describe("scanCodeFrom", () => {
  it("reads a printed, typed or linked code", () => {
    for (const [raw, code] of [
      ["CL-K7M4P2", "CL-K7M4P2"],
      ["cl k7m4p2", "CL-K7M4P2"],
      ["  clk7m4p2 ", "CL-K7M4P2"],
      ["CL-K7M4P2-2", "CL-K7M4P2-2"],
      ["clk7m4p22", "CL-K7M4P2-2"],
      ["CL-K7M4P2-12", "CL-K7M4P2-12"],
      ["https://customer.laawoldigital.com/t/CL-K7M4P2", "CL-K7M4P2"],
      ["https://customer.laawoldigital.com/t/CL-K7M4P2-3", "CL-K7M4P2-3"],
      ["customer.laawoldigital.com/t/cl-k7m4p2", "CL-K7M4P2"],
      ["HTTPS://CUSTOMER.LAAWOLDIGITAL.COM/T/CL-K7M4P2", "CL-K7M4P2"],
      ["https://customer.laawoldigital.com/?service=tracking&code=CL-K7M4P2",
        "CL-K7M4P2"],
      ["http://localhost:3000/t/CL-K7M4P2", "CL-K7M4P2"],
      // A trailing slash, a path alone, a part past 99.
      ["https://customer.laawoldigital.com/t/CL-K7M4P2/", "CL-K7M4P2"],
      ["https://customer.laawoldigital.com/t/CL-K7M4P2-3//", "CL-K7M4P2-3"],
      ["CL-K7M4P2/", "CL-K7M4P2"],
      ["/t/CL-K7M4P2", "CL-K7M4P2"],
      ["/t/cl-k7m4p2-4/", "CL-K7M4P2-4"],
      ["CL-K7M4P2-100", "CL-K7M4P2-100"],
      ["clk7m4p2100", "CL-K7M4P2-100"],
      ["https://customer.laawoldigital.com/t/CL-K7M4P2-1234",
        "CL-K7M4P2-1234"],
    ]) {
      assert.equal(scanCodeFrom(raw), code, raw);
    }
  });

  it("refuses anything that is not a package code", () => {
    for (const raw of ["", null, undefined, 42, "CL-K7M4P0", "CL-K7M4P",
      "BS-K7M4P2", "CL-K7M4P2-0", "CL-K7M4P2-01", "CL-K7M4P2-12345",
      "hello", "/", "/t/", "/x/CL-K7M4P2",
      "https://customer.laawoldigital.com/", "https://example.com/x/CL-K7M4P2",
      "https://customer.laawoldigital.com/t/BS-K7M4P2", "http://[bad"]) {
      assert.equal(scanCodeFrom(raw), "", String(raw));
    }
  });
});

describe("scanIdOf", () => {
  it("takes 8 to 64 of letters, digits, _ and -", () => {
    assert.equal(scanIdOf("abcd1234"), "abcd1234");
    assert.equal(scanIdOf("A_b-" + "x".repeat(60)), "A_b-" + "x".repeat(60));
    for (const bad of ["", "short", "x".repeat(65), "has space1",
      "slash/1234", null, 12345678, undefined]) {
      assert.equal(scanIdOf(bad), "", String(bad));
    }
  });
});

describe("scan ids remembered", () => {
  it("keeps two per piece, at least 20 and at most 120, oldest first",
      () => {
        assert.equal(scanIdsKept(0), MIN_LOAD_SCAN_IDS);
        assert.equal(scanIdsKept(3), 20);
        assert.equal(scanIdsKept(15), 30);
        assert.equal(scanIdsKept(60), 120);
        assert.equal(scanIdsKept(999), MAX_LOAD_SCAN_IDS);
        let ids = [];
        for (let i = 0; i < 25; i++) ids = appendScanId(ids, `scan-${i}`, 3);
        assert.equal(ids.length, 20);
        assert.equal(ids[0], "scan-5");
        assert.equal(ids[19], "scan-24");
        // A 40-piece package remembers every one of its scans.
        let many = [];
        for (let i = 0; i < 40; i++) {
          many = appendScanId(many, `scan-${i}`, 40);
        }
        assert.equal(many.length, 40);
        assert.equal(many[0], "scan-0");
        assert.deepEqual(appendScanId(undefined, "a"), ["a"]);
      });

  it("answers a retry as it was first answered", () => {
    const line = onBox({loadAddedByScan: true, loadScannedPieces: 2,
      loadScanIds: ["first-scan", "second-scan"]});
    assert.equal(repeatedScanResult(line, "first-scan"), "loaded");
    assert.equal(repeatedScanResult(line, "second-scan"), "counted");
    // Added by hand: the first scan only counted.
    assert.equal(repeatedScanResult({...line, loadAddedByScan: false},
        "first-scan"), "counted");
    // The loading scan was forgotten (more counted than ids kept).
    assert.equal(repeatedScanResult({...line, loadScannedPieces: 3},
        "first-scan"), "counted");
    // Moved here by a scan: its first scan loaded it too.
    assert.equal(repeatedScanResult({...line, loadAddedByScan: undefined,
      loadMovedFromContainerId: OTHER}, "first-scan"), "loaded");
  });
});

describe("scanDecision", () => {
  it("puts a waiting package on whole", () => {
    assert.deepEqual(scan(waiting()), {result: "loaded", change: "load"});
  });

  it("counts one more piece of a package already here", () => {
    assert.deepEqual(scan(onBox({loadScannedPieces: 1})),
        {result: "counted", change: "count", scannedPieces: 2});
    // Put on by hand: its first scan counts.
    assert.deepEqual(scan(onBox()),
        {result: "counted", change: "count", scannedPieces: 1});
  });

  it("changes nothing once every piece is in", () => {
    assert.deepEqual(scan(onBox({loadScannedPieces: 3})),
        {result: "all_scanned", change: "none"});
    assert.deepEqual(scan(onBox({kind: "car", loadScannedPieces: 1})),
        {result: "all_scanned", change: "none"});
  });

  it("answers a retried scan id without a change, even after shipping",
      () => {
        const line = onBox({loadAddedByScan: true, loadScannedPieces: 1,
          loadScanIds: ["scan-0001"]});
        assert.deepEqual(scan(line), {result: "loaded", change: "none"});
        assert.deepEqual(scan(line, {container: {...loading,
          status: "shipped"}}), {result: "loaded", change: "none"});
      });

  it("refuses what the business does not have", () => {
    assert.deepEqual(scan(null), {refusal: "line_not_found"});
    assert.deepEqual(scan(waiting({businessId: "other"})),
        {refusal: "line_not_found"});
  });

  it("refuses a container that is not loading", () => {
    for (const status of ["shipped", "arrived"]) {
      assert.deepEqual(scan(waiting(), {container: {...loading, status}}),
          {refusal: "container_locked"});
    }
  });

  it("refuses a delivered package", () => {
    assert.deepEqual(scan(waiting({containerId: OTHER,
      containerStatus: "arrived", deliveredAt: {seconds: 1}}),
    {otherContainer: {status: "arrived"}}), {refusal: "line_delivered"});
  });

  it("keeps the destination a hard block", () => {
    assert.deepEqual(scan(waiting({destinationCountryId: "sn"})),
        {refusal: "destination_mismatch"});
    assert.deepEqual(scan(waiting(), {container: {...loading,
      destinationCountryId: ""}}),
    {refusal: "container_destination_required"});
    // A line that never named a destination rides anywhere.
    assert.deepEqual(scan(waiting({destinationCountryId: ""})),
        {result: "loaded", change: "load"});
  });

  it("offers a move only from another container still loading", () => {
    const line = waiting({containerId: OTHER, containerStatus: "loading"});
    const other = {businessId: BIZ, status: "loading", label: "Box 2"};
    assert.deepEqual(scan(line, {otherContainer: other}), {
      refusal: "line_in_other_container",
      details: {otherContainerId: OTHER, otherContainerLabel: "Box 2",
        otherStatus: "loading", canMove: true, otherScannedPieces: 0},
    });
    // Part scanned into the other box: say how many, still movable.
    assert.deepEqual(scan({...line, loadScannedPieces: 2},
        {otherContainer: other}).details,
    {otherContainerId: OTHER, otherContainerLabel: "Box 2",
      otherStatus: "loading", canMove: true, otherScannedPieces: 2});
    assert.deepEqual(scan(line, {otherContainer: other, move: true}),
        {result: "loaded", change: "move"});
    const shipped = {...other, status: "shipped"};
    for (const move of [false, true]) {
      assert.deepEqual(scan({...line, containerStatus: "shipped"},
          {otherContainer: shipped, move}), {
        refusal: "line_in_other_container",
        details: {otherContainerId: OTHER, otherContainerLabel: "Box 2",
          otherStatus: "shipped", canMove: false, otherScannedPieces: 0},
      });
    }
    // Gone, or another business's: never movable.
    assert.equal(scan(line, {otherContainer: null, move: true})
        .details.canMove, false);
    // Going somewhere else: say that rather than offer the move.
    assert.deepEqual(scan({...line, destinationCountryId: "sn"},
        {otherContainer: other, move: true}),
    {refusal: "destination_mismatch"});
  });
});

describe("undoScanDecision", () => {
  const undo = (line, extra = {}) => undoScanDecision({line, businessId: BIZ,
    container: loading, containerId: BOX, origin: null, ...extra});
  const origin = {businessId: BIZ, status: "loading", label: "Box 2",
    destinationCountryId: "gn"};

  it("takes back the last scan", () => {
    assert.deepEqual(undo(onBox({loadScannedPieces: 3,
      loadAddedByScan: true, loadScanIds: ["a1", "b2", "c3"]})),
    {result: "uncounted", change: "uncount", scannedPieces: 2,
      scanIds: ["a1", "b2"]});
  });

  it("takes back the named scan wherever it is: pieces are anonymous",
      () => {
        assert.deepEqual(undo(onBox({loadScannedPieces: 3,
          loadAddedByScan: true, loadScanIds: ["a1", "b2", "c3"]}),
        {scanId: "a1"}),
        {result: "uncounted", change: "uncount", scannedPieces: 2,
          scanIds: ["b2", "c3"]});
      });

  it("changes nothing for a scan already taken back, and says so", () => {
    const line = onBox({loadScannedPieces: 2, loadAddedByScan: true,
      loadScanIds: ["a1", "b2"]});
    assert.deepEqual(undo(line, {scanId: "gone"}),
        {result: "already_undone", change: "none", scannedPieces: 2});
    // Nothing scanned at all.
    assert.deepEqual(undo(onBox()),
        {result: "already_undone", change: "none", scannedPieces: 0});
    // Already sent back to waiting (or moved back) by the same undo.
    assert.deepEqual(undo(waiting(), {scanId: "a1"}),
        {result: "already_undone", change: "none", scannedPieces: 0});
    assert.deepEqual(undo(onBox({containerId: OTHER}), {scanId: "a1"}),
        {result: "already_undone", change: "none", scannedPieces: 0});
  });

  it("sends a package this mode took from waiting back at none", () => {
    assert.deepEqual(undo(onBox({loadScannedPieces: 1,
      loadAddedByScan: true, loadScanIds: ["a1"]}), {scanId: "a1"}),
    {result: "unloaded", change: "unload", scannedPieces: 0, scanIds: []});
    // Not while another scan of it stands.
    assert.equal(undo(onBox({loadScannedPieces: 2, loadAddedByScan: true,
      loadScanIds: ["a1", "b2"]}), {scanId: "a1"}).change, "uncount");
  });

  it("moves a package a scan moved here back, while that box loads", () => {
    const line = onBox({loadScannedPieces: 1, loadScanIds: ["a1"],
      loadMovedFromContainerId: OTHER});
    assert.deepEqual(undo(line, {origin}),
        {result: "moved_back", change: "move_back", scannedPieces: 0,
          scanIds: [], movedBackTo: OTHER});
    // The other box has shipped (or is gone, or another business's):
    // it stays here at 0.
    for (const gone of [{...origin, status: "shipped"}, null,
      {...origin, businessId: "x"}, {...origin, destinationCountryId: "sn"}]) {
      assert.deepEqual(undo(line, {origin: gone}),
          {result: "uncounted", change: "uncount", scannedPieces: 0,
            scanIds: []});
    }
  });

  it("leaves one added by hand on the container at 0", () => {
    assert.deepEqual(undo(onBox({loadScannedPieces: 1,
      loadScanIds: ["a1"]})),
    {result: "uncounted", change: "uncount", scannedPieces: 0,
      scanIds: []});
  });

  it("refuses a package not on this container, or a closed one", () => {
    assert.deepEqual(undo(waiting()), {refusal: "line_not_found"});
    assert.deepEqual(undo(null), {refusal: "line_not_found"});
    assert.deepEqual(undo(onBox({businessId: "x"}), {scanId: "a1"}),
        {refusal: "line_not_found"});
    assert.deepEqual(undo(onBox({containerId: OTHER})),
        {refusal: "line_not_found"});
    assert.deepEqual(undo(onBox({loadScannedPieces: 1}),
        {container: {...loading, status: "shipped"}}),
    {refusal: "container_locked"});
  });
});

describe("leaveUnscannedDecision", () => {
  it("needs some, not all, pieces scanned", () => {
    for (const n of [1, 2]) {
      assert.deepEqual(leaveUnscannedDecision(onBox({loadScannedPieces: n})),
          {change: "split"});
    }
    for (const n of [0, 3, 4, undefined]) {
      assert.deepEqual(leaveUnscannedDecision(onBox({loadScannedPieces: n})),
          {refusal: "piece_count_invalid"}, String(n));
    }
    assert.deepEqual(leaveUnscannedDecision(onBox({kind: "car",
      loadScannedPieces: 1})), {refusal: "piece_count_invalid"});
  });

  it("answers a retry with the part it made", () => {
    assert.deepEqual(leaveUnscannedDecision(onBox({quantity: 2,
      loadScannedPieces: 2, loadLeftPartId: "part-1"})),
    {change: "none", partId: "part-1"});
    // Pieces left unscanned again: a new split.
    assert.deepEqual(leaveUnscannedDecision(onBox({quantity: 2,
      loadScannedPieces: 1, loadLeftPartId: "part-1"})), {change: "split"});
  });
});

describe("views", () => {
  it("shows a line by receiver, pieces and scanned pieces", () => {
    assert.deepEqual(loadLineView("l1", onBox({receiverName: "Mariama Bah",
      customerName: "Fatou Diallo", destinationCountryName: "Guinea",
      loadScannedPieces: 2})), {
      lineId: "l1", trackingCode: "CL-K7M4P2", name: "Mariama Bah",
      kind: "barrels", pieceCount: 3, scannedPieces: 2,
      destinationCountryName: "Guinea",
      addedByScan: false, assignedVia: "", assignedAt: null,
      customerName: "Fatou Diallo", customerPhone: "",
    });
    assert.equal(loadLineView("l1", onBox({customerName: "Fatou Diallo"}))
        .name, "Fatou Diallo");
    // Never more scanned than it has (pieces edited away).
    assert.equal(scannedPiecesOf(onBox({loadScannedPieces: 9})), 3);
  });

  it("says how, when and for whom a package went on", () => {
    const at = 1760000000000;
    const view = loadLineView("l1", onBox({receiverName: "Mariama Bah",
      receiverPhone: "+224620000000", customerName: "Fatou Diallo",
      customerPhone: "+16465550100", loadAddedByScan: true,
      containerAssignedVia: "scan",
      containerAssignedAt: {toMillis: () => at}}));
    assert.equal(view.addedByScan, true);
    assert.equal(view.assignedVia, "scan");
    assert.equal(view.assignedAt, at);
    // The sender, not the receiver (the name column is the receiver).
    assert.equal(view.name, "Mariama Bah");
    assert.equal(view.customerName, "Fatou Diallo");
    assert.equal(view.customerPhone, "+16465550100");
    // A Date and a number are times too; anything else is none.
    assert.equal(loadLineView("l1", onBox({
      containerAssignedAt: new Date(at)})).assignedAt, at);
    assert.equal(loadLineView("l1", onBox({containerAssignedAt: at}))
        .assignedAt, at);
    assert.equal(loadLineView("l1", onBox({containerAssignedAt: "soon"}))
        .assignedAt, null);
    assert.equal(loadLineView("l1", onBox({containerAssignedAt: {}}))
        .assignedAt, null);
  });

  it("falls back to the receiver as the customer, and to nothing", () => {
    const receiver = loadLineView("l1", onBox({receiverName: "Mariama Bah",
      receiverPhone: "+224620000000"}));
    assert.equal(receiver.customerName, "Mariama Bah");
    assert.equal(receiver.customerPhone, "+224620000000");
    // A sender with only a phone is still the sender.
    const phoneOnly = loadLineView("l1", onBox({customerPhone: "+1646",
      receiverName: "Mariama Bah", receiverPhone: "+224620000000"}));
    assert.equal(phoneOnly.customerName, "");
    assert.equal(phoneOnly.customerPhone, "+1646");
    // Business stock names nobody.
    const stock = loadLineView("l1", onBox({ownerKind: "stock",
      customerName: "Fatou", receiverName: "Agent"}));
    assert.equal(stock.customerName, "");
    assert.equal(stock.customerPhone, "");
    assert.equal(stock.name, "Agent");
  });

  it("leaves lines put on before this without how or when", () => {
    const old = loadLineView("l1", onBox());
    assert.equal(old.addedByScan, false);
    assert.equal(old.assignedVia, "");
    assert.equal(old.assignedAt, null);
    // Not a way anyone writes: shown as none.
    assert.equal(loadLineView("l1", onBox({containerAssignedVia: "magic"}))
        .assignedVia, "");
    assert.deepEqual(ASSIGN_VIA, {HAND: "hand", SCAN: "scan", MOVE: "move"});
    assert.deepEqual([...ASSIGN_FIELDS], ["containerAssignedAt",
      "containerAssignedByStaffId", "containerAssignedVia"]);
    // Kept apart from the scan marks, which the app also reads.
    assert.ok(ASSIGN_FIELDS.every((field) => !LOAD_FIELDS.includes(field)));
  });

  it("shows the container after a change", () => {
    const box = {label: "Box 1", lineCount: 2, carCount: 1, barrelCount: 3,
      otherCount: 1};
    assert.deepEqual(loadContainerView(BOX, box), {containerId: BOX,
      label: "Box 1", lineCount: 2, pieceCount: 5});
    assert.deepEqual(loadContainerView(BOX, box,
        {lineCount: 1, barrelCount: 2}),
    {containerId: BOX, label: "Box 1", lineCount: 3, pieceCount: 7});
    assert.deepEqual(loadContainerView(BOX, {}), {containerId: BOX,
      label: "", lineCount: 0, pieceCount: 0});
  });

  it("adds tally deltas key by key", () => {
    assert.deepEqual(addCountDeltas({lineCount: 1, barrelCount: 2},
        {lineCount: -1, barrelCount: -4}), {barrelCount: -2});
  });
});

describe("loadSummaryOf", () => {
  it("sorts the container's lines into incomplete and never scanned", () => {
    const {incomplete, unscanned} = loadSummaryOf([
      {id: "a", line: onBox({trackingCode: "CL-BBBBBB",
        loadScannedPieces: 1})},
      {id: "b", line: onBox({trackingCode: "CL-CCCCCC"})},
      {id: "c", line: onBox({trackingCode: "CL-DDDDDD",
        loadScannedPieces: 3})},
      {id: "d", line: onBox({trackingCode: "CL-BBBBBC", kind: "car",
        loadScannedPieces: 0})},
    ]);
    assert.deepEqual(incomplete.map((row) => [row.lineId, row.scannedPieces,
      row.pieceCount]), [["a", 1, 3]]);
    assert.deepEqual(unscanned.map((row) => row.lineId), ["d", "b"]);
    assert.deepEqual(loadSummaryOf(null), {incomplete: [], unscanned: []});
  });
});

describe("history and messages", () => {
  it("words the History entries", () => {
    assert.equal(scanLoadAuditSummary({what: "3 barrels for Fatou",
      label: "Box 1"}), "Loaded 3 barrels for Fatou on Box 1 by scan");
    assert.equal(scanLoadAuditSummary({what: "3 barrels", label: "Box 1",
      fromLabel: "Box 2"}), "Loaded 3 barrels on Box 1 by scan " +
      "(moved from Box 2)");
    assert.equal(scanUnloadAuditSummary("Box 1"),
        "Scan undone: taken off Box 1, waiting for a container");
    assert.equal(scanMoveBackAuditSummary({label: "Box 1",
      toLabel: "Box 2"}), "Scan undone: moved back from Box 1 to Box 2");
  });

  it("explains every refusal it can make", () => {
    for (const code of ["load_action_invalid", "scan_code_invalid",
      "scan_id_invalid", "scan_line_not_found", "line_delivered",
      "line_in_other_container", "line_not_found", "container_locked",
      "container_destination_required", "destination_mismatch",
      "piece_count_invalid"]) {
      assert.ok(CONTAINER_MESSAGES[code], code);
    }
  });

  it("keeps every scanning field server-side and cleared on leaving", () => {
    assert.deepEqual([...LOAD_FIELDS], ["loadScannedPieces",
      "loadAddedByScan", "loadScannedAt", "loadScannedByStaffId",
      "loadScanIds", "loadMovedFromContainerId", "loadLeftPartId"]);
  });
});
