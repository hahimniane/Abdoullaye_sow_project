"use client";

import { useConsoleDocumentTitle } from "@/lib/document-title";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EmailAuthProvider,
  PhoneAuthProvider,
  RecaptchaVerifier,
  linkWithCredential,
  reauthenticateWithCredential,
  sendEmailVerification,
  updatePhoneNumber,
  type User,
} from "firebase/auth";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  canonicalMake,
  canonicalModel,
  getMakes,
  getModels,
  getYears,
} from "@/lib/car-catalog";
import { DESTINATION_COUNTRIES } from "@/lib/destination-countries";
import { CalendarClock, Car, CircleAlert, CircleDollarSign, ClipboardList, Headphones, Home, LogOut, Menu, PackageSearch, Pencil, Settings, ShieldCheck, Ship, Star, Truck, UserRound } from "lucide-react";

import { auth, db, functions } from "@/lib/firebase";
import { formatDate, formatMoney, text } from "@/lib/format";
import { statusLabel } from "@/lib/tracking-journey";
import {
  carPurchaseIsViewing,
  viewingStatusLabel,
} from "@/lib/car-viewing";
import { customerCarListingIsEligible } from "@/lib/customer-service-eligibility";
import { useSharedBarrelsEnabled } from "@/lib/feature-flags";
import type { FirestoreRow, UserProfile } from "@/types/admin";
import { CustomerCarViewing } from "@/components/customer-car-viewing";
import { CustomerCars } from "@/components/customer-cars";
import { NotificationBell } from "@/components/notification-bell";
import { ToggleRow } from "@/components/toggle-row";
import {
  mergeNotificationPreferences,
  notificationPreferenceFields,
} from "@/lib/notification-preferences";
import { CustomerPhoneField } from "@/components/customer-phone-field";
import { CustomerParkingPools } from "@/components/customer-parking-pools";
import { CustomerShippingServices } from "@/components/customer-shipping-services";
import { CustomerSupport } from "@/components/customer-support";
import { CustomerTracking } from "@/components/customer-tracking";
import {
  ReviewComposerDrawer,
  useReviewedOrderKeys,
} from "@/components/customer-review-composer";
import { OrderDetailDrawer } from "@/components/order-detail-drawer";
import { isValidE164, isValidPhone, normalizePhone } from "@/lib/phone";
import { phoneVerificationErrorMessage } from "@/lib/phone-verification";
import { currentWebLanguage } from "@/lib/language";

type CustomerTab =
  | "home"
  | "services"
  | "parkingPools"
  | "cars"
  | "viewings"
  | "orders"
  | "support"
  | "profile";

type CustomerConsoleProps = {
  firebaseUser: User;
  profile: UserProfile;
  onSignOut: () => Promise<void> | void;
};

const PHONE_VERIFICATION_TIMEOUT_MS = 60_000;

async function withPhoneVerificationTimeout<T>(request: Promise<T>) {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      request,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject({ code: "auth/verification-timeout" }),
          PHONE_VERIFICATION_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export type CustomerCollection = {
  rows: FirestoreRow[];
  loading: boolean;
  error: string;
};

const tabs: Array<{
  id: CustomerTab;
  label: string;
  description: string;
  icon: typeof Home;
}> = [
  { id: "home", label: "Home", description: "Your activity at a glance", icon: Home },
  { id: "services", label: "Shipping services", description: "Barrels, freight, and car transport", icon: Ship },
  { id: "parkingPools", label: "Parking & shared barrels", description: "Reserve space or join a pool", icon: PackageSearch },
  { id: "cars", label: "Browse cars", description: "Listings from approved businesses", icon: Car },
  { id: "viewings", label: "Car viewings", description: "Appointments to see a car", icon: CalendarClock },
  { id: "orders", label: "Orders & tracking", description: "Shipping and vehicle services", icon: ClipboardList },
  { id: "support", label: "Support", description: "Messages about your orders", icon: Headphones },
  { id: "profile", label: "Profile", description: "Account and security", icon: UserRound },
];

type NotificationTarget = {
  tab: CustomerTab;
  focus?: {collection: string; id: string};
};

/**
 * Where a clicked notification should LAND - the tab plus, when the payload
 * names a record, that exact record. "It just takes me to Home" was mostly
 * unmapped types (shipment_tracking_update above all) falling through.
 */
function targetForNotification(
  data: Record<string, string>,
): NotificationTarget {
  const type = data.type ?? "";
  const relatedId = data.relatedId ?? data.shipmentId ?? "";
  const focus = relatedId
    ? {collection: data.relatedCollection ?? "", id: relatedId}
    : undefined;
  switch (type) {
    case "support_message":
    case "support_escalated":
      return {tab: "support"};
    case "car_viewing_status":
      // Viewings are not purchases and no longer live under Orders. Without
      // this case the type fell through to the default and landed on Home.
      return {tab: "viewings", focus};
    case "car_purchase_status":
    case "barrel_shipment_status":
    case "freight_shipment_status":
    case "freight_balance_due":
    case "freight_refund_issued":
    case "parking_reservation_status":
    case "shipment_tracking_update":
    case "review_request":
    case "deposit_refund_due":
      return {tab: "orders", focus};
    case "barrel_pool_deposit":
    case "barrel_pool_join":
    case "barrel_pool_balance_due":
      return {tab: "parkingPools", focus};
    default:
      return {tab: "home"};
  }
}

export function CustomerConsole({
  firebaseUser,
  profile,
  onSignOut,
}: CustomerConsoleProps) {
  const [activeTab, setActiveTab] = useState<CustomerTab>(() =>
    firebaseUser.phoneNumber ? "home" : "profile",
  );
  useConsoleDocumentTitle(
    "customer",
    tabs.find((item) => item.id === activeTab)?.label,
  );
  // The record a clicked notification points at; cleared once shown so a
  // later manual visit to Orders does not re-scroll.
  const [focusedRecord, setFocusedRecord] = useState<{
    collection: string;
    id: string;
  } | null>(null);
  const sharedBarrelsEnabled = useSharedBarrelsEnabled();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [emailNotice, setEmailNotice] = useState("");
  const shipments = useCustomerBarrelShipments(firebaseUser.uid);
  const freight = useCustomerFreightShipments(firebaseUser.uid);
  const transports = useCustomerTransportRequests(firebaseUser.uid);
  const parking = useCustomerParkingRecords(firebaseUser.uid);
  const purchases = useCustomerCarPurchases(firebaseUser.uid);
  const cars = usePublicCars(activeTab === "cars");


  const allOrders = useMemo(
    () => [
      ...tagRows(shipments.rows, "Barrel shipment", "barrelShipments", Ship),
      ...tagRows(freight.rows, "Freight shipment", "freightShipments", PackageSearch),
      ...tagRows(transports.rows, "Car transport", "transportRequests", Truck),
      ...tagRows(parking.rows, "Car parking", "parkedCars", Car),
      ...tagRows(purchases.rows, "Car purchase", "carPurchases", CircleDollarSign),
    ].sort((a, b) => rowTime(b.row) - rowTime(a.row)),
    [freight.rows, parking.rows, purchases.rows, shipments.rows, transports.rows],
  );

  // A viewing is an appointment, not a purchase: nothing is bought and no
  // money moves. Mixing the two put "arrange to see a car" in the same list as
  // "money you have paid", which read as though a viewing were an order.
  const viewingOrders = useMemo(
    () => allOrders.filter((order) => carPurchaseIsViewing(order.row)),
    [allOrders],
  );
  const nonViewingOrders = useMemo(
    () => allOrders.filter((order) => !carPurchaseIsViewing(order.row)),
    [allOrders],
  );

  const dataLoading = [shipments, freight, transports, parking, purchases].some(
    (state) => state.loading,
  );
  const dataError = [shipments, freight, transports, parking, purchases]
    .map((state) => state.error)
    .find(Boolean) ?? "";

  const handleSignOut = useCallback(async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await onSignOut();
    } finally {
      setSigningOut(false);
    }
  }, [onSignOut, signingOut]);

  const handleEmailVerification = useCallback(async () => {
    if (sendingEmail) return;
    setSendingEmail(true);
    setEmailNotice("");
    try {
      await sendEmailVerification(firebaseUser);
      setEmailNotice("Verification email sent. Check your inbox.");
    } catch {
      setEmailNotice("The verification email could not be sent. Try again.");
    } finally {
      setSendingEmail(false);
    }
  }, [firebaseUser, sendingEmail]);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <button
            aria-label={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            className="sidebar-toggle topbar-menu"
            onClick={() => setSidebarCollapsed((value) => !value)}
            type="button"
          >
            <Menu size={18} />
          </button>
          <div className="brand-badge">Laawol Digital</div>
          <div className="topbar-heading">
            <h1>Customer workspace</h1>
            <p>Shop, track, and manage your Laawol services from any device.</p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="admin-chip" title="Signed-in account">
            <UserRound size={18} />
            <span className="admin-chip-name">
              {text(profile.fullName ?? firebaseUser.email, "Customer")}
            </span>
            <span className="admin-role-tag">Customer</span>
          </div>
          <NotificationBell
            enabled={Boolean(firebaseUser.uid)}
            onSelect={(data) => {
              const target = targetForNotification(data);
              setActiveTab(target.tab);
              setFocusedRecord(target.focus ?? null);
            }}
            uid={firebaseUser.uid}
          />
          <button
            aria-label="Sign out"
            className="icon-button"
            data-loading={signingOut}
            disabled={signingOut}
            onClick={handleSignOut}
            title="Sign out"
            type="button"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className={`workspace customer-workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <nav className="sidebar customer-sidebar" aria-label="Customer sections">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const label =
              tab.id === "parkingPools" && !sharedBarrelsEnabled
                ? "Parking"
                : tab.label;
            const description =
              tab.id === "parkingPools" && !sharedBarrelsEnabled
                ? "Reserve a parking space"
                : tab.description;
            return (
              <button
                className={activeTab === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={label}
                type="button"
              >
                <Icon size={18} />
                <span className="nav-text">
                  <b>{label}</b>
                  <small>{description}</small>
                </span>
              </button>
            );
          })}
        </nav>

        <section className="content">
          {!firebaseUser.emailVerified && (
            <div className="info-band customer-verification-banner">
              <span>Verify your email to keep your account secure.</span>
              <button
                className="secondary-button"
                data-loading={sendingEmail}
                disabled={sendingEmail}
                onClick={() => void handleEmailVerification()}
                type="button"
              >
                {sendingEmail ? "Sending..." : "Send verification email"}
              </button>
              {emailNotice && <small>{emailNotice}</small>}
            </div>
          )}
          {dataError && <div className="error-box">We could not load all of your activity. {dataError}</div>}
          {activeTab === "home" && (
            <CustomerHome
              customerName={text(profile.fullName, "there")}
              loading={dataLoading}
              orders={allOrders}
              onOpenCars={() => setActiveTab("cars")}
              onOpenOrders={() => setActiveTab("orders")}
              uid={firebaseUser.uid}
            />
          )}
          {activeTab === "cars" && (
            <CustomerCars
              firebaseUser={firebaseUser}
              profile={profile}
              state={cars}
            />
          )}
          {activeTab === "services" && (
            <CustomerShippingServices
              freightShipments={freight.rows}
              profile={profile}
            />
          )}
          {activeTab === "parkingPools" && (
            <CustomerParkingPools
              firebaseUser={firebaseUser}
              profile={profile}
            />
          )}
          {activeTab === "viewings" && (
            <OrderPanel
              loading={dataLoading}
              orders={viewingOrders}
              title="Car viewings"
              uid={firebaseUser.uid}
            />
          )}
          {activeTab === "orders" && (
            <OrdersView
              focusedRecord={focusedRecord}
              onFocusConsumed={() => setFocusedRecord(null)}
              loading={dataLoading}
              orders={nonViewingOrders}
              trackedShipments={[
                ...shipments.rows.map((row) => ({
                  ...row,
                  relatedCollection: "barrelShipments",
                })),
                ...freight.rows.map((row) => ({
                  ...row,
                  relatedCollection: "freightShipments",
                })),
              ]}
              uid={firebaseUser.uid}
            />
          )}
          {activeTab === "support" && (
            <CustomerSupport
              references={allOrders.map(({ collectionName, label, row }) => ({
                collection: collectionName,
                id: row.id,
                label: `${label} · ${text(row.trackingCode ?? row.id)}`,
              }))}
              uid={firebaseUser.uid}
            />
          )}
          {activeTab === "profile" && (
            <ProfileView firebaseUser={firebaseUser} profile={profile} />
          )}
        </section>
      </main>
    </div>
  );
}

function CustomerHome({
  customerName,
  loading,
  orders,
  onOpenCars,
  onOpenOrders,
  uid,
}: {
  customerName: string;
  loading: boolean;
  orders: TaggedRow[];
  onOpenCars: () => void;
  onOpenOrders: () => void;
  uid: string;
}) {
  const openOrders = orders.filter(({ row }) => !isFinalStatus(text(row.status, ""))).length;
  return (
    <div className="stack">
      <section className="section-intro customer-welcome">
        <div>
          <span className="section-kicker">Customer account</span>
          <h2><span>Welcome, </span>{customerName}</h2>
          <p>Your mobile and web activity stays together in the same Laawol account.</p>
        </div>
        <div className="button-row">
          <button className="primary-button" onClick={onOpenCars} type="button">
            <Car size={16} /> Browse cars
          </button>
          <button className="secondary-button" onClick={onOpenOrders} type="button">
            <ClipboardList size={16} /> View orders
          </button>
        </div>
      </section>
      <div className="metric-grid">
        <Metric label="Open orders" value={loading ? "…" : String(openOrders)} />
        <Metric label="All activity" value={loading ? "…" : String(orders.length)} />
        <Metric label="Account access" value="Web + mobile" />
      </div>
      <OrderPanel loading={loading} orders={orders.slice(0, 5)} title="Recent activity" uid={uid} />
      <section className="info-band customer-parity-note">
        New service requests and web payments are being added service by service. Your existing orders,
        purchases, tracking, and account remain shared with the mobile app.
      </section>
    </div>
  );
}

function OrdersView({
  focusedRecord,
  onFocusConsumed,
  loading,
  orders,
  trackedShipments,
  uid,
}: {
  focusedRecord: {collection: string; id: string} | null;
  onFocusConsumed: () => void;
  loading: boolean;
  orders: TaggedRow[];
  trackedShipments: FirestoreRow[];
  uid: string;
}) {
  return (
    <div className="stack">
      <OrderPanel loading={loading} orders={orders} title="Orders & tracking" uid={uid} />
      {!loading && (
        <CustomerTracking
          focusedRecordId={focusedRecord?.id ?? ""}
          onFocusConsumed={onFocusConsumed}
          records={trackedShipments}
          uid={uid}
        />
      )}
    </div>
  );
}

function OrderPanel({
  loading,
  orders,
  title,
  uid,
}: {
  loading: boolean;
  orders: TaggedRow[];
  title: string;
  uid: string;
}) {
  // The open record is held by key and looked up from the live rows, never
  // kept as a snapshot: a car viewing changes status while its drawer is open
  // - the seller counters, the customer accepts - and a copy frozen at open
  // time would keep offering the action that was just taken.
  const [selectedKey, setSelectedKey] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [editing, setEditing] = useState(false);
  const selected = useMemo(
    () => orders.find((order) => orderKey(order) === selectedKey) ?? null,
    [orders, selectedKey],
  );
  const cancelAction = selected
    ? (pendingOrderCancellation(selected) ?? securedOrderCancellation(selected))
    : null;
  const reviewedKeys = useReviewedOrderKeys(uid);

  async function cancelSelectedOrder() {
    if (!selected || !cancelAction) return;
    // Secured cancellations move money, so they say what will happen and ask
    // first; pending ones never charged anything and keep the old one-click.
    if ("confirm" in cancelAction && cancelAction.confirm &&
        !window.confirm(cancelAction.confirm)) {
      return;
    }
    await httpsCallable(functions, cancelAction.callable)(cancelAction.payload);
  }

  return (
    <>
      <section className="panel">
        <div className="panel-header"><div><ClipboardList size={18} /><h2>{title}</h2></div></div>
        {loading && <div className="empty-state">Loading your activity...</div>}
        {!loading && orders.length === 0 && (
          <div className="empty-state">You do not have any activity here yet.</div>
        )}
        <div className="row-list">
          {orders.map((order) => {
            const { row, label, icon: Icon } = order;
            return (
              <button
                aria-label="Open order details"
                className="data-row customer-order-row customer-order-button"
                key={orderKey(order)}
                onClick={() => {
                  setSelectedKey(orderKey(order));
                  setReviewing(false);
                }}
                type="button"
              >
                <Icon size={20} />
                <div>
                  <strong>{label}</strong>
                  <small>{text(row.trackingCode ?? row.trackingNumber ?? row.id)}</small>
                </div>
                <div>
                  <span className="status-pill compact">{orderStatusLabel(order)}</span>
                  <small>{formatDate(row.updatedAt ?? row.createdAt)}</small>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      <OrderDetailDrawer
        cancelLabel={
          (cancelAction && "label" in cancelAction && cancelAction.label) ||
          "Cancel request"
        }
        onCancelOrder={cancelAction ? cancelSelectedOrder : undefined}
        onClose={() => {
          setSelectedKey("");
          setReviewing(false);
        }}
        open={Boolean(selected)}
        title={selected?.label ?? "Order details"}
      >
        {selected && (
          <>
            <div className="customer-order-facts">
              <OrderFact
                label="Reference"
                value={text(
                  selected.row.trackingCode ??
                    selected.row.trackingNumber ??
                    selected.row.id,
                )}
              />
              <OrderFact label="Status" value={orderStatusLabel(selected)} />
              <OrderFact
                label="Service provider"
                value={text(selected.row.businessName, "Not set")}
              />
              <OrderFact
                label="Destination"
                value={text(
                  selected.row.destinationCountryName ??
                    selected.row.destinationCountry,
                  "Not set",
                )}
              />
              <OrderFact
                label="Receiver"
                value={text(
                  selected.row.receiverName ?? selected.row.buyerName,
                  "Not set",
                )}
              />
              <OrderFact
                label="Total"
                value={formatMoney(
                  selected.row.totalAmount ??
                    selected.row.amount ??
                    selected.row.purchasePrice ??
                    selected.row.price,
                  text(selected.row.currency, "USD"),
                )}
              />
              <OrderFact
                label="Created"
                value={formatDate(selected.row.createdAt)}
              />
              <OrderFact
                label="Updated"
                value={formatDate(
                  selected.row.updatedAt ?? selected.row.createdAt,
                )}
              />
            </div>
            {selected.collectionName === "carPurchases" &&
              carPurchaseIsViewing(selected.row) && (
                <CustomerCarViewing row={selected.row} />
              )}
            {transportEditWindowOpen(selected) && (
              <button
                className="secondary-button"
                onClick={() => setEditing(true)}
                type="button"
              >
                <Pencil size={15} /> Edit request
              </button>
            )}
            {isReviewEligibleStatus(
              text(selected.row.status ?? selected.row.purchaseStatus, ""),
            ) &&
              text(selected.row.businessId, "") &&
              (reviewedKeys.has(`${selected.collectionName}_${selected.row.id}`) ? (
                <span className="status-pill compact">Review submitted</span>
              ) : (
                <button
                  className="secondary-button"
                  onClick={() => setReviewing(true)}
                  type="button"
                >
                  <Star size={15} /> Leave a review
                </button>
              ))}
          </>
        )}
      </OrderDetailDrawer>
      {selected && transportEditWindowOpen(selected) && (
        <TransportEditDrawer
          onClose={() => setEditing(false)}
          open={editing}
          row={selected.row}
        />
      )}
      {selected && (
        <ReviewComposerDrawer
          businessId={text(selected.row.businessId, "")}
          businessName={text(selected.row.businessName, "")}
          onClose={() => setReviewing(false)}
          onSubmitted={() => setReviewing(false)}
          open={reviewing}
          orderTitle={text(
            selected.row.trackingCode ?? selected.row.trackingNumber ?? selected.row.id,
          )}
          relatedCollection={selected.collectionName}
          relatedId={selected.row.id}
        />
      )}
    </>
  );
}

function isReviewEligibleStatus(status: string) {
  return ["completed", "sold", "paid", "succeeded"].includes(status);
}

function OrderFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

// A car transport request stays editable until the customer selects a quote.
// No business "accepts" in this marketplace - they quote - so quote selection
// is the cutoff, not any business-side status.
function transportEditWindowOpen(order: TaggedRow) {
  return (
    order.collectionName === "transportRequests" &&
    // Must match the server's own precondition, or the button appears on a
    // request the callable will refuse: marketplace flow, still collecting,
    // and not yet past the quote deadline.
    Number(order.row.flowVersion ?? 1) === 2 &&
    text(order.row.quoteStatus, "") === "collecting" &&
    text(order.row.status, "") === "quote_requested"
  );
}

// Fields a quote was priced against. Editing one of these makes every quote
// already given a quote for a different job.
const TRANSPORT_QUOTED_FIELDS = [
  "carMake",
  "carModel",
  "carYear",
  "pickupArea",
  "vehicleOperable",
  "requestedTransportMethod",
  "destinationCountryId",
] as const;

/**
 * Cancellation for an order that is already PAID (secured), shipping flows
 * only. The money outcome is decided server-side by cancelSecuredCustomerOrder:
 * still-held payments release for free; captured ones refund minus the card
 * fee. The label and confirm copy here mirror those two outcomes so the
 * customer knows which one they are choosing before they press anything.
 */
function securedOrderCancellation(order: TaggedRow) {
  const status = text(order.row.status, "").toLowerCase();
  const paymentStatus = text(order.row.paymentStatus, "").toLowerCase();
  if (status !== "pending" || paymentStatus !== "succeeded") return null;

  const held = text(order.row.paymentHoldStatus, "") === "held";
  const copy = held
    ? {
        label: "Cancel order (free)",
        confirm:
          "Cancel this order? Your card was never charged - the hold is " +
          "released and you pay nothing.",
      }
    : {
        label: "Cancel order (refund minus card fee)",
        confirm:
          "Cancel this order? Your payment is refunded minus the card " +
          "processing fee, as stated at checkout.",
      };

  switch (order.collectionName) {
    case "freightShipments":
      return {
        callable: "cancelSecuredCustomerOrder",
        payload: { orderType: "freightShipment", recordId: order.row.id },
        ...copy,
      };
    case "barrelShipments": {
      // A shipment born from a multi-destination order shares one payment
      // with its siblings, so the cancellable unit is the whole order.
      const orderId = text(order.row.orderId, "");
      if (orderId) {
        return {
          callable: "cancelSecuredCustomerOrder",
          payload: { orderType: "barrelOrder", recordId: orderId },
          label: held
            ? "Cancel whole order (free)"
            : "Cancel whole order (refund minus card fee)",
          confirm:
            "This shipment was paid together with the rest of its order, " +
            "so the whole order is cancelled. " +
            (held
              ? "Your card was never charged - you pay nothing."
              : "Your payment is refunded minus the card processing fee."),
        };
      }
      return {
        callable: "cancelSecuredCustomerOrder",
        payload: { orderType: "barrelShipment", recordId: order.row.id },
        ...copy,
      };
    }
    default:
      return null;
  }
}

function pendingOrderCancellation(order: TaggedRow) {
  // A marketplace transport request sits at "quote_requested", not "pending",
  // so the generic status gate below never matched it and the web console
  // offered no way to cancel - while the app did. Same callable, same window
  // (collecting quotes) as cancelTransportRequest enforces server-side.
  if (order.collectionName === "transportRequests") {
    return transportEditWindowOpen(order)
      ? {
          callable: "cancelTransportQuoteRequest",
          payload: { requestId: order.row.id },
        }
      : null;
  }
  const status = text(
    order.row.paymentStatus ?? order.row.purchaseStatus ?? order.row.status,
    "",
  ).toLowerCase();
  if (!["pending", "pending_payment"].includes(status)) return null;
  switch (order.collectionName) {
    case "barrelShipments":
      return {
        callable: "cancelPendingBarrelShipment",
        payload: { shipmentId: order.row.id },
      };
    case "freightShipments":
      return {
        callable: "cancelPendingFreightShipment",
        payload: { shipmentId: order.row.id },
      };
    case "parkedCars":
      return {
        callable: "cancelPendingParkingReservation",
        payload: { reservationId: order.row.id },
      };
    case "carPurchases":
      return {
        callable:
          order.row.paymentType === "viewing_reservation"
            ? "cancelCarViewingReservation"
            : "cancelPendingCarPurchase",
        payload: { purchaseId: order.row.id },
      };
    default:
      return null;
  }
}

function ProfileView({ firebaseUser, profile }: { firebaseUser: User; profile: UserProfile }) {
  const [fullName, setFullName] = useState(text(profile.fullName, ""));
  const [phone, setPhone] = useState(text(profile.phone, ""));
  const [prefs, setPrefs] = useState(() =>
    mergeNotificationPreferences(profile.notificationPreferences),
  );
  const [saving, setSaving] = useState(false);
  const [verificationId, setVerificationId] = useState("");
  const [verificationPhone, setVerificationPhone] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [phoneNotice, setPhoneNotice] = useState("");
  const [phoneError, setPhoneError] = useState("");
  const recaptcha = useRef<RecaptchaVerifier | null>(null);
  const normalizedDraft = normalizePhone(phone);
  // Require the backend's own record of verification (profile.phoneVerified),
  // not just a live match against the Auth SDK's phoneNumber: those two can
  // drift apart (e.g. a phone linked outside the normal verify-code flow),
  // and showing "Verified" here when the shared-barrel gate would still
  // reject the account is exactly the kind of mismatch that confuses users.
  const phoneVerified =
    isValidE164(normalizedDraft) &&
    normalizePhone(firebaseUser.phoneNumber || "") === normalizedDraft &&
    profile?.phoneVerified === true;

  function changePhone(value: string) {
    setPhone(value);
    if (
      verificationId &&
      normalizePhone(value) !== verificationPhone
    ) {
      setVerificationId("");
      setVerificationPhone("");
      setVerificationCode("");
      setPhoneNotice("");
      setPhoneError("");
    }
  }

  useEffect(
    () => () => {
      recaptcha.current?.clear();
      recaptcha.current = null;
    },
    [],
  );

  async function saveProfile() {
    if (!fullName.trim() || !isValidPhone(phone) || saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await httpsCallable(functions, "updateCustomerProfile")({
        fullName: fullName.trim(),
        phone: phone.trim(),
        notificationPreferences: prefs,
      });
      setNotice("Profile saved.");
    } catch {
      setError("Your profile could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  async function sendPhoneCode() {
    if (!isValidE164(phone) || verifying) {
      setError("Use an international phone number beginning with +.");
      return;
    }
    setVerifying(true);
    setPhoneError("");
    setPhoneNotice("");
    try {
      if (!recaptcha.current) {
        recaptcha.current = new RecaptchaVerifier(
          auth,
          "customer-phone-recaptcha",
          { size: "invisible" },
        );
      }
      auth.languageCode = currentWebLanguage();
      const provider = new PhoneAuthProvider(auth);
      const id = await withPhoneVerificationTimeout(
        provider.verifyPhoneNumber(normalizedDraft, recaptcha.current),
      );
      setVerificationId(id);
      setVerificationPhone(normalizedDraft);
      setPhoneNotice(
        "Verification code sent. Enter the 6-digit code below.",
      );
    } catch (caught) {
      recaptcha.current?.clear();
      recaptcha.current = null;
      setVerificationId("");
      setVerificationPhone("");
      setPhoneError(
        phoneVerificationErrorMessage(caught, window.location.hostname),
      );
    } finally {
      setVerifying(false);
    }
  }

  async function confirmPhone() {
    if (!verificationId || !verificationCode.trim() || verifying) return;
    if (normalizedDraft !== verificationPhone) {
      setPhoneError(
        "The phone number changed. Send a new verification code.",
      );
      return;
    }
    setVerifying(true);
    setPhoneError("");
    setPhoneNotice("");
    try {
      const credential = PhoneAuthProvider.credential(
        verificationId,
        verificationCode.trim(),
      );
      if (firebaseUser.phoneNumber) {
        await updatePhoneNumber(firebaseUser, credential);
      } else {
        await linkWithCredential(firebaseUser, credential);
      }
      await firebaseUser.getIdToken(true);
      await httpsCallable(functions, "syncVerifiedCustomerPhone")({});
      setVerificationCode("");
      setVerificationId("");
      setVerificationPhone("");
      setNotice("Phone number verified.");
    } catch (caught) {
      setPhoneError(
        phoneVerificationErrorMessage(caught, window.location.hostname),
      );
    } finally {
      setVerifying(false);
    }
  }

  async function requestDeletion() {
    if (!firebaseUser.email || !deletePassword || deleting) return;
    setDeleting(true);
    setError("");
    setNotice("");
    try {
      const credential = EmailAuthProvider.credential(
        firebaseUser.email,
        deletePassword,
      );
      await reauthenticateWithCredential(firebaseUser, credential);
      await firebaseUser.getIdToken(true);
      await httpsCallable(functions, "requestOwnAccountDeletion")({});
      setDeletePassword("");
      setNotice(
        "Account deletion requested. Laawol will complete it within 30 days.",
      );
    } catch {
      setError("The deletion request could not be submitted. Check your password.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-header">
          <div><Settings size={18} /><h2>Profile</h2></div>
        </div>
        {error && <div className="error-box">{error}</div>}
        {notice && <div className="info-band">{notice}</div>}
        <div className="customer-form-grid">
          <label>
            Full name
            <input
              autoComplete="name"
              onChange={(event) => setFullName(event.target.value)}
              value={fullName}
            />
          </label>
          <label>
            Email
            <input
              disabled
              type="email"
              value={text(profile.email ?? firebaseUser.email, "Not set")}
            />
          </label>
          <CustomerPhoneField
            id="profile-phone"
            label="Phone number"
            onChange={changePhone}
            disabled={verifying}
            value={phone}
          />
        </div>
        <div className="customer-profile-actions">
          <button
            className="primary-button"
            data-loading={saving}
            disabled={saving || !fullName.trim() || !isValidPhone(phone)}
            onClick={() => void saveProfile()}
            type="button"
          >
            {saving ? "Saving..." : "Save profile"}
          </button>
          <span
            className={`customer-phone-status ${
              phoneVerified ? "verified" : "unverified"
            }`}
          >
            {phoneVerified ? (
              <ShieldCheck aria-hidden="true" size={15} />
            ) : (
              <CircleAlert aria-hidden="true" size={15} />
            )}
            {phoneVerified ? "Verified" : "Not verified"}
          </span>
        </div>
        {!phoneVerified && (
          <div className="customer-phone-verification">
            <div className="customer-phone-verification-head">
              <span className="customer-phone-verification-icon">
                <ShieldCheck aria-hidden="true" size={20} />
              </span>
              <div>
                <strong>Verify your phone number</strong>
                <p>
                  We will text a 6-digit code to {normalizedDraft || "your phone"}.
                  Standard messaging rates may apply.
                </p>
              </div>
            </div>
            <div aria-live="polite">
              {phoneNotice && <div className="info-band">{phoneNotice}</div>}
              {phoneError && <div className="error-box">{phoneError}</div>}
            </div>
            {!verificationId && (
              <button
                className="primary-button customer-phone-send-code"
                data-loading={verifying}
                disabled={verifying || !isValidE164(phone)}
                onClick={() => void sendPhoneCode()}
                type="button"
              >
                {verifying ? "Sending verification code..." : "Send verification code"}
              </button>
            )}
            {verificationId && (
              <div className="customer-phone-code-step">
                <label>
                  6-digit verification code
                  <input
                    autoComplete="one-time-code"
                    autoFocus
                    inputMode="numeric"
                    maxLength={6}
                    onChange={(event) =>
                      setVerificationCode(
                        event.target.value.replace(/\D/g, "").slice(0, 6),
                      )
                    }
                    placeholder="000000"
                    value={verificationCode}
                  />
                </label>
                <div className="customer-phone-code-actions">
                  <button
                    className="primary-button"
                    data-loading={verifying}
                    disabled={verifying || verificationCode.length !== 6}
                    onClick={() => void confirmPhone()}
                    type="button"
                  >
                    {verifying ? "Verifying phone..." : "Verify phone"}
                  </button>
                  <button
                    className="secondary-button"
                    data-loading={verifying}
                    disabled={verifying}
                    onClick={() => void sendPhoneCode()}
                    type="button"
                  >
                    {verifying ? "Sending..." : "Resend code"}
                  </button>
                </div>
              </div>
            )}
            <div id="customer-phone-recaptcha" />
          </div>
        )}
      </section>
      <section className="panel">
        <div className="panel-header">
          <div><Settings size={18} /><h2>Notification preferences</h2></div>
        </div>
        {error && <div className="error-box">{error}</div>}
        {notice && <div className="info-band">{notice}</div>}
        <div className="toggle-list">
          {notificationPreferenceFields.map((field) => (
            <ToggleRow
              key={field.key}
              label={field.label}
              hint={field.hint}
              checked={prefs[field.key]}
              onChange={(value) =>
                setPrefs((current) => ({ ...current, [field.key]: value }))
              }
            />
          ))}
        </div>
        <div className="customer-profile-actions">
          <button
            className="primary-button"
            data-loading={saving}
            disabled={saving || !fullName.trim() || !isValidPhone(phone)}
            onClick={() => void saveProfile()}
            type="button"
          >
            {saving ? "Saving..." : "Save preferences"}
          </button>
        </div>
      </section>
      <section className="panel customer-danger-zone">
        <div className="panel-header"><div><h2>Delete account</h2></div></div>
        <p>
          Enter your password to request deletion. Required transaction records
          may be retained for legal and accounting obligations.
        </p>
        <div className="customer-delete-row">
          <label>
            Current password
            <input
              autoComplete="current-password"
              onChange={(event) => setDeletePassword(event.target.value)}
              type="password"
              value={deletePassword}
            />
          </label>
          <button
            className="danger-button"
            data-loading={deleting}
            disabled={deleting || !deletePassword}
            onClick={() => void requestDeletion()}
            type="button"
          >
            {deleting ? "Requesting..." : "Request account deletion"}
          </button>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric neutral"><span>{label}</span><strong>{value}</strong></div>;
}

function useCustomerCollection(collectionName: string, ownerField: string, uid: string): CustomerCollection {
  const [state, setState] = useState<CustomerCollection>({ rows: [], loading: true, error: "" });
  useEffect(() => {
    setState({ rows: [], loading: true, error: "" });
    const request = query(collection(db, collectionName), where(ownerField, "==", uid));
    return onSnapshot(request, (snapshot) => {
      setState({ rows: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })), loading: false, error: "" });
    }, (error) => setState({ rows: [], loading: false, error: error.message }));
  }, [collectionName, ownerField, uid]);
  return state;
}

function useCustomerBarrelShipments(uid: string) {
  return useCustomerCollection("barrelShipments", "customerUid", uid);
}

function useCustomerFreightShipments(uid: string) {
  return useCustomerCollection("freightShipments", "customerUid", uid);
}

function useCustomerTransportRequests(uid: string) {
  return useCustomerCollection("transportRequests", "customerUid", uid);
}

function useCustomerParkingRecords(uid: string) {
  return useCustomerCollection("parkedCars", "customerUid", uid);
}

function useCustomerCarPurchases(uid: string) {
  return useCustomerCollection("carPurchases", "buyerUid", uid);
}

export function usePublicCars(enabled: boolean): CustomerCollection {
  const [state, setState] = useState<CustomerCollection>({ rows: [], loading: false, error: "" });
  useEffect(() => {
    if (!enabled) return undefined;
    setState({ rows: [], loading: true, error: "" });
    const request = query(collection(db, "cars"), where("status", "==", "active"), limit(100));
    return onSnapshot(request, (snapshot) => {
      const rows = snapshot.docs
        .map((item) => ({ id: item.id, ...item.data() }))
        .filter(customerCarListingIsEligible);
      setState({ rows, loading: false, error: "" });
    }, (error) => setState({ rows: [], loading: false, error: error.message }));
  }, [enabled]);
  return state;
}

type TaggedRow = {
  row: FirestoreRow;
  label: string;
  collectionName: string;
  icon: typeof Car;
};

// Identity of one activity row across renders. The collection is part of it
// because two collections can hand out the same document id.
function orderKey(order: TaggedRow) {
  return `${order.collectionName}:${order.row.id}`;
}

// A status a customer can read. Only viewings are mapped: they are the one
// activity whose raw status words - viewing_countered, viewing_expired - say
// nothing to the person waiting on them. Everything else keeps the value it
// has always shown.
function orderStatusLabel(order: TaggedRow) {
  const status = text(order.row.status ?? order.row.purchaseStatus, "Pending");
  if (order.collectionName === "carPurchases") {
    return viewingStatusLabel(status) || status;
  }
  // Shipments already have customer-facing wording for every status they can
  // reach; without this the order list prints the raw enum ("in_transit")
  // while the tracking card below says "On its way" about the same barrel.
  // Deliberately not applied to the other collections: their statuses are a
  // different vocabulary, and "completed" means delivered for a shipment but
  // not for a parking booking.
  if (order.collectionName === "barrelShipments" ||
      order.collectionName === "freightShipments") {
    return statusLabel(status);
  }
  return status;
}

function tagRows(
  rows: FirestoreRow[],
  label: string,
  collectionName: string,
  icon: typeof Car,
): TaggedRow[] {
  return rows.map((row) => ({ row, label, collectionName, icon }));
}

function rowTime(row: FirestoreRow) {
  const value = row.updatedAt ?? row.createdAt;
  if (value && typeof value === "object" && "toMillis" in value && typeof value.toMillis === "function") {
    return value.toMillis();
  }
  return 0;
}

function isFinalStatus(status: string) {
  return ["completed", "cancelled", "refunded", "sold", "delivered"].includes(status.toLowerCase());
}


/**
 * Lets a customer revise an open transport request from the web console -
 * the same window and the same warning as the mobile app.
 *
 * Only changed fields are sent: the server treats an unchanged resubmission
 * as a no-op, and posting the whole form back would void every quote on a
 * save that altered nothing.
 */
function TransportEditDrawer({
  onClose,
  open,
  row,
}: {
  onClose: () => void;
  open: boolean;
  row: Record<string, unknown>;
}) {
  const [form, setForm] = useState(() => ({
    customerPhone: text(row.customerPhone, ""),
    pickupAddress: text(row.pickupAddress, ""),
    pickupArea: text(row.pickupArea, ""),
    notes: text(row.notes, ""),
    // Seed from the catalog's spelling when the stored value only differs by
    // case, so the dependent pickers populate and saving cleans the record.
    carMake: canonicalMake(text(row.carMake, "")) || text(row.carMake, ""),
    carModel:
      canonicalModel(text(row.carMake, ""), text(row.carModel, "")) ||
      text(row.carModel, ""),
    carYear: text(row.carYear, ""),
    destinationCountryId: text(row.destinationCountryId, ""),
    requestedTransportMethod: text(row.requestedTransportMethod, "open"),
    vehicleOperable: row.vehicleOperable !== false,
  }));
  // Pickup fields only make sense once the customer says they want pickup,
  // so they stay hidden until then rather than sitting there unexplained.
  const [wantsPickup, setWantsPickup] = useState(
    () => text(row.pickupAddress, "").trim() !== "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);

  const quoteCount = Number(row.quoteCount ?? 0);

  const withCurrent = (options: string[], current: string) =>
    current && !options.includes(current) ? [current, ...options] : options;
  const carMakeOptions = withCurrent(getMakes(), form.carMake);
  const carModelOptions = withCurrent(
    form.carMake ? getModels(form.carMake) : [],
    form.carModel,
  );
  const carYearOptions = withCurrent(
    form.carMake && form.carModel ? getYears(form.carMake, form.carModel) : [],
    form.carYear,
  );

  function changedFields() {
    const patch: Record<string, unknown> = {};
    const put = (key: string, next: unknown, before: unknown) => {
      if (String(next ?? "").trim() !== String(before ?? "").trim()) {
        patch[key] = next;
      }
    };
    put("customerPhone", form.customerPhone.trim(), row.customerPhone);
    put(
      "pickupAddress",
      wantsPickup ? form.pickupAddress.trim() : "",
      row.pickupAddress,
    );
    put(
      "destinationCountryId",
      form.destinationCountryId,
      row.destinationCountryId,
    );
    put("pickupArea", form.pickupArea.trim(), row.pickupArea);
    put("notes", form.notes.trim(), row.notes);
    put("carMake", form.carMake.trim(), row.carMake);
    put("carModel", form.carModel.trim(), row.carModel);
    put("carYear", form.carYear.trim(), row.carYear);
    put(
      "requestedTransportMethod",
      form.requestedTransportMethod,
      row.requestedTransportMethod,
    );
    if (form.vehicleOperable !== (row.vehicleOperable !== false)) {
      patch.vehicleOperable = form.vehicleOperable;
    }
    return patch;
  }

  async function save(patch: Record<string, unknown>) {
    setBusy(true);
    setError("");
    try {
      await httpsCallable(
        functions,
        "updateTransportRequestDetails",
      )({ requestId: row.id, ...patch });
      setConfirming(false);
      onClose();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not update this request. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }

  function attemptSave() {
    const patch = changedFields();
    if (Object.keys(patch).length === 0) {
      onClose();
      return;
    }
    const affectsQuotes = TRANSPORT_QUOTED_FIELDS.some((f) => f in patch);
    // Warn BEFORE saving: the customer watched these quotes arrive, and
    // clearing them silently would read as losing them.
    if (affectsQuotes && quoteCount > 0) {
      setConfirming(true);
      return;
    }
    void save(patch);
  }

  if (!open) return null;

  return (
    <OrderDetailDrawer onClose={onClose} open={open} title="Edit your request">
      <p className="drawer-note">
        You can change your request until you choose a quote.
      </p>
      <div className="settings-form">
        <label>
          Phone
          <input
            onChange={(e) => setForm({ ...form, customerPhone: e.target.value })}
            value={form.customerPhone}
          />
        </label>
        <label>
          Do you need pickup?
          <select
            onChange={(e) => setWantsPickup(e.target.value === "yes")}
            value={wantsPickup ? "yes" : "no"}
          >
            <option value="no">No, I will drop the vehicle off</option>
            <option value="yes">Yes, collect it from an address</option>
          </select>
        </label>
        {wantsPickup && (
          <label>
            Pickup address
            <input
              onChange={(e) =>
                setForm({ ...form, pickupAddress: e.target.value })
              }
              value={form.pickupAddress}
            />
          </label>
        )}
        <label>
          Pickup area
          <input
            onChange={(e) => setForm({ ...form, pickupArea: e.target.value })}
            value={form.pickupArea}
          />
        </label>
        <label>
          Destination
          <select
            onChange={(e) =>
              setForm({ ...form, destinationCountryId: e.target.value })
            }
            value={form.destinationCountryId}
          >
            {!form.destinationCountryId && <option value="">Select a country</option>}
            {DESTINATION_COUNTRIES.map((country) => (
              <option key={country.id} value={country.id}>
                {country.name}
              </option>
            ))}
          </select>
        </label>
        <label className="wide-field">
          Notes
          <textarea
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
            rows={2}
            value={form.notes}
          />
        </label>
        <label>
          Make
          <select
            onChange={(e) =>
              // Model and year belong to the previous make, so clear them
              // rather than leave an impossible combination behind.
              setForm({
                ...form,
                carMake: e.target.value,
                carModel: "",
                carYear: "",
              })
            }
            value={form.carMake}
          >
            {!form.carMake && <option value="">Select a make</option>}
            {carMakeOptions.map((make) => (
              <option key={make} value={make}>
                {make}
              </option>
            ))}
          </select>
        </label>
        <label>
          Model
          <select
            disabled={!form.carMake}
            onChange={(e) =>
              setForm({ ...form, carModel: e.target.value, carYear: "" })
            }
            value={form.carModel}
          >
            {!form.carModel && <option value="">Select a model</option>}
            {carModelOptions.map((model) => (
              <option key={model} value={model}>
                {model}
              </option>
            ))}
          </select>
        </label>
        <label>
          Year
          <select
            disabled={!form.carModel}
            onChange={(e) => setForm({ ...form, carYear: e.target.value })}
            value={form.carYear}
          >
            {!form.carYear && <option value="">Select a year</option>}
            {carYearOptions.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        </label>
        <label>
          Transport method
          <select
            onChange={(e) =>
              setForm({ ...form, requestedTransportMethod: e.target.value })
            }
            value={form.requestedTransportMethod}
          >
            <option value="open">Open</option>
            <option value="enclosed">Enclosed</option>
          </select>
        </label>
        <label>
          Vehicle is drivable
          <select
            onChange={(e) =>
              setForm({ ...form, vehicleOperable: e.target.value === "yes" })
            }
            value={form.vehicleOperable ? "yes" : "no"}
          >
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
      </div>
      {error && <div className="form-msg err">{error}</div>}
      {confirming ? (
        <div className="info-band">
          <b>This will reset your quotes.</b> Businesses priced their quotes on
          your current details. Saving clears the {quoteCount} quote
          {quoteCount === 1 ? "" : "s"} you already have, and businesses will be
          asked to quote again.
          <div className="drawer-actions">
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => setConfirming(false)}
              type="button"
            >
              Keep editing
            </button>
            <button
              className="primary-button"
              disabled={busy}
              onClick={() => void save(changedFields())}
              type="button"
            >
              {busy ? "Saving..." : "Save and reset quotes"}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="primary-button"
          disabled={busy}
          onClick={attemptSave}
          type="button"
        >
          {busy ? "Saving..." : "Save changes"}
        </button>
      )}
    </OrderDetailDrawer>
  );
}
