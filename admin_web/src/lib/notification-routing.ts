/**
 * Website notification click routing.
 *
 * Mirrors the mobile contract in
 * `my_flutter_app/lib/services/notification_routing.dart`, then lands on the
 * matching console tab and record. Live payloads often carry only a typed id
 * (`shipmentId`, `requestId`, …) and no `relatedCollection`; this module
 * infers the collection from `type` so an already-sent notification still
 * opens the right inner tab.
 */

import type { BusinessTab } from "@/lib/business-sidebar";

export type NotificationData = Record<string, string>;

export type NotificationFocus = {
  collection: string;
  id: string;
};

export type CustomerNotificationTab =
  | "home"
  | "services"
  | "parkingPools"
  | "cars"
  | "viewings"
  | "orders"
  | "support"
  | "profile";

export type CustomerNotificationTarget = {
  tab: CustomerNotificationTab;
  focus?: NotificationFocus;
  caseId?: string;
  openReview?: boolean;
};

export type BusinessPanelView =
  | "opportunities"
  | "jobs"
  | "requests"
  | "shipments";

export type BusinessNotificationTarget = {
  tab: BusinessTab;
  focusId?: string;
  panelView?: BusinessPanelView;
  caseId?: string;
};

export type AdminNotificationTarget = {
  tab: string;
  caseId?: string;
};

const ORDER_TYPE_COLLECTIONS: Record<string, string> = {
  barrelShipment: "barrelShipments",
  barrelOrder: "barrelOrders",
  barrelDestinationChange: "barrelShipments",
  freightShipment: "freightShipments",
  freightSettlement: "freightShipments",
  transportJob: "transportRequests",
  transport_job: "transportRequests",
  parking: "parkedCars",
  parking_deposit: "parkedCars",
  carDeposit: "carPurchases",
  carPurchase: "carPurchases",
  holdExtension: "carPurchases",
  reservation_deposit: "carPurchases",
  full_purchase: "carPurchases",
};

const TYPE_COLLECTIONS: Record<string, string> = {
  barrel_shipment_status: "barrelShipments",
  freight_shipment_status: "freightShipments",
  freight_balance_due: "freightShipments",
  freight_refund_issued: "freightShipments",
  freight_quote_received: "freightQuoteRequests",
  freight_quote_request: "freightQuoteRequests",
  freight_quote_won: "freightQuoteRequests",
  freight_quote_lost: "freightQuoteRequests",
  transport_request_status: "transportRequests",
  transport_opportunity: "transportRequests",
  transport_quote_won: "transportRequests",
  transport_quote_lost: "transportRequests",
  transport_job_paid: "transportRequests",
  parking_reservation_status: "parkedCars",
  car_purchase_status: "carPurchases",
  car_viewing_status: "carPurchases",
  review_request: "",
  shipment_tracking_update: "",
  payment_hold_capture_notice: "",
  secured_order_cancelled_by_business: "",
  barrel_pool_deposit: "barrelPools",
  barrel_pool_join: "barrelPools",
  barrel_pool_balance_due: "barrelPools",
  deposit_refund_due: "barrelPools",
};

function firstText(...values: Array<string | undefined>): string {
  for (const value of values) {
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

export function collectionForOrderType(orderType: string): string {
  return ORDER_TYPE_COLLECTIONS[orderType] ?? "";
}

export function collectionForNotificationType(type: string): string {
  return TYPE_COLLECTIONS[type] ?? "";
}

export function recordIdFromNotification(data: NotificationData): string {
  return firstText(
    data.relatedId,
    data.shipmentId,
    data.requestId,
    data.reservationId,
    data.purchaseId,
    data.recordId,
  );
}

export function collectionFromNotification(data: NotificationData): string {
  const stamped = firstText(data.relatedCollection);
  if (stamped) return stamped;
  const fromType = collectionForNotificationType(data.type ?? "");
  if (fromType) return fromType;
  return collectionForOrderType(firstText(data.orderType, data.service));
}

export function focusFromNotification(
  data: NotificationData,
): NotificationFocus | undefined {
  const id = recordIdFromNotification(data);
  if (!id) return undefined;
  return {collection: collectionFromNotification(data), id};
}

export function caseIdFromNotification(data: NotificationData): string {
  return firstText(data.caseId);
}

/**
 * Where a customer notification click should land.
 *
 * Live shipment/status payloads often have `shipmentId` and no
 * `relatedCollection`. Collection is inferred from `type` so Orders opens
 * Barrels/Freight instead of the leftover Cars tab.
 */
export function customerTargetForNotification(
  data: NotificationData,
): CustomerNotificationTarget {
  const type = data.type ?? "";
  const focus = focusFromNotification(data);
  const caseId = caseIdFromNotification(data);

  switch (type) {
    case "support_message":
    case "support_escalated":
    case "support_case_update":
      return caseId ? {tab: "support", caseId} : {tab: "support"};
    case "car_viewing_status":
      return {tab: "viewings", focus};
    case "car_purchase_status":
    case "barrel_shipment_status":
    case "freight_shipment_status":
    case "freight_balance_due":
    case "freight_refund_issued":
    case "freight_quote_received":
    case "parking_reservation_status":
    case "transport_request_status":
    case "shipment_tracking_update":
    case "deposit_refund_due":
    case "payment_hold_capture_notice":
    case "secured_order_cancelled_by_business":
      return {tab: "orders", focus};
    case "review_request":
      return {tab: "orders", focus, openReview: true};
    case "barrel_pool_deposit":
    case "barrel_pool_join":
    case "barrel_pool_balance_due":
      return {tab: "parkingPools", focus};
    case "business_application_status":
      return {tab: "profile"};
    default:
      return {tab: "home"};
  }
}

function businessPaidTab(service: string): BusinessTab {
  switch (service) {
    case "barrels":
      return "barrels";
    case "freight":
      return "freight";
    case "transport":
      return "transport";
    case "parking":
      return "parking";
    case "purchases":
      return "purchases";
    default:
      return "today";
  }
}

/**
 * Where a business notification click should land, including the inner
 * panel view (Accepted jobs vs Opportunities, price-requests vs shipments).
 */
export function businessTargetForNotification(
  data: NotificationData,
): BusinessNotificationTarget {
  const type = data.type ?? "";
  const service = data.service ?? "";
  const focusId = recordIdFromNotification(data);
  const caseId = caseIdFromNotification(data);

  if (type === "business_order_paid") {
    const tab = businessPaidTab(service);
    return {
      tab,
      focusId,
      panelView:
        service === "transport"
          ? "jobs"
          : service === "freight"
            ? "shipments"
            : undefined,
    };
  }

  switch (type) {
    case "support_message":
    case "support_escalated":
    case "support_case_update":
      return {tab: "cases", caseId, focusId: caseId};
    case "business_verification_review":
    case "business_verification_document":
    case "business_application_status":
      return {tab: "profile"};
    case "barrel_shipment_status":
      return {tab: "barrels", focusId};
    case "freight_shipment_status":
    case "freight_balance_due":
    case "freight_refund_issued":
      return {tab: "freight", focusId, panelView: "shipments"};
    case "freight_quote_request":
    case "freight_quote_won":
    case "freight_quote_lost":
      return {tab: "freight", focusId, panelView: "requests"};
    case "parking_reservation_status":
      return {tab: "parking", focusId};
    case "car_viewing_status":
      return {tab: "viewings", focusId};
    case "car_purchase_status":
      return {tab: "purchases", focusId};
    case "transport_opportunity":
    case "transport_quote_lost":
      return {tab: "transport", focusId, panelView: "opportunities"};
    case "transport_request_status":
    case "transport_quote_won":
    case "transport_job_paid":
      return {tab: "transport", focusId, panelView: "jobs"};
    default:
      return {tab: "today"};
  }
}

export function adminTargetForNotification(
  data: NotificationData,
): AdminNotificationTarget {
  const type = data.type ?? "";
  const caseId = caseIdFromNotification(data);
  switch (type) {
    case "support_message":
    case "support_escalated":
    case "support_case_update":
      return {tab: "support", caseId};
    case "business_application":
    case "business_application_status":
    case "business_verification_document":
    case "business_verification_review":
      return {tab: "businesses"};
    default:
      return {tab: "today"};
  }
}

/** Orders inner-tab for a focused customer record. */
export function customerOrdersInnerTab(
  collection: string,
): "barrels" | "freight" | "transport" | "cars" {
  switch (collection) {
    case "barrelShipments":
      return "barrels";
    case "freightShipments":
    case "freightQuoteRequests":
      return "freight";
    case "transportRequests":
      return "transport";
    default:
      return "cars";
  }
}
