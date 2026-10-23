import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { containerLineFocus } from "./container-manifest.ts";
import {
  adminTargetForNotification,
  businessTargetForNotification,
  collectionFromNotification,
  customerOrdersInnerTab,
  customerTargetForNotification,
  focusFromNotification,
} from "./notification-routing.ts";

test("a live barrel status payload with only shipmentId opens Barrels", () => {
  const data = {type: "barrel_shipment_status", shipmentId: "ship-1"};
  const target = customerTargetForNotification(data);
  assert.equal(target.tab, "orders");
  assert.deepEqual(target.focus, {collection: "barrelShipments", id: "ship-1"});
  assert.equal(customerOrdersInnerTab(target.focus!.collection), "barrels");
});

test("freight status, balance-due and refund open Freight, not Cars", () => {
  for (const type of [
    "freight_shipment_status",
    "freight_balance_due",
    "freight_refund_issued",
  ]) {
    const target = customerTargetForNotification({type, shipmentId: "fr-9"});
    assert.equal(target.tab, "orders", type);
    assert.deepEqual(target.focus, {
      collection: "freightShipments",
      id: "fr-9",
    });
    assert.equal(customerOrdersInnerTab("freightShipments"), "freight");
  }
});

test("a stamped relatedCollection wins over type inference", () => {
  const focus = focusFromNotification({
    type: "shipment_tracking_update",
    relatedCollection: "transportRequests",
    relatedId: "tr-1",
    shipmentId: "ignored",
  });
  assert.deepEqual(focus, {collection: "transportRequests", id: "tr-1"});
});

test("freight_quote_received opens Orders → Freight for that request", () => {
  const target = customerTargetForNotification({
    type: "freight_quote_received",
    requestId: "req-3",
  });
  assert.equal(target.tab, "orders");
  assert.deepEqual(target.focus, {
    collection: "freightQuoteRequests",
    id: "req-3",
  });
  assert.equal(customerOrdersInnerTab("freightQuoteRequests"), "freight");
});

test("transport_request_status opens Orders → Car transport", () => {
  const target = customerTargetForNotification({
    type: "transport_request_status",
    requestId: "tr-4",
  });
  assert.equal(target.tab, "orders");
  assert.deepEqual(target.focus, {
    collection: "transportRequests",
    id: "tr-4",
  });
  assert.equal(customerOrdersInnerTab("transportRequests"), "transport");
});

test("parking_reservation_status uses reservationId on Cars & parking", () => {
  const target = customerTargetForNotification({
    type: "parking_reservation_status",
    reservationId: "park-2",
  });
  assert.equal(target.tab, "orders");
  assert.deepEqual(target.focus, {collection: "parkedCars", id: "park-2"});
  assert.equal(customerOrdersInnerTab("parkedCars"), "cars");
});

test("car_purchase_status uses purchaseId on that purchase", () => {
  const target = customerTargetForNotification({
    type: "car_purchase_status",
    purchaseId: "buy-8",
  });
  assert.equal(target.tab, "orders");
  assert.deepEqual(target.focus, {collection: "carPurchases", id: "buy-8"});
});

test("car_viewing_status opens Viewings with the appointment id", () => {
  const target = customerTargetForNotification({
    type: "car_viewing_status",
    purchaseId: "view-1",
  });
  assert.equal(target.tab, "viewings");
  assert.deepEqual(target.focus, {collection: "carPurchases", id: "view-1"});
});

test("review_request opens the review composer for that record", () => {
  const target = customerTargetForNotification({
    type: "review_request",
    relatedCollection: "parkedCars",
    relatedId: "park-1",
    businessId: "biz-1",
  });
  assert.equal(target.tab, "orders");
  assert.equal(target.openReview, true);
  assert.deepEqual(target.focus, {collection: "parkedCars", id: "park-1"});
});

test("support_message and support_escalated open the case thread", () => {
  for (const type of ["support_message", "support_escalated"]) {
    const target = customerTargetForNotification({type, caseId: "case-7"});
    assert.equal(target.tab, "support", type);
    assert.equal(target.caseId, "case-7", type);
  }
});

test("support_case_update opens the support thread, not Home", () => {
  const target = customerTargetForNotification({
    type: "support_case_update",
    caseId: "case-9",
  });
  assert.equal(target.tab, "support");
  assert.equal(target.caseId, "case-9");
});

test("payment_hold_capture_notice opens the held order", () => {
  const target = customerTargetForNotification({
    type: "payment_hold_capture_notice",
    recordId: "hold-rec",
    orderType: "transport_job",
  });
  assert.equal(target.tab, "orders");
  assert.deepEqual(target.focus, {
    collection: "transportRequests",
    id: "hold-rec",
  });
});

test("secured_order_cancelled_by_business opens that booking", () => {
  const target = customerTargetForNotification({
    type: "secured_order_cancelled_by_business",
    orderType: "freightShipment",
    recordId: "fr-cancel",
  });
  assert.equal(target.tab, "orders");
  assert.deepEqual(target.focus, {
    collection: "freightShipments",
    id: "fr-cancel",
  });
});

test("an unknown customer type stays on Home", () => {
  assert.equal(customerTargetForNotification({type: "something_new"}).tab, "home");
  assert.equal(customerTargetForNotification({}).tab, "home");
});

test("business freight quote types open Freight price-requests", () => {
  for (const type of [
    "freight_quote_request",
    "freight_quote_won",
    "freight_quote_lost",
  ]) {
    const target = businessTargetForNotification({type, requestId: "fq-1"});
    assert.equal(target.tab, "freight", type);
    assert.equal(target.panelView, "requests", type);
    assert.equal(target.focusId, "fq-1", type);
  }
});

test("transport_job_paid and paid transport open Accepted jobs", () => {
  const paid = businessTargetForNotification({
    type: "transport_job_paid",
    requestId: "tr-paid",
  });
  assert.equal(paid.tab, "transport");
  assert.equal(paid.panelView, "jobs");
  assert.equal(paid.focusId, "tr-paid");

  const order = businessTargetForNotification({
    type: "business_order_paid",
    service: "transport",
    requestId: "tr-paid-2",
  });
  assert.equal(order.tab, "transport");
  assert.equal(order.panelView, "jobs");
  assert.equal(order.focusId, "tr-paid-2");
});

test("transport_quote_won opens jobs and lost opens opportunities", () => {
  const won = businessTargetForNotification({
    type: "transport_quote_won",
    requestId: "tr-w",
  });
  const lost = businessTargetForNotification({
    type: "transport_quote_lost",
    requestId: "tr-l",
  });
  assert.equal(won.panelView, "jobs");
  assert.equal(lost.panelView, "opportunities");
  assert.equal(won.tab, "transport");
  assert.equal(lost.tab, "transport");
});

test("business car_viewing_status opens Viewings, not Purchases", () => {
  const target = businessTargetForNotification({
    type: "car_viewing_status",
    purchaseId: "view-2",
  });
  assert.equal(target.tab, "viewings");
  assert.equal(target.focusId, "view-2");
});

test("business_order_paid focuses the record on the service tab", () => {
  const cases: Array<[string, string, string]> = [
    ["barrels", "shipmentId", "b-1"],
    ["freight", "shipmentId", "f-1"],
    ["parking", "reservationId", "p-1"],
    ["purchases", "purchaseId", "c-1"],
  ];
  for (const [service, field, id] of cases) {
    const target = businessTargetForNotification({
      type: "business_order_paid",
      service,
      [field]: id,
    });
    assert.equal(target.tab, service, service);
    assert.equal(target.focusId, id, service);
  }
});

test("business support types open the case thread", () => {
  for (const type of [
    "support_message",
    "support_escalated",
    "support_case_update",
  ]) {
    const target = businessTargetForNotification({type, caseId: "case-b"});
    assert.equal(target.tab, "cases", type);
    assert.equal(target.caseId, "case-b", type);
  }
});

test("admin support types open the Support thread", () => {
  for (const type of [
    "support_message",
    "support_escalated",
    "support_case_update",
  ]) {
    const target = adminTargetForNotification({type, caseId: "case-a"});
    assert.equal(target.tab, "support", type);
    assert.equal(target.caseId, "case-a", type);
  }
});

test("admin support_case_update is not Today", () => {
  assert.notEqual(
    adminTargetForNotification({type: "support_case_update", caseId: "x"}).tab,
    "today",
  );
});

test("collection inference covers live payloads without relatedCollection", () => {
  assert.equal(
    collectionFromNotification({type: "barrel_shipment_status", shipmentId: "1"}),
    "barrelShipments",
  );
  assert.equal(
    collectionFromNotification({
      type: "parking_reservation_status",
      reservationId: "2",
    }),
    "parkedCars",
  );
  assert.equal(
    collectionFromNotification({
      type: "payment_hold_capture_notice",
      orderType: "parking_deposit",
      recordId: "3",
    }),
    "parkedCars",
  );
});

test("an inventory sale alert opens the business Inventory sales tab on that sale", () => {
  const data = {
    type: "inventory_sale",
    businessId: "biz-1",
    saleId: "sale-9",
    storeId: "s-down",
    relatedCollection: "inventorySales",
    relatedId: "sale-9",
  };
  assert.deepEqual(businessTargetForNotification(data), {
    tab: "inventory",
    focusId: "sale-9",
    panelView: "sales",
    storeId: "s-down",
  });
  // A single-store business sends no store; an older payload with only saleId still opens the sale.
  const single = businessTargetForNotification({type: "inventory_sale", saleId: "sale-2", storeId: ""});
  assert.equal(single.tab, "inventory");
  assert.equal(single.focusId, "sale-2");
  assert.equal(single.storeId, "");
  assert.deepEqual(focusFromNotification(data), {collection: "inventorySales", id: "sale-9"});
  assert.equal(collectionFromNotification({type: "inventory_sale", saleId: "x"}), "inventorySales");
  // No sale id: the Sales tab still opens, with nothing to focus.
  assert.equal(businessTargetForNotification({type: "inventory_sale"}).focusId, "");
  // The customer and admin consoles ignore it.
  assert.deepEqual(customerTargetForNotification(data), {tab: "home"});
  assert.deepEqual(adminTargetForNotification(data), {tab: "today"});
});

test("the business console hands an inventory sale alert to the Inventory panel", () => {
  const business = readFileSync("src/components/business-console.tsx", "utf8");
  const panel = readFileSync("src/components/business/inventory-panel.tsx", "utf8");
  const list = readFileSync("src/components/business/inventory-sales-list.tsx", "utf8");
  assert.match(business, /saleFocusFrom\(target\.focusId, target\.storeId/);
  assert.match(business, /focusSale=\{notificationSale\}/);
  assert.match(panel, /setView\("sales"\)/);
  assert.match(panel, /saleFocusStoreFilter\(saleFocus, access\)/);
  assert.match(panel, /focus=\{saleFocus\}/);
  assert.match(list, /useLiveDocRead\("inventorySales"/);
  assert.match(list, /That sale is not available\./);
});

test("a store transfer alert opens Inventory on Transfers with that transfer", () => {
  const data = {
    type: "inventory_transfer",
    kind: "sent",
    businessId: "biz-1",
    transferId: "tr-7",
    code: "TR-4K8Q2A",
    fromStoreId: "s-bronx",
    toStoreId: "s-harlem",
    relatedCollection: "inventoryTransfers",
    relatedId: "tr-7",
  };
  assert.deepEqual(businessTargetForNotification(data), {
    tab: "inventory",
    panelView: "transfers",
    focusId: "tr-7",
  });
  // Every kind routes the same way; a payload with only transferId still opens it.
  for (const kind of ["cancelled", "differences", "transit_reminder", "dispute_reminder"]) {
    assert.equal(businessTargetForNotification({...data, kind}).panelView, "transfers", kind);
  }
  assert.equal(businessTargetForNotification({type: "inventory_transfer", transferId: "tr-2"}).focusId, "tr-2");
  assert.deepEqual(focusFromNotification(data), {collection: "inventoryTransfers", id: "tr-7"});
  assert.equal(collectionFromNotification({type: "inventory_transfer", transferId: "x"}), "inventoryTransfers");
  // No id: Transfers still opens, with nothing to focus.
  assert.equal(businessTargetForNotification({type: "inventory_transfer"}).focusId, "");
  // The customer and admin consoles ignore it.
  assert.deepEqual(customerTargetForNotification(data), {tab: "home"});
  assert.deepEqual(adminTargetForNotification(data), {tab: "today"});
});

test("the business console hands a transfer alert to the Inventory panel", () => {
  const business = readFileSync("src/components/business-console.tsx", "utf8");
  const panel = readFileSync("src/components/business/inventory-panel.tsx", "utf8");
  const view = readFileSync("src/components/business/inventory-transfers-view.tsx", "utf8");
  assert.match(business, /transferFocusFrom\(target\.focusId, Date\.now\(\)\)/);
  assert.match(business, /focusTransfer=\{notificationTransfer\}/);
  assert.match(panel, /setView\("transfers"\)/);
  assert.match(panel, /focus=\{transferFocus\}/);
  assert.match(view, /useLiveDocRead\("inventoryTransfers"/);
  assert.match(view, /That transfer is not available\./);
  assert.match(view, /FOCUS_READ_TIMEOUT_MS = 15_000/);
});

test("the consoles call the shared router instead of a local switch", () => {
  const customer = readFileSync("src/components/customer-console.tsx", "utf8");
  const business = readFileSync("src/components/business-console.tsx", "utf8");
  const admin = readFileSync("src/components/admin-console.tsx", "utf8");
  const panels = readFileSync(
    "src/components/business/operations-panels.tsx",
    "utf8",
  );
  const support = readFileSync("src/components/customer-support.tsx", "utf8");
  const cases = readFileSync(
    "src/components/support/support-cases-panel.tsx",
    "utf8",
  );
  assert.match(customer, /customerTargetForNotification/);
  assert.match(customer, /caseId=\{focusCaseId\}/);
  assert.match(customer, /customerOrdersInnerTab\(focusedRecord\.collection\)/);
  assert.match(support, /caseId = ""/);
  assert.match(business, /businessTargetForNotification/);
  assert.match(business, /focusView=\{notificationFocusView\}/);
  assert.match(
    panels,
    /setView\(focusView === "requests" \? "requests" : "shipments"\)/,
  );
  assert.match(
    panels,
    /setView\(focusView === "jobs" \? "jobs" : "opportunities"\)/,
  );
  assert.match(admin, /adminTargetForNotification/);
  assert.match(admin, /caseId=\{notificationCaseId\}/);
  assert.match(cases, /caseId = ""/);
});

test("a reported phone number opens its record, wherever the business works on it", () => {
  // The payload reportShipmentNotMine sends (docs/PHONE_ACCOUNTS.md §6.1).
  const base = {type: "phone_number_reported", field: "customerPhone", trackingCode: "CL-K7M4P2"};
  const cases: Array<[string, Record<string, unknown>]> = [
    ["containerLines", {tab: "containers", focusId: "rec-1", panelView: "line"}],
    ["packageRequests", {tab: "containers", focusId: "rec-1", panelView: "requests"}],
    ["barrelShipments", {tab: "barrels", focusId: "rec-1"}],
    ["freightShipments", {tab: "freight", focusId: "rec-1", panelView: "shipments"}],
    ["freightQuoteRequests", {tab: "freight", focusId: "rec-1", panelView: "requests"}],
    ["transportRequests", {tab: "transport", focusId: "rec-1", panelView: "jobs"}],
    ["parkedCars", {tab: "parking", focusId: "rec-1"}],
  ];
  for (const [relatedCollection, expected] of cases) {
    assert.deepEqual(
      businessTargetForNotification({...base, relatedCollection, relatedId: "rec-1"}),
      expected,
      relatedCollection,
    );
  }
  // An unknown collection is not a crash: it lands on Today.
  assert.deepEqual(
    businessTargetForNotification({...base, relatedCollection: "somethingNew", relatedId: "x"}),
    {tab: "today"},
  );
});

test("a line opened by id alone lands on its container or the waiting list, this business's only", () => {
  assert.deepEqual(
    containerLineFocus({businessId: "biz", containerId: "box-1", containerStatus: "loading"}, "biz"),
    {view: "container", containerId: "box-1"},
  );
  assert.deepEqual(containerLineFocus({businessId: "biz", containerId: "", containerStatus: "waiting"}, "biz"), {view: "waiting"});
  assert.deepEqual(containerLineFocus({businessId: "biz", containerStatus: "waiting"}, "biz"), {view: "waiting"});
  assert.equal(containerLineFocus({businessId: "other", containerId: "box-1"}, "biz"), null);
  assert.equal(containerLineFocus(null, "biz"), null);
  assert.equal(containerLineFocus({businessId: "biz", containerId: "box-1"}, ""), null);
});

test("the business console hands a reported line to the Containers panel, which finds it", () => {
  const consoleSource = readFileSync("src/components/business-console.tsx", "utf8");
  assert.match(consoleSource, /notificationFocusView === "line"\s*\? notificationFocusId/);
  const panel = readFileSync("src/components/business/containers-panel.tsx", "utf8");
  assert.match(panel, /containerLineFocus\(focusedLineRow, businessId\)/);
  const waiting = readFileSync("src/components/business/waiting-packages-panel.tsx", "utf8");
  assert.match(waiting, /document\.getElementById\(`wpk-line-\$\{focusLineId\}`\)/);
});

test("the owner's Check bank limit notice opens Settings on the bank card", () => {
  const data = {type: "bank_check_limit", businessId: "biz-1"};
  assert.deepEqual(businessTargetForNotification(data), {tab: "profile", panelView: "bank"});
  // Only the business console acts on it.
  assert.deepEqual(customerTargetForNotification(data), {tab: "home"});
  assert.deepEqual(adminTargetForNotification(data), {tab: "today"});
  const consoleSource = readFileSync(new URL("../components/business-console.tsx", import.meta.url), "utf8");
  assert.match(consoleSource, /target\.panelView === "bank"/);
});

test("a lot ledger repeat alert opens the ledger on that activity", () => {
  const data = {
    type: "lot_activity_repeat",
    businessId: "biz-1",
    activityId: "act-9",
    relatedId: "act-9",
    relatedCollection: "lotActivities",
    trackingCode: "LA-K7M4P2",
  };
  assert.deepEqual(businessTargetForNotification(data), {tab: "ledger", focusId: "act-9"});
  assert.deepEqual(focusFromNotification(data), {collection: "lotActivities", id: "act-9"});
  // An older payload with only the activity id still lands on it.
  assert.deepEqual(
    businessTargetForNotification({type: "lot_activity_repeat", activityId: "act-3"}),
    {tab: "ledger", focusId: "act-3"},
  );
  const business = readFileSync("src/components/business-console.tsx", "utf8");
  assert.match(business, /<LotLedgerPanel[\s\S]{0,200}focusRecordId=\{notificationFocusId\}/);
  const panels = readFileSync("src/components/business/operations-panels.tsx", "utf8");
  assert.match(panels, /void openExistingActivity\(focusRecordId\)/);
});
