import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
