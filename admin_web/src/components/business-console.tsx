"use client";

import { useConsoleDocumentTitle } from "@/lib/document-title";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import {
  BarChart3,
  Banknote,
  BookOpen,
  Boxes,
  Building2,
  CalendarClock,
  Car,
  ClipboardList,
  Container,
  ExternalLink,
  LogOut,
  MapPinned,
  Menu,
  MessageCircle,
  Package,
  PackageCheck,
  ParkingCircle,
  Search,
  Settings,
  Sparkles,
  Receipt,
  Star,
  Truck,
  UserCog,
} from "lucide-react";

import {AssistantWidget} from "@/components/business/assistant-widget";
import {BankZelleCard} from "@/components/business/bank-zelle-card";
import {callBank} from "@/components/business/bank-call";
import {CheckBankDialog, CheckBankHeaderEntry} from "@/components/business/check-bank-dialog";
import {canCheckBank, checkBankEntry} from "@/lib/bank-check";
import {canManageBank, readBankStatus, type BankStatus} from "@/lib/zelle-check";
import {ContainersPanel} from "@/components/business/containers-panel";
import {DeliveriesPanel} from "@/components/business/deliveries-panel";
import {BusinessVolumePanel} from "@/components/volume-views";
import {containerDeepLinkFromSearch, type ContainerDeepLink} from "@/lib/package-staff";
import {InventoryPanel} from "@/components/business/inventory-panel";
import {InvoicesPanel} from "@/components/business/invoices-panel";
import {GrowthPanel} from "@/components/business/growth-panel";
import {
  BarrelsPanel,
  DestinationsPanel,
  FreightPanel,
  ListingsPanel,
  OfficeLocationsPanel,
  ParkingPanel,
  LotLedgerPanel,
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
import { MessageCustomerProvider } from "@/components/support/message-customer";
import {
  businessSupportAccess,
  chatDisplayName,
  whatsappMessagesHint,
  whatsappMessagesOn,
} from "@/lib/whatsapp-conversations";
import { NotificationBell } from "@/components/notification-bell";
import { UserText } from "@/components/user-text";
import { ToggleRow } from "@/components/toggle-row";
import {
  inventoryNotificationPreferenceFields,
  packageNotificationPreferenceFields,
  parkedCarNotificationPreferenceFields,
  mergeNotificationPreferences,
  notificationPreferenceFields,
} from "@/lib/notification-preferences";
import {
  useBusinessCollection,
  useBusinessHasRecords,
  useBusinessStaff,
} from "@/lib/business-data";
import { useServerTotals } from "@/lib/use-server-totals";
import { Panel } from "@/components/panel";
import { TodayView } from "@/components/business/today-view";
import type { BusinessTodayResponse, TodayAttentionItem, TodayContainersView } from "@/lib/business-today";
import { previewBusinessToday } from "@/lib/business-today-preview";
import {
  buildBusinessSidebarGroups,
  businessPermissionHeld,
  businessSidebarTabs,
  containerListSteps,
  normalizePinnedTabs,
  shippingStepForTab,
  visibleBusinessTabs,
  visibleShippingSteps,
  type BusinessSidebarTab,
  type BusinessTab,
  type ShippingStep,
} from "@/lib/business-sidebar";
import {ShippingStepBar} from "@/components/business/shipping-steps";
import {MenuMovedDialog} from "@/components/business/menu-moved-dialog";
import {
  menuMovedLines,
  readMenuMovedDismissed,
  shouldShowMenuMovedNotice,
  writeMenuMovedDismissed,
} from "@/lib/menu-moved-notice";
import type {ListView} from "@/components/business/containers-panel";
import { buildBusinessVerificationChecklist } from "@/lib/business-verification";
import { db, functions } from "@/lib/firebase";
import { formatDate, text } from "@/lib/format";
import { inventoryViewerFromProfile, saleFocusFrom, type SaleFocus } from "@/lib/inventory";
import { transferFocusFrom, type TransferFocus } from "@/lib/inventory-transfers";
import {
  resolveBusinessPayoutStatus,
  type BusinessPayoutStatus,
} from "@/lib/payout-status";
import { confirmImportantAction } from "@/lib/action-confirmation";
import {
  businessTargetForNotification,
  type BusinessPanelView,
} from "@/lib/notification-routing";
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
  inventory: "Inventory",
};

const businessSidebarStorageKey = "laawol:business-sidebar-pins";

function NotificationPreferencesPanel({
  profile,
  showInventory = false,
  showParkedCars = false,
  showPackages = false,
}: {
  profile: UserProfile;
  showInventory?: boolean;
  showParkedCars?: boolean;
  showPackages?: boolean;
}) {
  const [prefs, setPrefs] = useState(() =>
    mergeNotificationPreferences(profile.notificationPreferences),
  );
  // Everyone at the business answers WhatsApp; the owner hears about new
  // messages unless they switch it off, staff once they switch it on. Always
  // saved explicitly: the server reads the raw value.
  const [whatsappOn, setWhatsappOn] = useState(() =>
    whatsappMessagesOn(profile.role, profile.notificationPreferences),
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
        notificationPreferences: { ...prefs, whatsappMessages: whatsappOn },
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
        {[
          ...notificationPreferenceFields,
          ...(showInventory ? inventoryNotificationPreferenceFields : []),
          ...(showParkedCars ? parkedCarNotificationPreferenceFields : []),
          ...(showPackages ? packageNotificationPreferenceFields : []),
        ].map((field) => (
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
        <ToggleRow
          label="WhatsApp messages"
          hint={whatsappMessagesHint(profile.role)}
          checked={whatsappOn}
          onChange={setWhatsappOn}
        />
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
  const [activeTab, setActiveTabState] = useState<BusinessTab>("today");
  // Which step of the Shipping page is open; "" = the first one this viewer
  // may open (decided once the steps are known, below).
  const [shippingStep, setShippingStep] = useState<ShippingStep | "">("");
  // Every way into a section goes through here: the old shipping tab ids
  // (Containers, Barrels, Freight, Deliveries, Volume - still named by
  // notifications, Today's rows and links) open that step of Shipping.
  const setActiveTab = useCallback((tab: BusinessTab, view = "") => {
    const step = shippingStepForTab(tab, view);
    if (step) {
      setShippingStep(step);
      setActiveTabState("shipping");
      return;
    }
    setActiveTabState(tab);
  }, []);
  useConsoleDocumentTitle("business");
  // `?container=<id>&line=<lineId>`: a package's "Open in business console"
  // on the tracking page. Read once at mount - an arrival, not a
  // subscription to the URL. Staff without the Containers tab fall back to
  // Today through the visible-tabs check below.
  const [containerLink, setContainerLink] = useState<ContainerDeepLink | null>(null);
  useEffect(() => {
    const link = containerDeepLinkFromSearch(window.location.search);
    if (!link) return;
    setContainerLink(link);
    setActiveTab("containers");
  }, [setActiveTab]);
  // Set when a notification is opened, so the destination panel can scroll to
  // and highlight the exact record instead of dropping the business into a
  // list of everything and making them hunt for it.
  const [notificationFocusId, setNotificationFocusId] = useState("");
  const [notificationFocusView, setNotificationFocusView] =
    useState<BusinessPanelView | "">("");
  const [notificationCaseId, setNotificationCaseId] = useState("");
  // An inventory sale alert: a new object per click, so tapping the same alert again re-opens its sale.
  const [notificationSale, setNotificationSale] = useState<SaleFocus | null>(null);
  // A store transfer alert: same idea, Inventory opens on Transfers with that transfer.
  const [notificationTransfer, setNotificationTransfer] = useState<TransferFocus | null>(null);
  // Leaving Inventory forgets the alert, so coming back by the sidebar opens the Products tab as usual.
  useEffect(() => {
    if (activeTab !== "inventory") {
      setNotificationSale(null);
      setNotificationTransfer(null);
    }
  }, [activeTab]);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [sidebarFilter, setSidebarFilter] = useState("");
  const [pinnedTabs, setPinnedTabs] = useState<BusinessTab[]>(readPinnedTabs);
  const [destinationSetupRequest, setDestinationSetupRequest] = useState(0);
  const [business, setBusiness] = useState<FirestoreRow | null>(
    previewBusiness,
  );
  const [businessError, setBusinessError] = useState("");
  // Only work that is actually the business's to do. A document sitting in
  // "submitted" is waiting on our review, not on them, and telling them to go
  // upload it again would be its own kind of wrong.
  const documentsOutstanding = useMemo(() => {
    if (!business) return false;
    const {summary} = buildBusinessVerificationChecklist(business);
    return summary.missing > 0 || summary.needsChanges > 0;
  }, [business]);
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

  // Check bank (docs/ZELLE_BANK_CHECK.md): the server's rule - the owner, or
  // staff who can sell (inventory permission + service) or take package
  // payments (containers). The bank's status is read once, for them only;
  // the owner's bank card keeps it current after a connect or disconnect.
  const isBankOwner = canManageBank(profile, businessId);
  const canCheck = canCheckBank({
    isOwner: isBankOwner,
    inventoryPermission: hasBusinessPermission(profile, "inventory"),
    inventoryService: services.has("inventory"),
    containersPermission: hasBusinessPermission(profile, "containers"),
  });
  const [bankStatus, setBankStatus] = useState<BankStatus | null>(null);
  const [checkBankOpen, setCheckBankOpen] = useState(false);
  const [bankFocus, setBankFocus] = useState(0);
  useEffect(() => {
    if (!businessId || !canCheck) {
      setBankStatus(null);
      return undefined;
    }
    let live = true;
    callBank("getBusinessBankStatus", {businessId}, previewMode)
      .then((data) => {
        if (live) setBankStatus(readBankStatus(data));
      })
      .catch(() => {
        if (live) setBankStatus(null);
      });
    return () => {
      live = false;
    };
  }, [businessId, canCheck, previewMode]);
  const openBankCard = useCallback(() => {
    setActiveTab("profile");
    setBankFocus((value) => value + 1);
  }, [setActiveTab]);

  const canManageListings = hasBusinessPermission(profile, "listings");
  // A business that no longer offers car sales keeps its Listings tab while
  // it still has listings. That only needs to know whether one exists: a
  // one-document probe, asked only when the service is off.
  const listingsProbe = useBusinessHasRecords(
    "cars",
    businessId,
    enabled && canManageListings && !services.has("carSales"),
  );
  const hasListings = listingsProbe.hasRecords;

  const visibleTabs = useMemo(
    () => visibleBusinessTabs(
      (id) => services.has(id),
      (permission) => hasBusinessPermission(profile, permission),
      {hasListings},
    ),
    [hasListings, profile, services],
  );
  const shippingSteps = useMemo(
    () => visibleShippingSteps(
      (id) => services.has(id),
      (permission) => hasBusinessPermission(profile, permission),
    ),
    [profile, services],
  );
  // The open step: the one asked for, when this viewer may open it;
  // otherwise the first of theirs.
  const activeShippingStep: ShippingStep | "" =
    shippingSteps.find((step) => step.id === shippingStep)?.id ??
    shippingSteps[0]?.id ??
    "";
  const [shippingCounts, setShippingCounts] = useState<Partial<Record<ShippingStep, number>>>({});
  const onContainerCounts = useCallback((counts: Record<ListView, number>) => {
    setShippingCounts((current) =>
      current.requests === counts.requests &&
      current.waiting === counts.waiting &&
      current.containers === counts.containers
        ? current
        : {...current, ...counts},
    );
  }, []);
  const onContainerView = useCallback((view: ListView) => setShippingStep(view), []);

  // "The menu has a new layout", once per person and browser, listing only
  // the moves that touch the sections this person can open.
  const menuMoved = useMemo(
    () => menuMovedLines(visibleTabs.map((tab) => tab.id), shippingSteps.map((step) => step.id)),
    [shippingSteps, visibleTabs],
  );
  const [menuMovedOpen, setMenuMovedOpen] = useState(false);
  const menuMovedChecked = useRef(false);
  useEffect(() => {
    // Decided once, after the business record (and so its services) loaded.
    if (menuMovedChecked.current || !business || menuMoved.length === 0) return;
    menuMovedChecked.current = true;
    if (shouldShowMenuMovedNotice(Date.now(), readMenuMovedDismissed(), menuMoved)) {
      setMenuMovedOpen(true);
    }
  }, [business, menuMoved]);
  const closeMenuMoved = useCallback(() => {
    writeMenuMovedDismissed();
    setMenuMovedOpen(false);
  }, []);

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
  }, [setActiveTab]);

  // Today's figures come from the server, over every record (the Volume
  // rollup, payments, aggregates): one callable, cached a few minutes and cut
  // to what this viewer may see. The local preview shows a sample instead.
  const onToday = enabled && activeTab === "today";
  const overview = useServerTotals<BusinessTodayResponse>(
    "getBusinessOverview",
    onToday ? { businessId } : null,
  );
  const previewToday = useMemo(
    () => (previewMode ? previewBusinessToday(services) : null),
    [previewMode, services],
  );
  const today = previewToday ?? overview.data?.today ?? null;
  // Where a Today row lands on the Containers tab: one container, or the
  // waiting / requests list. Forgotten on leaving the tab, so opening
  // Containers from the sidebar later shows the usual list.
  const [todayContainerFocus, setTodayContainerFocus] = useState("");
  const [todayContainersView, setTodayContainersView] = useState<TodayContainersView>("");
  useEffect(() => {
    if (activeTab !== "shipping") {
      setTodayContainerFocus("");
      setTodayContainersView("");
    }
  }, [activeTab]);
  const openTodayItem = useCallback((item: TodayAttentionItem) => {
    if (item.tab === "containers") setTodayContainersView(item.view);
    setActiveTab(item.tab, item.view);
  }, [setActiveTab]);
  // A step picked by hand forgets where a notification, a Today row or a
  // tracking link pointed: otherwise coming back to the lists would jump to
  // that record again instead of the step the person chose.
  const selectShippingStep = useCallback((step: ShippingStep) => {
    setNotificationFocusId("");
    setNotificationFocusView("");
    setTodayContainerFocus("");
    setTodayContainersView("");
    setContainerLink(null);
    setShippingStep(step);
  }, []);
  const openTodayContainer = useCallback((containerId: string) => {
    setTodayContainerFocus(containerId);
    setActiveTab("containers");
  }, [setActiveTab]);
  // Growth shows the three newest insights; that is all it reads.
  const insights = useBusinessCollection(
    "businessInsights",
    businessId,
    enabled && activeTab === "growth",
    { pageSize: 3, sort: "query" },
  );
  const staff = useBusinessStaff(businessId, enabled && activeTab === "people");
  // Unacknowledged ledger changes, newest first: the six Today shows.
  const ledgerEvents = useBusinessCollection(
    "lotLedgerAudit",
    businessId,
    onToday && services.has("carParking"),
    {
      pageSize: 6,
      orderBy: "at",
      where: [["acknowledged", "==", false]],
      sort: "query",
    },
  );

  const businessName = text(business?.name ?? profile.businessName, "Business");
  const status = text(business?.status ?? business?.businessStatus, "pending");
  const isApproved = status === "approved";
  const payoutStatus = resolveBusinessPayoutStatus({
    stripeAccountId: business?.stripeAccountId,
    chargesEnabled: business?.chargesEnabled,
    payoutsEnabled: business?.payoutsEnabled,
  });
  // Everyone opens Support for WhatsApp; reaching Laawol (an admin request)
  // and the other cases stay with the Support permission.
  const supportAccess = businessSupportAccess(hasBusinessPermission(profile, "support"));
  const canOpenSupport = supportAccess.canReplyToCases;
  // "Message customer" on a package: the conversation opens in Support.
  const messageCustomer = useMemo(() => ({
    previewMode,
    openConversation: (caseId: string) => {
      setNotificationCaseId(caseId);
      setActiveTab("cases");
    },
  }), [previewMode, setActiveTab]);

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
            {/* The dashboard is the business's own, so it wears the business's
                logo - not Laawol's. A lot without an uploaded logo gets a
                tile with its initial rather than falling back to Laawol. */}
            {text(business?.profileImageUrl, "") ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={text(business?.profileImageUrl, "")}
                alt={businessName}
                data-no-translate
                width={20}
                height={20}
                style={{ borderRadius: 5, display: "block", objectFit: "cover" }}
              />
            ) : (
              <span className="brand-initial" aria-hidden="true">
                {businessName.trim().charAt(0).toUpperCase() || "B"}
              </span>
            )}
          </div>
          <div className="topbar-heading">
            {/* The business's own name and the person's: user data, never
                run through the French dictionary ("Conakry Express Shipping"
                is not "Conakry Express Expédition"). */}
            <h1>
              <UserText value={text(business?.name ?? profile.businessName, "")} fallback="Business" />
            </h1>
            <p>
              Business dashboard ·{" "}
              <span className={`biz-status ${isApproved ? "ok" : "pending"}`}>
                {statusLabel(status)}
              </span>
            </p>
          </div>
        </div>
        <div className="topbar-actions">
          <CheckBankHeaderEntry
            entry={checkBankEntry(bankStatus, canCheck, isBankOwner)}
            onOpen={() => setCheckBankOpen(true)}
            onOpenSettings={openBankCard}
          />
          <div className="admin-chip" title="Signed-in account">
            <UserCog size={18} />
            <span className="admin-chip-name">
              <UserText value={text(profile.fullName ?? firebaseUser.email, "")} fallback="Business user" />
            </span>
            <span className="admin-role-tag">
              {profile.role === "businessOwner" ? "Owner" : "Staff"}
            </span>
          </div>
          <NotificationBell
            enabled={Boolean(firebaseUser.uid) && !previewMode}
            onSelect={(data) => {
              const target = businessTargetForNotification(data);
              setActiveTab(target.tab, target.panelView ?? "");
              setNotificationFocusId(target.focusId ?? "");
              setNotificationFocusView(target.panelView ?? "");
              setNotificationCaseId(target.caseId ?? "");
              setNotificationSale(
                target.panelView === "sales"
                  ? saleFocusFrom(target.focusId, target.storeId, Date.now())
                  : null,
              );
              setNotificationTransfer(
                target.panelView === "transfers"
                  ? transferFocusFrom(target.focusId, Date.now())
                  : null,
              );
              if (target.panelView === "bank") setBankFocus((value) => value + 1);
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

        <MessageCustomerProvider value={messageCustomer}>
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
              {businessStatusNotice(
                status,
                payoutStatus.state === "ready",
                documentsOutstanding,
              )}
            </div>
          )}

          {activeTab === "today" && (
            <TodayView
              ledgerEvents={ledgerEvents.rows}
              onOpenAttention={openTodayItem}
              onOpenContainer={openTodayContainer}
              onOpenLedger={() => setActiveTab("ledger")}
              previewMode={previewMode}
              state={{
                computedAtMs: overview.data?.computedAtMs ?? null,
                complete: overview.data?.complete !== false,
                loading: overview.loading,
                error: overview.error,
                refresh: () => overview.refresh(true),
              }}
              today={today}
            >
              <PayoutsPanel
                businessId={businessId}
                business={business}
                previewMode={previewMode}
                onOpenSupport={() => setActiveTab("cases")}
                canOpenSupport={canOpenSupport}
              />
            </TodayView>
          )}
          {activeTab === "profile" && (
            <>
              <BusinessProfilePanel businessId={businessId} business={business} />
              {isBankOwner && (
                <BankZelleCard
                  businessId={businessId}
                  enabled={enabled || previewMode}
                  previewMode={previewMode}
                  onStatus={setBankStatus}
                  focusRequest={bankFocus}
                />
              )}
              <NotificationPreferencesPanel
                profile={profile}
                showInventory={visibleTabs.some((tab) => tab.id === "inventory")}
                // Staff activity alerts reach owners and the staff of that area:
                // the parking tab, or the containers / deliveries tabs.
                showParkedCars={visibleTabs.some((tab) => tab.id === "parking")}
                showPackages={visibleTabs.some((tab) => tab.id === "containers" || tab.id === "deliveries")}
              />
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
            <PurchasesPanel
              businessId={businessId}
              focusRecordId={notificationFocusId}
              previewMode={previewMode}
            />
          )}
          {activeTab === "viewings" && (
            <PurchasesPanel
              businessId={businessId}
              focusRecordId={notificationFocusId}
              previewMode={previewMode}
              scope="viewings"
            />
          )}
          {activeTab === "transport" && (
            <TransportPanel
              businessId={businessId}
              focusRequestId={notificationFocusId}
              focusView={notificationFocusView}
              previewMode={previewMode}
            />
          )}
          {activeTab === "parking" && (
            <ParkingPanel
              businessId={businessId}
              previewMode={previewMode}
              businessName={businessName}
              business={business}
              focusRecordId={notificationFocusId}
              focusView={notificationFocusView}
              canManageLedger={hasBusinessPermission(profile, "ledger")}
            />
          )}
          {activeTab === "ledger" && (
            <LotLedgerPanel
              businessId={businessId}
              businessName={businessName}
              business={business}
              previewMode={previewMode}
              focusRecordId={notificationFocusId}
            />
          )}
          {activeTab === "shipping" && activeShippingStep && (
            <div className="shipping-page">
              <ShippingStepBar
                active={activeShippingStep}
                counts={shippingCounts}
                onSelect={selectShippingStep}
                steps={shippingSteps}
              />
              {containerListSteps.includes(activeShippingStep) && (
                <ContainersPanel
                  businessId={businessId}
                  business={business}
                  previewMode={previewMode}
                  view={activeShippingStep as ListView}
                  onViewChange={onContainerView}
                  onCounts={onContainerCounts}
                  // A deep link names the container; a "number isn't mine"
                  // notification names only the line, and the panel finds it.
                  focusContainerId={
                    notificationFocusView === "line"
                      ? ""
                      : todayContainerFocus || (containerLink?.containerId ?? "")
                  }
                  focusLineId={
                    notificationFocusView === "line"
                      ? notificationFocusId
                      : containerLink?.lineId ?? ""
                  }
                  focusView={notificationFocusView === "requests" ? "requests" : todayContainersView}
                  focusRequestId={notificationFocusView === "requests" ? notificationFocusId : ""}
                />
              )}
              {activeShippingStep === "deliveries" && (
                <DeliveriesPanel firebaseUser={firebaseUser} profile={profile} previewMode={previewMode} />
              )}
              {activeShippingStep === "barrels" && (
                <BarrelsPanel
                  businessId={businessId}
                  focusRecordId={notificationFocusId}
                  previewMode={previewMode}
                  onOpenDestinations={openDestinationSetup}
                />
              )}
              {activeShippingStep === "freight" && (
                <FreightPanel
                  businessId={businessId}
                  focusRecordId={notificationFocusId}
                  focusView={notificationFocusView}
                  previewMode={previewMode}
                />
              )}
              {activeShippingStep === "volume" && (
                <BusinessVolumePanel businessId={businessId} previewMode={previewMode} />
              )}
            </div>
          )}
          {activeTab === "invoices" && (
            <InvoicesPanel
              businessId={businessId}
              businessName={businessName}
              business={business}
              previewMode={previewMode}
            />
          )}
          {activeTab === "inventory" && (
            <InventoryPanel
              businessId={businessId}
              business={business}
              previewMode={previewMode}
              viewer={inventoryViewerFromProfile(profile)}
              viewerUid={firebaseUser.uid}
              focusSale={notificationSale}
              focusTransfer={notificationTransfer}
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
                    Extra offices are optional. Customers use headquarters
                    unless you add more drop-off locations.
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
              canLinkParking={profile.role === "businessOwner" || profile.role === "admin"}
            />
          )}
          {activeTab === "reviews" && (
            <ReviewsPanel businessId={businessId} business={business} previewMode={previewMode} />
          )}
          {activeTab === "cases" && (
            <SupportCasesPanel
              scope="business"
              businessId={businessId}
              enabled={!previewMode}
              caseId={notificationCaseId}
              currentUid={firebaseUser.uid}
              currentName={text(
                profile.fullName ?? firebaseUser.email,
                "Business",
              )}
              canReply={supportAccess.canReplyToCases}
              whatsappOnly={supportAccess.whatsappOnly}
              chatName={chatDisplayName(profile)}
              previewMode={previewMode}
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
        </MessageCustomerProvider>
      </main>

      {/* Mounted once for the whole console so the assistant floats over every
          tab and keeps its conversation while the business navigates. */}
      <AssistantWidget businessId={businessId} previewMode={previewMode} />
      {menuMovedOpen && (
        <MenuMovedDialog
          canOpenShipping={visibleTabs.some((tab) => tab.id === "shipping")}
          lines={menuMoved}
          onClose={closeMenuMoved}
          onOpenShipping={() => {
            closeMenuMoved();
            setActiveTab("shipping");
          }}
        />
      )}
      {checkBankOpen && (
        <CheckBankDialog businessId={businessId} previewMode={previewMode} onClose={() => setCheckBankOpen(false)} />
      )}
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
  const [autoCheckFailed, setAutoCheckFailed] = useState(false);
  const lastAutoCheck = useRef(0);
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
        setAutoCheckFailed(false);
    } catch (err) {
      if (silent) {
        // A silently swallowed failure here is indistinguishable from
        // "Stripe still says no": the business finishes onboarding and this
        // panel goes on telling them to finish onboarding, forever, with no
        // hint that the check itself never ran.
        setAutoCheckFailed(true);
      } else {
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
    lastAutoCheck.current = Date.now();
    void refresh({silent: true});
  }, [autoRefreshKey, businessId, payoutStatus.state, payoutStatus.stripeAccountId, previewMode, refresh]);

  // Stripe onboarding is finished on Stripe's own site, so the answer almost
  // always arrives while this tab is in the background. The once-per-account
  // check above has already run by then and will not run again, which is why
  // a business that has genuinely finished still gets told to finish. Check
  // again whenever they come back to the tab.
  useEffect(() => {
    if (!businessId || previewMode || payoutStatus.state === "ready") return;
    function recheck() {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastAutoCheck.current < 10_000) return;
      lastAutoCheck.current = now;
      void refresh({silent: true});
    }
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    return () => {
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [businessId, payoutStatus.state, previewMode, refresh]);

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
      {autoCheckFailed && payoutStatus.state !== "ready" && (
        <div className="info-band">
          We could not check your Stripe status automatically, so the status
          above may be out of date. If you have finished with Stripe, press
          {" "}<strong>{payoutStatus.refreshLabel}</strong>.
        </div>
      )}
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
              <UserText value={text(business?.name ?? profile.businessName, "")} fallback="Business" />
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
    viewings: <CalendarClock {...props} />,
    barrels: <Package {...props} />,
    freight: <Package {...props} />,
    transport: <Truck {...props} />,
    parking: <ParkingCircle {...props} />,
    ledger: <BookOpen {...props} />,
    containers: <Container {...props} />,
    deliveries: <PackageCheck {...props} />,
    volume: <BarChart3 {...props} />,
    invoices: <Receipt {...props} />,
    inventory: <Boxes {...props} />,
    destinations: <MapPinned {...props} />,
    people: <UserCog {...props} />,
    reviews: <Star {...props} />,
    cases: <MessageCircle {...props} />,
    growth: <Sparkles {...props} />,
    shipping: <Container {...props} />,
  };
  return icons[tab];
}

function hasBusinessPermission(profile: UserProfile, permission: string) {
  if (profile.role !== "staff") return true;
  const permissions = Array.isArray(profile.businessPermissions)
    ? profile.businessPermissions.map((item) => text(item, ""))
    : [];
  return businessPermissionHeld(permissions, permission);
}

function statusLabel(value: unknown) {
  const normalized = text(value, "unknown").toLowerCase();
  const labels: Record<string, string> = {
    active: "Active",
    approved: "Approved",
    // The freight lifecycle statuses land on this dashboard too. Each label
    // must be an exact french-dom dictionary key: the fallback below Title-
    // Cases unknown statuses, which misses the dictionary and lets the
    // substring pass mangle them word by word ("Awaiting Poids Confirmation").
    awaiting_balance_payment: "Awaiting balance payment",
    awaiting_weight_confirmation: "Awaiting weight confirmation",
    cancelled: "Cancelled",
    closed: "Closed",
    completed: "Completed",
    inactive: "Inactive",
    in_transit: "In transit",
    pending: "Pending",
    pending_payment: "Pending payment",
    ready_for_pickup: "Ready for pickup",
    refund_pending: "Refund pending",
    refunded: "Refunded",
    rejected: "Rejected",
    reserved: "Reserved",
    resolved: "Resolved",
    settlement_processing: "Settlement processing",
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

/**
 * What the business still has to do, in one sentence.
 *
 * Stripe is only half of getting approved: the platform also requires a
 * document per service (shipping authority, dealer license, transport
 * insurance...). Saying "nothing more is needed" the moment Stripe goes green
 * is as wrong as the old copy that demanded Stripe setup after it was done -
 * a business would sit and wait for an approval that cannot come until they
 * upload something nobody told them about.
 */
function businessStatusNotice(
  status: unknown,
  stripeReady = false,
  documentsOutstanding = false,
) {
  const state = statusLabel(status).toLowerCase();
  if (!stripeReady) {
    return `This business is currently ${state}. Complete Stripe setup and any requested profile details while it waits for platform approval.`;
  }
  if (documentsOutstanding) {
    return `This business is currently ${state}. Stripe setup is complete. Open Profile to upload the verification documents we still need before it can be approved.`;
  }
  return `This business is currently ${state}. Stripe setup and your documents are in, so nothing more is needed from you while it waits for platform approval.`;
}
