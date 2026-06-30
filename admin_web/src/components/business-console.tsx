"use client";

import { useEffect, useMemo, useState } from "react";
import type { User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  BarChart3,
  Banknote,
  Building2,
  Car,
  ClipboardList,
  LifeBuoy,
  LogOut,
  MapPinned,
  Menu,
  MessageCircle,
  Package,
  ParkingCircle,
  Sparkles,
  Truck,
  UserCog,
} from "lucide-react";

import {GrowthPanel} from "@/components/business/growth-panel";
import {
  BarrelsPanel,
  DestinationsPanel,
  ListingsPanel,
  ParkingPanel,
  PurchasesPanel,
  TransportPanel,
} from "@/components/business/operations-panels";
import {
  BusinessPeoplePanel,
  BusinessProfilePanel,
  BusinessSupportPanel,
} from "@/components/business/profile-support-people";
import { SupportCasesPanel } from "@/components/support/support-cases-panel";
import {
  useBusinessCollection,
  useBusinessStaff,
} from "@/lib/business-data";
import { db, functions } from "@/lib/firebase";
import { formatDate, formatMoney, text } from "@/lib/format";
import type { FirestoreRow, UserProfile } from "@/types/admin";

type BusinessTab =
  | "today"
  | "profile"
  | "listings"
  | "purchases"
  | "barrels"
  | "transport"
  | "parking"
  | "destinations"
  | "people"
  | "cases"
  | "support"
  | "growth";

type BusinessConsoleProps = {
  firebaseUser: User;
  profile: UserProfile;
  onSignOut: () => Promise<void> | void;
};

const serviceLabels: Record<string, string> = {
  barrelShipping: "Barrel shipping",
  sharedBarrels: "Shared barrels",
  carSales: "Car sales",
  carTransport: "Car transport",
  carParking: "Car parking",
};

const tabConfig: Array<{
  id: BusinessTab;
  label: string;
  description: string;
  service?: string;
  permission?: string;
}> = [
  {id: "today", label: "Today", description: "Needs attention"},
  {id: "profile", label: "Business", description: "Profile and services", permission: "profile"},
  {id: "listings", label: "Listings", description: "Vehicles for sale", service: "carSales", permission: "listings"},
  {id: "purchases", label: "Purchases", description: "Holds and buyers", service: "carSales", permission: "purchases"},
  {id: "barrels", label: "Barrels", description: "Shipping queue", service: "barrelShipping", permission: "barrels"},
  {id: "transport", label: "Transport", description: "Vehicle moves", service: "carTransport", permission: "transport"},
  {id: "parking", label: "Parking", description: "Stored cars", service: "carParking", permission: "parking"},
  {id: "destinations", label: "Destinations", description: "Country pricing", service: "barrelShipping", permission: "destinations"},
  {id: "people", label: "People", description: "Owners and staff", permission: "people"},
  {id: "cases", label: "Customer support", description: "Order conversations", permission: "support"},
  {id: "support", label: "Platform help", description: "Requests and replies", permission: "support"},
  {id: "growth", label: "Growth", description: "Plan and AI advisor", permission: "growth"},
];

export function BusinessConsole({
  firebaseUser,
  profile,
  onSignOut,
}: BusinessConsoleProps) {
  const businessId = text(profile.businessId, "");
  const [activeTab, setActiveTab] = useState<BusinessTab>("today");
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [business, setBusiness] = useState<FirestoreRow | null>(null);
  const [businessError, setBusinessError] = useState("");
  const enabled = Boolean(businessId);

  useEffect(() => {
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
  }, [businessId]);

  const services = useMemo(() => {
    const raw = Array.isArray(business?.enabledServices)
      ? business?.enabledServices
      : profile.businessServices;
    return new Set((Array.isArray(raw) ? raw : []).map((item) => text(item, "")));
  }, [business?.enabledServices, profile.businessServices]);

  const canManageListings = hasBusinessPermission(profile, "listings");
  const cars = useBusinessCollection("cars", businessId, enabled && canManageListings, null);

  const visibleTabs = useMemo(() => {
    return tabConfig.filter((tab) => {
      const serviceAllowed = !tab.service ||
        services.has(tab.service) ||
        (tab.id === "listings" && cars.rows.length > 0);
      const permissionAllowed = !tab.permission ||
        hasBusinessPermission(profile, tab.permission);
      return serviceAllowed && permissionAllowed;
    });
  }, [cars.rows.length, profile, services]);

  useEffect(() => {
    if (!visibleTabs.some((tab) => tab.id === activeTab)) {
      setActiveTab("today");
    }
  }, [activeTab, visibleTabs]);

  const purchases = useBusinessCollection("carPurchases", businessId, enabled && services.has("carSales"), 500);
  const shipments = useBusinessCollection("barrelShipments", businessId, enabled && services.has("barrelShipping"), 500);
  const transports = useBusinessCollection("transportRequests", businessId, enabled && services.has("carTransport"), 500);
  const parkedCars = useBusinessCollection("parkedCars", businessId, enabled && services.has("carParking"), 500);
  const support = useBusinessCollection("businessSupportRequests", businessId, enabled, 300);
  const insights = useBusinessCollection("businessInsights", businessId, enabled, 50);
  const staff = useBusinessStaff(businessId, enabled, 200);

  const businessName = text(business?.name ?? profile.businessName, "Business");
  const status = text(business?.status ?? business?.businessStatus, "pending");
  const isApproved = status === "approved";
  const attentionRows = [
    ...shipments.rows.filter((row) => isOpenStatus(row.status)).slice(0, 3),
    ...purchases.rows.filter((row) => isOpenStatus(purchaseStatus(row))).slice(0, 3),
    ...transports.rows.filter((row) => isOpenStatus(row.status)).slice(0, 3),
    ...parkedCars.rows.filter((row) => isOpenStatus(row.status)).slice(0, 3),
  ].slice(0, 8);

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-title">
          <button
            className="sidebar-toggle topbar-menu"
            onClick={() => setSidebarCollapsed((value) => !value)}
            title={sidebarCollapsed ? "Expand navigation" : "Collapse navigation"}
            type="button"
          >
            <Menu size={20} />
          </button>
          <div className="brand-badge">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/logo.png" alt="Laawol" width={20} height={20} style={{ borderRadius: 5, display: "block" }} />
            <span>Laawol Digital</span>
          </div>
          <div className="topbar-heading">
            <h1>{businessName}</h1>
            <p>Business dashboard · <span className={`biz-status ${isApproved ? "ok" : "pending"}`}>{statusLabel(status)}</span></p>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="admin-chip" title="Signed-in account">
            <UserCog size={18} />
            <span className="admin-chip-name">{text(profile.fullName ?? firebaseUser.email, "Business user")}</span>
            <span className="admin-role-tag">{profile.role === "businessOwner" ? "Owner" : "Staff"}</span>
          </div>
          <button className="icon-button" onClick={onSignOut} title="Sign out" type="button">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className={`workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <nav className="sidebar" aria-label="Business sections">
          <div className="nav-group">
            <span className="nav-group-label">Workspace</span>
            {visibleTabs.map((tab) => (
              <button
                className={activeTab === tab.id ? "active" : ""}
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                title={tab.label}
                type="button"
              >
                {tabIcon(tab.id)}
                <span className="nav-text">
                  <b>{tab.label}</b>
                  <small>{tab.description}</small>
                </span>
              </button>
            ))}
          </div>
        </nav>

        <section className="content">
          {(businessError || !businessId) && <div className="error-box">{businessError || "Business account is not configured."}</div>}
          {!isApproved && businessId && (
            <div className="info-band">
              This business is currently {statusLabel(status).toLowerCase()}. You can review setup data here while it waits for platform approval.
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
              transports={transports.rows}
              parkedCars={parkedCars.rows}
              support={support.rows}
              services={services}
            />
          )}
          {activeTab === "profile" && (
            <BusinessProfilePanel businessId={businessId} business={business} />
          )}
          {activeTab === "listings" && (
            <ListingsPanel
              businessId={businessId}
              businessName={businessName}
              businessStatus={status}
              businessProfileImageUrl={text(business?.profileImageUrl, "")}
              enabledServices={Array.from(services)}
            />
          )}
          {activeTab === "purchases" && (
            <PurchasesPanel businessId={businessId} />
          )}
          {activeTab === "barrels" && (
            <BarrelsPanel businessId={businessId} />
          )}
          {activeTab === "transport" && (
            <TransportPanel businessId={businessId} />
          )}
          {activeTab === "parking" && (
            <ParkingPanel businessId={businessId} businessName={businessName} />
          )}
          {activeTab === "destinations" && (
            <DestinationsPanel businessId={businessId} />
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
          {activeTab === "cases" && (
            <SupportCasesPanel
              scope="business"
              businessId={businessId}
              currentUid={firebaseUser.uid}
              currentName={text(profile.fullName ?? firebaseUser.email, "Business")}
              canReply={hasBusinessPermission(profile, "support")}
            />
          )}
          {activeTab === "support" && (
            <BusinessSupportPanel
              businessId={businessId}
              rows={support.rows}
              loading={support.loading}
              error={support.error}
            />
          )}
          {activeTab === "growth" && (
            <GrowthPanel
              businessId={businessId}
              business={business}
              insights={insights.rows}
              loading={insights.loading}
              error={insights.error}
            />
          )}
        </section>
      </main>
    </div>
  );
}

function TodayView({
  businessId,
  business,
  attentionRows,
  cars,
  purchases,
  shipments,
  transports,
  parkedCars,
  support,
  services,
}: {
  businessId: string;
  business: FirestoreRow | null;
  attentionRows: FirestoreRow[];
  cars: FirestoreRow[];
  purchases: FirestoreRow[];
  shipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
  support: FirestoreRow[];
  services: Set<string>;
}) {
  const metrics = [
    {label: "Active listings", value: cars.filter((row) => row.status === "active").length, tone: "good"},
    {label: "Open shipments", value: shipments.filter((row) => isOpenStatus(row.status)).length, tone: "attention"},
    {label: "Pending purchases", value: purchases.filter((row) => isOpenStatus(purchaseStatus(row))).length, tone: "attention"},
    {label: "Support requests", value: support.filter((row) => isOpenStatus(row.status)).length, tone: "neutral"},
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
        transports={transports}
        parkedCars={parkedCars}
      />
      <PayoutsPanel businessId={businessId} business={business} />
      <div className="split-grid">
        <Panel title="Needs attention" icon={<BarChart3 size={18} />}>
          <div className="row-list compact">
            {attentionRows.map((row) => (
              <DataRow
                key={`${row._path ?? row.id}`}
                title={text(row.trackingCode ?? row.title ?? row.vehicleTitle ?? row.carTitle, row.id)}
                subtitle={formatDate(row.updatedAt ?? row.createdAt)}
                status={text(row.purchaseStatus ?? row.status, "pending")}
              />
            ))}
            {attentionRows.length === 0 && <EmptyState text="No urgent operational items right now." />}
          </div>
        </Panel>
        <Panel title="Enabled services" icon={<Building2 size={18} />}>
          <div className="tool-list">
            {Array.from(services).map((service) => (
              <span className="status-pill" key={service}>{serviceLabels[service] ?? service}</span>
            ))}
            {services.size === 0 && <EmptyState text="No services are enabled yet." />}
          </div>
        </Panel>
      </div>
      {(transports.length > 0 || parkedCars.length > 0) && (
        <div className="metric-grid">
          <article className="metric neutral"><span>Transport requests</span><strong>{transports.length}</strong></article>
          <article className="metric neutral"><span>Parked cars</span><strong>{parkedCars.length}</strong></article>
        </div>
      )}
    </div>
  );
}

function PayoutsPanel({
  businessId,
  business,
}: {
  businessId: string;
  business: FirestoreRow | null;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const payoutsEnabled = business?.payoutsEnabled === true;
  const chargesEnabled = business?.chargesEnabled === true;
  const stripeAccountId = text(business?.stripeAccountId, "");

  async function connect() {
    setBusy(true);
    setError("");
    try {
      const href = window.location.href;
      const result = await httpsCallable(functions, "createBusinessStripeAccountLink")({
        businessId,
        returnUrl: href,
        refreshUrl: href,
      });
      const url = text((result.data as {url?: string})?.url, "");
      if (!url) throw new Error("Stripe did not return an onboarding link.");
      window.location.assign(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start Stripe onboarding.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    setBusy(true);
    setError("");
    try {
      await httpsCallable(functions, "refreshBusinessStripeAccountStatus")({
        businessId,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not refresh payout status.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Panel
      title="Payouts"
      icon={<Banknote size={18} />}
      action={
        <button className="lst-add" disabled={busy || !businessId} onClick={payoutsEnabled ? refresh : connect} type="button">
          {busy ? "Working..." : payoutsEnabled ? "Refresh" : stripeAccountId ? "Continue setup" : "Connect bank account"}
        </button>
      }
    >
      <div className="tool-list">
        <span className={`status-pill ${payoutsEnabled ? "" : "warning"}`}>
          {payoutsEnabled ? "Payouts enabled" : "Payout setup required"}
        </span>
        <span className={`status-pill ${chargesEnabled ? "" : "warning"}`}>
          {chargesEnabled ? "Charges verified" : "Charges not verified"}
        </span>
        {stripeAccountId && <span className="status-pill compact">{stripeAccountId}</span>}
      </div>
      {error && <div className="error-box">{error}</div>}
    </Panel>
  );
}

function AnalyticsView({
  cars,
  purchases,
  shipments,
  transports,
  parkedCars,
}: {
  cars: FirestoreRow[];
  purchases: FirestoreRow[];
  shipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
}) {
  const listingBreakdown = topStatuses(cars, "status");
  const operationBreakdown = topStatuses([...shipments, ...transports, ...parkedCars], "status");
  const purchaseBreakdown = topStatuses(purchases, "purchaseStatus");
  const activeInventoryValue = cars
    .filter((row) => text(row.status, "") === "active")
    .reduce((sum, row) => sum + numericValue(row.price), 0);
  const paidHoldValue = purchases
    .reduce((sum, row) => sum + numericValue(row.depositAmount ?? row.holdDepositAmount), 0);

  return (
    <div className="split-grid">
      <Panel title="Analytics" icon={<BarChart3 size={18} />}>
        <div className="metric-grid">
          <article className="metric money"><span>Active inventory value</span><strong>{formatMoney(activeInventoryValue)}</strong></article>
          <article className="metric money"><span>Hold deposits</span><strong>{formatMoney(paidHoldValue)}</strong></article>
        </div>
        <div className="analytics-bars">
          <AnalyticsBars title="Listings" rows={listingBreakdown} />
          <AnalyticsBars title="Purchases" rows={purchaseBreakdown} />
        </div>
      </Panel>
      <Panel title="Operations mix" icon={<ClipboardList size={18} />}>
        <AnalyticsBars title="Operational statuses" rows={operationBreakdown} />
      </Panel>
    </div>
  );
}

function AnalyticsBars({title, rows}: {title: string; rows: Array<[string, number]>}) {
  const total = rows.reduce((sum, [, count]) => sum + count, 0);
  return (
    <div className="analytics-bars">
      <div className="analytics-bar-label"><span>{title}</span><span>{total}</span></div>
      {rows.map(([label, count]) => {
        const width = total > 0 ? Math.max(4, Math.round((count / total) * 100)) : 0;
        return (
          <div className="analytics-bar" key={label}>
            <div className="analytics-bar-label"><span>{statusLabel(label)}</span><span>{count}</span></div>
            <div className="analytics-bar-track"><div className="analytics-bar-fill" style={{width: `${width}%`}} /></div>
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
            <strong>{text(business?.name ?? profile.businessName, "Business")}</strong>
            <small>{text(business?.email ?? business?.phone ?? business?.website, "Business contact not set")}</small>
          </div>
          <div className="business-card-meta">
            <span>Status: {statusLabel(text(business?.status, "pending"))}</span>
            <span>Updated: {formatDate(business?.updatedAt)}</span>
          </div>
        </div>
      </Panel>
      <Panel title="Services" icon={<ClipboardList size={18} />}>
        <div className="tool-list">
          {Array.from(services).map((service) => (
            <span className="status-pill" key={service}>{serviceLabels[service] ?? service}</span>
          ))}
          {services.size === 0 && <EmptyState text="No enabled services found." />}
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
      <span className={`status-pill compact ${isOpenStatus(status) ? "warning" : ""}`}>{statusLabel(status)}</span>
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
    transport: <Truck {...props} />,
    parking: <ParkingCircle {...props} />,
    destinations: <MapPinned {...props} />,
    people: <UserCog {...props} />,
    cases: <MessageCircle {...props} />,
    support: <LifeBuoy {...props} />,
    growth: <Sparkles {...props} />,
  };
  return icons[tab];
}

function isOpenStatus(value: unknown) {
  const status = text(value, "").toLowerCase();
  return !["", "completed", "cancelled", "sold", "inactive", "refunded", "rejected", "resolved", "closed"].includes(status);
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
  return permissions.length === 0 || permissions.includes(permission);
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
