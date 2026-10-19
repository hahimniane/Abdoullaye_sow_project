"use strict";

/**
 * Store transfers (docs/INVENTORY.md, "Store transfers (v5)"): stock moves
 * between the stores of ONE business in two steps. The source store sends
 * (its count and the product's total go down: the pieces are in transit and
 * sellable nowhere), the destination confirms what arrived (its count goes
 * up). Pieces that did not arrive are held as disputed until the owner returns
 * them to the source store or writes them off.
 *
 * This file is the pure half: no Firestore and no clock unless one is passed,
 * so every rule is unit-tested and the callables in `index.js` only read and
 * write around it. Counts per store use the v2 rules in `inventory.js`
 * (`effectiveRow`: a product that never got its rows is held whole by the
 * Main store; `mainRowToMaterialize`: that Main row is written the moment any
 * other row of the product is).
 */

const crypto = require("node:crypto");
const {effectiveRow, mainRowToMaterialize, itemDisplayName} =
  require("./inventory");
const {recipientLanguage} = require("./notification_settings");

const TRANSFER_STATUS = Object.freeze({
  DRAFT: "draft",
  IN_TRANSIT: "in_transit",
  RECEIVED: "received",
  RECEIVED_WITH_DIFFERENCES: "received_with_differences",
  CANCELLED: "cancelled",
});
const TRANSFER_STAGE = Object.freeze({
  DRAFT: "draft",
  IN_TRANSIT: "in_transit",
  REVIEW: "review",
  DONE: "done",
});
/** The stages lists read as "open": a draft, on its way, or in review. */
const OPEN_STAGES = Object.freeze(["draft", "in_transit", "review"]);
/** The stages that hold stock nowhere: on its way, or disputed. */
const HOLDING_STAGES = Object.freeze(["in_transit", "review"]);

const MAX_TRANSFER_LINES = 100;
const MAX_QUANTITY = 1000000;
const MAX_TRANSFER_NOTE = 300;
const MAX_NAME = 120;
const WRITE_OFF_REASONS = Object.freeze(["lost", "damaged", "stolen", "other"]);
const WRITE_OFF_REASON_LABELS = Object.freeze({
  en: {lost: "Lost in transit", damaged: "Damaged", stolen: "Stolen",
    other: "Other"},
  fr: {lost: "Perdu en route", damaged: "Abîmé", stolen: "Volé",
    other: "Autre"},
});
const RESOLUTIONS = Object.freeze({RETURN: "return", WRITE_OFF: "write_off"});

const TRANSFER_NOTIFICATION_PREFERENCE = "inventoryTransfers";
const MAX_TRANSFER_NOTIFICATION_RECIPIENTS = 50;
/** Reminders go out 2 days after sending / receiving, then every 2 days. */
const TRANSFER_REMINDER_EVERY_MS = 2 * 24 * 60 * 60 * 1000;
/** The morning job's start time drifts; this much early still counts. */
const TRANSFER_REMINDER_SLACK_MS = 2 * 60 * 60 * 1000;
const TRANSFER_ZONE = "America/New_York";
const DAY_MS = 24 * 60 * 60 * 1000;
/** "In transit 3 days" (and the reminder) start at this age. */
const TRANSIT_LATE_DAYS = 2;

const text = (value, max) => String(value ?? "").trim().slice(0, max);
const count = (value) => Math.max(0, Math.round(Number(value) || 0));

/**
 * @param {*} value Raw whole number (a number, or digits in a string).
 * @param {number} min Smallest allowed.
 * @param {number} max Largest allowed.
 * @return {number|null} The integer, or null when it is not one in range.
 */
function wholeNumber(value, min, max) {
  if (typeof value === "boolean" || value === null || value === undefined ||
      String(value).trim() === "") {
    return null;
  }
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
}

/**
 * @param {*} value A store / product id from a client.
 * @return {string} It trimmed, "" when it is empty or holds a slash.
 */
function docId(value) {
  const id = String(value ?? "").trim();
  return id.includes("/") ? "" : id.slice(0, 200);
}

/**
 * @param {*} value A retry key from the client.
 * @return {string} The key, or "" when it is not usable (the sale rule).
 */
function cleanRequestKey(value) {
  const id = text(value, 101);
  return /^[A-Za-z0-9_.:-]{8,100}$/.test(id) ? id : "";
}

/**
 * The transfer's document id: one per business and retry key, so a retried
 * Send lands on the same document and saving a draft again updates it.
 *
 * @param {string} businessId The business.
 * @param {string} clientRequestId A valid retry key.
 * @return {string} A 40-character id.
 */
function transferDocId(businessId, clientRequestId) {
  return crypto.createHash("sha256")
      .update(`${businessId}\u0000transfer\u0000${clientRequestId}`)
      .digest("hex").slice(0, 40);
}

/**
 * Reads what a draft save or a send asks for. Products named twice are
 * merged into one line (their quantities added).
 *
 * @param {object} data The callable's data.
 * @return {object} {errors, clientRequestId, fromStoreId, toStoreId, lines:
 *   [{itemId, quantity}]}.
 */
function cleanTransferInput(data) {
  const row = data && typeof data === "object" ? data : {};
  const errors = [];
  const clientRequestId = cleanRequestKey(row.clientRequestId);
  if (!clientRequestId) errors.push("client_request_id_invalid");
  const fromStoreId = docId(row.fromStoreId);
  const toStoreId = docId(row.toStoreId);
  if (!fromStoreId || !toStoreId) errors.push("store_not_found");
  else if (fromStoreId === toStoreId) errors.push("same_store");
  const raw = Array.isArray(row.lines) ? row.lines : [];
  const merged = new Map();
  let badQuantity = false;
  let badItem = false;
  for (const line of raw) {
    const itemId = docId(line?.itemId);
    const quantity = wholeNumber(line?.quantity, 1, MAX_QUANTITY);
    if (!itemId) {
      badItem = true;
      continue;
    }
    if (quantity === null) {
      badQuantity = true;
      continue;
    }
    merged.set(itemId, (merged.get(itemId) || 0) + quantity);
  }
  if (raw.length === 0) errors.push("transfer_lines_required");
  else if (merged.size > MAX_TRANSFER_LINES) {
    errors.push("transfer_lines_too_many");
  }
  if (badItem) errors.push("item_not_found");
  if (badQuantity || [...merged.values()].some((n) => n > MAX_QUANTITY)) {
    errors.push("quantity_invalid");
  }
  return {
    errors: [...new Set(errors)],
    clientRequestId,
    fromStoreId,
    toStoreId,
    lines: [...merged.entries()].map(([itemId, quantity]) =>
      ({itemId, quantity})),
  };
}

/**
 * @param {object} access {owner, all, homeStoreId} (inventory.storeAccessOf).
 * @param {string} storeId A store.
 * @return {boolean} True when the caller may send from that store.
 */
function canSendFrom(access, storeId) {
  return Boolean(access?.all) ||
    (Boolean(access?.homeStoreId) && access.homeStoreId === storeId);
}

/**
 * Checks the two stores of a draft or a send and whether the caller may send
 * from the source.
 *
 * @param {object} args {converted, stores, fromStoreId, toStoreId, access}.
 * @return {{code: ?string, from: ?object, to: ?object}} The stores, or the
 *   refusal code.
 */
function checkTransferStores({converted, stores, fromStoreId, toStoreId,
  access}) {
  if (!converted) return {code: "store_not_found", from: null, to: null};
  if (fromStoreId === toStoreId) return {code: "same_store"};
  const all = Array.isArray(stores) ? stores : [];
  const from = all.find((store) => store.id === fromStoreId);
  const to = all.find((store) => store.id === toStoreId);
  if (!from || !to) return {code: "store_not_found", from: null, to: null};
  if (from.archived === true || to.archived === true) {
    return {code: "store_archived", from, to};
  }
  if (!canSendFrom(access, from.id)) {
    return {code: access?.homeStoreId ? "store_not_allowed" :
      "home_store_required", from, to};
  }
  return {code: null, from, to};
}

/**
 * @param {object} item The stored product.
 * @return {number|null} Its cost, when known.
 */
function knownCost(item) {
  const cost = item?.costCents;
  return Number.isInteger(cost) && cost >= 0 ? cost : null;
}

/**
 * One line of a transfer as stored: a snapshot of the product and what is
 * sent of it.
 *
 * @param {string} itemId The product.
 * @param {object} item The stored product.
 * @param {number} quantity Pieces sent (or planned, for a draft).
 * @return {object} The stored line.
 */
function transferLine(itemId, item, quantity) {
  return {
    itemId,
    name: text(item?.name, MAX_NAME),
    brand: text(item?.brand, 60),
    code: text(item?.code, 40),
    costCents: knownCost(item),
    quantitySent: count(quantity),
    quantityReceived: null,
    missing: 0,
    resolution: "",
    writeOffReason: "",
    resolutionNote: "",
    resolvedByStaffId: "",
    resolvedByName: "",
    resolvedAt: null,
  };
}

/**
 * Per-line refusals for products that are not this business's.
 *
 * @param {Array<{itemId}>} lines The cleaned lines.
 * @param {Map<string, object>} items The products found (this business).
 * @return {string[]} The ids not found.
 */
function missingItemIds(lines, items) {
  return lines.filter((line) => !items.has(line.itemId))
      .map((line) => line.itemId);
}

/**
 * What a send does to the source store: per product its new count there and
 * its new total, or the refusals (all at once).
 *
 * @param {object} args {lines: [{itemId, quantity}], items: Map (the products
 *   of this business that exist), rows: Map (the stock row at the source per
 *   product), fromStoreId, mainStoreId}.
 * @return {object} {errors, details: {itemIds, byReason, available},
 *   writes: [{itemId, amount, rowQuantity, rowCountWasOff, totalAfter,
 *   extraRows}]}.
 */
function planSend({lines, items, rows, fromStoreId, mainStoreId}) {
  const byReason = {item_not_found: [], item_archived: [],
    insufficient_stock: []};
  const available = {};
  const writes = [];
  for (const line of lines) {
    const item = items.get(line.itemId);
    if (!item) {
      byReason.item_not_found.push(line.itemId);
      continue;
    }
    if (item.archived === true) {
      byReason.item_archived.push(line.itemId);
      continue;
    }
    const eff = effectiveRow(item, rows.get(line.itemId), fromStoreId,
        mainStoreId);
    if (eff.quantity < line.quantity) {
      byReason.insufficient_stock.push(line.itemId);
      available[line.itemId] = eff.quantity;
      continue;
    }
    writes.push({
      itemId: line.itemId,
      amount: line.quantity,
      rowQuantity: eff.quantity - line.quantity,
      rowCountWasOff: eff.countWasOff,
      totalAfter: Math.max(0, count(item.quantity) - line.quantity),
      extraRows: mainRowToMaterialize(item, mainStoreId, [fromStoreId]),
    });
  }
  const errors = Object.keys(byReason).filter((code) =>
    byReason[code].length > 0);
  const itemIds = [...new Set(errors.flatMap((code) => byReason[code]))];
  return {
    errors,
    details: {itemIds, byReason: Object.fromEntries(errors.map((code) =>
      [code, byReason[code]])), available},
    writes: errors.length > 0 ? [] : writes,
  };
}

/**
 * Pieces coming back into (or arriving at) a store: the store's new count and
 * the product's new total.
 *
 * @param {object} args {itemId, item, row, storeId, mainStoreId, amount}.
 * @return {object} {errors, write: {itemId, amount, rowQuantity,
 *   rowCountWasOff, totalAfter, extraRows}}.
 */
function planStockIn({itemId, item, row, storeId, mainStoreId, amount}) {
  const eff = effectiveRow(item, row, storeId, mainStoreId);
  const extraRows = mainRowToMaterialize(item, mainStoreId, [storeId]);
  if (eff.quantity + amount > MAX_QUANTITY ||
      count(item?.quantity) + amount > MAX_QUANTITY) {
    return {errors: ["quantity_invalid"]};
  }
  return {
    errors: [],
    write: {
      itemId,
      amount,
      rowQuantity: eff.quantity + amount,
      rowCountWasOff: eff.countWasOff,
      totalAfter: count(item?.quantity) + amount,
      extraRows,
    },
  };
}

/**
 * Putting a cancelled transfer's pieces back into the source store. A
 * product deleted since is skipped (deleting one in a transfer is refused,
 * so this only guards old data).
 *
 * @param {object} args {lines, items, rows (source rows), fromStoreId,
 *   mainStoreId}.
 * @return {object} {errors, writes, skippedItemIds, itemsReturned}.
 */
function planCancel({lines, items, rows, fromStoreId, mainStoreId}) {
  const writes = [];
  const skippedItemIds = [];
  for (const line of lines) {
    const amount = count(line.quantitySent);
    if (amount === 0) continue;
    const item = items.get(line.itemId);
    if (!item) {
      skippedItemIds.push(line.itemId);
      continue;
    }
    const plan = planStockIn({itemId: line.itemId, item,
      row: rows.get(line.itemId), storeId: fromStoreId, mainStoreId, amount});
    if (plan.errors.length > 0) return {errors: plan.errors};
    writes.push(plan.write);
  }
  return {errors: [], writes, skippedItemIds,
    itemsReturned: writes.reduce((sum, w) => sum + w.amount, 0)};
}

/**
 * Reads what arrived: every line of the transfer, the ones left out arrived
 * as sent.
 *
 * @param {object} data The receive callable's data.
 * @param {object[]} lines The transfer's stored lines.
 * @return {object} {errors, details: {itemIds}, received: Map itemId -> n,
 *   note}.
 */
function cleanReceiveInput(data, lines) {
  const row = data && typeof data === "object" ? data : {};
  const sent = new Map((Array.isArray(lines) ? lines : []).map((line) =>
    [line.itemId, count(line.quantitySent)]));
  const received = new Map(sent);
  const errors = [];
  const tooMany = [];
  const unknown = [];
  const seen = new Set();
  for (const line of Array.isArray(row.lines) ? row.lines : []) {
    const itemId = docId(line?.itemId);
    if (!sent.has(itemId)) {
      unknown.push(itemId);
      continue;
    }
    if (seen.has(itemId)) {
      errors.push("quantity_invalid");
      continue;
    }
    seen.add(itemId);
    const quantity = wholeNumber(line?.quantityReceived, 0, MAX_QUANTITY);
    if (quantity === null) {
      errors.push("quantity_invalid");
      continue;
    }
    if (quantity > sent.get(itemId)) {
      tooMany.push(itemId);
      continue;
    }
    received.set(itemId, quantity);
  }
  if (unknown.length > 0) errors.unshift("item_not_in_transfer");
  if (tooMany.length > 0) errors.push("received_too_many");
  const note = String(row.note ?? "").trim();
  if (note.length > MAX_TRANSFER_NOTE) errors.push("note_too_long");
  return {
    errors: [...new Set(errors)],
    details: {itemIds: [...unknown, ...tooMany]},
    received,
    note: note.slice(0, MAX_TRANSFER_NOTE),
  };
}

/**
 * Every count a transfer stores, from its lines.
 *
 * @param {object[]} lines The stored lines.
 * @return {object} {productsCount, itemsCount, receivedCount (null before
 *   anything was received), missingCount, openMissingCount, returnedCount,
 *   writtenOffCount, valueCents, openMissingValueCents, linesWithoutCost}.
 */
function transferTotals(lines) {
  const all = Array.isArray(lines) ? lines : [];
  const totals = {
    productsCount: all.length, itemsCount: 0, receivedCount: null,
    missingCount: 0, openMissingCount: 0, returnedCount: 0,
    writtenOffCount: 0, valueCents: 0, openMissingValueCents: 0,
    linesWithoutCost: 0,
  };
  for (const line of all) {
    const sent = count(line.quantitySent);
    const missing = count(line.missing);
    const cost = Number.isInteger(line.costCents) ? line.costCents : null;
    totals.itemsCount += sent;
    if (line.quantityReceived !== null && line.quantityReceived !== undefined) {
      totals.receivedCount = (totals.receivedCount || 0) +
        count(line.quantityReceived);
    }
    totals.missingCount += missing;
    const open = missing > 0 && !line.resolution;
    if (open) totals.openMissingCount += missing;
    if (line.resolution === "returned") totals.returnedCount += missing;
    if (line.resolution === "written_off") totals.writtenOffCount += missing;
    if (cost === null) {
      totals.linesWithoutCost += 1;
    } else {
      totals.valueCents += sent * cost;
      if (open) totals.openMissingValueCents += missing * cost;
    }
  }
  return totals;
}

/**
 * @param {string} status The transfer's status.
 * @param {object[]} lines Its lines.
 * @return {string} The stage lists and checks query.
 */
function stageOf(status, lines) {
  if (status === TRANSFER_STATUS.DRAFT) return TRANSFER_STAGE.DRAFT;
  if (status === TRANSFER_STATUS.IN_TRANSIT) return TRANSFER_STAGE.IN_TRANSIT;
  if (status === TRANSFER_STATUS.RECEIVED_WITH_DIFFERENCES &&
      transferTotals(lines).openMissingCount > 0) {
    return TRANSFER_STAGE.REVIEW;
  }
  return TRANSFER_STAGE.DONE;
}

/**
 * What a receive does: the lines with what arrived, the destination's new
 * counts, and the new status.
 *
 * @param {object} args {lines (stored), received (Map itemId -> n), items
 *   (Map of the products that exist), rows (destination rows), toStoreId,
 *   mainStoreId}.
 * @return {object} {errors, lines, writes, skippedItemIds, status, stage,
 *   totals}.
 */
function planReceive({lines, received, items, rows, toStoreId, mainStoreId}) {
  const writes = [];
  const skippedItemIds = [];
  const next = [];
  for (const line of lines) {
    const sent = count(line.quantitySent);
    const got = Math.min(sent, count(received.get(line.itemId)));
    next.push({...line, quantityReceived: got, missing: sent - got});
    if (got === 0) continue;
    const item = items.get(line.itemId);
    if (!item) {
      skippedItemIds.push(line.itemId);
      continue;
    }
    const plan = planStockIn({itemId: line.itemId, item,
      row: rows.get(line.itemId), storeId: toStoreId, mainStoreId,
      amount: got});
    if (plan.errors.length > 0) return {errors: plan.errors};
    writes.push(plan.write);
  }
  const totals = transferTotals(next);
  const status = totals.missingCount > 0 ?
    TRANSFER_STATUS.RECEIVED_WITH_DIFFERENCES : TRANSFER_STATUS.RECEIVED;
  return {errors: [], lines: next, writes, skippedItemIds, status,
    stage: stageOf(status, next), totals};
}

/**
 * Reads an owner's decision on a missing line.
 *
 * @param {object} data The callable's data.
 * @return {object} {errors, itemId, action, reason, note, requestId}.
 */
function cleanResolveInput(data) {
  const row = data && typeof data === "object" ? data : {};
  const errors = [];
  const itemId = docId(row.itemId);
  const action = text(row.action, 20);
  if (action !== RESOLUTIONS.RETURN && action !== RESOLUTIONS.WRITE_OFF) {
    errors.push("resolution_invalid");
  }
  const reason = text(row.reason, 20);
  if (action === RESOLUTIONS.WRITE_OFF && !WRITE_OFF_REASONS.includes(reason)) {
    errors.push("write_off_reason_invalid");
  }
  const note = String(row.note ?? "").trim();
  if (note.length > MAX_TRANSFER_NOTE) errors.push("note_too_long");
  if (!itemId) errors.unshift("item_not_in_transfer");
  return {
    errors: [...new Set(errors)],
    itemId,
    action,
    reason: action === RESOLUTIONS.WRITE_OFF ? reason : "",
    note: note.slice(0, MAX_TRANSFER_NOTE),
    requestId: cleanRequestKey(row.requestId),
  };
}

/**
 * Whether the line can be decided now, and what is already decided.
 *
 * @param {object} transfer The stored transfer.
 * @param {object} input cleanResolveInput's answer.
 * @return {{code: ?string, line: ?object, index: number, replayed:
 *   boolean, details: object}} A refusal, a replay, or the line to decide.
 */
function checkResolve(transfer, input) {
  const lines = Array.isArray(transfer?.lines) ? transfer.lines : [];
  const index = lines.findIndex((line) => line.itemId === input.itemId);
  if (index < 0) {
    return {code: "item_not_in_transfer", line: null, index, replayed: false,
      details: {}};
  }
  const line = lines[index];
  const want = input.action === RESOLUTIONS.RETURN ? "returned" :
    "written_off";
  if (line.resolution) {
    if (input.requestId && line.resolveRequestId === input.requestId &&
        line.resolution === want) {
      return {code: null, line, index, replayed: true, details: {}};
    }
    return {code: "line_already_resolved", line, index, replayed: false,
      details: {resolution: line.resolution}};
  }
  if (transfer.status !== TRANSFER_STATUS.RECEIVED_WITH_DIFFERENCES ||
      count(line.missing) === 0) {
    return {code: "line_not_disputed", line, index, replayed: false,
      details: {status: transfer.status}};
  }
  return {code: null, line, index, replayed: false, details: {}};
}

/**
 * The line once decided.
 *
 * @param {object} line The stored line.
 * @param {object} decision {action, reason, note, uid, name, at, requestId}.
 * @return {object} The new line.
 */
function resolvedLine(line, {action, reason, note, uid, name, at,
  requestId}) {
  return {
    ...line,
    resolution: action === RESOLUTIONS.RETURN ? "returned" : "written_off",
    writeOffReason: action === RESOLUTIONS.WRITE_OFF ? reason : "",
    resolutionNote: text(note, MAX_TRANSFER_NOTE),
    resolvedByStaffId: text(uid, 200),
    resolvedByName: text(name, MAX_NAME),
    resolvedAt: at ?? null,
    resolveRequestId: text(requestId, 101),
  };
}

// ---------------------------------------------------------------------------
// Who may do what (the clients mirror these).
// ---------------------------------------------------------------------------

/**
 * @param {object} access The caller's store access.
 * @param {string} uid The caller.
 * @param {object} transfer The stored transfer.
 * @return {boolean} True when the caller may cancel it while it is on its
 *   way: the sender, the owner, a platform admin, all-stores staff.
 */
function canCancel(access, uid, transfer) {
  return Boolean(access?.all) ||
    (Boolean(uid) && text(transfer?.sentByStaffId, 200) === uid);
}

/**
 * @param {object} access The caller's store access.
 * @param {string} uid The caller.
 * @param {object} transfer The stored draft.
 * @return {boolean} True when the caller may discard it.
 */
function canDiscardDraft(access, uid, transfer) {
  return canSendFrom(access, text(transfer?.fromStoreId, 200)) ||
    (Boolean(uid) && text(transfer?.createdByStaffId, 200) === uid);
}

/**
 * @param {object} access The caller's store access.
 * @param {object} transfer The stored transfer.
 * @return {boolean} True for the destination's staff, owners, platform
 *   admins and all-stores staff.
 */
function canReceive(access, transfer) {
  return Boolean(access?.all) ||
    (Boolean(access?.homeStoreId) &&
      access.homeStoreId === text(transfer?.toStoreId, 200));
}

/**
 * @param {object} access The caller's store access.
 * @return {boolean} True for whoever settles missing pieces.
 */
function canResolve(access) {
  return Boolean(access?.all);
}

// ---------------------------------------------------------------------------
// Words: history rows and pushes.
// ---------------------------------------------------------------------------

/**
 * @param {number} n Pieces.
 * @param {"en"|"fr"} language The language.
 * @return {string} "1 item", "14 items" / "1 article", "14 articles".
 */
function itemsText(n, language = "en") {
  const value = count(n);
  if (language === "fr") {
    return `${value} ${value === 1 ? "article" : "articles"}`;
  }
  return `${value} ${value === 1 ? "item" : "items"}`;
}

/**
 * @param {string} reason A write-off reason code.
 * @param {"en"|"fr"} language The language.
 * @return {string} Its label.
 */
function writeOffReasonLabel(reason, language = "en") {
  const labels = WRITE_OFF_REASON_LABELS[language === "fr" ? "fr" : "en"];
  return labels[reason] || labels.other;
}

/**
 * The History (lotLedgerAudit) sentence of a transfer event. English only,
 * like every History row; the console translates the shapes.
 *
 * @param {string} action sent | cancelled | draft_discarded | received |
 *   received_with_differences | returned | written_off.
 * @param {object} t {code, fromStoreName, toStoreName, itemsCount,
 *   receivedCount, missingCount, itemName, quantity, reason}.
 * @return {string} The summary.
 */
function transferAuditSummary(action, t) {
  const code = text(t.code, 40);
  const from = text(t.fromStoreName, MAX_NAME);
  const to = text(t.toStoreName, MAX_NAME);
  switch (action) {
    case "sent":
      return `Sent ${itemsText(t.itemsCount)} from ${from} to ${to} (${code})`;
    case "cancelled":
      return `Cancelled ${code}: ${itemsText(t.itemsCount)} back in ${from}`;
    case "draft_discarded":
      return `Discarded the draft ${code}`;
    case "received":
      return `${to} received all ${itemsText(t.itemsCount)} of ${code}`;
    case "received_with_differences":
      return `${to} received ${count(t.receivedCount)} of ` +
        `${itemsText(t.itemsCount)} of ${code}: ${count(t.missingCount)} ` +
        "missing";
    case "returned":
      return `Returned ${count(t.quantity)} of ${text(t.itemName, 200)} to ` +
        `${from} (${code})`;
    case "written_off":
      return `Wrote off ${count(t.quantity)} of ${text(t.itemName, 200)} ` +
        `from ${code}: ${writeOffReasonLabel(t.reason)}`;
    default:
      return code;
  }
}

/**
 * @param {*} value A stored time (Firestore Timestamp, Date, millis).
 * @return {?number} Its milliseconds, or null.
 */
function millisOf(value) {
  if (value === null || value === undefined) return null;
  if (typeof value.toMillis === "function") return value.toMillis();
  if (value instanceof Date) return value.getTime();
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * @param {*} since A stored time.
 * @param {number} nowMs Now.
 * @return {number} Whole days since then (0 when unknown).
 */
function daysSince(since, nowMs) {
  const ms = millisOf(since);
  if (ms === null) return 0;
  return Math.max(0, Math.floor((nowMs - ms) / DAY_MS));
}

/**
 * The words of one transfer push in one language.
 *
 * @param {object} args {transfer, kind, audience ("destination" | "owner" |
 *   "settler"), language, days}.
 * @return {{title: string, body: string}} The copy.
 */
function transferNotificationCopy({transfer, kind, audience, language,
  days = 0}) {
  const fr = language === "fr";
  const code = text(transfer?.code, 40);
  const from = text(transfer?.fromStoreName, MAX_NAME);
  const to = text(transfer?.toStoreName, MAX_NAME);
  const totals = transferTotals(transfer?.lines);
  const n = totals.itemsCount;
  const missing = kind === "dispute_reminder" ? totals.openMissingCount :
    totals.missingCount;
  const items = itemsText(n, fr ? "fr" : "en");
  switch (kind) {
    case "sent":
      if (audience === "destination") {
        return fr ?
          {title: `${from} vous a envoyé ${items}`,
            body: `${code} · confirmez à l'arrivée`} :
          {title: `${from} sent you ${items}`,
            body: `${code} · confirm when they arrive`};
      }
      return fr ?
        {title: `${from} a envoyé ${items} à ${to}`,
          body: `${code} · en route`} :
        {title: `${from} sent ${items} to ${to}`, body: `${code} · in transit`};
    case "cancelled":
      return fr ?
        {title: `${from} a annulé un transfert`,
          body: `${code} · ${items} restent à ${from}`} :
        {title: `${from} cancelled a transfer`,
          body: `${code} · ${items} stay in ${from}`};
    case "differences": {
      const received = count(totals.receivedCount);
      if (fr) {
        return {
          title: missing === 1 ?
            `1 article n'est pas arrivé à ${to}` :
            `${missing} articles ne sont pas arrivés à ${to}`,
          body: `${code} de ${from} · ${received} sur ${n} arrivés · ` +
            "à vous de décider",
        };
      }
      return {
        title: missing === 1 ? `1 item didn't arrive at ${to}` :
          `${missing} items didn't arrive at ${to}`,
        body: `${code} from ${from} · ${received} of ${n} arrived · ` +
          "needs your decision",
      };
    }
    case "transit_reminder":
      return fr ?
        {title: `${items} toujours en route vers ${to}`,
          body: `${code} de ${from} · envoyé il y a ${days} ` +
            `${days === 1 ? "jour" : "jours"} · confirmez à l'arrivée`} :
        {title: `${items} still on their way to ${to}`,
          body: `${code} from ${from} · sent ${days} ` +
            `${days === 1 ? "day" : "days"} ago · confirm when they arrive`};
    case "dispute_reminder":
      return fr ?
        {title: missing === 1 ? "1 article manquant attend votre décision" :
          `${missing} articles manquants attendent votre décision`,
        body: `${code} · ${from} → ${to}`} :
        {title: missing === 1 ? "1 missing item needs your decision" :
          `${missing} missing items need your decision`,
        body: `${code} · ${from} → ${to}`};
    default:
      return {title: code, body: ""};
  }
}

/**
 * Who hears about a transfer event, and what they read.
 *
 * - sent, cancelled, transit_reminder: the destination store's staff
 *   (inventory permission, home store = destination) and the owner(s);
 * - differences: the owner(s) and all-stores staff;
 * - dispute_reminder: the owner(s).
 * Never the person who did it, never anyone who switched "Store transfers"
 * off, never another business's people; owners first, at most
 * MAX_TRANSFER_NOTIFICATION_RECIPIENTS.
 *
 * @param {object} args {transfer (stored, with `id`), kind, users (profiles
 *   with `id`), actorUid, ownerUids (the business's ownerUid), nowMs}.
 * @return {{recipients: Array<{uid, language, title, body}>, data: object}}
 *   The plan.
 */
function planTransferNotification({transfer, kind, users, actorUid = "",
  ownerUids = [], nowMs = Date.now()}) {
  const businessId = text(transfer?.businessId, 200);
  const toStoreId = text(transfer?.toStoreId, 200);
  const actor = text(actorUid, 200);
  const owners = new Set((Array.isArray(ownerUids) ? ownerUids : [])
      .map((uid) => text(uid, 200)).filter(Boolean));
  const chosen = [];
  const seen = new Set();
  for (const user of Array.isArray(users) ? users : []) {
    const uid = text(user?.id, 200);
    if (!uid || uid === actor || seen.has(uid)) continue;
    const owner = user.role === "businessOwner" || owners.has(uid);
    if (text(user.businessId, 200) !== businessId && !owners.has(uid)) {
      continue;
    }
    if (user.notificationPreferences?.[TRANSFER_NOTIFICATION_PREFERENCE] ===
        false) {
      continue;
    }
    let audience = "";
    if (owner) {
      audience = kind === "differences" ? "settler" : "owner";
    } else if (user.role === "staff" &&
        (Array.isArray(user.businessPermissions) ?
          user.businessPermissions : []).includes("inventory")) {
      if (kind === "differences") {
        if (user.inventoryAllStores === true) audience = "settler";
      } else if (kind !== "dispute_reminder" &&
          text(user.inventoryHomeStoreId, 200) === toStoreId) {
        audience = "destination";
      }
    }
    if (!audience) continue;
    seen.add(uid);
    chosen.push({uid, owner, user, audience});
  }
  chosen.sort((a, b) => (a.owner === b.owner ?
    (a.uid < b.uid ? -1 : a.uid > b.uid ? 1 : 0) : a.owner ? -1 : 1));
  const days = daysSince(transfer?.sentAt, nowMs);
  const transferId = text(transfer?.id, 200);
  return {
    recipients: chosen.slice(0, MAX_TRANSFER_NOTIFICATION_RECIPIENTS)
        .map(({uid, user, audience}) => {
          const language = recipientLanguage(user);
          return {uid, language, ...transferNotificationCopy({transfer, kind,
            audience, language, days})};
        }),
    data: {
      type: "inventory_transfer",
      kind,
      businessId,
      transferId,
      code: text(transfer?.code, 40),
      fromStoreId: text(transfer?.fromStoreId, 200),
      toStoreId,
      relatedCollection: "inventoryTransfers",
      relatedId: transferId,
    },
  };
}

/**
 * @param {*} last When the last reminder went out (null: never).
 * @param {*} since When the clock started (sent / received).
 * @param {number} nowMs Now.
 * @return {boolean} True when 2 days have passed since both.
 */
function dueAfter(last, since, nowMs) {
  const start = millisOf(since);
  if (start === null) return false;
  const every = TRANSFER_REMINDER_EVERY_MS - TRANSFER_REMINDER_SLACK_MS;
  if (nowMs - start < every) return false;
  const lastMs = millisOf(last);
  return lastMs === null || nowMs - lastMs >= every;
}

/**
 * Which reminder the morning job owes this transfer now, if any.
 *
 * @param {object} transfer The stored transfer.
 * @param {number} nowMs Now.
 * @return {""|"transit_reminder"|"dispute_reminder"} The reminder.
 */
function reminderDue(transfer, nowMs) {
  if (!transfer) return "";
  if (transfer.status === TRANSFER_STATUS.IN_TRANSIT &&
      dueAfter(transfer.lastTransitReminderAt, transfer.sentAt, nowMs)) {
    return "transit_reminder";
  }
  if (transfer.status === TRANSFER_STATUS.RECEIVED_WITH_DIFFERENCES &&
      stageOf(transfer.status, transfer.lines) === TRANSFER_STAGE.REVIEW &&
      dueAfter(transfer.lastDisputeReminderAt, transfer.receivedAt, nowMs)) {
    return "dispute_reminder";
  }
  return "";
}

// ---------------------------------------------------------------------------
// The summary block.
// ---------------------------------------------------------------------------

/**
 * What is in transit and disputed now, and what was received in a range.
 *
 * @param {object} args {open: transfers in transit or in review, received:
 *   transfers received in the range, storeId ("" = every store)}.
 * @return {object} {inTransitCount, inTransitItems, inTransitValueCents,
 *   disputedCount, disputedItems, disputedValueCents, receivedCount,
 *   receivedItems, receivedWithDifferences, linesWithoutCost}.
 */
function summarizeTransfers({open = [], received = [], storeId = ""}) {
  const store = text(storeId, 200);
  const touches = (t) => !store || t.fromStoreId === store ||
    t.toStoreId === store;
  const block = {
    inTransitCount: 0, inTransitItems: 0, inTransitValueCents: 0,
    disputedCount: 0, disputedItems: 0, disputedValueCents: 0,
    receivedCount: 0, receivedItems: 0, receivedWithDifferences: 0,
    linesWithoutCost: 0,
  };
  for (const t of open) {
    if (!touches(t)) continue;
    const totals = transferTotals(t.lines);
    if (t.status === TRANSFER_STATUS.IN_TRANSIT) {
      block.inTransitCount += 1;
      block.inTransitItems += totals.itemsCount;
      block.inTransitValueCents += totals.valueCents;
      block.linesWithoutCost += totals.linesWithoutCost;
    } else if (stageOf(t.status, t.lines) === TRANSFER_STAGE.REVIEW) {
      block.disputedCount += 1;
      block.disputedItems += totals.openMissingCount;
      block.disputedValueCents += totals.openMissingValueCents;
      block.linesWithoutCost += (Array.isArray(t.lines) ? t.lines : [])
          .filter((line) => count(line.missing) > 0 && !line.resolution &&
            !Number.isInteger(line.costCents)).length;
    }
  }
  for (const t of received) {
    if (!touches(t)) continue;
    if (t.status !== TRANSFER_STATUS.RECEIVED &&
        t.status !== TRANSFER_STATUS.RECEIVED_WITH_DIFFERENCES) {
      continue;
    }
    const totals = transferTotals(t.lines);
    block.receivedCount += 1;
    block.receivedItems += count(totals.receivedCount);
    if (t.status === TRANSFER_STATUS.RECEIVED_WITH_DIFFERENCES) {
      block.receivedWithDifferences += 1;
    }
  }
  return block;
}

/**
 * @param {object} line A stored line.
 * @return {string} "Jordan 11", the way products read everywhere.
 */
function lineDisplayName(line) {
  return itemDisplayName(line) || text(line?.code, 40);
}

module.exports = {
  TRANSFER_STATUS,
  TRANSFER_STAGE,
  OPEN_STAGES,
  HOLDING_STAGES,
  MAX_TRANSFER_LINES,
  MAX_TRANSFER_NOTE,
  WRITE_OFF_REASONS,
  RESOLUTIONS,
  TRANSFER_NOTIFICATION_PREFERENCE,
  MAX_TRANSFER_NOTIFICATION_RECIPIENTS,
  TRANSFER_REMINDER_EVERY_MS,
  TRANSFER_REMINDER_SLACK_MS,
  TRANSFER_ZONE,
  TRANSIT_LATE_DAYS,
  cleanRequestKey,
  transferDocId,
  cleanTransferInput,
  canSendFrom,
  checkTransferStores,
  transferLine,
  missingItemIds,
  planSend,
  planStockIn,
  planCancel,
  cleanReceiveInput,
  transferTotals,
  stageOf,
  planReceive,
  cleanResolveInput,
  checkResolve,
  resolvedLine,
  canCancel,
  canDiscardDraft,
  canReceive,
  canResolve,
  itemsText,
  writeOffReasonLabel,
  transferAuditSummary,
  millisOf,
  daysSince,
  transferNotificationCopy,
  planTransferNotification,
  reminderDue,
  summarizeTransfers,
  lineDisplayName,
};
