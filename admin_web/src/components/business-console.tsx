"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  BarChart3,
  Banknote,
  Building2,
  Car,
  ClipboardList,
  ExternalLink,
  LogOut,
  MapPinned,
  Menu,
  MessageCircle,
  Package,
  ParkingCircle,
  Search,
  Settings,
  Sparkles,
  Star,
  Truck,
  UserCog,
} from "lucide-react";

import {AssistantWidget} from "@/components/business/assistant-widget";
import {GrowthPanel} from "@/components/business/growth-panel";
import {
  BarrelsPanel,
  DestinationsPanel,
  FreightPanel,
  ListingsPanel,
  OfficeLocationsPanel,
  ParkingPanel,
  PurchasesPanel,
  TransportPanel,
} from "@/components/business/operations-panels";
import {
  BusinessPeoplePanel,
  BusinessProfilePanel,
  BusinessServicesPanel,
} from "@/components/business/profile-support-people";
import { ReviewsPanel } from "@/components/business/reviews-panel";
import { SupportCasesPanel } from "@/components/support/support-cases-panel";
import { NotificationBell } from "@/components/notification-bell";
import { ToggleRow } from "@/components/toggle-row";
import {
  mergeNotificationPreferences,
  notificationPreferenceFields,
} from "@/lib/notification-preferences";
import { useBusinessCollection, useBusinessStaff } from "@/lib/business-data";
import {
  buildBusinessSidebarGroups,
  businessSidebarTabs,
  normalizePinnedTabs,
  type BusinessSidebarTab,
  type BusinessTab,
} from "@/lib/business-sidebar";
import { summarizeBusinessEarnings } from "@/lib/business-earnings";
import { db, functions } from "@/lib/firebase";
import { formatDate, formatMoney, text } from "@/lib/format";
import {
  resolveBusinessPayoutStatus,
  type BusinessPayoutStatus,
} from "@/lib/payout-status";
import { confirmImportantAction } from "@/lib/action-confirmation";
import type { FirestoreRow, UserProfile } from "@/types/admin";

type BusinessConsoleProps = {
  firebaseUser: User;
  profile: UserProfile;
  onSignOut: () => Promise<void> | void;
  previewBusiness?: FirestoreRow | null;
};

const serviceLabels: Record<string, string> = {
  barrelShipping: "Barrel shipping",
  sharedBarrels: "Shared barrels",
  freight: "Freight (parcels)",
  carSales: "Car sales",
  carTransport: "Car transport",
  carParking: "Car parking",
};

const businessSidebarStorageKey = "laawol:business-sidebar-pins";

function tabForNotification(
  type: string,
  service = "",
): BusinessTab {
  // A paid order can belong to any service, so the payload carries which one -
  // dropping the business on "today" would make them hunt for the order that
  // was just paid for.
  if (type === "business_order_paid") {
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
  switch (type) {
    case "support_message":
    case "support_escalated":
      return "cases";
    case "business_verification_review":
    case "business_verification_document":
    case "business_application_status":
      return "profile";
    case "barrel_shipment_status":
      return "barrels";
    case "freight_shipment_status":
    case "freight_balance_due":
    case "freight_refund_issued":
      return "freight";
    case "parking_reservation_status":
      return "parking";
    case "transport_opportunity":
    case "transport_request_status":
    case "transport_quote_won":
    case "transport_quote_lost":
      return "transport";
    default:
      return "today";
  }
}

function NotificationPreferencesPanel({ profile }: { profile: UserProfile }) {
  const [prefs, setPrefs] = useState(() =>
    mergeNotificationPreferences(profile.notificationPreferences),
  );
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function save() {
    if (saving) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      await httpsCallable(functions, "updateNotificationPreferences")({
        notificationPreferences: prefs,
      });
      setNotice("Notification preferences saved.");
    } catch {
      setError("Your preferences could not be saved. Try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="panel">
      <div className="panel-header">
        <div><Settings size={18} /><h2>Your notification preferences</h2></div>
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
          disabled={saving}
          onClick={() => void save()}
          type="button"
        >
          {saving ? "Saving..." : "Save preferences"}
        </button>
      </div>
    </section>
  );
}

export function BusinessConsole({
  firebaseUser,
  profile,
  onSignOut,
  previewBusiness = null,
}: BusinessConsoleProps) {
  const businessId = text(profile.businessId, "");
  const previewMode = Boolean(previewBusiness);
  const [activeTab, setActiveTab] = useState<BusinessTab>("today");
  // Set when a notification is opened, so the destination panel can scroll to
  // and highlight the exact record instead of dropping the business into a
  // list of everything and making them hunt for it.
  const [notificationFocusId, setNotificationFocusId] = useState("");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [pinnedTabs, setPinnedTabs] = useState<BusinessTab[]>(readPinnedTabs);
  const [destinationSetupRequest, setDestinationSetupRequest] = useState(0);
  const [business, setBusiness] = useState<FirestoreRow | null>(
    previewBusiness,
  );
  const [businessError, setBusinessError] = useState("");
  const enabled = Boolean(businessId && !previewMode);

  const handleSignOut = useCallback(async () => {
    if (
      await confirmImportantAction(
        "Sign out? You will need to sign in again to continue.",
        "Se déconnecter ? Vous devrez vous reconnecter pour continuer.",
      )
    ) {
      await onSignOut();
    }
  }, [onSignOut]);

  useEffect(() => {
    if (previewMode) {
      setBusiness(previewBusiness);
      setBusinessError("");
      return undefined;
    }
    if (!businessId) {
      setBusiness(null);
      setBusinessError("This account is not linked to a business.");
      return;
    }
    return onSnapshot(
      doc(db, "businesses", businessId),
      (snap) => {
        setBusiness(snap.exists() ? {id: snap.id, ...snap.data()} : null);
        setBusinessError(snap.exists() ? "" : "Business profile was not found.");
      },
      (error) => {
        setBusiness(null);
        setBusinessError(error.message);
      },
    );
  }, [businessId, previewBusiness, previewMode]);

  const services = useMemo(() => {
    const raw = Array.isArray(business?.enabledServices)
      ? business?.enabledServices
      : profile.businessServices;
    return new Set(
      (Array.isArray(raw) ? raw : []).map((item) => text(item, "")),
    );
  }, [business?.enabledServices, profile.businessServices]);

  const canManageListings = hasBusinessPermission(profile, "listings");
  const cars = useBusinessCollection(
    "cars",
    businessId,
    enabled && canManageListings,
    null,
  );

  const visibleTabs = useMemo(() => {
    return businessSidebarTabs.filter((tab) => {
      const serviceAllowed =
        !tab.service ||
        services.has(tab.service) ||
        (tab.id === "listings" && cars.rows.length > 0);
      const permissionAllowed =
        !tab.permission || hasBusinessPermission(profile, tab.permission);
      return serviceAllowed && permissionAllowed;
    });
  }, [cars.rows.length, profile, services]);

  useEffect(() => {
    setPinnedTabs((current) => {
      const next = normalizePinnedTabs(current, visibleTabs);
      if (
        next.length === current.length &&
        next.every((id, index) => id === current[index])
      ) {
        return current;
      }
      writePinnedTabs(next);
      return next;
    });
  }, [visibleTabs]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("today");
    }
  }, [activeTab, visibleTabs]);

  const sidebarGroups = useMemo(
    () => buildBusinessSidebarGroups(visibleTabs, pinnedTabs, sidebarFilter),
    [pinnedTabs, sidebarFilter, visibleTabs],
  );

  const togglePinnedTab = useCallback((tabId: BusinessTab) => {
    setPinnedTabs((current) => {
      const next = current.includes(tabId)
        ? current.filter((id) => id !== tabId)
        : [...current, tabId];
      writePinnedTabs(next);
      return next;
    });
  }, []);

  const openDestinationSetup = useCallback(() => {
    setDestinationSetupRequest((value) => value + 1);
    setActiveTab("destinations");
  }, []);

  const purchases = useBusinessCollection(
    "carPurchases",
    businessId,
    enabled && services.has("carSales"),
    500,
  );
  const shipments = useBusinessCollection(
    "barrelShipments",
    businessId,
    enabled && services.has("barrelShipping"),
    500,
  );
  const freightShipments = useBusinessCollection(
    "freightShipments",
    businessId,
    enabled && services.has("freight"),
    500,
  );
  const transports = useBusinessCollection(
    "transportRequests",
    businessId,
    enabled && services.has("carTransport"),
    500,
  );
  const parkedCars = useBusinessCollection(
    "parkedCars",
    businessId,
    enabled && services.has("carParking"),
    500,
  );
  const supportCases = useBusinessCollection(
    "supportCases",
    businessId,
    enabled,
    300,
  );
  const insights = useBusinessCollection(
    "businessInsights",
    businessId,
    enabled,
    50,
  );
  const staff = useBusinessStaff(businessId, enabled, 200);

  const businessName = text(business?.name ?? profile.businessName, "Business");
  const status = text(business?.status ?? business?.businessStatus, "pending");
  const isApproved = status === "approved";
  const payoutStatus = resolveBusinessPayoutStatus({
    stripeAccountId: business?.stripeAccountId,
    chargesEnabled: business?.chargesEnabled,
    payoutsEnabled: business?.payoutsEnabled,
  });
  const canOpenSupport = visibleTabs.some((tab) => tab.id === "cases");
  const attentionRows = [
    ...shipments.rows.filter((row) => isOpenStatus(row.status)).slice(0, 3),
    ...freightShipments.rows
      .filter((row) => isOpenStatus(row.status))
      .slice(0, 3),
    ...purchases.rows
      .filter((row) => isOpenStatus(purchaseStatus(row)))
      .slice(0, 3),
    ...transports.rows.filter((row) => isOpenStatus(row.status)).slice(0, 3),
    ...parkedCars.rows.filter((row) => isOpenStatus(row.status)).slice(0, 3),
  ].slice(0, 8);

  return (
    // has-floating-assistant reserves scroll room at the end of the page so
    // the bubble can never permanently cover a control (see globals.css).
    <div className="app-shell has-floating-assistant">
      <header className="topbar">
        <div className="topbar-title">
          <button
            className="sidebar-toggle topbar-menu"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={
              sidebarCollapsed ? "Expand navigation" : "Collapse navigation"
            }
            type="button"
          >
            <Menu size={20} />
          </button>
          <div className="brand-badge">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/logo.png"
              alt="Laawol"
              width={20}
              height={20}
              style={{ borderRadius: 5, display: "block" }}
            />
            <span>Laawol Digital</span>
          </div>
          <div className="topbar-heading">
            <h1>{businessName}</h1>
            <p>
              Business dashboard ·{" "}
              <span className={`biz-status ${isApproved ? "ok" : "pending"}`}>
                {statusLabel(status)}
              </span>
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="admin-chip" title="Signed-in account">
            <UserCog size={18} />
            <span className="admin-chip-name">
              {text(profile.fullName ?? firebaseUser.email, "Business user")}
            </span>
            <span className="admin-role-tag">
              {profile.role === "businessOwner" ? "Owner" : "Staff"}
            </span>
          </div>
          <NotificationBell
            enabled={Boolean(firebaseUser.uid) && !previewMode}
            onSelect={(data) => {
              setActiveTab(
                tabForNotification(data.type ?? "", data.service ?? ""),
              );
              setNotificationFocusId(data.requestId ?? "");
            }}
            uid={firebaseUser.uid}
          />
          <button
            className="icon-button"
            onClick={handleSignOut}
            title="Sign out"
            type="button"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main
        className={`workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}
      >
        <nav
          className="sidebar business-sidebar"
          aria-label="Business sections"
        >
          <div className="sidebar-search" role="search">
            <Search size={15} />
            <input
              aria-label="Filter business sections"
              onChange={(event) => setSidebarFilter(event.target.value)}
              placeholder="Filter services..."
              value={sidebarFilter}
            />
            {sidebarFilter.trim() && (
              <button
                className="sidebar-clear"
                onClick={() => setSidebarFilter("")}
                type="button"
              >
                Clear
              </button>
            )}
          </div>
          {sidebarGroups.length === 0 && (
            <div className="sidebar-empty">No sections match this filter.</div>
          )}
          {sidebarGroups.map((group) => (
            <div className="nav-group" key={group.id}>
              <span className="nav-group-label">{group.label}</span>
              {group.tabs.map((tab) => (
                <BusinessNavItem
                  active={activeTab === tab.id}
                  key={tab.id}
                  onOpen={() => setActiveTab(tab.id)}
                  onTogglePin={() => togglePinnedTab(tab.id)}
                  pinned={pinnedTabs.includes(tab.id)}
                  tab={tab}
                />
              ))}
            </div>
          ))}
        </nav>

        <section className="content">
          {(businessError || !businessId) && (
            <div className="error-box">
              {businessError || "Business account is not configured."}
            </div>
          )}
          {businessId && payoutStatus.state !== "ready" && (
            <StripeSetupBanner
              businessId={businessId}
              payoutStatus={payoutStatus}
              previewMode={previewMode}
              onOpenSupport={() => setActiveTab("cases")}
              canOpenSupport={canOpenSupport}
            />
          )}
          {!isApproved && businessId && (
            <div className="info-band">
              {businessStatusNotice(status)}
            </div>
          )}

          {activeTab === "today" && (
            <TodayView
              businessId={businessId}
              business={business}
              attentionRows={attentionRows}
              cars={cars.rows}
              purchases={purchases.rows}
              shipments={shipments.rows}
              freightShipments={freightShipments.rows}
              transports={transports.rows}
              parkedCars={parkedCars.rows}
              support={supportCases.rows}
              services={services}
              previewMode={previewMode}
              onOpenSupport={() => setActiveTab("cases")}
              canOpenSupport={canOpenSupport}
            />
          )}
          {activeTab === "profile" && (
            <>
              <BusinessProfilePanel businessId={businessId} business={business} />
              <NotificationPreferencesPanel profile={profile} />
            </>
          )}
          {activeTab === "listings" && (
            <ListingsPanel
              businessId={businessId}
              previewMode={previewMode}
              businessName={businessName}
              businessStatus={status}
              businessProfileImageUrl={text(business?.profileImageUrl, "")}
              enabledServices={Array.from(services)}
            />
          )}
          {activeTab === "purchases" && (
            <PurchasesPanel businessId={businessId} previewMode={previewMode} />
          )}
          {activeTab === "barrels" && (
            <BarrelsPanel
              businessId={businessId}
              previewMode={previewMode}
              onOpenDestinations={openDestinationSetup}
            />
          )}
          {activeTab === "freight" && (
            <FreightPanel businessId={businessId} previewMode={previewMode} />
          )}
          {activeTab === "transport" && (
            <TransportPanel
              businessId={businessId}
              focusRequestId={notificationFocusId}
              previewMode={previewMode}
            />
          )}
          {activeTab === "parking" && (
            <ParkingPanel
              businessId={businessId}
              businessName={businessName}
              previewMode={previewMode}
            />
          )}
          {activeTab === "destinations" && (
            <div className="business-service-workspace">
              <BusinessServicesPanel
                businessId={businessId}
                business={business}
                canManage={profile.role === "businessOwner" && !previewMode}
              />
              <div className="service-settings-summary coverage-summary">
                <div>
                  <strong>Office locations</strong>
                  <span>
                    Add every physical location customers can bring items to.
                  </span>
                </div>
                <span className="service-settings-step">3 · Locations</span>
              </div>
              <OfficeLocationsPanel
                businessId={businessId}
                previewMode={previewMode}
              />
              <div className="service-settings-summary coverage-summary">
                <div>
                  <strong>Country coverage &amp; route pricing</strong>
                  <span>
                    Choose countries, customer rates, departure days, and
                    delivery estimates.
                  </span>
                </div>
                <span className="service-settings-step">4 · Coverage</span>
              </div>
              <DestinationsPanel
                businessId={businessId}
                previewMode={previewMode}
                enabledServices={Array.from(services)}
                openNewToken={destinationSetupRequest}
              />
            </div>
          )}
          {activeTab === "people" && (
            <BusinessPeoplePanel
              businessId={businessId}
              business={business}
              rows={staff.rows}
              loading={staff.loading}
              error={staff.error}
              canManageStaff={profile.role === "businessOwner"}
            />
          )}
          {activeTab === "reviews" && (
            <ReviewsPanel businessId={businessId} previewMode={previewMode} />
          )}
          {activeTab === "cases" && (
            <SupportCasesPanel
              scope="business"
              businessId={businessId}
              currentUid={firebaseUser.uid}
              currentName={text(
                profile.fullName ?? firebaseUser.email,
                "Business",
              )}
              canReply={hasBusinessPermission(profile, "support")}
              enabled={!previewMode}
            />
          )}
          {activeTab === "growth" && (
            <GrowthPanel
              businessId={businessId}
              business={business}
              previewMode={previewMode}
              insights={insights.rows}
              loading={insights.loading}
              error={insights.error}
            />
          )}
        </section>
      </main>

      {/* Mounted once for the whole console so the assistant floats over every
          tab and keeps its conversation while the business navigates. */}
      <AssistantWidget businessId={businessId} previewMode={previewMode} />
    </div>
  );
}

function readPinnedTabs() {
  if (typeof window === "undefined") return [] as BusinessTab[];
  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(businessSidebarStorageKey) ?? "[]",
    );
    return Array.isArray(parsed)
      ? normalizePinnedTabs(parsed, businessSidebarTabs)
      : [];
  } catch {
    return [];
  }
}

function writePinnedTabs(tabs: readonly BusinessTab[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(businessSidebarStorageKey, JSON.stringify(tabs));
}

function BusinessNavItem({
  active,
  pinned,
  tab,
  onOpen,
  onTogglePin,
}: {
  active: boolean;
  pinned: boolean;
  tab: BusinessSidebarTab;
  onOpen: () => void;
  onTogglePin: () => void;
}) {
  const pinTitle = pinned ? `Unpin ${tab.label}` : `Pin ${tab.label}`;
  return (
    <div className={`nav-row ${active ? "active" : ""}`}>
      <button
        className={active ? "nav-main active" : "nav-main"}
        onClick={onOpen}
        title={tab.label}
        type="button"
      >
        {tabIcon(tab.id)}
        <span className="nav-text">
          <b>{tab.label}</b>
          <small>{tab.description}</small>
        </span>
      </button>
      <button
        aria-label={pinTitle}
        className={pinned ? "nav-pin is-pinned" : "nav-pin"}
        onClick={onTogglePin}
        title={pinTitle}
        type="button"
      >
        <Star fill={pinned ? "currentColor" : "none"} size={13} />
      </button>
    </div>
  );
}

function StripeSetupBanner({
  businessId,
  payoutStatus,
  previewMode,
  onOpenSupport,
  canOpenSupport,
}: {
  businessId: string;
  payoutStatus: BusinessPayoutStatus;
  previewMode: boolean;
  onOpenSupport: () => void;
  canOpenSupport: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const hasStripeAccount = Boolean(payoutStatus.stripeAccountId);
  const headline = hasStripeAccount
    ? "Finish Stripe setup to continue"
    : "Set up Stripe to continue";
  const body = hasStripeAccount
    ? "Your Stripe account exists, but Stripe still needs verification details before Laawol can approve payouts or send customer payments to your business."
    : "Before your business can be approved for paid services, create your secure Stripe account for identity, tax, legal, and bank verification.";
  const actionLabel = busy
    ? "Opening Stripe..."
    : hasStripeAccount
      ? "Continue Stripe setup"
      : "Start Stripe registration";

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const href = window.location.href;
      const result = await httpsCallable(
        functions,
        "createBusinessStripeAccountLink",
      )({
        businessId,
        returnUrl: href,
        refreshUrl: href,
      });
      const url = text((result.data as {url?: string})?.url, "");
      if (!url) throw new Error("Stripe did not return an onboarding link.");
      window.location.assign(url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not start Stripe onboarding.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      className="stripe-setup-banner"
      aria-labelledby="stripe-setup-title"
    >
      <div className="stripe-setup-main">
        <span className="stripe-setup-step">Required first step</span>
        <h2 id="stripe-setup-title">{headline}</h2>
        <p>{body}</p>
        <div className="stripe-setup-meta">
          <span>{payoutStatus.primaryLabel}</span>
          <span>{payoutStatus.chargesLabel}</span>
          {payoutStatus.stripeAccountId && (
            <span>{payoutStatus.stripeAccountId}</span>
          )}
        </div>
        {error && <div className="error-box">{error}</div>}
      </div>
      <div className="stripe-setup-actions">
        <button
          className="lst-add"
          disabled={busy || !businessId || previewMode}
          onClick={connect}
          type="button"
        >
          {actionLabel}
        </button>
        <a
          className="secondary-button"
          href="https://support.stripe.com/questions/connect-platforms-manage-onboarding-and-risk-requirements-for-connected-accounts"
          rel="noreferrer"
          target="_blank"
        >
          Stripe setup help <ExternalLink size={14} />
        </a>
        <button
          className="secondary-button"
          disabled={!canOpenSupport}
          onClick={onOpenSupport}
          type="button"
        >
          Contact Laawol support
        </button>
      </div>
    </section>
  );
}

function TodayView({
  businessId,
  business,
  attentionRows,
  cars,
  purchases,
  shipments,
  freightShipments,
  transports,
  parkedCars,
  support,
  services,
  previewMode,
  onOpenSupport,
  canOpenSupport,
}: {
  businessId: string;
  business: FirestoreRow | null;
  attentionRows: FirestoreRow[];
  cars: FirestoreRow[];
  purchases: FirestoreRow[];
  shipments: FirestoreRow[];
  freightShipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
  support: FirestoreRow[];
  services: Set<string>;
  previewMode: boolean;
  onOpenSupport: () => void;
  canOpenSupport: boolean;
}) {
  const metrics = [
    {
      label: "Active listings",
      value: cars.filter((row) => row.status === "active").length,
      tone: "good",
    },
    {
      label: "Open shipments",
      value: [...shipments, ...freightShipments].filter((row) =>
        isOpenStatus(row.status),
      ).length,
      tone: "attention",
    },
    {
      label: "Pending purchases",
      value: purchases.filter((row) => isOpenStatus(purchaseStatus(row)))
        .length,
      tone: "attention",
    },
    {
      label: "Support requests",
      value: support.filter((row) => isOpenStatus(row.status)).length,
      tone: "neutral",
    },
  ];
  return (
    <div className="stack">
      <div className="metric-grid">
        {metrics.map((metric) => (
          <article className={`metric ${metric.tone}`} key={metric.label}>
            <span>{metric.label}</span>
            <strong>{metric.value}</strong>
          </article>
        ))}
      </div>
      <AnalyticsView
        cars={cars}
        purchases={purchases}
        shipments={shipments}
        freightShipments={freightShipments}
        transports={transports}
        parkedCars={parkedCars}
        services={services}
      />
      <PayoutsPanel
        businessId={businessId}
        business={business}
        previewMode={previewMode}
        onOpenSupport={onOpenSupport}
        canOpenSupport={canOpenSupport}
      />
      <div className="split-grid">
        <Panel title="Needs attention" icon={<BarChart3 size={18} />}>
          <div className="row-list compact">
            {attentionRows.map((row) => (
              <DataRow
                key={`${row._path ?? row.id}`}
                title={text(
                  row.trackingCode ??
                    row.title ??
                    row.vehicleTitle ??
                    row.carTitle,
                  row.id,
                )}
                subtitle={formatDate(row.updatedAt ?? row.createdAt)}
                status={text(row.purchaseStatus ?? row.status, "pending")}
              />
            ))}
            {attentionRows.length === 0 && (
              <EmptyState text="No urgent operational items right now." />
            )}
          </div>
        </Panel>
        <Panel title="Enabled services" icon={<Building2 size={18} />}>
          <div className="tool-list">
            {Array.from(services).map((service) => (
              <span className="status-pill" key={service}>
                {serviceLabels[service] ?? service}
              </span>
            ))}
            {services.size === 0 && (
              <EmptyState text="No services are enabled yet." />
            )}
          </div>
        </Panel>
      </div>
      {(transports.length > 0 || parkedCars.length > 0) && (
        <div className="metric-grid">
          <article className="metric neutral">
            <span>Transport requests</span>
            <strong>{transports.length}</strong>
          </article>
          <article className="metric neutral">
            <span>Parked cars</span>
            <strong>{parkedCars.length}</strong>
          </article>
        </div>
      )}
    </div>
  );
}

type BusinessFeeSettings = {
  stripeFeeMode: string;
  connectReady: boolean;
  defaultPlatformFeePct: number;
  hasBusinessOverride: boolean;
};

function PayoutsPanel({
  businessId,
  business,
  previewMode = false,
  onOpenSupport,
  canOpenSupport,
}: {
  businessId: string;
  business: FirestoreRow | null;
  previewMode?: boolean;
  onOpenSupport: () => void;
  canOpenSupport: boolean;
}) {
  const [busyAction, setBusyAction] = useState<
    "" | "link" | "refresh" | "auto"
  >("");
  const [error, setError] = useState("");
  const [autoRefreshKey, setAutoRefreshKey] = useState("");
  const [feeSettings, setFeeSettings] = useState<BusinessFeeSettings | null>(
    null,
  );
  const [feeSettingsError, setFeeSettingsError] = useState("");

  useEffect(() => {
    let active = true;
    if (!businessId || previewMode) return undefined;
    httpsCallable(functions, "getBusinessFeeSettings")({businessId})
      .then((result) => {
        if (active) setFeeSettings(result.data as BusinessFeeSettings);
      })
      .catch((err) => {
        if (active) {
          setFeeSettingsError(
            err instanceof Error
              ? err.message
              : "Could not load your fee settings.",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [businessId, previewMode]);
  const payoutStatus = resolveBusinessPayoutStatus({
    stripeAccountId: business?.stripeAccountId,
    chargesEnabled: business?.chargesEnabled,
    payoutsEnabled: business?.payoutsEnabled,
  });
  const busy = busyAction !== "";

  async function connect() {
    setBusyAction("link");
    setError("");
    try {
      const href = window.location.href;
      const result = await httpsCallable(
        functions,
        "createBusinessStripeAccountLink",
      )({
        businessId,
        returnUrl: href,
        refreshUrl: href,
      });
      const url = text((result.data as {url?: string})?.url, "");
      if (!url) throw new Error("Stripe did not return an onboarding link.");
      window.location.assign(url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Could not start Stripe onboarding.",
      );
    } finally {
      setBusyAction("");
    }
  }

  const refresh = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
    setBusyAction(silent ? "auto" : "refresh");
    if (!silent) setError("");
    try {
        await httpsCallable(
          functions,
          "refreshBusinessStripeAccountStatus",
        )({ businessId });
    } catch (err) {
      if (!silent) {
          setError(
            err instanceof Error
              ? err.message
              : "Could not refresh payout status.",
          );
      }
    } finally {
      setBusyAction("");
    }
    },
    [businessId],
  );

  useEffect(() => {
    if (
      !businessId ||
      previewMode ||
      !payoutStatus.stripeAccountId ||
      payoutStatus.state !== "connected_pending"
    ) {
      return;
    }
    const key = `${businessId}:${payoutStatus.stripeAccountId}`;
    if (autoRefreshKey === key) return;
    setAutoRefreshKey(key);
    void refresh({silent: true});
  }, [autoRefreshKey, businessId, payoutStatus.state, payoutStatus.stripeAccountId, previewMode, refresh]);

  const actionLabel = busy
    ? busyAction === "refresh" || busyAction === "auto"
      ? "Checking status..."
      : "Working..."
    : payoutStatus.actionLabel;

  return (
    <Panel
      title="Payouts"
      icon={<Banknote size={18} />}
      action={
        <button
          className="lst-add"
          disabled={busy || !businessId || previewMode}
          onClick={payoutStatus.state === "ready" ? () => refresh() : connect}
          type="button"
        >
          {actionLabel}
        </button>
      }
    >
      <div className="tool-list">
        <span
          className={`status-pill ${payoutStatus.state === "ready" ? "" : "warning"}`}
        >
          {payoutStatus.primaryLabel}
        </span>
        <span
          className={`status-pill ${payoutStatus.chargesEnabled ? "" : "warning"}`}
        >
          {payoutStatus.chargesLabel}
        </span>
        {payoutStatus.stripeAccountId && (
          <span className="status-pill compact">
            {payoutStatus.stripeAccountId}
          </span>
        )}
        {payoutStatus.state === "connected_pending" && (
          <button
            className="secondary-button"
            disabled={busy || !businessId || previewMode}
            onClick={() => refresh()}
            type="button"
          >
            {payoutStatus.refreshLabel}
          </button>
        )}
      </div>
      {payoutStatus.helperText && (
        <div className="info-band">{payoutStatus.helperText}</div>
      )}
      {payoutStatus.state === "connected_pending" && (
        <div className="stripe-help-card">
          <strong>Stuck with Stripe setup?</strong>
          <p>
            Use Continue in Stripe to finish identity, tax, legal, and bank
            questions. Return here and refresh the status after submitting.
          </p>
          <div className="stripe-help-actions">
            <a
              className="secondary-button"
              href="https://support.stripe.com/questions/connect-platforms-manage-onboarding-and-risk-requirements-for-connected-accounts"
              rel="noreferrer"
              target="_blank"
            >
              Stripe help center
            </a>
            <button
              className="secondary-button"
              disabled={!canOpenSupport}
              onClick={onOpenSupport}
              type="button"
            >
              Contact Laawol support
            </button>
          </div>
          <small>
            Do not upload identity, tax, legal, or bank files to Laawol. Stripe
            must collect those details in its secure onboarding flow.
          </small>
        </div>
      )}
      {error && <div className="error-box">{error}</div>}
      {feeSettings && (
        <div className="fee-settings-card">
          <div className="fee-settings-row">
            <span>Platform fee</span>
            <strong>
              {(feeSettings.defaultPlatformFeePct * 100).toFixed(2)}%
            </strong>
          </div>
          {feeSettings.hasBusinessOverride ? (
            <span className="status-pill compact">Custom rate for your business</span>
          ) : (
            <small>May vary by service on our default rate.</small>
          )}
          <div className="fee-settings-row">
            <span>Who pays Stripe&apos;s processing fee</span>
            <strong>
              {feeSettings.stripeFeeMode === "business_absorbs_processing_fee"
                ? "You"
                : "Laawol"}
            </strong>
          </div>
          {feeSettings.stripeFeeMode === "business_absorbs_processing_fee" &&
            !feeSettings.connectReady && (
              <div className="info-band">
                Your account is set to pay Stripe&apos;s processing fee
                directly, but this only takes effect once your Stripe payout
                setup is complete - until then, payments still use the
                default (Laawol pays Stripe&apos;s fee).
              </div>
          )}
        </div>
      )}
      {feeSettingsError && (
        <div className="error-box">{feeSettingsError}</div>
      )}
    </Panel>
  );
}

function AnalyticsView({
  cars,
  purchases,
  shipments,
  freightShipments,
  transports,
  parkedCars,
  services,
}: {
  cars: FirestoreRow[];
  purchases: FirestoreRow[];
  shipments: FirestoreRow[];
  freightShipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
  services: Set<string>;
}) {
  const listingBreakdown = topStatuses(cars, "status");
  const operationBreakdown = topStatuses(
    [...shipments, ...freightShipments, ...transports, ...parkedCars],
    "status",
  );
  const purchaseBreakdown = topStatuses(purchases, "purchaseStatus");
  const earnings = useMemo(
    () =>
      summarizeBusinessEarnings({
    purchases,
    shipments,
        freightShipments,
    transports,
    parkedCars,
      }),
    [freightShipments, parkedCars, purchases, shipments, transports],
  );
  const visibleServiceRows = earnings.services.filter(
    (service) =>
      services.has(service.serviceId) ||
      service.paidTransactions > 0 ||
      service.pendingTransactions > 0,
  );
  const activeInventoryValue = cars
    .filter((row) => text(row.status, "") === "active")
    .reduce((sum, row) => sum + numericValue(row.price), 0);
  const paidHoldValue = purchases.reduce(
    (sum, row) =>
      sum + numericValue(row.depositAmount ?? row.holdDepositAmount),
    0,
  );

  return (
    <div className="stack">
      <div className="split-grid">
        <Panel title="Analytics" icon={<BarChart3 size={18} />}>
          <div className="metric-grid">
            <article className="metric money">
              <span>Active inventory value</span>
              <strong>{formatMoney(activeInventoryValue)}</strong>
            </article>
            <article className="metric money">
              <span>Hold deposits</span>
              <strong>{formatMoney(paidHoldValue)}</strong>
            </article>
          </div>
          <div className="analytics-bars">
            <AnalyticsBars title="Listings" rows={listingBreakdown} />
            <AnalyticsBars title="Purchases" rows={purchaseBreakdown} />
          </div>
        </Panel>
        <Panel title="Operations mix" icon={<ClipboardList size={18} />}>
          <AnalyticsBars
            title="Operational statuses"
            rows={operationBreakdown}
          />
        </Panel>
      </div>
      <Panel title="Business earnings" icon={<Banknote size={18} />}>
        <div className="metric-grid earnings-metrics">
          <article className="metric money">
            <span>Gross received</span>
            <strong>{formatMoney(earnings.totals.grossReceived)}</strong>
          </article>
          <article className="metric attention">
            <span>Platform fees</span>
            <strong>{formatMoney(earnings.totals.platformFees)}</strong>
          </article>
          <article className="metric good">
            <span>Business earnings</span>
            <strong>{formatMoney(earnings.totals.businessEarnings)}</strong>
          </article>
          <article className="metric neutral">
            <span>Pending payments</span>
            <strong>{formatMoney(earnings.totals.pendingGross)}</strong>
          </article>
        </div>
        <div className="list-summary">
          <span>Paid transactions</span>{" "}
          <b>{earnings.totals.paidTransactions.toLocaleString()}</b> ·{" "}
          <span>Pending transactions</span>{" "}
          <b>{earnings.totals.pendingTransactions.toLocaleString()}</b>
        </div>
        <div className="earnings-table">
          <div className="earnings-table-head">
            <span>Service</span>
            <span>Gross received</span>
            <span>Platform fees</span>
            <span>Business earnings</span>
            <span>Pending</span>
          </div>
          {visibleServiceRows.map((service) => (
            <div className="earnings-table-row" key={service.serviceId}>
              <span>
                <strong>{service.label}</strong>
                <small>
                  <span>Paid</span> {service.paidTransactions} ·{" "}
                  <span>Pending</span> {service.pendingTransactions}
                </small>
              </span>
              <span>{formatMoney(service.grossReceived)}</span>
              <span>{formatMoney(service.platformFees)}</span>
              <span>{formatMoney(service.businessEarnings)}</span>
              <span>{formatMoney(service.pendingGross)}</span>
            </div>
          ))}
        </div>
        {earnings.totals.paidTransactions === 0 &&
          earnings.totals.pendingTransactions === 0 && (
          <EmptyState text="No paid business transactions are loaded yet." />
        )}
      </Panel>
    </div>
  );
}

function AnalyticsBars({
  title,
  rows,
}: {
  title: string;
  rows: Array<[string, number]>;
}) {
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  return (
    <div className="analytics-bars">
      <div className="analytics-bar-label">
        <span>{title}</span>
        <span>{total}</span>
      </div>
      {rows.map(([label, count]) => {
        const width =
          total > 0 ? Math.max(4, Math.round((count / total) * 100)) : 0;
        return (
          <div className="analytics-bar" key={label}>
            <div className="analytics-bar-label">
              <span>{statusLabel(label)}</span>
              <span>{count}</span>
            </div>
            <div className="analytics-bar-track">
              <div
                className="analytics-bar-fill"
                style={{ width: `${width}%` }}
              />
            </div>
          </div>
        );
      })}
      {rows.length === 0 && <EmptyState text="No rows loaded yet." />}
    </div>
  );
}

function ProfileView({
  business,
  profile,
  services,
}: {
  business: FirestoreRow | null;
  profile: UserProfile;
  services: Set<string>;
}) {
  return (
    <div className="split-grid">
      <Panel title="Business profile" icon={<Building2 size={18} />}>
        <div className="business-card-body">
          <div className="person-block owner-block">
            <span>Name</span>
            <strong>
              {text(business?.name ?? profile.businessName, "Business")}
            </strong>
            <small>
              {text(
                business?.email ?? business?.phone ?? business?.website,
                "Business contact not set",
              )}
            </small>
          </div>
          <div className="business-card-meta">
            <span>
              Status: {statusLabel(text(business?.status, "pending"))}
            </span>
            <span>Updated: {formatDate(business?.updatedAt)}</span>
          </div>
        </div>
      </Panel>
      <Panel title="Services" icon={<ClipboardList size={18} />}>
        <div className="tool-list">
          {Array.from(services).map((service) => (
            <span className="status-pill" key={service}>
              {serviceLabels[service] ?? service}
            </span>
          ))}
          {services.size === 0 && (
            <EmptyState text="No enabled services found." />
          )}
        </div>
      </Panel>
    </div>
  );
}

function Panel({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: React.ReactNode;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <article className="panel">
      <div className="panel-header">
        <div>
          {icon}
          <h2>{title}</h2>
        </div>
        {action && <div className="panel-action">{action}</div>}
      </div>
      {children}
    </article>
  );
}

function DataRow({
  title,
  subtitle,
  status,
}: {
  title: string;
  subtitle: string;
  status: string;
}) {
  return (
    <article className="data-row">
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
      <span
        className={`status-pill compact ${isOpenStatus(status) ? "warning" : ""}`}
      >
        {statusLabel(status)}
      </span>
    </article>
  );
}

function EmptyState({text: message}: {text: string}) {
  return <div className="empty-state">{message}</div>;
}

function tabIcon(tab: BusinessTab) {
  const props = {size: 19};
  const icons: Record<BusinessTab, React.ReactNode> = {
    today: <BarChart3 {...props} />,
    profile: <Building2 {...props} />,
    listings: <Car {...props} />,
    purchases: <ClipboardList {...props} />,
    barrels: <Package {...props} />,
    freight: <Package {...props} />,
    transport: <Truck {...props} />,
    parking: <ParkingCircle {...props} />,
    destinations: <MapPinned {...props} />,
    people: <UserCog {...props} />,
    reviews: <Star {...props} />,
    cases: <MessageCircle {...props} />,
    growth: <Sparkles {...props} />,
  };
  return icons[tab];
}

function isOpenStatus(value: unknown) {
  const status = text(value, "").toLowerCase();
  return ![
    "",
    "completed",
    "cancelled",
    "sold",
    "inactive",
    "refunded",
    "rejected",
    "resolved",
    "closed",
  ].includes(status);
}

function purchaseStatus(row: FirestoreRow) {
  return text(row.purchaseStatus ?? row.status, "pending");
}

function topStatuses(rows: FirestoreRow[], field: string) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const value = text(row[field], "unknown").toLowerCase();
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
}

function numericValue(value: unknown) {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function hasBusinessPermission(profile: UserProfile, permission: string) {
  if (profile.role !== "staff") return true;
  const permissions = Array.isArray(profile.businessPermissions)
    ? profile.businessPermissions.map((item) => text(item, ""))
    : [];
  return permissions.includes(permission);
}

function statusLabel(value: unknown) {
  const normalized = text(value, "unknown").toLowerCase();
  const labels: Record<string, string> = {
    active: "Active",
    approved: "Approved",
    cancelled: "Cancelled",
    closed: "Closed",
    completed: "Completed",
    inactive: "Inactive",
    in_transit: "In transit",
    pending: "Pending",
    refund_pending: "Refund pending",
    refunded: "Refunded",
    rejected: "Rejected",
    reserved: "Reserved",
    resolved: "Resolved",
    sold: "Sold",
    unknown: "Unknown",
  };
  if (labels[normalized]) return labels[normalized];
  return normalized
      .split(/[_-]/)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
}

function businessStatusNotice(status: unknown) {
  return `This business is currently ${statusLabel(status).toLowerCase()}. Complete Stripe setup and any requested profile details while it waits for platform approval.`;
}
