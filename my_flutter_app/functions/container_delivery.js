"use strict";

/**
 * Package delivered at destination (owner decisions 2026-10-21;
 * docs/WAITING_PACKAGES.md "Delivered at destination").
 *
 * Destination staff hand a package (one container line, all of its pieces at
 * once) to the person collecting it and mark it DELIVERED. The line records
 * when, who handed it over and who collected it (the receiver by default -
 * someone may collect for them). An unpaid balance is a warning, never a
 * block: the first ask is refused with `delivery_balance_due` until the
 * caller confirms (`acknowledgeBalance`). The sender and the receiver each
 * hear once, by WhatsApp (`delivered`, shipment_delivered_2lang). The owner
 * or a manager (the containers permission) may undo a delivery; an undo
 * tells nobody.
 *
 * Who may do what:
 *   - mark delivered: the containers permission OR the narrower
 *     `deliveries` permission (owners and admins hold every section);
 *   - undo: the containers permission (owners and admins included);
 *   - see the amount still owed: the containers or the ledger permission.
 *     A deliveries-only person is told there is a balance, never how much.
 *
 * Pure: no Firestore, no clock. The callable is an action on
 * `updateContainerLine` in index.js (no new Cloud Function export: the CPU
 * instance budget in test/scaling-contract.test.js is at its limit). The
 * console's `container-delivery.ts` and the app's `container_delivery.dart`
 * mirror the rules the screens need.
 */

const {lineCustomerName} = require("./container_manifest");

const DELIVERY_ACTION = Object.freeze({
  DELIVER: "deliver",
  UNDO: "undo_delivery",
});
const DELIVERY_ACTIONS = Object.freeze(Object.values(DELIVERY_ACTION));

// The staff permission that opens Deliveries and nothing else.
const DELIVERIES_SECTION = "deliveries";
// Who may mark a package delivered.
const DELIVERY_SECTIONS = Object.freeze(["containers", DELIVERIES_SECTION]);
// Who may undo a delivery: a manager of the containers.
const DELIVERY_UNDO_SECTION = "containers";
// Who may see what a package still owes.
const DELIVERY_MONEY_SECTIONS = Object.freeze(["containers", "ledger"]);

const MAX_COLLECTED_BY = 120;

// The fields a delivery writes on the line, and an undo clears.
const DELIVERY_FIELDS = Object.freeze([
  "deliveredAt",
  "deliveredByStaffId",
  "deliveredByName",
  "collectedBy",
  "deliveredBalanceCents",
]);

const DELIVERY_MESSAGES = Object.freeze({
  delivery_action_invalid: "That is not something a package delivery can do.",
  delivery_not_arrived:
    "A package can be marked delivered once its container is ready for " +
    "pickup.",
  delivery_balance_due:
    "This package still has an unpaid balance. Confirm to mark it " +
    "delivered anyway.",
  collected_by_too_long:
    "Keep the name of who collected it to 120 characters.",
  line_not_found: "That package no longer exists.",
});

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
// One line of text: a name is never several lines.
const oneLine = (value) => String(value ?? "")
    .replace(/[\r\n\t]+/g, " ").replace(/ {2,}/g, " ").trim();

/**
 * @param {*} value The request's `action`.
 * @return {string} A DELIVERY_ACTION, or "" for anything else (including
 *   none, which is an ordinary line edit).
 */
function deliveryActionOf(value) {
  const action = text(value, 40);
  return DELIVERY_ACTIONS.includes(action) ? action : "";
}

/**
 * @param {object} line A stored line.
 * @return {boolean} Whether it is marked delivered.
 */
function lineIsDelivered(line) {
  const row = line && typeof line === "object" ? line : {};
  return Boolean(row.deliveredAt);
}

/**
 * Why a package cannot be marked delivered now, or null. Only a package on
 * a container that has been marked ready for pickup (stored `arrived`) can
 * be handed over: a waiting package, or one on a box still loading or at
 * sea, is not at the destination yet.
 *
 * @param {object} line The stored line.
 * @param {object|null} container Its container, or null when it has none
 *   (or it is gone).
 * @return {string|null} A DELIVERY_MESSAGES code, or null.
 */
function deliveryRefusal(line, container) {
  const row = line && typeof line === "object" ? line : {};
  if (!text(row.containerId)) return "delivery_not_arrived";
  if (!container || typeof container !== "object") {
    return "delivery_not_arrived";
  }
  return text(container.status, 20) === "arrived" ?
    null : "delivery_not_arrived";
}

/**
 * Who collected the package: what staff typed (one line), else the
 * receiver's name, else the line's customer (a line with no receiver name
 * predates required receivers).
 *
 * @param {*} input What staff typed, possibly blank.
 * @param {object} line The stored line.
 * @return {string} The name, possibly "" for a line that names nobody.
 */
function collectedByOf(input, line) {
  const typed = oneLine(input).slice(0, MAX_COLLECTED_BY);
  if (typed) return typed;
  const row = line && typeof line === "object" ? line : {};
  return oneLine(row.receiverName).slice(0, MAX_COLLECTED_BY) ||
    oneLine(lineCustomerName(row)).slice(0, MAX_COLLECTED_BY);
}

/**
 * @param {*} input What staff typed as "collected by".
 * @return {string[]} Error codes.
 */
function collectedByErrors(input) {
  return oneLine(input).length > MAX_COLLECTED_BY ?
    ["collected_by_too_long"] : [];
}

/**
 * The warning step: a package that still owes money is delivered only once
 * the caller has seen the warning and confirmed.
 *
 * @param {number} balanceCents What the package (its whole group) still owes.
 * @param {boolean} acknowledged Whether the caller confirmed.
 * @return {string|null} "delivery_balance_due" until confirmed, else null.
 */
function deliveryBalanceRefusal(balanceCents, acknowledged) {
  const owed = Math.round(Number(balanceCents));
  if (!Number.isFinite(owed) || owed <= 0) return null;
  return acknowledged === true ? null : "delivery_balance_due";
}

/**
 * What a caller is told about the balance: whether there is one, and the
 * amount only when they may see money.
 *
 * @param {number} balanceCents What is still owed.
 * @param {boolean} canSeeMoney Whether the caller holds containers or ledger.
 * @return {{hasBalance: boolean, balanceCents: (number|null)}} The answer.
 */
function deliveryBalanceView(balanceCents, canSeeMoney) {
  const owed = Math.max(0, Math.round(Number(balanceCents)) || 0);
  return {
    hasBalance: owed > 0,
    balanceCents: canSeeMoney ? owed : null,
  };
}

/**
 * @param {object} args {staffId, staffName, collectedBy, balanceCents}.
 * @return {object} The delivery's fields on the line (the caller adds
 *   `deliveredAt`, the server's time).
 */
function deliveryRecord(args) {
  const row = args && typeof args === "object" ? args : {};
  return {
    deliveredByStaffId: text(row.staffId, 128),
    deliveredByName: oneLine(row.staffName).slice(0, 120),
    collectedBy: oneLine(row.collectedBy).slice(0, MAX_COLLECTED_BY),
    deliveredBalanceCents:
      Math.max(0, Math.round(Number(row.balanceCents)) || 0),
  };
}

/**
 * @param {object[]} lines A container's lines.
 * @return {number} How many of them are delivered.
 */
function deliveredLineCount(lines) {
  return (Array.isArray(lines) ? lines : [])
      .filter((line) => lineIsDelivered(line)).length;
}

/**
 * "X of Y delivered", from the container's stored tallies (kept by the
 * delivery transaction and repaired by every recount).
 *
 * @param {object} container The stored container.
 * @return {{delivered: number, total: number}} The progress; `delivered`
 *   never above `total`.
 */
function containerDeliveryProgress(container) {
  const row = container && typeof container === "object" ? container : {};
  const count = (value) => {
    const n = Math.round(Number(value));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const total = count(row.lineCount);
  return {delivered: Math.min(count(row.deliveredCount), total), total};
}

/**
 * The History sentence for a delivery. The amount owed is named (History is
 * read by managers, who see money); a deliveries-only person never opens it.
 *
 * @param {object} args {what (containerLineTitle), collectedBy,
 *   balanceText ("" or a formatted amount)}.
 * @return {string} e.g. "Delivered 3 barrels for Fatou Diallo, collected by
 *   Mamadou Bah, with $40.00 still owed".
 */
function deliveryAuditSummary(args) {
  const row = args && typeof args === "object" ? args : {};
  const who = oneLine(row.collectedBy);
  const owed = oneLine(row.balanceText);
  return `Delivered ${oneLine(row.what) || "a package"}` +
    (who ? `, collected by ${who}` : "") +
    (owed ? `, with ${owed} still owed` : "");
}

/**
 * @param {string} what containerLineTitle of the line.
 * @return {string} The History sentence for an undone delivery.
 */
function deliveryUndoAuditSummary(what) {
  return `Undid the delivery of ${oneLine(what) || "a package"}`;
}

module.exports = {
  DELIVERY_ACTION,
  DELIVERY_ACTIONS,
  DELIVERIES_SECTION,
  DELIVERY_SECTIONS,
  DELIVERY_UNDO_SECTION,
  DELIVERY_MONEY_SECTIONS,
  DELIVERY_FIELDS,
  DELIVERY_MESSAGES,
  MAX_COLLECTED_BY,
  deliveryActionOf,
  lineIsDelivered,
  deliveryRefusal,
  collectedByOf,
  collectedByErrors,
  deliveryBalanceRefusal,
  deliveryBalanceView,
  deliveryRecord,
  deliveredLineCount,
  containerDeliveryProgress,
  deliveryAuditSummary,
  deliveryUndoAuditSummary,
};
