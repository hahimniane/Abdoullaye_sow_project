"use client";

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
  Car,
  CircleAlert,
  CircleDollarSign,
  ClipboardList,
  Home,
  Headphones,
  LogOut,
  Menu,
  PackageSearch,
  Settings,
  Ship,
  ShieldCheck,
  Truck,
  UserRound,
  WalletCards,
} from "lucide-react";

import { auth, db, functions } from "@/lib/firebase";
import { formatDate, formatMoney, text } from "@/lib/format";
import type { FirestoreRow, UserProfile } from "@/types/admin";
import { CustomerCars } from "@/components/customer-cars";
import { CustomerPhoneField } from "@/components/customer-phone-field";
import { CustomerParkingPools } from "@/components/customer-parking-pools";
import { CustomerShippingServices } from "@/components/customer-shipping-services";
import { CustomerSupport } from "@/components/customer-support";
import { CustomerTracking } from "@/components/customer-tracking";
import { CustomerTrackingActions } from "@/components/customer-tracking";
import { CustomerWalletActions } from "@/components/customer-wallet-actions";
import { OrderDetailDrawer } from "@/components/order-detail-drawer";
import { isValidE164, isValidPhone, normalizePhone } from "@/lib/phone";
import { phoneVerificationErrorMessage } from "@/lib/phone-verification";
import { currentWebLanguage } from "@/lib/language";

type CustomerTab =
  | "home"
  | "services"
  | "parkingPools"
  | "cars"
  | "orders"
  | "wallet"
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
  { id: "orders", label: "Orders & tracking", description: "Shipping and vehicle services", icon: ClipboardList },
  { id: "wallet", label: "Wallet", description: "Balance and transactions", icon: WalletCards },
  { id: "support", label: "Support", description: "Messages about your orders", icon: Headphones },
  { id: "profile", label: "Profile", description: "Account and security", icon: UserRound },
];

export function CustomerConsole({
  firebaseUser,
  profile,
  onSignOut,
}: CustomerConsoleProps) {
  const [activeTab, setActiveTab] = useState<CustomerTab>(() =>
    firebaseUser.phoneNumber ? "home" : "profile",
  );
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
  const wallet = useWallet(firebaseUser.uid, activeTab === "wallet" || activeTab === "home");

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
            return (
              <button
                className={activeTab === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                type="button"
              >
                <Icon size={18} />
                <span className="nav-text">
                  <b>{tab.label}</b>
                  <small>{tab.description}</small>
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
              walletBalance={wallet.balance}
              onOpenCars={() => setActiveTab("cars")}
              onOpenOrders={() => setActiveTab("orders")}
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
          {activeTab === "orders" && (
            <OrdersView
              loading={dataLoading}
              orders={allOrders}
              trackedShipments={[...shipments.rows, ...freight.rows]}
            />
          )}
          {activeTab === "wallet" && <WalletView state={wallet} />}
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
  walletBalance,
  onOpenCars,
  onOpenOrders,
}: {
  customerName: string;
  loading: boolean;
  orders: TaggedRow[];
  walletBalance: number;
  onOpenCars: () => void;
  onOpenOrders: () => void;
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
        <Metric label="Wallet balance" value={formatMoney(walletBalance)} />
        <Metric label="Account access" value="Web + mobile" />
      </div>
      <OrderPanel loading={loading} orders={orders.slice(0, 5)} title="Recent activity" />
      <section className="info-band customer-parity-note">
        New service requests and web payments are being added service by service. Your existing orders,
        purchases, tracking, wallet, and account remain shared with the mobile app.
      </section>
    </div>
  );
}

function OrdersView({
  loading,
  orders,
  trackedShipments,
}: {
  loading: boolean;
  orders: TaggedRow[];
  trackedShipments: FirestoreRow[];
}) {
  return (
    <div className="stack">
      <OrderPanel loading={loading} orders={orders} title="Orders & tracking" />
      {!loading && <CustomerTracking records={trackedShipments} />}
    </div>
  );
}

function OrderPanel({ loading, orders, title }: { loading: boolean; orders: TaggedRow[]; title: string }) {
  const [selected, setSelected] = useState<TaggedRow | null>(null);
  const cancelAction = selected ? pendingOrderCancellation(selected) : null;

  async function cancelSelectedOrder() {
    if (!selected || !cancelAction) return;
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
                key={`${label}-${row.id}`}
                onClick={() => setSelected(order)}
                type="button"
              >
                <Icon size={20} />
                <div>
                  <strong>{label}</strong>
                  <small>{text(row.trackingCode ?? row.trackingNumber ?? row.id)}</small>
                </div>
                <div>
                  <span className="status-pill compact">{text(row.status ?? row.purchaseStatus, "Pending")}</span>
                  <small>{formatDate(row.updatedAt ?? row.createdAt)}</small>
                </div>
              </button>
            );
          })}
        </div>
      </section>
      <OrderDetailDrawer
        onCancelOrder={cancelAction ? cancelSelectedOrder : undefined}
        onClose={() => setSelected(null)}
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
              <OrderFact
                label="Status"
                value={text(
                  selected.row.status ?? selected.row.purchaseStatus,
                  "Pending",
                )}
              />
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
            {["barrelShipments", "freightShipments"].includes(
              selected.collectionName,
            ) && <CustomerTrackingActions record={selected.row} />}
          </>
        )}
      </OrderDetailDrawer>
    </>
  );
}

function OrderFact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function pendingOrderCancellation(order: TaggedRow) {
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

function WalletView({ state }: { state: WalletState }) {
  return (
    <div className="stack">
      <div className="metric-grid">
        <Metric label="Available balance" value={formatMoney(state.balance, state.currency)} />
        <Metric label="Transactions" value={state.loading ? "…" : String(state.transactions.length)} />
      </div>
      <section className="panel">
        <div className="panel-header"><div><WalletCards size={18} /><h2>Wallet activity</h2></div></div>
        {state.loading && <div className="empty-state">Loading wallet...</div>}
        {state.error && <div className="error-box">Wallet could not be loaded. {state.error}</div>}
        {!state.loading && state.transactions.length === 0 && (
          <div className="empty-state">No wallet transactions yet.</div>
        )}
        <div className="row-list">
          {state.transactions.map((transaction) => (
            <div className="data-row" key={transaction.id}>
              <div><strong>{text(transaction.description ?? transaction.type, "Wallet transaction")}</strong><small>{formatDate(transaction.createdAt)}</small></div>
              <strong>{formatMoney(transaction.amount, state.currency)}</strong>
            </div>
          ))}
        </div>
      </section>
      <CustomerWalletActions
        balance={state.balance}
        currency={state.currency}
        pendingRefund={state.pendingRefund}
      />
    </div>
  );
}

function ProfileView({ firebaseUser, profile }: { firebaseUser: User; profile: UserProfile }) {
  const [fullName, setFullName] = useState(text(profile.fullName, ""));
  const [phone, setPhone] = useState(text(profile.phone, ""));
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
  const phoneVerified =
    isValidE164(normalizedDraft) &&
    normalizePhone(firebaseUser.phoneNumber || "") === normalizedDraft;

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
        notificationPreferences:
          profile.notificationPreferences ?? {
            channels: { push: true, email: true, sms: false },
            categories: {
              orders: true,
              payments: true,
              support: true,
              marketing: false,
            },
          },
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

function usePublicCars(enabled: boolean): CustomerCollection {
  const [state, setState] = useState<CustomerCollection>({ rows: [], loading: false, error: "" });
  useEffect(() => {
    if (!enabled) return undefined;
    setState({ rows: [], loading: true, error: "" });
    const request = query(collection(db, "cars"), where("status", "==", "active"), limit(100));
    return onSnapshot(request, (snapshot) => {
      setState({ rows: snapshot.docs.map((item) => ({ id: item.id, ...item.data() })), loading: false, error: "" });
    }, (error) => setState({ rows: [], loading: false, error: error.message }));
  }, [enabled]);
  return state;
}

type WalletState = {
  balance: number;
  currency: string;
  pendingRefund: number;
  transactions: FirestoreRow[];
  loading: boolean;
  error: string;
};

function useWallet(uid: string, enabled: boolean): WalletState {
  const [wallet, setWallet] = useState({
    balance: 0,
    currency: "USD",
    pendingRefund: 0,
    error: "",
  });
  const [transactions, setTransactions] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!enabled) return undefined;
    setLoading(true);
    const unsubscribeWallet = onSnapshot(doc(db, "wallets", uid), (snapshot) => {
      const data = snapshot.data();
      setWallet({
        balance: Number(data?.balance ?? 0),
        currency: text(data?.currency, "USD"),
        pendingRefund: Number(data?.pendingRefund ?? 0),
        error: "",
      });
      setLoading(false);
    }, (error) => { setWallet((current) => ({ ...current, error: error.message })); setLoading(false); });
    const transactionQuery = query(collection(db, "wallets", uid, "transactions"), orderBy("createdAt", "desc"), limit(100));
    const unsubscribeTransactions = onSnapshot(transactionQuery, (snapshot) => {
      setTransactions(snapshot.docs.map((item) => ({ id: item.id, ...item.data() })));
      setLoading(false);
    }, (error) => { setWallet((current) => ({ ...current, error: error.message })); setLoading(false); });
    return () => { unsubscribeWallet(); unsubscribeTransactions(); };
  }, [enabled, uid]);
  return { ...wallet, transactions, loading };
}

type TaggedRow = {
  row: FirestoreRow;
  label: string;
  collectionName: string;
  icon: typeof Car;
};

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
