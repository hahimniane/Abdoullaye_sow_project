"use client";

import {
  FormEvent,
  ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  PhoneAuthProvider,
  RecaptchaVerifier,
  User,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  updatePhoneNumber,
} from "firebase/auth";
import {
  collection,
  collectionGroup,
  doc,
  getDoc,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
} from "firebase/firestore";
import { httpsCallable } from "firebase/functions";
import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import {
  Activity,
  ArrowUpRight,
  BadgeDollarSign,
  Building2,
  Car,
  Check,
  ClipboardList,
  DatabaseZap,
  LogOut,
  Menu,
  Package,
  RefreshCw,
  Search,
  Send,
  Shield,
  SlidersHorizontal,
  Store,
  Truck,
  UserCog,
  Users,
  X,
} from "lucide-react";

import { auth, db, functions, storage } from "@/lib/firebase";
import { asDate, formatDate, formatMoney, text } from "@/lib/format";
import type { FirestoreRow, Role, UserProfile } from "@/types/admin";

const tabs = [
  "today",
  "businesses",
  "people",
  "marketplace",
  "operations",
  "finance",
  "website",
  "tools",
  "settings",
] as const;

type Tab = (typeof tabs)[number];

const navGroups: Array<{ label: string; tabs: Tab[] }> = [
  { label: "Overview", tabs: ["today"] },
  { label: "Network", tabs: ["businesses", "people"] },
  { label: "Queues", tabs: ["marketplace", "operations", "finance"] },
  { label: "System", tabs: ["website", "tools", "settings"] },
];

const accountRoleOptions: Role[] = ["admin", "customer"];
const businessRoleOptions = ["businessOwner", "staff"] as const;

// ---- Admin roles & privileges (RBAC) ----
// Roles are fully dynamic: super admins create/edit them in Settings and they
// are stored in Firestore (platformConfig/permissions). Each role grants each
// console SECTION an access level ("none" | "view" | "manage") AND may be
// limited to a set of platform SERVICES. The backend reads the same config.
type AdminCapability = "users" | "businesses" | "marketplace" | "operations" | "finance" | "support" | "website";
type AccessLevel = "none" | "view" | "manage";

const EDITABLE_SECTIONS: Array<{ tab: Tab; key: string; cap: AdminCapability; label: string }> = [
  { tab: "people", key: "people", cap: "users", label: "People & access" },
  { tab: "businesses", key: "businesses", cap: "businesses", label: "Businesses" },
  { tab: "marketplace", key: "marketplace", cap: "marketplace", label: "Marketplace" },
  { tab: "operations", key: "operations", cap: "operations", label: "Operations" },
  { tab: "finance", key: "finance", cap: "finance", label: "Finance" },
  { tab: "website", key: "website", cap: "website", label: "Website" },
];
const EDITABLE_CAPS: Array<{ key: string; cap: AdminCapability; label: string }> = [
  { key: "support", cap: "support", label: "Reply to support requests" },
];
const ACCESS_LEVELS: AccessLevel[] = ["none", "view", "manage"];

// Canonical platform services a role can be scoped to.
const PLATFORM_SERVICES: Array<{ id: string; label: string }> = [
  { id: "barrelShipping", label: "Barrel shipping" },
  { id: "carSales", label: "Car sales" },
  { id: "carTransport", label: "Car transport" },
  { id: "carParking", label: "Car parking" },
];

type RoleConfig = {
  label: string;
  builtIn?: boolean;
  sections: Record<string, AccessLevel>;
  services: string[]; // empty = all services
};
type PermissionsConfig = { roles?: Record<string, RoleConfig> };

const ROLE_LABELS_BUILTIN: Record<string, string> = {
  superAdmin: "Super admin",
  operationsManager: "Operations manager",
  financeManager: "Finance manager",
  supportAdmin: "Support admin",
  contentManager: "Content manager",
};

const DEFAULT_ROLES: Record<string, RoleConfig> = {
  operationsManager: { label: "Operations manager", builtIn: true, services: [], sections: { people: "view", businesses: "manage", marketplace: "manage", operations: "manage", finance: "none", website: "manage", support: "manage" } },
  financeManager: { label: "Finance manager", builtIn: true, services: [], sections: { people: "view", businesses: "none", marketplace: "none", operations: "view", finance: "manage", website: "none", support: "manage" } },
  supportAdmin: { label: "Support admin", builtIn: true, services: [], sections: { people: "view", businesses: "view", marketplace: "view", operations: "view", finance: "none", website: "none", support: "manage" } },
  contentManager: { label: "Content manager", builtIn: true, services: [], sections: { people: "view", businesses: "view", marketplace: "none", operations: "none", finance: "none", website: "manage", support: "none" } },
};

const SUPER_ADMIN_TABS: Tab[] = [
  "today", "businesses", "people", "marketplace", "operations", "finance", "website", "tools", "settings",
];

type Perms = {
  role: string;
  label: string;
  tabs: Tab[];
  can: (capability: AdminCapability) => boolean;
  services: string[] | null; // null = all services
  canService: (serviceId: string) => boolean;
};

// Built-in defaults overlaid with any stored config (custom + edited roles).
function mergedRoles(config: PermissionsConfig | null): Record<string, RoleConfig> {
  const roles: Record<string, RoleConfig> = {};
  for (const [key, value] of Object.entries(DEFAULT_ROLES)) {
    roles[key] = { ...value, sections: { ...value.sections }, services: [...value.services] };
  }
  for (const [key, value] of Object.entries(config?.roles ?? {})) {
    const base = roles[key];
    roles[key] = {
      label: text(value.label, base?.label ?? key),
      builtIn: base?.builtIn ?? false,
      sections: { ...(base?.sections ?? {}), ...(value.sections ?? {}) },
      services: Array.isArray(value.services) ? value.services : base?.services ?? [],
    };
  }
  return roles;
}

function roleLabel(roleKey: string, config: PermissionsConfig | null): string {
  if (roleKey === "superAdmin") return ROLE_LABELS_BUILTIN.superAdmin;
  return mergedRoles(config)[roleKey]?.label ?? ROLE_LABELS_BUILTIN[roleKey] ?? roleKey;
}

function roleOptionList(config: PermissionsConfig | null): Array<{ key: string; label: string }> {
  const roles = mergedRoles(config);
  return [
    { key: "superAdmin", label: ROLE_LABELS_BUILTIN.superAdmin },
    ...Object.keys(roles).map((key) => ({ key, label: roles[key].label })),
  ];
}

function resolvePerms(
  profile: UserProfile | null,
  previewMode: boolean,
  config: PermissionsConfig | null,
): Perms {
  const raw = text(profile?.adminRole, "");
  const effective = previewMode ? "superAdmin" : raw || "superAdmin";
  if (effective === "superAdmin") {
    return {
      role: "superAdmin", label: ROLE_LABELS_BUILTIN.superAdmin, tabs: SUPER_ADMIN_TABS,
      can: () => true, services: null, canService: () => true,
    };
  }
  const role = mergedRoles(config)[effective];
  if (!role) {
    return {
      role: effective, label: roleLabel(effective, config), tabs: ["today"],
      can: () => false, services: [], canService: () => false,
    };
  }
  const allowedTabs: Tab[] = ["today"];
  const caps = new Set<AdminCapability>();
  for (const section of EDITABLE_SECTIONS) {
    const level = role.sections[section.key] ?? "none";
    if (level === "view" || level === "manage") allowedTabs.push(section.tab);
    if (level === "manage") caps.add(section.cap);
  }
  for (const extra of EDITABLE_CAPS) {
    if ((role.sections[extra.key] ?? "none") === "manage") caps.add(extra.cap);
  }
  const services = role.services.length ? role.services : null;
  return {
    role: effective, label: role.label, tabs: allowedTabs,
    can: (capability) => caps.has(capability),
    services,
    canService: (serviceId) => services === null || services.includes(serviceId),
  };
}

function useRolePermissionsConfig(enabled: boolean): PermissionsConfig | null {
  const [config, setConfig] = useState<PermissionsConfig | null>(null);
  useEffect(() => {
    if (!enabled) {
      setConfig(null);
      return;
    }
    return onSnapshot(
      doc(db, "platformConfig", "permissions"),
      (snap) => setConfig(snap.exists() ? (snap.data() as PermissionsConfig) : {}),
      () => setConfig({}),
    );
  }, [enabled]);
  return config;
}
const businessStatuses = ["pending", "approved", "suspended", "changes_requested", "rejected"];
const listingStatuses = ["active", "inactive", "reserved", "sold"];
const operationalStatuses = [
  "pending",
  "active",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
  "sold",
  "reserved",
  "inactive",
];
const purchaseStatuses = [
  "pending",
  "viewing_scheduled",
  "reserved",
  "completed",
  "cancelled",
  "no_show",
  "refunded",
  "forfeited",
];
const businessServices = [
  { id: "barrelShipping", label: "Barrel shipping" },
  { id: "carSales", label: "Car sales" },
  { id: "carParking", label: "Car parking" },
  { id: "carTransport", label: "Car transport" },
];

const statusLabels = {
  pending: "Pending",
  approved: "Approved",
  active: "Active",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
  sold: "Sold",
  reserved: "Reserved",
  inactive: "Halted",
  suspended: "Suspended",
  rejected: "Rejected",
  changes_requested: "Changes requested",
  open: "Open",
  closed: "Closed",
  blocked: "Blocked",
  missing_profile: "Missing profile",
  viewing_scheduled: "Viewing scheduled",
  no_show: "No show",
  refunded: "Refunded",
  forfeited: "Forfeited",
};

type Toast = {
  type: "success" | "error";
  message: string;
};

type BusyAction = {
  id: number;
  label: string;
};

type SupportDraft = {
  businessId: string;
  priority: string;
  subject: string;
  message: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  relatedCollection: string;
  relatedId: string;
  relatedLabel: string;
};

type FinanceLedgerRow = {
  id: string;
  source: string;
  sourceLabel: string;
  sourceCollection: string;
  sourceId: string;
  title: string;
  businessId: string;
  businessName: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  amount: number;
  currency: string;
  status: string;
  occurredAt: unknown;
  occurredAtMs: number;
  relatedLabel: string;
  searchText: string;
  record: FirestoreRow;
};

const supportPriorities = ["normal", "urgent", "blocked"] as const;

function emptySupportDraft(businessId = ""): SupportDraft {
  return {
    businessId,
    priority: "normal",
    subject: "",
    message: "",
    customerName: "",
    customerEmail: "",
    customerPhone: "",
    relatedCollection: "",
    relatedId: "",
    relatedLabel: "",
  };
}

function loadingActionLabel(label: string) {
  const value = label.trim();
  const lower = value.toLowerCase();
  if (lower.includes("destination") && lower.includes("updated")) return "Updating destination...";
  if (lower.includes("profile") && lower.includes("updated")) return "Saving profile...";
  if (lower.includes("photo") && lower.includes("uploaded")) return "Uploading photo...";
  if (lower.includes("phone") && lower.includes("sent")) return "Sending phone code...";
  if (lower.includes("phone") && lower.includes("confirmed")) return "Confirming phone...";
  if (lower.includes("refund") && lower.includes("completed")) return "Completing refund request...";
  if (lower.includes("refund") && lower.includes("rejected")) return "Rejecting refund request...";
  if (lower.includes("deleted")) return value.replace(/deleted/i, "Deleting...");
  if (lower.includes("created")) return value.replace(/created/i, "Creating...");
  if (lower.includes("updated")) return value.replace(/updated/i, "Updating...");
  if (lower.includes("saved")) return value.replace(/saved/i, "Saving...");
  if (lower.includes("complete")) return value.replace(/complete/i, "Running...");
  return `${value}...`;
}

const previewData = {
  users: [
    { id: "admin-preview", fullName: "Platform Administrator", email: "admin@laawoldigital.com", role: "admin" },
    { id: "owner-keren", fullName: "Keren Manager", email: "owner@kerenautos.com", role: "businessOwner", businessName: "Keren Auto Sales" },
    { id: "staff-yard", fullName: "Yard Staff", email: "yard@laawoldigital.com", role: "staff", businessName: "Keren Auto Sales" },
    { id: "customer-a", fullName: "Mamadou Diallo", email: "mamadou@example.com", phone: "+1 718 555 0199", role: "customer" },
    { id: "contact-aissatou", fullName: "Aissatou Bah", email: "aissatou@example.com", phone: "+1 718 555 0134", role: "missing_profile", businessName: "Keren Auto Sales", hasProfile: false, _inferred: true, _sourceCode: "VX-BRL-1048" },
  ],
  businesses: [
    { id: "keren_auto_sales", name: "Keren Auto Sales", phone: "+1 718 555 0110", email: "ops@kerenautos.com", status: "approved", enabledServices: ["carSales", "carParking", "carTransport", "barrelShipping"], serviceNote: "Cars, parking, transport, barrel shipping", featureConsent: true, marketingBlurb: "Cars, parking, transport, and shipping support for customers moving between the U.S. and West Africa.", logoUrl: "https://placehold.co/256x256?text=K" },
    { id: "atlantic_exports", name: "Atlantic Exports", phone: "+1 646 555 0182", email: "hello@atlanticexports.com", status: "pending", enabledServices: ["barrelShipping"], featureStatus: "requested", marketingBlurb: "Barrel and shared-load shipping with clear destination pricing.", serviceNote: "Pending document review" },
  ],
  featuredBusinesses: [
    { id: "keren_auto_sales", businessId: "keren_auto_sales", displayName: "Keren Auto Sales", logoUrl: "https://placehold.co/256x256?text=K", blurb: "Cars, parking, transport, and shipping support for the road home.", services: ["carSales", "carParking", "carTransport"], order: 1, active: true },
  ],
  cars: [
    { id: "camry-2021", title: "2021 Toyota Camry SE", make: "Toyota", model: "Camry", year: "2021", price: 18500, status: "active", businessName: "Keren Auto Sales", locationCity: "Bronx", locationState: "NY" },
    { id: "rav4-2020", title: "2020 Toyota RAV4 XLE", make: "Toyota", model: "RAV4", year: "2020", price: 22800, status: "reserved", businessName: "Keren Auto Sales", locationCity: "Newark", locationState: "NJ" },
    { id: "accord-2019", title: "2019 Honda Accord Sport", make: "Honda", model: "Accord", year: "2019", price: 17100, status: "active", businessName: "Keren Auto Sales", locationCity: "Queens", locationState: "NY" },
    { id: "escape-2018", title: "2018 Ford Escape SEL", make: "Ford", model: "Escape", year: "2018", price: 12900, status: "sold", businessName: "Keren Auto Sales", locationCity: "Brooklyn", locationState: "NY" },
    { id: "civic-2022", title: "2022 Honda Civic EX", make: "Honda", model: "Civic", year: "2022", price: 21400, status: "inactive", businessName: "Atlantic Exports", locationCity: "Jersey City", locationState: "NJ" },
  ],
  barrelShipments: [
    { id: "SHIP-1048", trackingCode: "VX-BRL-1048", receiverName: "Aissatou Bah", businessName: "Keren Auto Sales", destinationCountryName: "Guinea", price: 275, status: "pending", customerEmail: "aissatou@example.com" },
    { id: "SHIP-1042", trackingCode: "VX-BRL-1042", receiverName: "Ibrahima Sow", businessName: "Keren Auto Sales", destinationCountryName: "Senegal", price: 310, status: "completed", customerEmail: "ibrahima@example.com" },
  ],
  transportRequests: [
    { id: "TR-302", trackingCode: "VX-TR-302", ownerName: "Mamadou Diallo", carMake: "Toyota", carModel: "Camry", carYear: "2021", status: "scheduled", price: 450, businessName: "Keren Auto Sales" },
  ],
  parkedCars: [
    { id: "PK-88", trackingCode: "VX-PK-88", ownerName: "Fatou Camara", carMake: "Honda", carModel: "CR-V", carYear: "2018", status: "active", totalCost: 140, businessName: "Keren Auto Sales" },
  ],
  purchases: [
    { id: "PUR-77", carTitle: "2020 Toyota RAV4 XLE", buyerName: "Mamadou Diallo", buyerEmail: "mamadou@example.com", depositAmount: 500, depositCurrency: "USD", paymentStatus: "paid", purchaseStatus: "pending", businessName: "Keren Auto Sales" },
  ],
  refunds: [
    { id: "RF-17", customerUid: "customer-a", customerEmail: "aissatou@example.com", amount: 125, amountCents: 12500, currency: "USD", status: "pending", businessName: "Keren Auto Sales" },
  ],
  wallets: [
    { id: "customer-a", customerUid: "customer-a", balance: 45, balanceCents: 4500, pendingRefund: 125, pendingRefundCents: 12500, currency: "USD" },
  ],
  walletTransactions: [
    { id: "WT-1", _parentId: "customer-a", type: "debit", reason: "card_refund_requested", amount: 125, amountCents: 12500, currency: "USD", status: "pending", refundRequestId: "RF-17", createdAt: "2026-06-20", businessName: "Keren Auto Sales", customerEmail: "aissatou@example.com" },
    { id: "WT-2", _parentId: "customer-a", type: "credit", reason: "shipment_adjustment", amount: 45, amountCents: 4500, currency: "USD", status: "completed", createdAt: "2026-06-18", businessName: "Keren Auto Sales", customerEmail: "mamadou@example.com" },
  ],
  supportRequests: [
    { id: "SR-1", businessId: "keren_auto_sales", businessName: "Keren Auto Sales", subject: "Confirm card return for RF-17", priority: "urgent", status: "open", customerEmail: "aissatou@example.com", relatedLabel: "Refund RF-17", createdAt: "2026-06-20" },
  ],
  pricing: [
    { id: "guinea", destinationCountryName: "Guinea", businessName: "Keren Auto Sales", price: 275, status: "active" },
    { id: "senegal", destinationCountryName: "Senegal", businessName: "Keren Auto Sales", price: 310, status: "active" },
  ],
  destinations: [
    { id: "guinea", businessId: "keren_auto_sales", name: "Guinea", code: "GN", businessName: "Keren Auto Sales", barrelShippingPrice: 275, deliveryEstimateMinDays: 21, deliveryEstimateMaxDays: 28, destinationNote: "Conakry warehouse receives cleared barrels Monday through Friday.", isActive: true },
    { id: "senegal", businessId: "keren_auto_sales", name: "Senegal", code: "SN", businessName: "Keren Auto Sales", barrelShippingPrice: 310, deliveryEstimateMinDays: 24, deliveryEstimateMaxDays: 31, destinationNote: "Dakar pickup requires receiver ID and tracking code.", isActive: true },
    { id: "gambia", businessId: "keren_auto_sales", name: "Gambia", code: "GM", businessName: "Keren Auto Sales", barrelShippingPrice: 295, deliveryEstimateMinDays: 24, deliveryEstimateMaxDays: 31, destinationNote: "Banjul route runs through the Senegal dispatch partner.", isActive: true },
  ],
  applications: [
    { id: "APP-9", businessName: "Atlantic Exports", applicantEmail: "owner@atlanticexports.com", status: "pending", type: "business_application" },
  ],
  notifications: [
    { id: "NOTE-4", businessName: "Atlantic Exports", message: "Business application waiting for review", status: "pending", type: "business_application" },
  ],
} satisfies Record<string, FirestoreRow[]>;

function slugify(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || `business_${Date.now()}`;
}

function numberValue(value: unknown) {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowStatus(row: FirestoreRow, field = "status") {
  return text(row[field], "pending").toLowerCase();
}

function countWhere(rows: FirestoreRow[], predicate: (row: FirestoreRow) => boolean) {
  return rows.reduce((total, row) => total + (predicate(row) ? 1 : 0), 0);
}

function countBy(rows: FirestoreRow[], field: string) {
  return rows.reduce<Record<string, number>>((counts, row) => {
    const value = rowStatus(row, field);
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function statusLabel(value: unknown) {
  const key = text(value, "pending").toLowerCase() as keyof typeof statusLabels;
  return statusLabels[key] ?? text(value, "Pending");
}

async function commitStatusChange({
  collectionName,
  targetId,
  nextStatus,
}: {
  collectionName: string;
  targetId: string;
  nextStatus: string;
}) {
  await httpsCallable(functions, "updateAdminRecordStatus")({
    collectionName,
    recordId: targetId,
    status: nextStatus,
  });
}

async function deleteAdminRecord(collectionName: string, recordId: string) {
  await httpsCallable(functions, "deleteAdminRecord")({
    collectionName,
    recordId,
  });
}

async function sendBusinessSupportRequest(draft: SupportDraft) {
  await httpsCallable(functions, "sendBusinessSupportRequest")({
    businessId: draft.businessId.trim(),
    priority: draft.priority,
    subject: draft.subject.trim(),
    message: draft.message.trim(),
    customerName: draft.customerName.trim(),
    customerEmail: draft.customerEmail.trim(),
    customerPhone: draft.customerPhone.trim(),
    relatedCollection: draft.relatedCollection.trim(),
    relatedId: draft.relatedId.trim(),
    relatedLabel: draft.relatedLabel.trim(),
  });
}

function optionalDate(value: unknown) {
  const formatted = formatDate(value);
  return formatted === "Not set" ? "" : formatted;
}

function optionalMoney(value: unknown, currency = "USD") {
  if (value === undefined || value === null || value === "") return "";
  return formatMoney(value, currency);
}

function countryFlag(code: unknown) {
  const value = text(code, "").trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(value)) return "🏳";
  return String.fromCodePoint(
      ...[...value].map((char) => char.charCodeAt(0) - 65 + 0x1F1E6),
  );
}

function detailRows(rows: Array<[string, unknown]>) {
  return rows
    .map(([label, value]) => [label, text(value, "")] as [string, string])
    .filter(([, value]) => value.length > 0);
}

function urgencyRank(item: { kind: string; status: string }) {
  if (item.kind === "refund") return 0;
  if (item.kind === "business") return 1;
  if (item.kind === "purchase") return 2;
  if (item.kind === "shipment") return 3;
  if (item.status === "pending") return 4;
  return 5;
}

function businessKey(id: unknown, name: unknown) {
  return text(id ?? name, "").trim().toLowerCase();
}

function businessDirectory(
  businesses: FirestoreRow[],
  sources: FirestoreRow[][],
) {
  const known = new Map<string, FirestoreRow>();
  for (const business of businesses) {
    known.set(businessKey(business.id, business.name), business);
    const nameKey = businessKey(null, business.name);
    if (nameKey) known.set(nameKey, business);
  }

  const inferred = new Map<string, FirestoreRow>();
  for (const rows of sources) {
    for (const row of rows) {
      const name = text(row.businessName, "");
      if (!name) continue;
      const id = text(row.businessId, slugify(name));
      const idKey = businessKey(id, name);
      const nameKey = businessKey(null, name);
      if (known.has(idKey) || known.has(nameKey) || inferred.has(idKey) || inferred.has(nameKey)) {
        const existing = inferred.get(idKey) ?? inferred.get(nameKey);
        if (existing) existing._sourceCount = numberValue(existing._sourceCount) + 1;
        continue;
      }
      const business = {
        id,
        name,
        status: "missing_profile",
        businessStatus: row.businessStatus,
        phone: row.businessPhone ?? row.contactPhone,
        email: row.businessEmail ?? row.contactEmail,
        serviceNote: "Inferred from operational records",
        _inferred: true,
        _sourceCount: 1,
      };
      inferred.set(idKey, business);
      inferred.set(nameKey, business);
    }
  }

  return [
    ...businesses,
    ...Array.from(new Set(inferred.values())),
  ].sort((a, b) => {
    const aMissing = a._inferred === true ? 1 : 0;
    const bMissing = b._inferred === true ? 1 : 0;
    if (aMissing !== bMissing) return bMissing - aMissing;
    return text(a.name, a.id).localeCompare(text(b.name, b.id));
  });
}

function userKeys(user: FirestoreRow) {
  const uid = text(user.uid ?? user.id, "");
  const email = text(user.email, "").toLowerCase();
  const phone = text(user.phone, "");
  const name = text(user.fullName, "");
  return [
    uid ? `uid:${uid}` : "",
    email ? `email:${email}` : "",
    phone ? `phone:${phone}` : "",
    name ? `name:${slugify(name)}` : "",
  ].filter(Boolean);
}

function mergeUserDirectoryRow(target: FirestoreRow, source: FirestoreRow) {
  Object.entries(source).forEach(([key, value]) => {
    if (value === undefined || value === null || value === "") return;
    if (target[key] === undefined || target[key] === null || target[key] === "") {
      target[key] = value;
    }
  });
  // Only ever upgrade these flags to true — never coerce an unknown
  // (undefined) value down to false, which would wrongly hide real accounts
  // that also appear in operational records.
  if (source.hasAuth === true) target.hasAuth = true;
  if (source.hasProfile === true) target.hasProfile = true;
  target._inferred = target._inferred === true && source.hasProfile !== true;
}

function userContactsFromRow(row: FirestoreRow) {
  const candidates = [
    {
      id: row.customerUid ?? row.userId,
      uid: row.customerUid ?? row.userId,
      fullName: row.customerName,
      email: row.customerEmail,
      phone: row.customerPhone,
    },
    {
      id: row.buyerUid,
      uid: row.buyerUid,
      fullName: row.buyerName,
      email: row.buyerEmail,
      phone: row.buyerPhone,
    },
    {
      id: row.ownerUid,
      uid: row.ownerUid,
      fullName: row.ownerName,
      email: row.ownerEmail,
      phone: row.ownerPhone,
    },
    {
      id: row.receiverUid,
      uid: row.receiverUid,
      fullName: row.receiverName,
      email: row.receiverEmail,
      phone: row.receiverPhone,
    },
  ];

  return candidates.flatMap((candidate) => {
    const email = text(candidate.email, "");
    const phone = text(candidate.phone, "");
    const fullName = text(candidate.fullName, "");
    const uid = text(candidate.uid, "");
    if (!email && !phone && !fullName && !uid) return [];
    return [{
      id: uid || email || phone || slugify(fullName),
      uid,
      fullName,
      email,
      phone,
      role: "missing_profile",
      businessId: row.businessId,
      businessName: row.businessName,
      hasProfile: false,
      _inferred: true,
      _sourceId: row.id,
      _sourceCode: row.trackingCode ?? row.purchaseCode ?? row.id,
    }];
  });
}

function isBusinessMember(user: FirestoreRow) {
  const role = text(user.role, "");
  return (role === "businessOwner" || role === "staff") && user._inferred !== true;
}

function isPlatformAdmin(user: FirestoreRow) {
  return text(user.role, "") === "admin" && user._inferred !== true;
}

function isCustomerAccount(user: FirestoreRow) {
  // A real customer is anyone with a saved profile and the customer role.
  // Auth-listing status must not gate this — a profile doc is a real account.
  return (
    text(user.role, "customer") === "customer" &&
    user._inferred !== true &&
    user.hasProfile !== false
  );
}

function isContactReference(user: FirestoreRow) {
  return user._inferred === true || user.hasProfile === false;
}

function businessRecordKey(row: FirestoreRow) {
  return {
    id: text(row.businessId, "").trim().toLowerCase(),
    name: text(row.businessName, "").trim().toLowerCase(),
  };
}

function belongsToBusiness(row: FirestoreRow, business: FirestoreRow) {
  const record = businessRecordKey(row);
  const businessId = text(business.id, "").trim().toLowerCase();
  const businessName = text(business.name, "").trim().toLowerCase();
  return Boolean(
    (record.id && record.id === businessId) ||
    (record.name && record.name === businessName),
  );
}

function userDisplayName(user: FirestoreRow) {
  return text(user.fullName ?? user.email ?? user.phone, user.id);
}

function userMeta(user: FirestoreRow) {
  return [
    user.email,
    user.phone,
    user.role === "admin" ? user.adminRole : null,
    user.businessName,
    user.hasAuth === false ? "Profile only" : null,
    user.disabled ? "Disabled" : "",
    user.emailVerified === false ? "Email not verified" : "",
    user._inferred ? `Seen in ${text(user._sourceCode, "records")}` : "",
  ].filter(Boolean).join(" • ");
}

function userDirectory(
  profiles: FirestoreRow[],
  authUsers: FirestoreRow[],
  contactSources: FirestoreRow[][],
) {
  const directory = new Map<string, FirestoreRow>();
  const ordered: FirestoreRow[] = [];

  function upsert(row: FirestoreRow, preferred = false) {
    const keys = userKeys(row);
    if (keys.length === 0) return;
    const existing = keys.map((key) => directory.get(key)).find(Boolean);
    if (existing) {
      if (preferred) {
        Object.assign(existing, row);
        existing.hasProfile = true;
        existing._inferred = false;
      } else {
        mergeUserDirectoryRow(existing, row);
      }
      keys.forEach((key) => directory.set(key, existing));
      return;
    }

    const next = {...row};
    ordered.push(next);
    keys.forEach((key) => directory.set(key, next));
  }

  authUsers.forEach((user) => upsert(user));
  profiles.forEach((profile) => upsert({
    ...profile,
    uid: profile.uid ?? profile.id,
    hasProfile: true,
    _inferred: false,
  }, true));
  contactSources
      .flatMap((rows) => rows.flatMap(userContactsFromRow))
      .forEach((user) => upsert(user));

  return ordered.sort((a, b) => {
    const aMissing = a.hasProfile === false || a._inferred === true ? 1 : 0;
    const bMissing = b.hasProfile === false || b._inferred === true ? 1 : 0;
    if (aMissing !== bMissing) return bMissing - aMissing;
    return text(a.fullName ?? a.email, a.id).localeCompare(
        text(b.fullName ?? b.email, b.id),
    );
  });
}

function useAdminCollection(name: string, enabled: boolean, max = 150) {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    const unsubscribe = onSnapshot(
      query(collection(db, name), limit(max)),
      (snapshot) => {
        setRows(snapshot.docs.map((item) => ({
          id: item.id,
          _path: item.ref.path,
          ...item.data(),
        })));
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        setError(snapshotError.message);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [enabled, max, name]);

  return { rows, loading, error };
}

function useAdminCollectionGroup(name: string, enabled: boolean, max = 500) {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }
    setLoading(true);
    const unsubscribe = onSnapshot(
      query(collectionGroup(db, name), limit(max)),
      (snapshot) => {
        setRows(snapshot.docs.map((item) => ({
          id: item.id,
          _path: item.ref.path,
          _parentId: item.ref.parent.parent?.id ?? "",
          _parentPath: item.ref.parent.parent?.path ?? "",
          ...item.data(),
        })));
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        setRows([]);
        setError(snapshotError.message);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [enabled, max, name]);

  return { rows, loading, error };
}

function useAdminAuthUsers(enabled: boolean) {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }

    let active = true;
    const backendReady = process.env.NEXT_PUBLIC_ADMIN_BACKEND_READY === "1";
    const forceAuthUsers = new URL(window.location.href).searchParams.get("authUsers") === "1";
    if (!backendReady && !forceAuthUsers) {
      setRows([]);
      setLoading(false);
      setError("");
      return () => {
        active = false;
      };
    }

    setLoading(true);
    setError("");
    httpsCallable(functions, "listPlatformUsers")({maxResults: 1000})
        .then((result) => {
          if (!active) return;
          const data = result.data as {users?: FirestoreRow[]};
          setRows(data.users ?? []);
        })
        .catch((listError) => {
          if (!active) return;
          setRows([]);
          setError("Firebase Auth user listing is unavailable. Showing profile and activity records.");
        })
        .finally(() => {
          if (active) setLoading(false);
        });

    return () => {
      active = false;
    };
  }, [enabled, refreshToken]);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  return {rows, loading, error, refresh};
}

function useAdminDestinationCoverage(enabled: boolean) {
  const [rows, setRows] = useState<FirestoreRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!enabled) {
      setRows([]);
      setLoading(false);
      setError("");
      return;
    }

    setLoading(true);
    const unsubscribe = onSnapshot(
      query(collectionGroup(db, "destinationCountries"), limit(500)),
      (snapshot) => {
        const destinationRows: FirestoreRow[] = snapshot.docs.map((item) => ({
          id: item.id,
          _path: item.ref.path,
          businessId: item.ref.parent.parent?.id ?? "",
          ...item.data(),
        }));
        setRows(destinationRows.sort((a, b) => {
          const businessCompare = text(a.businessName, "").localeCompare(
              text(b.businessName, ""),
          );
          if (businessCompare !== 0) return businessCompare;
          return text(a.name, a.id).localeCompare(text(b.name, b.id));
        }));
        setLoading(false);
        setError("");
      },
      (snapshotError) => {
        setRows([]);
        setError(snapshotError.message);
        setLoading(false);
      },
    );
    return unsubscribe;
  }, [enabled]);

  const refresh = useCallback(() => {
    setRows((value) => [...value]);
  }, []);

  return {rows, loading, error, refresh};
}

export function AdminConsole() {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [booting, setBooting] = useState(true);
  const [authError, setAuthError] = useState("");
  const [activeTab, setActiveTab] = useState<Tab>("today");
  const [toast, setToast] = useState<Toast | null>(null);
  const [busyAction, setBusyAction] = useState<BusyAction | null>(null);
  const actionSequence = useRef(0);
  const [previewMode, setPreviewMode] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);

  const isAdmin = profile?.role === "admin";
  const enabled = Boolean(firebaseUser && isAdmin && !previewMode);
  const rolePermsConfig = useRolePermissionsConfig(enabled);
  const perms = useMemo(
    () => resolvePerms(profile, previewMode, rolePermsConfig),
    [profile, previewMode, rolePermsConfig],
  );

  // Keep the active tab within the admin's allowed sections.
  useEffect(() => {
    if (!perms.tabs.includes(activeTab)) {
      setActiveTab(perms.tabs[0] ?? "today");
    }
  }, [perms, activeTab]);

  const userProfiles = useAdminCollection("users", enabled, 1000);
  const businesses = useAdminCollection("businesses", enabled, 500);
  const cars = useAdminCollection("cars", enabled, 1000);
  const barrelShipments = useAdminCollection("barrelShipments", enabled, 1000);
  const transportRequests = useAdminCollection("transportRequests", enabled, 1000);
  const parkedCars = useAdminCollection("parkedCars", enabled, 1000);
  const purchases = useAdminCollection("carPurchases", enabled, 1000);
  const refunds = useAdminCollection("walletRefundRequests", enabled, 500);
  const wallets = useAdminCollection("wallets", enabled, 1000);
  const walletTransactions = useAdminCollectionGroup("transactions", enabled, 1000);
  const pricing = useAdminCollection("shipmentPricing", enabled, 500);
  const destinations = useAdminDestinationCoverage(
    enabled && (activeTab === "businesses" || activeTab === "marketplace"),
  );
  const applications = useAdminCollection("businessApplications", enabled, 150);
  const notifications = useAdminCollection("platformNotifications", enabled, 150);
  const supportRequests = useAdminCollection("businessSupportRequests", enabled, 500);
  const featuredBusinesses = useAdminCollection(
    "featuredBusinesses",
    enabled && perms.tabs.includes("website"),
    200,
  );
  const authUsers = useAdminAuthUsers(enabled);
  const carRows = previewMode ? previewData.cars : cars.rows;
  const shipmentRows = previewMode ? previewData.barrelShipments : barrelShipments.rows;
  const transportRows = previewMode ? previewData.transportRequests : transportRequests.rows;
  const parkedRows = previewMode ? previewData.parkedCars : parkedCars.rows;
  const purchaseRows = previewMode ? previewData.purchases : purchases.rows;
  const refundRows = previewMode ? previewData.refunds : refunds.rows;
  const walletRows = previewMode ? previewData.wallets : wallets.rows;
  const walletTransactionRows = previewMode
    ? previewData.walletTransactions
    : walletTransactions.rows;
  const pricingRows = previewMode ? previewData.pricing : pricing.rows;
  const destinationRows = previewMode ? previewData.destinations : destinations.rows;
  const applicationRows = previewMode ? previewData.applications : applications.rows;
  const notificationRows = previewMode ? previewData.notifications : notifications.rows;
  const supportRequestRows = previewMode
    ? previewData.supportRequests
    : supportRequests.rows;
  const featuredBusinessRows = previewMode
    ? previewData.featuredBusinesses
    : featuredBusinesses.rows;
  const profileRows = useMemo(() => {
    const rows = userProfiles.rows.map((row) => ({
      ...row,
      uid: row.uid ?? row.id,
      hasProfile: true,
      _inferred: false,
    }));
    if (!profile) return rows;
    const currentUserId = profile.id;
    const includesCurrentUser = rows.some((row) => {
      return text(row.uid ?? row.id, "") === currentUserId;
    });
    if (includesCurrentUser) return rows;
    return [
      ...rows,
      {...profile, uid: profile.id, hasProfile: true, _inferred: false},
    ];
  }, [profile, userProfiles.rows]);
  const userRows = previewMode
    ? previewData.users
    : userDirectory(profileRows, authUsers.rows, [
        shipmentRows,
        transportRows,
        parkedRows,
        purchaseRows,
        refundRows,
        supportRequestRows,
      ]);
  const businessRows = previewMode
    ? previewData.businesses
    : businessDirectory(businesses.rows, [
        carRows,
        shipmentRows,
        transportRows,
        parkedRows,
        purchaseRows,
        pricingRows,
        destinationRows,
        applicationRows,
        notificationRows,
        supportRequestRows,
      ]);

  const notify = useCallback((type: Toast["type"], message: string) => {
    setToast({ type, message });
    window.setTimeout(() => setToast(null), 4200);
  }, []);

  useEffect(() => {
    const url = new URL(window.location.href);
    const localPreview =
      url.searchParams.get("preview") === "1" &&
      ["localhost", "127.0.0.1"].includes(window.location.hostname);
    setPreviewMode(localPreview);
    if (localPreview) {
      setBooting(false);
      return undefined;
    }
    return onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      setProfile(null);
      setAuthError("");
      if (!user) {
        setBooting(false);
        return;
      }

      try {
        if ((user.email ?? "").toLowerCase() === "admin@gmail.com") {
          await httpsCallable(functions, "ensurePlatformAdminProfile")();
        }
        const profileSnapshot = await getDoc(doc(db, "users", user.uid));
        const userProfile = profileSnapshot.exists()
          ? ({ id: profileSnapshot.id, ...profileSnapshot.data() } as UserProfile)
          : null;
        setProfile(userProfile);
        if (userProfile?.role !== "admin") {
          setAuthError("This console is restricted to platform administrators.");
        }
      } catch (error) {
        setAuthError(error instanceof Error ? error.message : String(error));
      } finally {
        setBooting(false);
      }
    });
  }, []);

  const runAction = useCallback(
    async (label: string, action: () => Promise<unknown>) => {
      const id = actionSequence.current + 1;
      actionSequence.current = id;
      const activeElement = document.activeElement;
      const trigger = activeElement instanceof HTMLElement
        ? activeElement.closest("button") as HTMLButtonElement | null
        : null;
      const triggerWasDisabled = trigger?.disabled ?? false;
      if (trigger) {
        trigger.dataset.loading = "true";
        trigger.disabled = true;
        trigger.setAttribute("aria-busy", "true");
        trigger.setAttribute("aria-disabled", "true");
      }
      setBusyAction({id, label: loadingActionLabel(label)});
      try {
        if (previewMode) {
          await new Promise((resolve) => window.setTimeout(resolve, 900));
          notify("success", `${label} (preview only)`);
          return;
        }
        await action();
        notify("success", label);
      } catch (error) {
        notify("error", error instanceof Error ? error.message : String(error));
      } finally {
        if (trigger) {
          delete trigger.dataset.loading;
          trigger.disabled = triggerWasDisabled;
          trigger.removeAttribute("aria-busy");
          trigger.removeAttribute("aria-disabled");
        }
        if (actionSequence.current === id) {
          setBusyAction(null);
        }
      }
    },
    [notify, previewMode],
  );

  if (booting) {
    return (
      <Shell>
        <div className="center-panel">
          <RefreshCw className="spin" size={28} />
          <p>Opening admin console...</p>
        </div>
      </Shell>
    );
  }

  if ((!firebaseUser || !isAdmin) && !previewMode) {
    return (
      <Shell>
        <SignInCard authError={authError} />
      </Shell>
    );
  }

  return (
    <Shell busyAction={busyAction} toast={toast}>
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
            <Shield size={18} />
            <span>Laawol Digital</span>
          </div>
          <div className="topbar-heading">
            <h1>{tabLabel(activeTab)}</h1>
            <p>{tabHint(activeTab)}</p>
          </div>
        </div>
        <div className="topbar-actions">
          {previewMode && <span className="preview-flag">Preview data</span>}
          <button
            className="admin-chip"
            onClick={() => setAccountOpen(true)}
            title="Open account settings"
            type="button"
          >
            <Shield size={18} />
            <span className="admin-chip-name">{previewMode ? "Preview Administrator" : text(profile?.fullName ?? firebaseUser?.email, "Administrator")}</span>
            <span className="admin-role-tag">{perms.label}</span>
          </button>
          <button className="icon-button" onClick={() => previewMode ? setPreviewMode(false) : signOut(auth)} title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </header>

      <main className={`workspace ${sidebarCollapsed ? "sidebar-collapsed" : ""}`}>
        <nav className="sidebar" aria-label="Admin sections">
          {navGroups
            .map((group) => ({ ...group, tabs: group.tabs.filter((tab) => perms.tabs.includes(tab)) }))
            .filter((group) => group.tabs.length > 0)
            .map((group) => (
            <div className="nav-group" key={group.label}>
              <span className="nav-group-label">{group.label}</span>
              {group.tabs.map((tab) => (
                <button
                  key={tab}
                  className={activeTab === tab ? "active" : ""}
                  onClick={() => setActiveTab(tab)}
                  title={tabLabel(tab)}
                >
                  {tabIcon(tab)}
                  <span className="nav-text">
                    <b>{tabLabel(tab)}</b>
                    <small>{tabHint(tab)}</small>
                  </span>
                </button>
              ))}
            </div>
          ))}
        </nav>

        <section className="content">
          {activeTab === "today" && (
            <Today
              users={userRows}
              businesses={businessRows}
              cars={carRows}
              barrelShipments={shipmentRows}
              transportRequests={transportRows}
              parkedCars={parkedRows}
              purchases={purchaseRows}
              refunds={refundRows}
              applications={applicationRows}
              navigate={setActiveTab}
            />
          )}
          {activeTab === "people" && (
            <UsersView
              users={userRows}
              loading={userProfiles.loading || authUsers.loading}
              error={[userProfiles.error, authUsers.error].filter(Boolean).join(" ")}
              currentUserId={firebaseUser?.uid ?? ""}
              refreshUsers={authUsers.refresh}
              runAction={runAction}
              canManage={perms.can("users")}
              permsConfig={rolePermsConfig}
            />
          )}
          {activeTab === "businesses" && (
            <BusinessesView
              businesses={businessRows}
              users={userRows}
              cars={carRows}
              shipments={shipmentRows}
              transports={transportRows}
              parkedCars={parkedRows}
              purchases={purchaseRows}
              refunds={refundRows}
              destinations={destinationRows}
              contactReferences={userRows.filter(isContactReference)}
              applications={applicationRows}
              notifications={notificationRows}
              supportRequests={supportRequestRows}
              runAction={runAction}
            />
          )}
          {activeTab === "operations" && (
            <OperationsView
              shipments={shipmentRows}
              transports={transportRows}
              parkedCars={parkedRows}
              purchases={purchaseRows}
              runAction={runAction}
              canService={perms.canService}
            />
          )}
          {activeTab === "marketplace" && (
            <MarketplaceView
              cars={carRows}
              businesses={businessRows}
              pricing={pricingRows}
              destinations={destinationRows}
              errors={[cars.error, pricing.error, destinations.error].filter(Boolean)}
              loading={cars.loading || pricing.loading || destinations.loading}
              refreshDestinations={destinations.refresh}
              runAction={runAction}
            />
          )}
          {activeTab === "finance" && (
            <FinanceView
              refunds={refundRows}
              wallets={walletRows}
              walletTransactions={walletTransactionRows}
              businesses={businessRows}
              users={userRows}
              cars={carRows}
              shipments={shipmentRows}
              transports={transportRows}
              parkedCars={parkedRows}
              purchases={purchaseRows}
              supportRequests={supportRequestRows}
              runAction={runAction}
              canManage={perms.can("finance")}
              canSendSupport={perms.can("support")}
            />
          )}
          {activeTab === "website" && (
            <WebsiteView
              businesses={businessRows}
              currentUserId={firebaseUser?.uid ?? ""}
              featuredBusinesses={featuredBusinessRows}
              previewMode={previewMode}
              runAction={runAction}
            />
          )}
          {activeTab === "tools" && (
            <ToolsView businesses={businessRows} runAction={runAction} />
          )}
          {activeTab === "settings" && (
            <SettingsView
              config={rolePermsConfig}
              currentUserId={firebaseUser?.uid ?? ""}
              previewMode={previewMode}
              runAction={runAction}
            />
          )}
        </section>
      </main>
      <AdminAccountPanel
        firebaseUser={firebaseUser}
        onClose={() => setAccountOpen(false)}
        onProfileUpdated={setProfile}
        open={accountOpen}
        perms={perms}
        profile={profile}
        runAction={runAction}
      />
    </Shell>
  );
}

function Shell({
  busyAction,
  children,
  toast,
}: {
  busyAction?: BusyAction | null;
  children: ReactNode;
  toast?: Toast | null;
}) {
  return (
    <div className="app-shell">
      {children}
      {busyAction && (
        <div className="action-progress" role="status" aria-live="polite">
          <RefreshCw className="spin" size={16} />
          <span>{busyAction.label}</span>
        </div>
      )}
      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}
    </div>
  );
}

function SignInCard({ authError }: { authError: string }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (signInError) {
      setError(readableAuthError(signInError));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="login-screen">
      <div className="login-header">
        <div className="brand-mark">
          <Shield size={30} />
        </div>
        <div>
          <h1>Laawol Digital Admin</h1>
          <p>Production console for platform administrators.</p>
        </div>
      </div>
      <form className="login-card" onSubmit={submit}>
        <h2>Sign in</h2>
        <label>
          Email
          <input
            autoComplete="email"
            inputMode="email"
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          Password
          <input
            autoComplete="current-password"
            required
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {(error || authError) && <div className="error-box">{error || authError}</div>}
        <button
          className="primary-button"
          data-loading={submitting ? "true" : undefined}
          disabled={submitting}
        >
          {submitting ? "Signing in..." : "Open console"}
        </button>
      </form>
    </div>
  );
}

function readableAuthError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (
    message.includes("auth/invalid-credential") ||
    message.includes("auth/wrong-password") ||
    message.includes("auth/user-not-found")
  ) {
    return "Invalid email or password.";
  }
  if (message.includes("auth/too-many-requests")) {
    return "Too many failed attempts. Try again later.";
  }
  if (message.includes("auth/network-request-failed")) {
    return "Network error. Check your connection and try again.";
  }
  return "Sign in failed. Try again or contact support.";
}

function Today(props: {
  users: FirestoreRow[];
  businesses: FirestoreRow[];
  cars: FirestoreRow[];
  barrelShipments: FirestoreRow[];
  transportRequests: FirestoreRow[];
  parkedCars: FirestoreRow[];
  purchases: FirestoreRow[];
  refunds: FirestoreRow[];
  applications: FirestoreRow[];
  navigate: (tab: Tab) => void;
}) {
  const pendingBusinesses = countWhere(props.businesses, (item) => rowStatus(item) === "pending");
  const approvedBusinesses = countWhere(props.businesses, (item) => rowStatus(item) === "approved");
  const missingProfiles = countWhere(props.businesses, (item) => item._inferred === true);
  const activeListings = countWhere(props.cars, (item) => rowStatus(item) === "active");
  const pendingShipments = countWhere(props.barrelShipments, (item) => rowStatus(item) === "pending");
  const pendingPurchases = countWhere(props.purchases, (item) => rowStatus(item, "purchaseStatus") === "pending");
  const pendingRefunds = props.refunds.filter((item) => rowStatus(item) === "pending");
  const pendingRefundAmount = pendingRefunds.reduce((total, item) => total + numberValue(item.amount), 0);

  const queue = [
    ...props.businesses
      .filter((item) => item.status === "pending")
      .map((item) => ({
        id: item.id,
        kind: "business" as const,
        target: "businesses" as Tab,
        label: text(item.name, "Business application"),
        meta: [item.phone, item.email, item.ownerName].filter(Boolean).join(" • ") || "Awaiting partner approval",
        status: text(item.status, "pending"),
        cta: "Review business",
      })),
    ...props.applications
      .filter((item) => rowStatus(item) === "pending")
      .map((item) => ({
        id: item.id,
        kind: "business" as const,
        target: "businesses" as Tab,
        label: text(item.businessName ?? item.name, "Business application"),
        meta: [text(item.type, "application"), item.applicantEmail].filter(Boolean).join(" • "),
        status: text(item.status, "pending"),
        cta: "Open application",
      })),
    ...props.refunds
      .filter((item) => item.status === "pending")
      .map((item) => ({
        id: item.id,
        kind: "refund" as const,
        target: "finance" as Tab,
        label: `${formatMoney(item.amount, text(item.currency, "USD"))} card return`,
        meta: [text(item.customerEmail, "Customer"), text(item.businessName, "")].filter(Boolean).join(" • "),
        status: "pending",
        cta: "Resolve refund",
      })),
    ...props.purchases
      .filter((item) => item.purchaseStatus === "pending")
      .map((item) => ({
        id: item.id,
        kind: "purchase" as const,
        target: "operations" as Tab,
        label: text(item.carTitle, "Car purchase"),
        meta: [text(item.buyerName ?? item.buyerEmail, "Buyer"), text(item.businessName, "")].filter(Boolean).join(" • "),
        status: "pending",
        cta: "Open purchase",
      })),
    ...props.barrelShipments
      .filter((item) => item.status === "pending")
      .map((item) => ({
        id: item.id,
        kind: "shipment" as const,
        target: "operations" as Tab,
        label: `${text(item.trackingCode, item.id)} • ${text(item.receiverName, "Receiver")}`,
        meta: [text(item.businessName, "Business"), text(item.destinationCountryName, "")].filter(Boolean).join(" • "),
        status: "pending",
        cta: "Open shipment",
      })),
  ].sort((a, b) => urgencyRank(a) - urgencyRank(b));

  const totalOpen = queue.length;
  const visibleQueue = queue.slice(0, 12);

  const roleCounts = countBy(props.users, "role");
  const carStatuses = countBy(props.cars, "status");
  const shipmentStatuses = countBy(props.barrelShipments, "status");
  const purchaseStatuses = countBy(props.purchases, "purchaseStatus");
  const businessStatusCounts = countBy(props.businesses, "status");

  const businessSegments = Object.entries(businessStatusCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ label: statusLabel(key), value, color: statusColor(key) }));
  const listingSegments = Object.entries(carStatuses)
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => ({ label: statusLabel(key), value, color: statusColor(key) }));
  const accountBars = [
    { label: "Admins", value: roleCounts.admin ?? 0, color: "#0d9488" },
    { label: "Owners", value: roleCounts.businessowner ?? roleCounts.businessOwner ?? 0, color: "#14b8a6" },
    { label: "Staff", value: roleCounts.staff ?? 0, color: "#f59e0b" },
    { label: "Customers", value: roleCounts.customer ?? 0, color: "#2563eb" },
  ];

  const serviceLoads = [
    {
      label: "Marketplace",
      value: activeListings,
      total: Math.max(props.cars.length, 1),
      meta: `${activeListings} active of ${props.cars.length} listings`,
    },
    {
      label: "Barrel shipments",
      value: pendingShipments,
      total: Math.max(props.barrelShipments.length, 1),
      meta: `${pendingShipments} open of ${props.barrelShipments.length} records`,
    },
    {
      label: "Car purchases",
      value: pendingPurchases,
      total: Math.max(props.purchases.length, 1),
      meta: `${pendingPurchases} open of ${props.purchases.length} records`,
    },
    {
      label: "Card returns",
      value: pendingRefunds.length,
      total: Math.max(props.refunds.length, 1),
      meta: `${formatMoney(pendingRefundAmount)} awaiting payout`,
    },
  ];

  const kpis = [
    {
      label: "Needs review",
      value: pendingBusinesses + props.applications.filter((item) => rowStatus(item) === "pending").length,
      tone: "attention" as const,
      meta: "Businesses & applications",
      target: "businesses" as Tab,
    },
    {
      label: "Open shipments",
      value: pendingShipments,
      tone: "neutral" as const,
      meta: `${props.barrelShipments.length} barrel records`,
      target: "operations" as Tab,
    },
    {
      label: "Pending purchases",
      value: pendingPurchases,
      tone: "neutral" as const,
      meta: `${props.purchases.length} purchase records`,
      target: "operations" as Tab,
    },
    {
      label: "Refunds to pay",
      value: pendingRefunds.length,
      tone: "money" as const,
      meta: formatMoney(pendingRefundAmount),
      target: "finance" as Tab,
    },
  ];

  return (
    <div className="stack">
      <section className="page-hero">
        <div>
          <h2>What needs you now</h2>
          <p>
            {totalOpen > 0
              ? `${totalOpen} ${totalOpen === 1 ? "item is" : "items are"} waiting across approvals, logistics, and finance.`
              : "Every queue is clear. Browse a business workspace to review activity."}
          </p>
        </div>
        <div className="page-hero-stats">
          <span>Approved partners <b>{approvedBusinesses}</b></span>
          <span>Active listings <b>{activeListings}</b></span>
          {missingProfiles > 0 && <span className="warn">Missing profiles <b>{missingProfiles}</b></span>}
        </div>
      </section>

      <section className="kpi-grid">
        {kpis.map((kpi) => (
          <button
            className={`kpi ${kpi.tone}`}
            key={kpi.label}
            onClick={() => props.navigate(kpi.target)}
            type="button"
          >
            <span className="kpi-label">{kpi.label}</span>
            <strong>{kpi.value.toLocaleString()}</strong>
            <small>{kpi.meta}</small>
            <ArrowUpRight className="kpi-go" size={16} />
          </button>
        ))}
      </section>

      <section className="chart-grid">
        <DonutChart title="Businesses" total={props.businesses.length} segments={businessSegments} />
        <BarChart title="Accounts by role" bars={accountBars} />
        <DonutChart title="Listings" total={props.cars.length} segments={listingSegments} />
      </section>

      <div className="today-layout">
        <Panel
          title="Needs your attention"
          icon={<ClipboardList size={18} />}
          action={<span className="panel-count">{totalOpen}</span>}
        >
          {visibleQueue.length ? (
            <div className="worklist">
              {visibleQueue.map((item) => (
                <article className={`worklist-row ${item.kind}`} key={`${item.kind}-${item.id}`}>
                  <span className={`work-tag ${item.kind}`}>{item.kind}</span>
                  <div className="worklist-main">
                    <strong>{item.label}</strong>
                    <small>{item.meta}</small>
                  </div>
                  <button
                    className="link-button"
                    onClick={() => props.navigate(item.target)}
                    type="button"
                  >
                    {item.cta}
                    <ArrowUpRight size={15} />
                  </button>
                </article>
              ))}
              {totalOpen > visibleQueue.length && (
                <div className="worklist-more">
                  {totalOpen - visibleQueue.length} more open items across the queues.
                </div>
              )}
            </div>
          ) : (
            <EmptyState text="No open approvals, shipments, purchases, or refunds are currently loaded." />
          )}
        </Panel>

        <div className="today-side">
          <Panel title="Network health" icon={<Users size={18} />}>
            <div className="insight-grid">
              <Insight label="Admins" value={roleCounts.admin ?? 0} />
              <Insight label="Owners" value={roleCounts.businessowner ?? roleCounts.businessOwner ?? 0} />
              <Insight label="Staff" value={roleCounts.staff ?? 0} />
              <Insight label="Customers" value={roleCounts.customer ?? 0} />
            </div>
            <div className="status-strip">
              <span>Pending <b>{pendingBusinesses}</b></span>
              <span>Approved <b>{approvedBusinesses}</b></span>
              <span>Applications <b>{props.applications.length}</b></span>
            </div>
          </Panel>

          <Panel title="Service load" icon={<Activity size={18} />}>
            <div className="meter-list">
              {serviceLoads.map((item) => (
                <StatusMeter key={item.label} {...item} />
              ))}
            </div>
          </Panel>

          <Panel title="Open by status" icon={<DatabaseZap size={18} />}>
            <div className="distribution-grid">
              <Distribution title="Shipments" counts={shipmentStatuses} />
              <Distribution title="Purchases" counts={purchaseStatuses} />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function StatusMeter({
  label,
  value,
  total,
  meta,
}: {
  label: string;
  value: number;
  total: number;
  meta: string;
}) {
  return (
    <div className="meter-row">
      <div>
        <strong>{label}</strong>
        <span>{meta}</span>
      </div>
      <b>{value.toLocaleString()}</b>
    </div>
  );
}

function Insight({ label, value }: { label: string; value: number }) {
  return (
    <div className="insight">
      <span>{label}</span>
      <strong>{value.toLocaleString()}</strong>
    </div>
  );
}

function Distribution({
  title,
  counts,
}: {
  title: string;
  counts: Record<string, number>;
}) {
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="distribution">
      <h3>{title}</h3>
      {entries.length ? (
        entries.slice(0, 5).map(([status, value]) => (
          <div className="distribution-row" key={status}>
            <span>{statusLabel(status)}</span>
            <b>{value}</b>
          </div>
        ))
      ) : (
        <small>No records</small>
      )}
    </div>
  );
}

function statusColor(status: string) {
  const map: Record<string, string> = {
    approved: "#059669",
    active: "#0d9488",
    completed: "#059669",
    pending: "#f59e0b",
    scheduled: "#0ea5e9",
    in_progress: "#0ea5e9",
    viewing_scheduled: "#0ea5e9",
    reserved: "#2563eb",
    sold: "#7c3aed",
    inactive: "#94a3b8",
    changes_requested: "#d97706",
    suspended: "#dc2626",
    rejected: "#dc2626",
    cancelled: "#94a3b8",
    no_show: "#dc2626",
    refunded: "#7c3aed",
    forfeited: "#b45309",
    missing_profile: "#94a3b8",
  };
  return map[status.toLowerCase()] ?? "#14b8a6";
}

type ChartSegment = { label: string; value: number; color: string };

function DonutChart({
  title,
  total,
  segments,
}: {
  title: string;
  total: number;
  segments: ChartSegment[];
}) {
  const sum = segments.reduce((acc, seg) => acc + seg.value, 0);
  const radius = 40;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;
  return (
    <article className="chart-card">
      <div className="chart-head">
        <h3>{title}</h3>
        <span className="chart-total">{total.toLocaleString()}</span>
      </div>
      <div className="donut-wrap">
        <svg className="donut" viewBox="0 0 100 100" width="128" height="128" role="img" aria-label={`${title} by status`}>
          <circle cx="50" cy="50" r={radius} fill="none" stroke="var(--paper-soft)" strokeWidth="15" />
          {sum > 0 &&
            segments.map((seg, index) => {
              const length = (seg.value / sum) * circumference;
              const dash = (
                <circle
                  key={index}
                  cx="50"
                  cy="50"
                  r={radius}
                  fill="none"
                  stroke={seg.color}
                  strokeWidth="15"
                  strokeDasharray={`${length} ${circumference - length}`}
                  strokeDashoffset={-offset}
                  transform="rotate(-90 50 50)"
                />
              );
              offset += length;
              return dash;
            })}
        </svg>
        <ul className="chart-legend">
          {segments.length ? (
            segments.map((seg) => (
              <li key={seg.label}>
                <span className="dot" style={{ background: seg.color }} />
                {seg.label}
                <b>{seg.value}</b>
              </li>
            ))
          ) : (
            <li className="legend-empty">No records yet</li>
          )}
        </ul>
      </div>
    </article>
  );
}

function BarChart({ title, bars }: { title: string; bars: ChartSegment[] }) {
  const max = Math.max(...bars.map((bar) => bar.value), 1);
  const total = bars.reduce((acc, bar) => acc + bar.value, 0);
  return (
    <article className="chart-card">
      <div className="chart-head">
        <h3>{title}</h3>
        <span className="chart-total">{total.toLocaleString()}</span>
      </div>
      <div className="bar-rows">
        {bars.map((bar) => (
          <div className="bar-row" key={bar.label}>
            <span className="bar-label">{bar.label}</span>
            <div className="bar-track">
              <span className="bar-fill" style={{ width: `${Math.round((bar.value / max) * 100)}%`, background: bar.color }} />
            </div>
            <b>{bar.value}</b>
          </div>
        ))}
      </div>
    </article>
  );
}

function SectionIntro({
  title,
  description,
  stats,
}: {
  title: string;
  description: string;
  stats: Array<[string, string]>;
}) {
  return (
    <section className="section-intro">
      <div>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      <div className="section-stats">
        {stats.map(([label, value]) => (
          <span key={label}>
            {label}
            <b>{value}</b>
          </span>
        ))}
      </div>
    </section>
  );
}

function UsersView({
  users,
  loading,
  error,
  currentUserId,
  refreshUsers,
  runAction,
  canManage,
  permsConfig,
}: {
  users: FirestoreRow[];
  loading: boolean;
  error: string;
  currentUserId: string;
  refreshUsers: () => void;
  runAction: (label: string, action: () => Promise<unknown>) => void;
  canManage: boolean;
  permsConfig: PermissionsConfig | null;
}) {
  const roleOptions = roleOptionList(permsConfig);
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const visibleUsers = users.filter((item) => !isBusinessMember(item));
    if (!needle) return visibleUsers;
    return visibleUsers.filter((item) =>
      [item.email, item.fullName, item.phone, item.role, item.businessName]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ")
        .includes(needle),
    );
  }, [search, users]);
  const platformAdmins = filtered.filter(isPlatformAdmin);
  const customerAccounts = filtered.filter(isCustomerAccount);
  const contactReferences = filtered
      .filter(isContactReference)
      .filter((user) => !text(user.businessId ?? user.businessName, ""));
  const businessMemberCount = countWhere(users, isBusinessMember);

  async function updateRole(userId: string, newRole: Role) {
    await httpsCallable(functions, "updateUserRole")({ userId, newRole });
  }

  async function deleteUser(userId: string) {
    await httpsCallable(functions, "deleteUser")({ userId });
  }

  async function createMissingProfile(userId: string) {
    await httpsCallable(functions, "createMissingUserProfile")({ userId });
  }

  async function setAdminRole(userId: string, adminRole: string) {
    await httpsCallable(functions, "setPlatformAdminRole")({ userId, adminRole });
  }

  return (
    <div className="stack">
      <SectionIntro
        title="Access management"
        description="Manage platform administrators and global customer support. Business-linked people and records live under Businesses."
        stats={[
          ["Admins", String(countWhere(users, (item) => rowStatus(item, "role") === "admin"))],
          ["Business people", String(businessMemberCount)],
          ["Customers", String(countWhere(users, isCustomerAccount))],
          ["Global contacts", String(contactReferences.length)],
        ]}
      />
      <div className="tool-row">
        <SearchBox value={search} onChange={setSearch} placeholder="Search users" />
        {canManage && <CreatePersonForms runAction={runAction} roleOptions={roleOptions.filter((option) => option.key !== "superAdmin")} />}
      </div>
      {!canManage && (
        <div className="info-band">
          You have view access to people. Managing administrators, roles, and accounts requires the Super admin or User-management privilege.
        </div>
      )}
      <Panel
        title="Platform admins"
        icon={<Users size={18} />}
        action={
          <button className="secondary-button" disabled={loading} onClick={refreshUsers}>
            <RefreshCw className={loading ? "spin" : ""} size={15} />
            Refresh Auth
          </button>
        }
      >
        {error && <div className="inline-error">{error}</div>}
        {loading && <div className="empty-state">Loading user accounts...</div>}
        <div className="table">
          {platformAdmins.map((user) => {
            const isCurrentUser = text(user.uid ?? user.id, "") === currentUserId;
            const adminRole = text(user.adminRole, "superAdmin");
            return (
              <div className="table-row admin-row" key={user.id}>
                <div>
                  <strong>{userDisplayName(user)}</strong>
                  <small>{[userMeta(user), isCurrentUser ? "Signed in" : ""].filter(Boolean).join(" • ")}</small>
                </div>
                {canManage ? (
                  <select
                    aria-label="Access role"
                    disabled={isCurrentUser}
                    value={roleOptions.some((option) => option.key === adminRole) ? adminRole : "superAdmin"}
                    onChange={(event) =>
                      runAction("Admin role updated", () =>
                        setAdminRole(user.id, event.target.value),
                      )
                    }
                  >
                    {roleOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="admin-role-pill">{roleLabel(adminRole, permsConfig)}</span>
                )}
                {canManage && !isCurrentUser ? (
                  <button
                    className="danger-button"
                    onClick={() => {
                      if (window.confirm(`Delete ${text(user.email ?? user.fullName, user.id)}?`)) {
                        runAction("User deleted", () => deleteUser(user.id));
                      }
                    }}
                  >
                    <X size={15} />
                    Delete
                  </button>
                ) : (
                  <span className="muted-action">{isCurrentUser ? "You" : "—"}</span>
                )}
              </div>
            );
          })}
          {!loading && platformAdmins.length === 0 && (
            <div className="empty-state">No platform administrators match this search.</div>
          )}
        </div>
      </Panel>

      <Panel title="Customer accounts" icon={<UserCog size={18} />}>
        <div className="table">
          {customerAccounts.map((user) => (
            <div className="table-row" key={user.id}>
              <div>
                <strong>{userDisplayName(user)}</strong>
                <small>{userMeta(user)}</small>
              </div>
              {canManage ? (
                <>
                  <select
                    value={text(user.role, "customer")}
                    onChange={(event) =>
                      runAction("User role updated", () =>
                        updateRole(user.id, event.target.value as Role),
                      )
                    }
                  >
                    {accountRoleOptions.map((role) => (
                      <option key={role} value={role}>
                        {role}
                      </option>
                    ))}
                  </select>
                  <button
                    className="danger-button"
                    onClick={() => {
                      if (window.confirm(`Delete ${text(user.email ?? user.fullName, user.id)}?`)) {
                        runAction("User deleted", () => deleteUser(user.id));
                      }
                    }}
                  >
                    <X size={15} />
                    Delete
                  </button>
                </>
              ) : (
                <span className="status-pill">Customer</span>
              )}
            </div>
          ))}
          {!loading && customerAccounts.length === 0 && (
            <div className="empty-state">No customer accounts match this search.</div>
          )}
        </div>
      </Panel>

      <Panel title="Contact-only support references" icon={<ClipboardList size={18} />}>
        <div className="list-summary">
          These people were found on shipments, purchases, refunds, or service records. They are not editable accounts unless Firebase Auth has a matching user.
        </div>
        <div className="table">
          {contactReferences.map((user) => (
            <div className="table-row" key={user.id}>
              <div>
                <strong>{userDisplayName(user)}</strong>
                <small>{userMeta(user)}</small>
              </div>
              <span className="status-pill warning">Contact only</span>
              {canManage && user.hasAuth === true && user.hasProfile === false ? (
                  <button
                    onClick={() =>
                      runAction("User profile created", () => createMissingProfile(user.id))
                    }
                  >
                    <Check size={15} />
                    Create profile
                  </button>
                ) : user._inferred === true ? (
                  <span className="muted-action">Contact only</span>
                ) : (
                  <span className="muted-action">Needs Auth match</span>
                )}
            </div>
          ))}
          {!loading && contactReferences.length === 0 && (
            <div className="empty-state">No contact-only references match this search.</div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function buildRolesDraft(config: PermissionsConfig | null): Record<string, RoleConfig> {
  const roles = mergedRoles(config);
  const draft: Record<string, RoleConfig> = {};
  for (const [key, value] of Object.entries(roles)) {
    draft[key] = {
      label: value.label,
      builtIn: value.builtIn,
      sections: { ...value.sections },
      services: [...value.services],
    };
  }
  return draft;
}

const SETTINGS_SECTION_ROWS: Array<{ key: string; label: string; levels: AccessLevel[] }> = [
  ...EDITABLE_SECTIONS.map((section) => ({ key: section.key, label: section.label, levels: ACCESS_LEVELS })),
  ...EDITABLE_CAPS.map((extra) => ({ key: extra.key, label: extra.label, levels: ["none", "manage"] as AccessLevel[] })),
];

function SettingsView({
  config,
  currentUserId,
  previewMode,
  runAction,
}: {
  config: PermissionsConfig | null;
  currentUserId: string;
  previewMode: boolean;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [draft, setDraft] = useState<Record<string, RoleConfig>>(() => buildRolesDraft(config));
  const [saved, setSaved] = useState(true);
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const newRoleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraft(buildRolesDraft(config));
    setSaved(true);
  }, [config]);

  // Focus & select the name field of a freshly added role.
  useEffect(() => {
    if (focusKey && newRoleInputRef.current) {
      newRoleInputRef.current.focus();
      newRoleInputRef.current.select();
      newRoleInputRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
      setFocusKey(null);
    }
  }, [focusKey]);

  function update(roleKey: string, mutate: (role: RoleConfig) => void) {
    setDraft((current) => {
      const next = { ...current, [roleKey]: { ...current[roleKey], sections: { ...current[roleKey].sections }, services: [...current[roleKey].services] } };
      mutate(next[roleKey]);
      return next;
    });
    setSaved(false);
  }

  function setSection(roleKey: string, sectionKey: string, level: AccessLevel) {
    update(roleKey, (role) => { role.sections[sectionKey] = level; });
  }
  function toggleService(roleKey: string, serviceId: string) {
    update(roleKey, (role) => {
      role.services = role.services.includes(serviceId)
        ? role.services.filter((id) => id !== serviceId)
        : [...role.services, serviceId];
    });
  }
  function setLabel(roleKey: string, label: string) {
    update(roleKey, (role) => { role.label = label; });
  }
  function addRole() {
    const key = `role_${Date.now().toString(36)}`;
    setDraft((current) => ({
      ...current,
      [key]: {
        label: "New role",
        builtIn: false,
        sections: { people: "none", businesses: "none", marketplace: "none", operations: "none", finance: "none", website: "none", support: "none" },
        services: [],
      },
    }));
    setFocusKey(key);
    setSaved(false);
  }
  function confirmDelete(roleKey: string) {
    setDraft((current) => {
      const next = { ...current };
      delete next[roleKey];
      return next;
    });
    setPendingDelete(null);
    setSaved(false);
  }
  function resetDefaults() {
    setDraft(buildRolesDraft({}));
    setSaved(false);
  }
  async function save() {
    const cleaned: Record<string, RoleConfig> = {};
    for (const [key, role] of Object.entries(draft)) {
      cleaned[key] = { ...role, label: role.label.trim() || "Untitled role" };
    }
    if (previewMode) {
      setDraft(cleaned);
      setSaved(true);
      return;
    }
    await setDoc(doc(db, "platformConfig", "permissions"), {
      roles: cleaned,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId,
    });
    setSaved(true);
  }

  const roleKeys = Object.keys(draft);

  return (
    <div className="stack">
      <SectionIntro
        title="Settings"
        description="Configure how the console works. Create roles, decide what each one can see and do, and limit them to specific services."
        stats={[
          ["Roles", String(roleKeys.length + 1)],
          ["Services", String(PLATFORM_SERVICES.length)],
          ["Status", saved ? "Saved" : "Unsaved"],
        ]}
      />

      <Panel
        title="Roles & permissions"
        icon={<Shield size={18} />}
        action={
          <div className="panel-tools">
            <button className="secondary-button" type="button" onClick={addRole}>
              <Check size={15} />
              Add role
            </button>
            <button className="ghost-button" type="button" onClick={resetDefaults}>
              <RefreshCw size={15} />
              Reset
            </button>
            <button className="primary-button" type="button" disabled={saved} onClick={() => runAction("Roles & permissions saved", save)}>
              {saved ? "Saved" : "Save changes"}
            </button>
          </div>
        }
      >
        <div className="info-band">
          <strong>Super admin</strong> always has full access. For every other role, set each section to <b>None</b>, <b>View</b>, or <b>Manage</b>, and optionally limit it to specific services. Add as many roles as you need.
        </div>
        <div className="role-card-grid">
          {roleKeys.map((roleKey) => {
            const role = draft[roleKey];
            if (pendingDelete === roleKey) {
              return (
                <article className="role-card confirming" key={roleKey}>
                  <div className="role-delete-confirm">
                    <strong>Delete “{role.label || "this role"}”?</strong>
                    <p>Admins assigned to it keep dashboard-only access until you reassign them.</p>
                    <div className="role-delete-actions">
                      <button className="ghost-button" type="button" onClick={() => setPendingDelete(null)}>Cancel</button>
                      <button className="danger-button" type="button" onClick={() => confirmDelete(roleKey)}>
                        <X size={15} />
                        Delete role
                      </button>
                    </div>
                  </div>
                </article>
              );
            }
            return (
              <article className="role-card" key={roleKey}>
                <header className="role-card-head">
                  {role.builtIn ? (
                    <div className="role-title">
                      <strong>{role.label}</strong>
                      <span className="builtin-badge">Built-in</span>
                    </div>
                  ) : (
                    <input
                      ref={roleKey === focusKey ? newRoleInputRef : undefined}
                      className="role-name-input"
                      value={role.label}
                      placeholder="Role name"
                      onChange={(event) => setLabel(roleKey, event.target.value)}
                      onFocus={(event) => event.target.select()}
                      aria-label="Role name"
                    />
                  )}
                  {!role.builtIn && (
                    <button className="icon-danger" type="button" title="Delete role" onClick={() => setPendingDelete(roleKey)}>
                      <X size={15} />
                    </button>
                  )}
                </header>

                <div className="role-sections">
                  {SETTINGS_SECTION_ROWS.map((row) => (
                    <div className="role-section-row" key={row.key}>
                      <span>{row.label}</span>
                      <div className="level-toggle">
                        {row.levels.map((level) => (
                          <button
                            key={level}
                            type="button"
                            className={`level-${level} ${(role.sections[row.key] ?? "none") === level ? "active" : ""}`}
                            onClick={() => setSection(roleKey, row.key, level)}
                          >
                            {level === "none" ? "None" : level === "view" ? "View" : "Manage"}
                          </button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div className="role-services">
                  <span className="role-services-label">
                    Limited to services <small>{role.services.length ? "" : "(all services)"}</small>
                  </span>
                  <div className="service-checks">
                    {PLATFORM_SERVICES.map((service) => (
                      <label key={service.id} className={role.services.includes(service.id) ? "on" : ""}>
                        <input
                          type="checkbox"
                          checked={role.services.includes(service.id)}
                          onChange={() => toggleService(roleKey, service.id)}
                        />
                        {service.label}
                      </label>
                    ))}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </Panel>

      <MoreSettings
        currentUserId={currentUserId}
        previewMode={previewMode}
        runAction={runAction}
      />
    </div>
  );
}

const GENERAL_DEFAULTS = {
  branding: {
    platformName: "Laawol Digital",
    tagline: "Trusted services from registered businesses",
    supportEmail: "hello@laawoldigital.com",
    supportPhone: "",
    whatsapp: "",
    address: "",
  },
  shipping: {
    defaultBarrelPrice: "",
    destinations: [] as FirestoreRow[],
  },
  applications: {
    requireDocuments: true,
    requirePhone: true,
    requireAddress: false,
    requireService: true,
    autoApprove: false,
  },
  notifications: {
    purchaseStatus: true,
    shipmentStatus: true,
    refundDecision: true,
    newApplication: true,
    notifyAdmins: true,
  },
};

type GeneralSettings = typeof GENERAL_DEFAULTS;

function mergeGeneral(data: Record<string, unknown> | undefined): GeneralSettings {
  const d = data ?? {};
  const shipping = (d.shipping as { destinations?: unknown }) ?? {};
  return {
    branding: { ...GENERAL_DEFAULTS.branding, ...((d.branding as object) ?? {}) },
    shipping: {
      ...GENERAL_DEFAULTS.shipping,
      ...((d.shipping as object) ?? {}),
      destinations: Array.isArray(shipping.destinations)
        ? (shipping.destinations as FirestoreRow[])
        : [],
    },
    applications: { ...GENERAL_DEFAULTS.applications, ...((d.applications as object) ?? {}) },
    notifications: { ...GENERAL_DEFAULTS.notifications, ...((d.notifications as object) ?? {}) },
  };
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <div className="toggle-row">
      <span className="toggle-text">
        <b>{label}</b>
        {hint && <small>{hint}</small>}
      </span>
      <button
        type="button"
        className={`switch ${checked ? "on" : ""}`}
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
      >
        <span className="knob" />
      </button>
    </div>
  );
}

function MoreSettings({
  currentUserId,
  previewMode,
  runAction,
}: {
  currentUserId: string;
  previewMode: boolean;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [draft, setDraft] = useState<GeneralSettings>(() => mergeGeneral(undefined));
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let active = true;
    if (previewMode) {
      setDraft(mergeGeneral(undefined));
      setLoaded(true);
      return () => { active = false; };
    }
    getDoc(doc(db, "platformConfig", "general"))
      .then((snap) => {
        if (active) {
          setDraft(mergeGeneral(snap.exists() ? snap.data() : undefined));
          setLoaded(true);
        }
      })
      .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [previewMode]);

  function setBranding(key: string, value: string) {
    setDraft((d) => ({ ...d, branding: { ...d.branding, [key]: value } }));
  }
  function setShipping(key: string, value: unknown) {
    setDraft((d) => ({ ...d, shipping: { ...d.shipping, [key]: value } }));
  }
  function setApplications(key: string, value: boolean) {
    setDraft((d) => ({ ...d, applications: { ...d.applications, [key]: value } }));
  }
  function setNotifications(key: string, value: boolean) {
    setDraft((d) => ({ ...d, notifications: { ...d.notifications, [key]: value } }));
  }

  function addDestination() {
    setShipping("destinations", [
      ...draft.shipping.destinations,
      { name: "", code: "", price: "", minDays: "", maxDays: "" },
    ]);
  }
  function setDestination(index: number, key: string, value: string) {
    setShipping(
      "destinations",
      draft.shipping.destinations.map((row, i) => (i === index ? { ...row, [key]: value } : row)),
    );
  }
  function removeDestination(index: number) {
    setShipping("destinations", draft.shipping.destinations.filter((_, i) => i !== index));
  }

  async function saveSection(section: keyof GeneralSettings) {
    if (previewMode) return;
    await setDoc(
      doc(db, "platformConfig", "general"),
      { [section]: draft[section], updatedAt: serverTimestamp(), updatedBy: currentUserId },
      { merge: true },
    );
  }

  if (!loaded) {
    return (
      <Panel title="More settings" icon={<SlidersHorizontal size={18} />}>
        <EmptyState text="Loading settings…" />
      </Panel>
    );
  }

  return (
    <>
      <Panel
        title="Internal platform branding"
        icon={<Store size={18} />}
        action={<button className="primary-button compact" type="button" onClick={() => runAction("Branding saved", () => saveSection("branding"))}>Save</button>}
      >
        <div className="info-band">
          These settings stay in the admin and app configuration. Public website copy and marketing contact details are managed from Website.
        </div>
        <div className="settings-form">
          <label>Platform name<input value={draft.branding.platformName} onChange={(e) => setBranding("platformName", e.target.value)} /></label>
          <label>Tagline<input value={draft.branding.tagline} onChange={(e) => setBranding("tagline", e.target.value)} /></label>
          <label>Support email<input type="email" value={draft.branding.supportEmail} onChange={(e) => setBranding("supportEmail", e.target.value)} /></label>
          <label>Support phone<input value={draft.branding.supportPhone} onChange={(e) => setBranding("supportPhone", e.target.value)} /></label>
          <label>WhatsApp<input value={draft.branding.whatsapp} onChange={(e) => setBranding("whatsapp", e.target.value)} /></label>
          <label>Address<input value={draft.branding.address} onChange={(e) => setBranding("address", e.target.value)} /></label>
        </div>
      </Panel>

      <Panel
        title="Default barrel pricing & destinations"
        icon={<BadgeDollarSign size={18} />}
        action={<button className="primary-button compact" type="button" onClick={() => runAction("Shipping defaults saved", () => saveSection("shipping"))}>Save</button>}
      >
        <div className="settings-form narrow">
          <label>Default barrel price (USD)<input inputMode="decimal" value={String(draft.shipping.defaultBarrelPrice ?? "")} onChange={(e) => setShipping("defaultBarrelPrice", e.target.value)} placeholder="e.g. 275" /></label>
        </div>
        <div className="dest-editor">
          <div className="dest-editor-head"><span>Country</span><span>Code</span><span>Price</span><span>Min days</span><span>Max days</span><span></span></div>
          {draft.shipping.destinations.map((row, index) => (
            <div className="dest-editor-row" key={index}>
              <input placeholder="Country" value={text(row.name, "")} onChange={(e) => setDestination(index, "name", e.target.value)} />
              <input placeholder="Code" value={text(row.code, "")} onChange={(e) => setDestination(index, "code", e.target.value)} />
              <input placeholder="Price" inputMode="decimal" value={text(row.price, "")} onChange={(e) => setDestination(index, "price", e.target.value)} />
              <input placeholder="Min" inputMode="numeric" value={text(row.minDays, "")} onChange={(e) => setDestination(index, "minDays", e.target.value)} />
              <input placeholder="Max" inputMode="numeric" value={text(row.maxDays, "")} onChange={(e) => setDestination(index, "maxDays", e.target.value)} />
              <button className="icon-danger" type="button" title="Remove" onClick={() => removeDestination(index)}><X size={15} /></button>
            </div>
          ))}
          {draft.shipping.destinations.length === 0 && <EmptyState text="No default destinations yet." />}
          <button className="secondary-button" type="button" onClick={addDestination}>Add destination</button>
        </div>
      </Panel>

      <Panel
        title="Business application requirements"
        icon={<Building2 size={18} />}
        action={<button className="primary-button compact" type="button" onClick={() => runAction("Application rules saved", () => saveSection("applications"))}>Save</button>}
      >
        <div className="toggle-list">
          <ToggleRow label="Require business documents" hint="Applicants must upload verification documents" checked={draft.applications.requireDocuments} onChange={(v) => setApplications("requireDocuments", v)} />
          <ToggleRow label="Require phone number" checked={draft.applications.requirePhone} onChange={(v) => setApplications("requirePhone", v)} />
          <ToggleRow label="Require business address" checked={draft.applications.requireAddress} onChange={(v) => setApplications("requireAddress", v)} />
          <ToggleRow label="Require at least one service" checked={draft.applications.requireService} onChange={(v) => setApplications("requireService", v)} />
          <ToggleRow label="Auto-approve new businesses" hint="Skip manual review (not recommended)" checked={draft.applications.autoApprove} onChange={(v) => setApplications("autoApprove", v)} />
        </div>
      </Panel>

      <Panel
        title="Notifications & email preferences"
        icon={<Send size={18} />}
        action={<button className="primary-button compact" type="button" onClick={() => runAction("Notification preferences saved", () => saveSection("notifications"))}>Save</button>}
      >
        <div className="toggle-list">
          <ToggleRow label="Car purchase status emails" checked={draft.notifications.purchaseStatus} onChange={(v) => setNotifications("purchaseStatus", v)} />
          <ToggleRow label="Barrel shipment status emails" checked={draft.notifications.shipmentStatus} onChange={(v) => setNotifications("shipmentStatus", v)} />
          <ToggleRow label="Refund decision emails" checked={draft.notifications.refundDecision} onChange={(v) => setNotifications("refundDecision", v)} />
          <ToggleRow label="New business application emails" checked={draft.notifications.newApplication} onChange={(v) => setNotifications("newApplication", v)} />
          <ToggleRow label="Notify admins of new applications" checked={draft.notifications.notifyAdmins} onChange={(v) => setNotifications("notifyAdmins", v)} />
        </div>
      </Panel>
    </>
  );
}

const WEBSITE_HOME_DEFAULTS = {
  hero: {
    eyebrow: "Trusted service marketplace",
    headline: "Find the right business for the road home.",
    subheadline: "Laawol Digital is a platform where registered businesses offer diaspora services — shipping, cars, sourcing, food, and professional help. We bring the pricing, tracking, support, and accountability into one place so customers can choose with confidence.",
    primaryCtaLabel: "Get the app",
    primaryCtaHref: "app.html",
    secondaryCtaLabel: "Explore services",
    secondaryCtaHref: "services.html",
  },
  featured: {
    enabled: true,
    heading: "Featured businesses",
    subheading: "A curated group of approved partners with marketing-safe profiles.",
    maxToShow: 6,
  },
  sections: {
    servicesIntro: "Businesses register on Laawol to offer the services they are good at. You see their routes, pricing, service details, and status in one place, with platform support if something needs attention.",
  },
};

const WEBSITE_CONTACT_DEFAULTS = {
  supportEmail: "hello@laawoldigital.com",
  supportPhone: "",
  whatsapp: "",
  address: "",
};

type WebsiteHomeDraft = typeof WEBSITE_HOME_DEFAULTS;
type WebsiteContactDraft = typeof WEBSITE_CONTACT_DEFAULTS;

type FeaturedDraft = {
  businessId: string;
  displayName: string;
  logoUrl: string;
  blurb: string;
  servicesText: string;
  city: string;
  country: string;
  websiteUrl: string;
  order: string;
  active: boolean;
  featureConsent: boolean;
};

function mergeWebsiteHome(data: Record<string, unknown> | undefined): WebsiteHomeDraft {
  const d = data ?? {};
  return {
    hero: { ...WEBSITE_HOME_DEFAULTS.hero, ...((d.hero as object) ?? {}) },
    featured: { ...WEBSITE_HOME_DEFAULTS.featured, ...((d.featured as object) ?? {}) },
    sections: { ...WEBSITE_HOME_DEFAULTS.sections, ...((d.sections as object) ?? {}) },
  };
}

function mergeWebsiteContact(data: Record<string, unknown> | undefined): WebsiteContactDraft {
  return {
    ...WEBSITE_CONTACT_DEFAULTS,
    ...((data as object) ?? {}),
  };
}

function serviceDisplay(value: unknown) {
  const id = text(value, "");
  return businessServices.find((service) => service.id === id)?.label ?? id;
}

function featuredServices(row: FirestoreRow) {
  return Array.isArray(row.services)
    ? row.services.map((service) => text(service, "")).filter(Boolean)
    : [];
}

function servicesFromText(value: string) {
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function toggleStringValue(values: string[], value: string, enabled: boolean) {
  if (enabled) return Array.from(new Set([...values, value]));
  return values.filter((item) => item !== value);
}

function locationCountry(row: FirestoreRow | undefined) {
  return text(row?.country ?? row?.countryName ?? row?.locationCountry, "").trim();
}

function locationCity(row: FirestoreRow | undefined) {
  return text(row?.city ?? row?.locationCity, "").trim();
}

function sortedLocationValues(values: string[], currentValue: string) {
  const seen = new Set<string>();
  const options = values
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value) => {
        const key = value.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.localeCompare(b));
  const current = currentValue.trim();
  if (current && !seen.has(current.toLowerCase())) {
    options.unshift(current);
  }
  return options;
}

function draftFromBusiness(
  business: FirestoreRow | undefined,
  featured: FirestoreRow | undefined,
  nextOrder: number,
): FeaturedDraft {
  const services = featuredServices(featured ?? {id: ""});
  const fallbackServices = Array.isArray(business?.enabledServices)
    ? (business?.enabledServices as unknown[]).map((service) => text(service, "")).filter(Boolean)
    : [];
  return {
    businessId: text(featured?.businessId ?? business?.id, ""),
    displayName: text(featured?.displayName ?? business?.name ?? business?.businessName, ""),
    logoUrl: text(featured?.logoUrl ?? business?.logoUrl ?? business?.profileImageUrl, ""),
    blurb: text(featured?.blurb ?? business?.marketingBlurb, ""),
    servicesText: (services.length ? services : fallbackServices).join(", "),
    city: text(featured?.city ?? locationCity(business), ""),
    country: text(featured?.country ?? locationCountry(business), ""),
    websiteUrl: text(featured?.websiteUrl ?? business?.website, ""),
    order: String(featured?.order ?? business?.featureOrder ?? nextOrder),
    active: featured?.active !== false,
    featureConsent: featured?.featureConsent === true || business?.featureConsent === true,
  };
}

function emptyFeaturedDraft(nextOrder = 1): FeaturedDraft {
  return draftFromBusiness(undefined, undefined, nextOrder);
}

function missingFeatureItems(business: FirestoreRow | undefined, draft: FeaturedDraft) {
  const services = draft.servicesText.split(",").map((item) => item.trim()).filter(Boolean);
  const missing = [];
  if (text(business?.status, "") !== "approved") missing.push("approved business status");
  if (!draft.displayName.trim()) missing.push("display name");
  if (!draft.logoUrl.trim()) missing.push("logo");
  if (!draft.blurb.trim()) missing.push("short blurb");
  if (draft.blurb.trim().length > 140) missing.push("blurb under 140 characters");
  if (services.length === 0) missing.push("at least one service");
  if (!draft.featureConsent) missing.push("feature consent");
  return missing;
}

function WebsiteView({
  businesses,
  currentUserId,
  featuredBusinesses,
  previewMode,
  runAction,
}: {
  businesses: FirestoreRow[];
  currentUserId: string;
  featuredBusinesses: FirestoreRow[];
  previewMode: boolean;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [homeDraft, setHomeDraft] = useState<WebsiteHomeDraft>(() => mergeWebsiteHome(undefined));
  const [contactDraft, setContactDraft] = useState<WebsiteContactDraft>(() => mergeWebsiteContact(undefined));
  const [loaded, setLoaded] = useState(false);
  const [featureDraft, setFeatureDraft] = useState<FeaturedDraft>(() => emptyFeaturedDraft());
  const [editingId, setEditingId] = useState("");
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const sortedFeatured = useMemo(() => {
    return [...featuredBusinesses].sort((a, b) => {
      const byOrder = numberValue(a.order) - numberValue(b.order);
      if (byOrder !== 0) return byOrder;
      return text(a.displayName, a.id).localeCompare(text(b.displayName, b.id));
    });
  }, [featuredBusinesses]);
  const nextOrder = sortedFeatured.length + 1;
  const selectedBusiness = businesses.find((business) => business.id === featureDraft.businessId);
  const requests = businesses.filter((business) => text(business.featureStatus, "") === "requested");
  const eligibleBusinesses = businesses.filter((business) => business._inferred !== true);
  const locationOptions = useMemo(() => {
    const countryValues = [
      ...eligibleBusinesses.map(locationCountry),
      ...sortedFeatured.map(locationCountry),
    ];
    const selectedCountry = featureDraft.country.trim();
    const cityValues = [
      ...eligibleBusinesses
          .filter((business) => !selectedCountry || locationCountry(business) === selectedCountry)
          .map(locationCity),
      ...sortedFeatured
          .filter((row) => !selectedCountry || locationCountry(row) === selectedCountry)
          .map(locationCity),
    ];
    return {
      countries: sortedLocationValues(countryValues, featureDraft.country),
      cities: sortedLocationValues(cityValues, featureDraft.city),
    };
  }, [eligibleBusinesses, sortedFeatured, featureDraft.country, featureDraft.city]);

  useEffect(() => {
    let active = true;
    if (previewMode) {
      setHomeDraft(mergeWebsiteHome(undefined));
      setContactDraft(mergeWebsiteContact(undefined));
      setLoaded(true);
      return () => { active = false; };
    }
    Promise.all([
      getDoc(doc(db, "websiteContent", "home")),
      getDoc(doc(db, "websiteContent", "contact")),
    ])
        .then(([homeSnap, contactSnap]) => {
          if (!active) return;
          setHomeDraft(mergeWebsiteHome(homeSnap.exists() ? homeSnap.data() : undefined));
          setContactDraft(mergeWebsiteContact(contactSnap.exists() ? contactSnap.data() : undefined));
          setLoaded(true);
        })
        .catch(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [previewMode]);

  useEffect(() => {
    if (!featureDraft.businessId) {
      setFeatureDraft((current) => ({...current, order: current.order || String(nextOrder)}));
    }
  }, [featureDraft.businessId, nextOrder]);

  function setHero(key: keyof WebsiteHomeDraft["hero"], value: string) {
    setHomeDraft((draft) => ({...draft, hero: {...draft.hero, [key]: value}}));
  }
  function setFeatured(key: keyof WebsiteHomeDraft["featured"], value: boolean | number | string) {
    setHomeDraft((draft) => ({...draft, featured: {...draft.featured, [key]: value}}));
  }
  function setSection(key: keyof WebsiteHomeDraft["sections"], value: string) {
    setHomeDraft((draft) => ({...draft, sections: {...draft.sections, [key]: value}}));
  }
  function setContact(key: keyof WebsiteContactDraft, value: string) {
    setContactDraft((draft) => ({...draft, [key]: value}));
  }
  function setFeatureField(key: keyof FeaturedDraft, value: string | boolean) {
    setFeatureDraft((draft) => ({...draft, [key]: value}));
  }
  function setFeatureCountry(country: string) {
    setFeatureDraft((draft) => ({
      ...draft,
      country,
      city: country === draft.country ? draft.city : "",
    }));
  }
  function setFeatureService(serviceId: string, enabled: boolean) {
    setFeatureDraft((draft) => ({
      ...draft,
      servicesText: toggleStringValue(
          servicesFromText(draft.servicesText),
          serviceId,
          enabled,
      ).join(", "),
    }));
  }
  function selectBusiness(businessId: string) {
    const business = businesses.find((row) => row.id === businessId);
    const featured = sortedFeatured.find((row) => text(row.businessId ?? row.id, "") === businessId);
    setFeatureDraft(draftFromBusiness(business, featured, nextOrder));
    setEditingId(featured ? text(featured.businessId ?? featured.id, "") : "");
  }
  function editFeatured(row: FirestoreRow) {
    const businessId = text(row.businessId ?? row.id, "");
    const business = businesses.find((item) => item.id === businessId);
    setFeatureDraft(draftFromBusiness(business, row, nextOrder));
    setEditingId(businessId);
  }
  function clearFeatureForm() {
    setFeatureDraft(emptyFeaturedDraft(nextOrder));
    setEditingId("");
  }
  async function saveHome() {
    if (previewMode) return;
    await setDoc(doc(db, "websiteContent", "home"), {
      ...homeDraft,
      featured: {
        ...homeDraft.featured,
        maxToShow: Math.max(1, Math.min(8, Number(homeDraft.featured.maxToShow) || 6)),
      },
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId,
    }, {merge: true});
  }
  async function saveContact() {
    if (previewMode) return;
    await setDoc(doc(db, "websiteContent", "contact"), {
      ...contactDraft,
      updatedAt: serverTimestamp(),
      updatedBy: currentUserId,
    }, {merge: true});
  }
  async function uploadLogo(file: File) {
    if (!featureDraft.businessId) throw new Error("Choose a business before uploading a logo.");
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `businessLogos/${featureDraft.businessId}/logo_${Date.now()}.${extension}`;
    const target = storageRef(storage, path);
    setUploadingLogo(true);
    try {
      await uploadBytes(target, file, {contentType: file.type || "image/jpeg"});
      const url = await getDownloadURL(target);
      setFeatureField("logoUrl", url);
    } finally {
      setUploadingLogo(false);
    }
  }
  async function publishDraft(overrides: Partial<FeaturedDraft> = {}) {
    const next = {...featureDraft, ...overrides};
    const business = businesses.find((row) => row.id === next.businessId);
    const missing = missingFeatureItems(business, next);
    if (missing.length > 0) throw new Error(`Missing: ${missing.join(", ")}`);
    await httpsCallable(functions, "publishFeaturedBusiness")({
      businessId: next.businessId,
      displayName: next.displayName.trim(),
      logoUrl: next.logoUrl.trim(),
      blurb: next.blurb.trim(),
      services: servicesFromText(next.servicesText),
      city: next.city.trim(),
      country: next.country.trim(),
      websiteUrl: next.websiteUrl.trim(),
      order: Number(next.order) || 0,
      active: next.active,
      featureConsent: next.featureConsent,
    });
    clearFeatureForm();
  }
  async function publishExisting(row: FirestoreRow, patch: Partial<FeaturedDraft>) {
    const businessId = text(row.businessId ?? row.id, "");
    const business = businesses.find((item) => item.id === businessId);
    const draft = {
      ...draftFromBusiness(business, row, nextOrder),
      ...patch,
    };
    const services = servicesFromText(draft.servicesText);
    await httpsCallable(functions, "publishFeaturedBusiness")({
      businessId,
      displayName: draft.displayName.trim(),
      logoUrl: draft.logoUrl.trim(),
      blurb: draft.blurb.trim(),
      services,
      city: draft.city.trim(),
      country: draft.country.trim(),
      websiteUrl: draft.websiteUrl.trim(),
      order: Number(draft.order) || 0,
      active: draft.active,
      featureConsent: draft.featureConsent,
    });
  }
  async function moveFeatured(row: FirestoreRow, direction: -1 | 1) {
    const index = sortedFeatured.findIndex((item) => item.id === row.id);
    const target = sortedFeatured[index + direction];
    if (index < 0 || !target) return;
    const currentOrder = numberValue(row.order) || index + 1;
    const targetOrder = numberValue(target.order) || index + direction + 1;
    await Promise.all([
      publishExisting(row, {order: String(targetOrder)}),
      publishExisting(target, {order: String(currentOrder)}),
    ]);
  }
  async function unpublish(row: FirestoreRow) {
    await httpsCallable(functions, "unpublishFeaturedBusiness")({
      businessId: text(row.businessId ?? row.id, ""),
    });
  }

  if (!loaded) {
    return (
      <div className="stack">
        <Panel title="Website" icon={<Store size={18} />}>
          <EmptyState text="Loading website content..." />
        </Panel>
      </div>
    );
  }

  return (
    <div className="stack">
      <SectionIntro
        title="Website"
        description="Edit public site copy and curate the small approved set of businesses shown on the marketing homepage."
        stats={[
          ["Featured", String(sortedFeatured.length)],
          ["Requests", String(requests.length)],
          ["Homepage cap", String(homeDraft.featured.maxToShow)],
        ]}
      />

      <Panel
        title="Homepage content"
        icon={<Store size={18} />}
        action={<a className="secondary-button compact" href="https://laawoldigital.com" target="_blank" rel="noreferrer"><ArrowUpRight size={15} />View site</a>}
      >
        <div className="settings-form">
          <label>Hero eyebrow<input value={homeDraft.hero.eyebrow} onChange={(e) => setHero("eyebrow", e.target.value)} /></label>
          <label>Headline<input value={homeDraft.hero.headline} onChange={(e) => setHero("headline", e.target.value)} /></label>
          <label className="wide-field">Subheadline<textarea value={homeDraft.hero.subheadline} onChange={(e) => setHero("subheadline", e.target.value)} rows={4} /></label>
          <label>Primary CTA label<input value={homeDraft.hero.primaryCtaLabel} onChange={(e) => setHero("primaryCtaLabel", e.target.value)} /></label>
          <label>Primary CTA href<input value={homeDraft.hero.primaryCtaHref} onChange={(e) => setHero("primaryCtaHref", e.target.value)} /></label>
          <label>Secondary CTA label<input value={homeDraft.hero.secondaryCtaLabel} onChange={(e) => setHero("secondaryCtaLabel", e.target.value)} /></label>
          <label>Secondary CTA href<input value={homeDraft.hero.secondaryCtaHref} onChange={(e) => setHero("secondaryCtaHref", e.target.value)} /></label>
          <label>Featured heading<input value={homeDraft.featured.heading} onChange={(e) => setFeatured("heading", e.target.value)} /></label>
          <label>Featured max<input type="number" min="1" max="8" value={String(homeDraft.featured.maxToShow)} onChange={(e) => setFeatured("maxToShow", Number(e.target.value))} /></label>
          <label className="wide-field">Featured subheading<textarea value={homeDraft.featured.subheading} onChange={(e) => setFeatured("subheading", e.target.value)} rows={3} /></label>
          <label className="wide-field">Services intro<textarea value={homeDraft.sections.servicesIntro} onChange={(e) => setSection("servicesIntro", e.target.value)} rows={3} /></label>
        </div>
        <div className="website-panel-footer">
          <ToggleRow label="Show featured businesses" checked={homeDraft.featured.enabled} onChange={(value) => setFeatured("enabled", value)} />
          <button className="primary-button compact" type="button" onClick={() => runAction("Website content saved", saveHome)}>Save content</button>
        </div>
      </Panel>

      <Panel
        title="Public website contact"
        icon={<Send size={18} />}
        action={<button className="primary-button compact" type="button" onClick={() => runAction("Website contact saved", saveContact)}>Save</button>}
      >
        <div className="info-band">
          These fields are public. Keep private platform settings in Settings; only marketing-safe contact details belong here.
        </div>
        <div className="settings-form">
          <label>Support email<input type="email" value={contactDraft.supportEmail} onChange={(e) => setContact("supportEmail", e.target.value)} /></label>
          <label>Support phone<input value={contactDraft.supportPhone} onChange={(e) => setContact("supportPhone", e.target.value)} /></label>
          <label>WhatsApp<input value={contactDraft.whatsapp} onChange={(e) => setContact("whatsapp", e.target.value)} /></label>
          <label>Address<input value={contactDraft.address} onChange={(e) => setContact("address", e.target.value)} /></label>
        </div>
      </Panel>

      <div className="split-grid">
        <Panel title="Featuring requests" icon={<ClipboardList size={18} />}>
          <div className="website-request-list">
            {requests.map((business) => {
              const draft = draftFromBusiness(business, undefined, nextOrder);
              const missing = missingFeatureItems(business, draft);
              return (
                <article className="website-request-row" key={business.id}>
                  <div>
                    <strong>{text(business.name, business.id)}</strong>
                    <small>{missing.length ? `Missing: ${missing.join(", ")}` : "Ready to review"}</small>
                  </div>
                  <button className="secondary-button compact" type="button" onClick={() => selectBusiness(business.id)}>Review</button>
                </article>
              );
            })}
            {requests.length === 0 && <EmptyState text="No featuring requests yet." />}
          </div>
        </Panel>

        <Panel title={editingId ? "Edit featured business" : "Add featured business"} icon={<Building2 size={18} />}>
          <div className="settings-form website-feature-form">
            <label className="wide-field">Business
              <select value={featureDraft.businessId} onChange={(event) => selectBusiness(event.target.value)}>
                <option value="">Choose a business</option>
                {eligibleBusinesses.map((business) => (
                  <option key={business.id} value={business.id}>{text(business.name, business.id)}</option>
                ))}
              </select>
            </label>
            <label>Display name<input value={featureDraft.displayName} onChange={(e) => setFeatureField("displayName", e.target.value)} /></label>
            <label>Order<input inputMode="numeric" value={featureDraft.order} onChange={(e) => setFeatureField("order", e.target.value)} /></label>
            <label className="wide-field">Logo URL<input value={featureDraft.logoUrl} onChange={(e) => setFeatureField("logoUrl", e.target.value)} /></label>
            <label className="wide-field">Upload logo
              <input type="file" accept="image/*" disabled={!featureDraft.businessId || uploadingLogo} onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                runAction("Logo uploaded", () => uploadLogo(file));
                event.target.value = "";
              }} />
            </label>
            <label className="wide-field">Short blurb ({featureDraft.blurb.length}/140)<textarea value={featureDraft.blurb} onChange={(e) => setFeatureField("blurb", e.target.value)} maxLength={140} rows={3} /></label>
            <fieldset className="wide-field service-checks">
              <legend>Services</legend>
              {businessServices.map((service) => (
                <label className="switch-line" key={service.id}>
                  <input
                    checked={servicesFromText(featureDraft.servicesText).includes(service.id)}
                    type="checkbox"
                    onChange={(event) => setFeatureService(service.id, event.target.checked)}
                  />
                  <span>{service.label}</span>
                </label>
              ))}
            </fieldset>
            <label>Country
              <select value={featureDraft.country} disabled={!featureDraft.businessId} onChange={(e) => setFeatureCountry(e.target.value)}>
                <option value="">Select country</option>
                {locationOptions.countries.map((country) => (
                  <option key={country} value={country}>{country}</option>
                ))}
              </select>
            </label>
            <label>City
              <select value={featureDraft.city} disabled={!featureDraft.businessId || !featureDraft.country} onChange={(e) => setFeatureField("city", e.target.value)}>
                <option value="">Select city</option>
                {locationOptions.cities.map((city) => (
                  <option key={city} value={city}>{city}</option>
                ))}
              </select>
            </label>
            <label className="wide-field">Website URL<input value={featureDraft.websiteUrl} onChange={(e) => setFeatureField("websiteUrl", e.target.value)} /></label>
          </div>
          <div className="website-panel-footer stacked">
            <ToggleRow label="Business has consented to being featured" checked={featureDraft.featureConsent} onChange={(value) => setFeatureField("featureConsent", value)} />
            <ToggleRow label="Active on public site" checked={featureDraft.active} onChange={(value) => setFeatureField("active", value)} />
            {featureDraft.businessId && (
              <div className="info-band">
                {missingFeatureItems(selectedBusiness, featureDraft).length
                  ? `Gate: ${missingFeatureItems(selectedBusiness, featureDraft).join(", ")}`
                  : "Ready to publish."}
              </div>
            )}
            <div className="panel-tools">
              <button className="ghost-button" type="button" onClick={clearFeatureForm}>Clear</button>
              <button className="primary-button compact" type="button" disabled={!featureDraft.businessId} onClick={() => runAction("Featured business published", () => publishDraft())}>
                {editingId ? "Save featured" : "Publish"}
              </button>
            </div>
          </div>
        </Panel>
      </div>

      <Panel title="Approved featured businesses" icon={<Check size={18} />}>
        <div className="featured-admin-list">
          {sortedFeatured.map((row, index) => (
            <article className="featured-admin-row" key={row.id}>
              <img src={text(row.logoUrl, "")} alt="" />
              <div>
                <strong>{text(row.displayName, row.id)}</strong>
                <small>{text(row.blurb, "")}</small>
                <div className="service-checks compact">
                  {featuredServices(row).map((service) => <span key={service}>{serviceDisplay(service)}</span>)}
                </div>
              </div>
              <div className="featured-admin-actions">
                <span className={`status-pill compact ${row.active === false ? "warning" : ""}`}>{row.active === false ? "Hidden" : "Active"}</span>
                <button
                  className="ghost-button compact"
                  type="button"
                  disabled={index === 0}
                  onClick={() => runAction("Featured order updated", () =>
                    moveFeatured(row, -1),
                  )}
                >
                  Up
                </button>
                <button
                  className="ghost-button compact"
                  type="button"
                  disabled={index === sortedFeatured.length - 1}
                  onClick={() => runAction("Featured order updated", () =>
                    moveFeatured(row, 1),
                  )}
                >
                  Down
                </button>
                <button className="secondary-button compact" type="button" onClick={() => editFeatured(row)}>Edit</button>
                <button className="secondary-button compact" type="button" onClick={() => runAction("Featured business updated", () => publishExisting(row, {active: row.active === false}))}>{row.active === false ? "Show" : "Hide"}</button>
                <button className="danger-button compact" type="button" onClick={() => {
                  if (window.confirm(`Remove ${text(row.displayName, row.id)} from the public site?`)) {
                    runAction("Featured business removed", () => unpublish(row));
                  }
                }}>Remove</button>
              </div>
            </article>
          ))}
          {sortedFeatured.length === 0 && <EmptyState text="No public featured businesses have been approved yet." />}
        </div>
      </Panel>
    </div>
  );
}

function AdminAccountPanel({
  firebaseUser,
  open,
  onClose,
  perms,
  profile,
  onProfileUpdated,
  runAction,
}: {
  firebaseUser: User | null;
  open: boolean;
  onClose: () => void;
  perms: Perms;
  profile: UserProfile | null;
  onProfileUpdated: (profile: UserProfile | null) => void;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [fullName, setFullName] = useState(text(profile?.fullName, ""));
  const [phone, setPhone] = useState(text(profile?.phone ?? firebaseUser?.phoneNumber, ""));
  const [photoUrl, setPhotoUrl] = useState(text(profile?.profileImageUrl, ""));
  const [photoPath, setPhotoPath] = useState(text(profile?.profileImagePath, ""));
  const [verificationId, setVerificationId] = useState("");
  const [verificationCode, setVerificationCode] = useState("");
  const [uploading, setUploading] = useState(false);
  const recaptchaVerifier = useRef<RecaptchaVerifier | null>(null);

  useEffect(() => {
    setFullName(text(profile?.fullName, ""));
    setPhone(text(profile?.phone ?? firebaseUser?.phoneNumber, ""));
    setPhotoUrl(text(profile?.profileImageUrl, ""));
    setPhotoPath(text(profile?.profileImagePath, ""));
  }, [profile, firebaseUser]);

  async function updateProfile(payload: Record<string, unknown>) {
    const result = await httpsCallable(functions, "updateCurrentAdminProfile")(payload);
    const data = result.data as {profile?: UserProfile};
    if (data.profile) {
      onProfileUpdated({
        ...(profile ?? {id: firebaseUser?.uid ?? ""}),
        ...data.profile,
      });
    }
  }

  async function saveProfile(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    await updateProfile({
      fullName: fullName.trim(),
      phone: phone.trim(),
      profileImageUrl: photoUrl.trim(),
      profileImagePath: photoPath.trim(),
    });
  }

  async function uploadPhoto(file: File) {
    if (!firebaseUser) throw new Error("Sign in before uploading a profile photo.");
    const extension = file.name.split(".").pop()?.toLowerCase() || "jpg";
    const path = `users/${firebaseUser.uid}/admin_profile_${Date.now()}.${extension}`;
    const target = storageRef(storage, path);
    setUploading(true);
    try {
      await uploadBytes(target, file, {contentType: file.type || "image/jpeg"});
      const url = await getDownloadURL(target);
      setPhotoUrl(url);
      setPhotoPath(path);
      await updateProfile({
        fullName: fullName.trim(),
        phone: phone.trim(),
        profileImageUrl: url,
        profileImagePath: path,
      });
    } finally {
      setUploading(false);
    }
  }

  async function sendPhoneCode() {
    if (!phone.trim()) throw new Error("Enter a phone number first.");
    if (!firebaseUser) throw new Error("Sign in before confirming your phone.");
    if (!recaptchaVerifier.current) {
      recaptchaVerifier.current = new RecaptchaVerifier(auth, "admin-phone-recaptcha", {
        size: "invisible",
      });
    }
    const provider = new PhoneAuthProvider(auth);
    const id = await provider.verifyPhoneNumber(phone.trim(), recaptchaVerifier.current);
    setVerificationId(id);
  }

  async function confirmPhoneCode() {
    if (!firebaseUser) throw new Error("Sign in before confirming your phone.");
    if (!verificationId || !verificationCode.trim()) {
      throw new Error("Send a code and enter it before confirming.");
    }
    const credential = PhoneAuthProvider.credential(verificationId, verificationCode.trim());
    await updatePhoneNumber(firebaseUser, credential);
    await updateProfile({
      fullName: fullName.trim(),
      phone: phone.trim(),
      profileImageUrl: photoUrl.trim(),
      profileImagePath: photoPath.trim(),
      phoneVerified: true,
    });
    setVerificationCode("");
    setVerificationId("");
  }

  const phoneVerified = profile?.phoneVerified === true ||
    (firebaseUser?.phoneNumber && firebaseUser.phoneNumber === phone.trim());
  const displayName = fullName || text(profile?.fullName ?? firebaseUser?.displayName, "Platform Administrator");
  const email = firebaseUser?.email ?? text(profile?.email, "");
  const initials = businessInitials(displayName || email || "Admin");

  if (!open) return null;

  return (
    <div className="account-overlay" role="presentation">
      <button className="account-backdrop" onClick={onClose} type="button" aria-label="Dismiss account settings" />
      <aside aria-modal="true" className="account-drawer" role="dialog">
        <div className="account-drawer-head">
          <div className="account-id">
            <div className="account-avatar">
              {photoUrl ? <img alt="Admin profile" src={photoUrl} /> : <span>{initials}</span>}
            </div>
            <div>
              <h2>Account settings</h2>
              <p>{[perms.label, email].filter(Boolean).join(" • ") || displayName}</p>
            </div>
          </div>
          <button className="icon-button subtle" onClick={onClose} title="Close account settings" type="button">
            <X size={18} />
          </button>
        </div>
        <form
          className="account-form"
          onSubmit={(event) => {
            event.preventDefault();
            runAction("Profile updated", () => saveProfile());
          }}
        >
          <section className="account-photo-row">
            <div className="account-avatar large">
              {photoUrl ? <img alt="Admin profile" src={photoUrl} /> : <span>{initials}</span>}
            </div>
            <div>
              <strong>Profile photo</strong>
              <small>Used in the admin header and audit/account context.</small>
            </div>
            <label className="secondary-button account-upload">
              {uploading ? "Uploading..." : "Upload photo"}
              <input
                accept="image/*"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    runAction("Profile photo uploaded", () => uploadPhoto(file));
                  }
                }}
                type="file"
              />
            </label>
          </section>
          <div className="account-fields">
            <label>
              <span>Name</span>
              <input value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Full name" />
            </label>
            <label>
              <span>Email</span>
              <input disabled value={email} />
            </label>
            <label className="account-phone-field">
              <span className="field-label-row">
                <span>Phone</span>
                <span className={`status-pill compact ${phoneVerified ? "" : "warning"}`}>
                  {phoneVerified ? "Confirmed" : "Not confirmed"}
                </span>
              </span>
              <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+15551234567" />
            </label>
            <label>
              <span>Photo URL</span>
              <input value={photoUrl} onChange={(event) => setPhotoUrl(event.target.value)} placeholder="https://..." />
            </label>
          </div>
          <section className="account-phone-card">
            <div>
              <strong>Phone confirmation</strong>
              <small>Firebase SMS confirms this phone on the signed-in admin account.</small>
            </div>
            <div className="phone-confirm-actions">
              <button
                className="secondary-button"
                onClick={() => runAction("Phone verification code sent", sendPhoneCode)}
                type="button"
              >
                Send code
              </button>
              <input
                inputMode="numeric"
                onChange={(event) => setVerificationCode(event.target.value)}
                placeholder="SMS code"
                value={verificationCode}
              />
              <button
                className="primary-button"
                disabled={!verificationId}
                onClick={() => runAction("Phone confirmed", confirmPhoneCode)}
                type="button"
              >
                Confirm
              </button>
            </div>
            <div id="admin-phone-recaptcha" />
          </section>
          <div className="account-drawer-actions">
            <button className="secondary-button" onClick={onClose} type="button">Cancel</button>
            <button className="primary-button" type="submit">Save changes</button>
          </div>
        </form>
      </aside>
    </div>
  );
}

function CreatePersonForms({
  runAction,
  roleOptions,
}: {
  runAction: (label: string, action: () => Promise<unknown>) => void;
  roleOptions: Array<{ key: string; label: string }>;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [platformAdminRole, setPlatformAdminRole] = useState<string>("operationsManager");

  function reset() {
    setFullName("");
    setEmail("");
    setPhone("");
    setPassword("");
    setPlatformAdminRole("operationsManager");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const payload = {
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      password,
      adminRole: platformAdminRole,
    };
    await httpsCallable(functions, "createPlatformManager")(payload);
    reset();
  }

  return (
    <form
      className="inline-form"
      onSubmit={(event) => runAction("Platform manager created", () => submit(event))}
    >
      <span className="form-note strong">Platform manager</span>
      <input required autoComplete="name" name="fullName" placeholder="Name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
      <input required autoComplete="username" name="username" placeholder="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <input autoComplete="tel" name="phone" placeholder="Phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
      <input required autoComplete="new-password" minLength={6} name="new-password" placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <select value={platformAdminRole} onChange={(event) => setPlatformAdminRole(event.target.value)}>
        {roleOptions.map((option) => (
          <option key={option.key} value={option.key}>
            {option.label}
          </option>
        ))}
      </select>
      <button className="primary-button">
        Create
      </button>
    </form>
  );
}

function relatedRecordTitle(item: FirestoreRow, fallback: string) {
  return text(
      item.trackingCode ??
      item.purchaseCode ??
      item.title ??
      item.carTitle ??
      item.id,
      fallback,
  );
}

function relatedContactSummary(item: FirestoreRow) {
  return [
    item.senderName ? `Sender ${text(item.senderName, "")}` : null,
    item.receiverName ? `Receiver ${text(item.receiverName, "")}` : null,
    item.buyerName ? `Buyer ${text(item.buyerName, "")}` : null,
    item.customerName ? `Customer ${text(item.customerName, "")}` : null,
    item.ownerName ? `Owner ${text(item.ownerName, "")}` : null,
    item.customerEmail ?? item.buyerEmail ?? item.ownerEmail ?? item.senderEmail,
    item.customerPhone ?? item.buyerPhone ?? item.ownerPhone ?? item.senderPhone ?? item.receiverPhone,
  ].filter(Boolean).join(" • ");
}

function relatedRecordMeta(item: FirestoreRow, statusField = "status") {
  return [
    statusLabel(item[statusField]),
    item.destinationCountryName,
    item.paymentStatus,
    optionalMoney(item.price ?? item.totalCost ?? item.depositAmount, text(item.depositCurrency, "USD")),
    relatedContactSummary(item),
  ].filter(Boolean).join(" • ");
}

function BusinessesView({
  businesses,
  users,
  cars,
  shipments,
  transports,
  parkedCars,
  purchases,
  refunds,
  destinations,
  contactReferences,
  applications,
  notifications,
  supportRequests,
  runAction,
}: {
  businesses: FirestoreRow[];
  users: FirestoreRow[];
  cars: FirestoreRow[];
  shipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
  purchases: FirestoreRow[];
  refunds: FirestoreRow[];
  destinations: FirestoreRow[];
  contactReferences: FirestoreRow[];
  applications: FirestoreRow[];
  notifications: FirestoreRow[];
  supportRequests: FirestoreRow[];
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [serviceNote, setServiceNote] = useState("");
  const [enabledServices, setEnabledServices] = useState<string[]>(
    businessServices.map((service) => service.id),
  );
  const [search, setSearch] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>("");
  const assignableUsers = useMemo(() => {
    return users
        .filter((user) => user._inferred !== true)
        .filter((user) => user.hasProfile !== false)
        .filter((user) => user.hasAuth !== false)
        .filter((user) => text(user.role, "customer") !== "admin")
        .sort((a, b) => userDisplayName(a).localeCompare(userDisplayName(b)));
  }, [users]);

  function toggleService(serviceId: string) {
    setEnabledServices((current) =>
      current.includes(serviceId)
        ? current.filter((item) => item !== serviceId)
        : [...current, serviceId],
    );
  }

  async function saveBusiness(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabledServices.length) {
      throw new Error("Choose at least one service for this business.");
    }
    await httpsCallable(functions, "createAdminBusiness")({
      name: name.trim(),
      phone: phone.trim(),
      email: email.trim(),
      enabledServices,
      serviceNote: serviceNote.trim(),
      status: "pending",
    });
    setName("");
    setPhone("");
    setEmail("");
    setServiceNote("");
    setEnabledServices(businessServices.map((service) => service.id));
  }

  async function updateMembership({
    userId,
    role,
    businessId,
  }: {
    userId: string;
    role: "businessOwner" | "staff" | "customer";
    businessId?: string;
  }) {
    await httpsCallable(functions, "updateBusinessMembership")({
      userId,
      role,
      businessId: role === "customer" ? "" : businessId,
    });
  }

  async function createMissingBusinessProfile(business: FirestoreRow) {
    await httpsCallable(functions, "createMissingBusinessProfile")({
      businessId: business.id,
      name: text(business.name, business.id),
      phone: text(business.phone, ""),
      email: text(business.email, ""),
      serviceNote: "Created from existing marketplace or operations records.",
      status: text(business.businessStatus, "approved"),
      enabledServices: Array.isArray(business.enabledServices)
        ? business.enabledServices
        : businessServices.map((service) => service.id),
    });
  }

  const needle = search.trim().toLowerCase();
  const filteredBusinesses = needle
    ? businesses.filter((business) =>
        [business.name, business.id, business.email, business.phone, business.serviceNote]
          .map((value) => String(value ?? "").toLowerCase())
          .join(" ")
          .includes(needle),
      )
    : businesses;
  const activeBusiness =
    filteredBusinesses.find((business) => business.id === selectedBusinessId) ??
    filteredBusinesses[0] ??
    null;

  function slicesFor(business: FirestoreRow) {
    return {
      members: users.filter((user) => belongsToBusiness(user, business) && isBusinessMember(user)),
      cars: cars.filter((item) => belongsToBusiness(item, business)),
      shipments: shipments.filter((item) => belongsToBusiness(item, business)),
      transports: transports.filter((item) => belongsToBusiness(item, business)),
      parkedCars: parkedCars.filter((item) => belongsToBusiness(item, business)),
      purchases: purchases.filter((item) => belongsToBusiness(item, business)),
      refunds: refunds.filter((item) => belongsToBusiness(item, business)),
      destinations: destinations.filter((item) => belongsToBusiness(item, business)),
      contactReferences: contactReferences.filter((item) => belongsToBusiness(item, business)),
      applications: applications.filter((item) => belongsToBusiness(item, business)),
      notifications: notifications.filter((item) => belongsToBusiness(item, business)),
      supportRequests: supportRequests.filter((item) => belongsToBusiness(item, business)),
    };
  }

  function openWorkCount(business: FirestoreRow) {
    const slices = slicesFor(business);
    return (
      countWhere(slices.shipments, (item) => rowStatus(item) === "pending") +
      countWhere(slices.purchases, (item) => rowStatus(item, "purchaseStatus") === "pending") +
      countWhere(slices.refunds, (item) => rowStatus(item) === "pending") +
      slices.applications.length +
      countWhere(slices.supportRequests, (item) => rowStatus(item, "status") !== "closed")
    );
  }

  return (
    <div className="stack">
      <section className="page-hero">
        <div>
          <h2>Business network</h2>
          <p>Pick a partner to manage its people, listings, services, payments, and support history in one place.</p>
        </div>
        <div className="page-hero-stats">
          <span>Pending <b>{countWhere(businesses, (item) => rowStatus(item) === "pending")}</b></span>
          <span>Approved <b>{countWhere(businesses, (item) => rowStatus(item) === "approved")}</b></span>
          {countWhere(businesses, (item) => item._inferred === true) > 0 && (
            <span className="warn">Missing profiles <b>{countWhere(businesses, (item) => item._inferred === true)}</b></span>
          )}
        </div>
      </section>

      {showAddForm && (
        <form
          className="add-business-form"
          onSubmit={(event) => runAction("Business saved", async () => {
            await saveBusiness(event);
            setShowAddForm(false);
          })}
        >
          <div className="add-business-grid">
            <input required placeholder="Business name" value={name} onChange={(event) => setName(event.target.value)} />
            <input placeholder="Phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
            <input autoComplete="email" placeholder="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
            <input placeholder="Review note" value={serviceNote} onChange={(event) => setServiceNote(event.target.value)} />
          </div>
          <div className="checkbox-group" aria-label="Business services">
            {businessServices.map((service) => (
              <label key={service.id}>
                <input
                  checked={enabledServices.includes(service.id)}
                  onChange={() => toggleService(service.id)}
                  type="checkbox"
                />
                {service.label}
              </label>
            ))}
          </div>
          <div className="add-business-actions">
            <button className="ghost-button" type="button" onClick={() => setShowAddForm(false)}>Cancel</button>
            <button className="primary-button" type="submit">Create business</button>
          </div>
        </form>
      )}

      <div className="master-detail">
        <aside className="master-list">
          <div className="master-list-head">
            <SearchBox value={search} onChange={setSearch} placeholder="Search businesses" />
            <button className="primary-button compact" type="button" onClick={() => setShowAddForm((value) => !value)}>
              {showAddForm ? "Close" : "Add"}
            </button>
          </div>
          <div className="master-list-scroll">
            {filteredBusinesses.map((business) => {
              const open = openWorkCount(business);
              const active = activeBusiness?.id === business.id;
              return (
                <button
                  key={business.id}
                  className={`master-row ${active ? "active" : ""}`}
                  onClick={() => setSelectedBusinessId(business.id)}
                  type="button"
                >
                  <span className="master-avatar">{businessInitials(text(business.name, business.id))}</span>
                  <span className="master-row-main">
                    <strong>{text(business.name, business.id)}</strong>
                    <small>{businessStatusLabel(business)}</small>
                  </span>
                  {open > 0 && <span className="master-badge">{open}</span>}
                </button>
              );
            })}
            {filteredBusinesses.length === 0 && (
              <EmptyState text={businesses.length === 0 ? "No business profiles are currently loaded." : "No businesses match this search."} />
            )}
          </div>
        </aside>

        <div className="detail-pane">
          {activeBusiness ? (
            <BusinessWorkspace
              key={activeBusiness.id}
              business={activeBusiness}
              assignableUsers={assignableUsers}
              {...slicesFor(activeBusiness)}
              createMissingBusinessProfile={createMissingBusinessProfile}
              updateMembership={updateMembership}
              runAction={runAction}
            />
          ) : (
            <div className="detail-empty">
              <Building2 size={36} />
              <p>Select a business to open its workspace.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function businessInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

function businessStatusLabel(business: FirestoreRow) {
  if (business._inferred === true) return "Missing profile";
  return statusLabel(business.status);
}

function CreateBusinessStaffForm({
  business,
  runAction,
}: {
  business: FirestoreRow;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");

  function reset() {
    setFullName("");
    setEmail("");
    setPhone("");
    setPassword("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await httpsCallable(functions, "createStaffUser")({
      fullName: fullName.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      password,
      businessId: business.id,
    });
    reset();
  }

  return (
    <form
      className="membership-form staff-create-form"
      onSubmit={(event) => runAction("Business staff created", () => submit(event))}
    >
      <span className="form-note strong">New staff for {text(business.name, business.id)}</span>
      <input required autoComplete="name" name={`staff-name-${business.id}`} placeholder="Name" value={fullName} onChange={(event) => setFullName(event.target.value)} />
      <input required autoComplete="username" name={`staff-email-${business.id}`} placeholder="Email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} />
      <input autoComplete="tel" name={`staff-phone-${business.id}`} placeholder="Phone" value={phone} onChange={(event) => setPhone(event.target.value)} />
      <input required autoComplete="new-password" minLength={6} name={`staff-password-${business.id}`} placeholder="Password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} />
      <button className="primary-button">Create staff</button>
    </form>
  );
}

function BusinessSupportRequestForm({
  businesses,
  draft,
  onDraftChange,
  runAction,
}: {
  businesses: FirestoreRow[];
  draft: SupportDraft;
  onDraftChange: (draft: SupportDraft) => void;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const businessOptions = businesses.filter((business) => business._inferred !== true);
  const selectedBusiness = businessOptions.find((business) => business.id === draft.businessId);
  const canSend = Boolean(
    draft.businessId &&
    draft.subject.trim() &&
    draft.message.trim() &&
    businessOptions.length > 0,
  );

  function update(patch: Partial<SupportDraft>) {
    onDraftChange({...draft, ...patch});
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft.businessId) throw new Error("Choose a business.");
    if (!draft.subject.trim()) throw new Error("Enter a request subject.");
    if (!draft.message.trim()) throw new Error("Enter a request message.");
    await sendBusinessSupportRequest(draft);
    onDraftChange(emptySupportDraft(draft.businessId));
  }

  return (
    <form
      className="support-request-form"
      onSubmit={(event) => runAction("Support request sent", () => submit(event))}
    >
      <div className="support-request-grid">
        <label>
          Business
          <select
            required
            value={draft.businessId}
            onChange={(event) => update({businessId: event.target.value})}
          >
            <option value="">Choose business</option>
            {businessOptions.map((business) => (
              <option key={business.id} value={business.id}>
                {text(business.name, business.id)}
              </option>
            ))}
          </select>
        </label>
        <label>
          Priority
          <select value={draft.priority} onChange={(event) => update({priority: event.target.value})}>
            {supportPriorities.map((priority) => (
              <option key={priority} value={priority}>
                {priority === "normal" ? "Normal" : priority === "urgent" ? "Urgent" : "Blocked"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Customer name
          <input
            placeholder="Customer name"
            value={draft.customerName}
            onChange={(event) => update({customerName: event.target.value})}
          />
        </label>
        <label>
          Customer email
          <input
            inputMode="email"
            placeholder="Customer email"
            type="email"
            value={draft.customerEmail}
            onChange={(event) => update({customerEmail: event.target.value})}
          />
        </label>
        <label>
          Customer phone
          <input
            inputMode="tel"
            placeholder="Customer phone"
            value={draft.customerPhone}
            onChange={(event) => update({customerPhone: event.target.value})}
          />
        </label>
        <label className="wide">
          Subject
          <input
            required
            placeholder="What should the business handle?"
            value={draft.subject}
            onChange={(event) => update({subject: event.target.value})}
          />
        </label>
        <label className="wide support-message-field">
          Message
          <textarea
            required
            placeholder="Describe the request, what the customer needs, and any deadline."
            value={draft.message}
            onChange={(event) => update({message: event.target.value})}
          />
        </label>
      </div>
      {draft.relatedId && (
        <div className="support-related-record">
          <span>
            Related: <b>{draft.relatedLabel || draft.relatedId}</b>
            {draft.relatedCollection ? ` (${draft.relatedCollection})` : ""}
          </span>
          <button
            className="ghost-button"
            onClick={() => update({relatedCollection: "", relatedId: "", relatedLabel: ""})}
            type="button"
          >
            Clear
          </button>
        </div>
      )}
      <div className="support-request-actions">
        <span>
          {selectedBusiness
            ? `Sends to ${text(selectedBusiness.name, selectedBusiness.id)} and records an audit log.`
            : "Choose a business before sending."}
        </span>
        <button className="primary-button" disabled={!canSend} type="submit">
          <Send size={16} />
          Send request
        </button>
      </div>
    </form>
  );
}

const workspaceSections = [
  "overview",
  "people",
  "listings",
  "services",
  "payments",
  "support",
] as const;

type WorkspaceSection = (typeof workspaceSections)[number];

function workspaceSectionLabel(section: WorkspaceSection) {
  return {
    overview: "Overview",
    people: "People",
    listings: "Listings",
    services: "Services",
    payments: "Payments",
    support: "Support",
  }[section];
}

function BusinessWorkspace({
  business,
  members,
  assignableUsers,
  cars,
  shipments,
  transports,
  parkedCars,
  purchases,
  refunds,
  destinations,
  contactReferences,
  applications,
  notifications,
  supportRequests,
  createMissingBusinessProfile,
  updateMembership,
  runAction,
}: {
  business: FirestoreRow;
  members: FirestoreRow[];
  assignableUsers: FirestoreRow[];
  cars: FirestoreRow[];
  shipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
  purchases: FirestoreRow[];
  refunds: FirestoreRow[];
  destinations: FirestoreRow[];
  contactReferences: FirestoreRow[];
  applications: FirestoreRow[];
  notifications: FirestoreRow[];
  supportRequests: FirestoreRow[];
  createMissingBusinessProfile: (business: FirestoreRow) => Promise<void>;
  updateMembership: (payload: {
    userId: string;
    role: "businessOwner" | "staff" | "customer";
    businessId?: string;
  }) => Promise<void>;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [section, setSection] = useState<WorkspaceSection>("overview");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] =
    useState<(typeof businessRoleOptions)[number]>("staff");
  const [supportDraft, setSupportDraft] = useState<SupportDraft>(() =>
    emptySupportDraft(text(business.id, "")),
  );

  useEffect(() => {
    setSupportDraft((current) => ({
      ...current,
      businessId: text(business.id, ""),
    }));
  }, [business.id]);

  const owner = members.find((user) => text(user.role, "") === "businessOwner");
  const staff = members.filter((user) => text(user.role, "") === "staff");
  const inferred = business._inferred === true;

  const openShipments = countWhere(shipments, (item) => rowStatus(item) === "pending");
  const openPurchases = countWhere(purchases, (item) => rowStatus(item, "purchaseStatus") === "pending");
  const openRefunds = countWhere(refunds, (item) => rowStatus(item) === "pending");
  const activeListings = countWhere(cars, (item) => rowStatus(item) === "active");

  const counts: Array<[string, number]> = [
    ["Listings", cars.length],
    ["Barrels", shipments.length],
    ["Transport", transports.length],
    ["Parking", parkedCars.length],
    ["Purchases", purchases.length],
    ["Refunds", refunds.length],
    ["Destinations", destinations.filter((item) => item.isActive === true).length],
    ["Contacts", contactReferences.length],
    ["Requests", applications.length + notifications.length + supportRequests.length],
  ];

  const openWork = [
    ...shipments.map((item) => ({
      id: `shipment-${item.id}`,
      title: relatedRecordTitle(item, "Barrel shipment"),
      subtitle: relatedRecordMeta(item),
      badge: statusLabel(item.status),
    })),
    ...purchases.map((item) => ({
      id: `purchase-${item.id}`,
      title: relatedRecordTitle(item, "Car purchase"),
      subtitle: relatedRecordMeta(item, "purchaseStatus"),
      badge: statusLabel(item.purchaseStatus),
    })),
    ...transports.map((item) => ({
      id: `transport-${item.id}`,
      title: relatedRecordTitle(item, "Transport request"),
      subtitle: relatedRecordMeta(item),
      badge: statusLabel(item.status),
    })),
    ...parkedCars.map((item) => ({
      id: `parking-${item.id}`,
      title: relatedRecordTitle(item, "Parked car"),
      subtitle: relatedRecordMeta(item),
      badge: statusLabel(item.status),
    })),
    ...refunds.map((item) => ({
      id: `refund-${item.id}`,
      title: `${optionalMoney(item.amount, text(item.currency, "USD")) || "Card return"}`,
      subtitle: [text(item.customerEmail ?? item.customerName, ""), relatedContactSummary(item)].filter(Boolean).join(" • "),
      badge: statusLabel(item.status),
    })),
    ...applications.map((item) => ({
      id: `application-${item.id}`,
      title: text(item.businessName ?? item.name, "Business application"),
      subtitle: [item.type, item.applicantEmail, item.message].filter(Boolean).join(" • "),
      badge: statusLabel(item.status),
    })),
    ...notifications.map((item) => ({
      id: `notification-${item.id}`,
      title: text(item.businessName ?? item.title, "Business notification"),
      subtitle: [item.type, item.message].filter(Boolean).join(" • "),
      badge: statusLabel(item.status),
    })),
    ...supportRequests.map((item) => ({
      id: `support-${item.id}`,
      title: text(item.subject, "Support request"),
      subtitle: [
        item.priority ? `Priority ${text(item.priority, "")}` : "",
        item.customerEmail ?? item.customerName ?? item.customerPhone,
        item.relatedLabel,
        formatDate(item.createdAt),
      ].filter(Boolean).join(" • "),
      badge: statusLabel(item.status),
    })),
  ];

  const availableUsers = assignableUsers.filter((user) => {
    return text(user.id, "") !== text(owner?.id, "") || selectedRole !== "businessOwner";
  });

  function assignSelectedUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedUserId) return;
    return runAction("Business membership updated", async () => {
      await updateMembership({
        userId: selectedUserId,
        role: selectedRole,
        businessId: business.id,
      });
      setSelectedUserId("");
      setSelectedRole("staff");
    });
  }

  return (
    <div className="workspace-detail">
      <header className="workspace-head">
        <div className="workspace-id">
          <span className="workspace-avatar">{businessInitials(text(business.name, business.id))}</span>
          <div>
            <h2>{text(business.name, business.id)}</h2>
            <p>{[text(business.phone, "No phone"), text(business.email, "No email")].join(" • ")}</p>
          </div>
        </div>
        <div className="workspace-head-actions">
          {inferred ? (
            <span className="status-pill warning">Missing profile</span>
          ) : (
            <label className="field-inline">
              <span>Status</span>
              <select
                value={text(business.status, "pending")}
                onChange={(event) =>
                  runAction("Business status updated", () =>
                    commitStatusChange({
                      collectionName: "businesses",
                      targetId: business.id,
                      nextStatus: event.target.value,
                    }),
                  )
                }
              >
                {businessStatuses.map((status) => (
                  <option key={status} value={status}>
                    {statusLabel(status)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      </header>

      <div className="workspace-kpis">
        <span><b>{activeListings}</b> active listings</span>
        <span><b>{openShipments}</b> open shipments</span>
        <span><b>{openPurchases}</b> open purchases</span>
        <span className={openRefunds > 0 ? "warn" : ""}><b>{openRefunds}</b> refunds to pay</span>
        <span><b>{members.length}</b> people</span>
      </div>

      {inferred ? (
        <div className="repair-card">
          <p>This business was inferred from existing marketplace or operations records. Create a profile document before assigning people or editing status.</p>
          <button
            className="primary-button"
            onClick={() => runAction("Business profile created", () => createMissingBusinessProfile(business))}
          >
            <Building2 size={16} />
            Create business profile
          </button>
          {openWork.length > 0 && (
            <div className="row-list compact">
              {openWork.slice(0, 8).map((item) => (
                <DataRow key={item.id} title={item.title} subtitle={item.subtitle} badge={item.badge} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <>
          <nav className="sub-tabs" aria-label="Business sections">
            {workspaceSections.map((value) => (
              <button
                key={value}
                className={section === value ? "active" : ""}
                onClick={() => setSection(value)}
                type="button"
              >
                {workspaceSectionLabel(value)}
              </button>
            ))}
          </nav>

          <div className="workspace-body">
            {section === "overview" && (
              <div className="workspace-section">
                <div className="people-summary">
                  <div className="person-block owner-block">
                    <span>Business head</span>
                    <strong>{owner ? userDisplayName(owner) : "No owner assigned"}</strong>
                    <small>{owner ? userMeta(owner) : "Assign one owner for accountability."}</small>
                  </div>
                  <div className="person-block">
                    <span>Staff</span>
                    <strong>{staff.length}</strong>
                    <small>{staff.map(userDisplayName).join(", ") || "No staff assigned."}</small>
                  </div>
                </div>
                <div className="count-grid">
                  {counts.map(([label, value]) => (
                    <div className="count-cell" key={label}>
                      <strong>{value}</strong>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
                <div className="subsection">
                  <h3>Recent activity</h3>
                  <div className="row-list compact">
                    {openWork.slice(0, 6).map((item) => (
                      <DataRow key={item.id} title={item.title} subtitle={item.subtitle} badge={item.badge} />
                    ))}
                    {openWork.length === 0 && (
                      <EmptyState text="No related business records are currently loaded." />
                    )}
                  </div>
                </div>
              </div>
            )}

            {section === "people" && (
              <div className="workspace-section">
                <div className="subsection">
                  <h3>Add people</h3>
                  <form className="assign-form" onSubmit={assignSelectedUser}>
                    <select required value={selectedUserId} onChange={(event) => setSelectedUserId(event.target.value)}>
                      <option value="">Assign existing account…</option>
                      {availableUsers.map((user) => (
                        <option key={user.id} value={user.id}>
                          {userDisplayName(user)} {user.businessName ? `(${text(user.businessName, "")})` : ""}
                        </option>
                      ))}
                    </select>
                    <select value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as (typeof businessRoleOptions)[number])}>
                      {businessRoleOptions.map((role) => (
                        <option key={role} value={role}>
                          {role === "businessOwner" ? "Business head" : "Staff"}
                        </option>
                      ))}
                    </select>
                    <button className="primary-button" disabled={assignableUsers.length === 0}>Assign</button>
                  </form>
                  <CreateBusinessStaffForm business={business} runAction={runAction} />
                </div>
                <div className="subsection">
                  <h3>Team</h3>
                  <div className="membership-list">
                    {members.map((user) => (
                      <div className="membership-row" key={user.id}>
                        <div>
                          <strong>{userDisplayName(user)}</strong>
                          <small>{userMeta(user)}</small>
                        </div>
                        <select
                          value={text(user.role, "staff")}
                          onChange={(event) =>
                            runAction("Business membership updated", () =>
                              updateMembership({
                                userId: user.id,
                                role: event.target.value as "businessOwner" | "staff" | "customer",
                                businessId: business.id,
                              }),
                            )
                          }
                        >
                          <option value="businessOwner">Business head</option>
                          <option value="staff">Staff</option>
                          <option value="customer">Remove to customer</option>
                        </select>
                      </div>
                    ))}
                    {members.length === 0 && (
                      <EmptyState text="No business people assigned yet." />
                    )}
                  </div>
                </div>
                {contactReferences.length > 0 && (
                  <div className="subsection">
                    <h3>Support contacts</h3>
                    <div className="row-list compact">
                      {contactReferences.map((contact) => (
                        <div className="support-contact-row" key={contact.id}>
                          <strong>{userDisplayName(contact)}</strong>
                          <span>{userMeta(contact)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {section === "listings" && (
              <div className="workspace-section">
                <div className="listing-list">
                  {cars.map((listing) => {
                    const imageUrl = listingImageUrl(listing);
                    return (
                      <article className="listing-card" key={listing.id}>
                        <div className="listing-thumb" aria-label={`${listingTitle(listing)} photo`}>
                          {imageUrl ? (
                            <img alt={`${listingTitle(listing)} photo`} loading="lazy" src={imageUrl} />
                          ) : (
                            <div className="listing-thumb-empty"><Car size={26} /><span>No photo</span></div>
                          )}
                        </div>
                        <div className="listing-card-main">
                          <strong>{listingTitle(listing)}</strong>
                          <small>{[formatMoney(listing.price), text(listing.mileage, ""), listingLocation(listing)].filter(Boolean).join(" • ")}</small>
                        </div>
                        <select
                          value={text(listing.status, "active")}
                          onChange={(event) =>
                            runAction("Listing status updated", () =>
                              commitStatusChange({ collectionName: "cars", targetId: listing.id, nextStatus: event.target.value }),
                            )
                          }
                        >
                          {listingStatuses.map((status) => (
                            <option key={status} value={status}>{statusLabel(status)}</option>
                          ))}
                        </select>
                        <button
                          className="danger-button"
                          onClick={() => {
                            if (window.confirm(`Delete ${listingTitle(listing)}?`)) {
                              runAction("Listing deleted", () => deleteAdminRecord("cars", listing.id));
                            }
                          }}
                        >
                          <X size={15} />
                        </button>
                      </article>
                    );
                  })}
                  {cars.length === 0 && (
                    <EmptyState text="This business has no marketplace listings loaded." />
                  )}
                </div>
              </div>
            )}

            {section === "services" && (
              <div className="workspace-section">
                <BusinessDestinationsPanel
                  business={business}
                  destinations={destinations}
                  runAction={runAction}
                />
                <ServiceGroup title="Barrel shipments" icon={<Package size={16} />} rows={shipments} statusField="status" />
                <ServiceGroup title="Transport requests" icon={<Truck size={16} />} rows={transports} statusField="status" />
                <ServiceGroup title="Parked cars" icon={<Car size={16} />} rows={parkedCars} statusField="status" />
              </div>
            )}

            {section === "payments" && (
              <div className="workspace-section">
                <ServiceGroup title="Car purchases" icon={<BadgeDollarSign size={16} />} rows={purchases} statusField="purchaseStatus" />
                <div className="subsection">
                  <h3>Card return requests</h3>
                  <div className="row-list compact">
                    {refunds.map((item) => (
                      <DataRow
                        key={item.id}
                        title={`${optionalMoney(item.amount, text(item.currency, "USD")) || "Card return"}`}
                        subtitle={[text(item.customerEmail, "Customer"), formatDate(item.createdAt)].filter(Boolean).join(" • ")}
                        badge={statusLabel(item.status)}
                      />
                    ))}
                    {refunds.length === 0 && (
                      <EmptyState text="No card return requests for this business." />
                    )}
                  </div>
                </div>
              </div>
            )}

            {section === "support" && (
              <div className="workspace-section">
                <div className="subsection">
                  <h3>
                    <Send size={16} />
                    Message business
                  </h3>
                  <BusinessSupportRequestForm
                    businesses={[business]}
                    draft={supportDraft}
                    onDraftChange={setSupportDraft}
                    runAction={runAction}
                  />
                </div>
                <div className="subsection">
                  <h3>Activity & requests</h3>
                  <div className="row-list compact">
                    {openWork.map((item) => (
                      <DataRow key={item.id} title={item.title} subtitle={item.subtitle} badge={item.badge} />
                    ))}
                    {openWork.length === 0 && (
                      <EmptyState text="No related business records are currently loaded." />
                    )}
                  </div>
                </div>
                {contactReferences.length > 0 && (
                  <div className="subsection">
                    <h3>Support contacts</h3>
                    <div className="row-list compact">
                      {contactReferences.map((contact) => (
                        <div className="support-contact-row" key={contact.id}>
                          <strong>{userDisplayName(contact)}</strong>
                          <span>{userMeta(contact)}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function BusinessDestinationsPanel({
  business,
  destinations,
  runAction,
}: {
  business: FirestoreRow;
  destinations: FirestoreRow[];
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [search, setSearch] = useState("");
  const activeCount = countWhere(destinations, (item) => item.isActive === true);
  const inactiveCount = destinations.length - activeCount;
  const needle = search.trim().toLowerCase();
  const filteredDestinations = needle
    ? destinations.filter((item) =>
        [
          item.name,
          item.code,
          item.destinationNote,
          item.details,
          item.barrelShippingPrice,
        ]
          .map((value) => String(value ?? "").toLowerCase())
          .join(" ")
          .includes(needle),
      )
    : destinations;

  return (
    <div className="subsection">
      <h3>
        <DatabaseZap size={16} />
        Shipping destinations
        <span className="subsection-count">{activeCount} active</span>
      </h3>
      <div className="destination-toolbar">
        <SearchBox value={search} onChange={setSearch} placeholder="Find destination" />
        <span>{destinations.length} business countries • {inactiveCount} inactive</span>
        <button
          className="secondary-button"
          onClick={() =>
            runAction("Business destination list seeded", () =>
              httpsCallable(functions, "seedDestinationCountries")({
                businessId: business.id,
              }),
            )
          }
          type="button"
        >
          <RefreshCw size={15} />
          Add country list
        </button>
      </div>
      <div className="row-list business-destination-list">
        {filteredDestinations.map((destination) => (
          <DestinationCoverageRow
            key={text(destination._path, `${business.id}-${destination.id}`)}
            destination={destination}
            runAction={runAction}
          />
        ))}
        {destinations.length === 0 && (
          <EmptyState text="This business has no destination list yet. Add the country list, then activate only the countries this business ships to." />
        )}
        {destinations.length > 0 && filteredDestinations.length === 0 && (
          <EmptyState text="No destinations match this search." />
        )}
      </div>
    </div>
  );
}

function ServiceGroup({
  title,
  icon,
  rows,
  statusField,
}: {
  title: string;
  icon: ReactNode;
  rows: FirestoreRow[];
  statusField: string;
}) {
  return (
    <div className="subsection">
      <h3>{icon}{title}<span className="subsection-count">{rows.length}</span></h3>
      <div className="row-list compact">
        {rows.map((item) => (
          <DataRow
            key={item.id}
            title={relatedRecordTitle(item, title)}
            subtitle={relatedRecordMeta(item, statusField)}
            badge={statusLabel(item[statusField])}
          />
        ))}
        {rows.length === 0 && (
          <EmptyState text={`No ${title.toLowerCase()} for this business.`} />
        )}
      </div>
    </div>
  );
}

type ServiceModule = {
  id: string;
  label: string;
  service: string;
  icon: ReactNode;
  collectionName: string;
  rows: FirestoreRow[];
  statusField: string;
  statusOptions: readonly string[];
  title: (item: FirestoreRow) => string;
  subtitle: (item: FirestoreRow) => string;
  details?: (item: FirestoreRow) => Array<[string, string]>;
};

// To add a new service in the future, append one entry to this list — the
// segmented selector, counts, search, filtering, and rows all derive from it.
function buildServiceModules(data: {
  shipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
  purchases: FirestoreRow[];
}): ServiceModule[] {
  return [
    {
      id: "barrels",
      label: "Barrel shipping",
      service: "barrelShipping",
      icon: <Package size={16} />,
      collectionName: "barrelShipments",
      rows: data.shipments,
      statusField: "status",
      statusOptions: operationalStatuses,
      title: (item) => `${text(item.trackingCode, item.id)} • ${text(item.receiverName, "Receiver")}`,
      subtitle: (item) => `${text(item.businessName, "Business")} • ${text(item.destinationCountryName, "Destination")} • ${formatMoney(item.price)}`,
      details: barrelShipmentDetails,
    },
    {
      id: "transport",
      label: "Car transport",
      service: "carTransport",
      icon: <Truck size={16} />,
      collectionName: "transportRequests",
      rows: data.transports,
      statusField: "status",
      statusOptions: operationalStatuses,
      title: (item) => `${text(item.trackingCode, item.id)} • ${text(item.ownerName, "Owner")}`,
      subtitle: (item) => `${text(item.carYear, "")} ${text(item.carMake, "")} ${text(item.carModel, "")} • ${formatDate(item.transportDate)}`,
      details: (item) => detailRows([
        ["Business", item.businessName],
        ["Owner email", item.ownerEmail],
        ["Owner phone", item.ownerPhone],
        ["Pickup", [item.pickupAddress, item.pickupCity, item.pickupState].filter(Boolean).join(", ")],
        ["Drop-off", [item.dropoffAddress, item.dropoffCity, item.dropoffState].filter(Boolean).join(", ")],
        ["Price", optionalMoney(item.price)],
        ["Updated", optionalDate(item.statusUpdatedAt ?? item.updatedAt)],
        ["Updated by", item.statusUpdatedBy ?? item.updatedBy],
      ]),
    },
    {
      id: "parking",
      label: "Car parking",
      service: "carParking",
      icon: <Car size={16} />,
      collectionName: "parkedCars",
      rows: data.parkedCars,
      statusField: "status",
      statusOptions: operationalStatuses,
      title: (item) => `${text(item.trackingCode, item.id)} • ${text(item.ownerName, "Owner")}`,
      subtitle: (item) => `${text(item.carYear, "")} ${text(item.carMake, "")} ${text(item.carModel, "")} • parked ${formatDate(item.parkingDate)}`,
      details: (item) => detailRows([
        ["Business", item.businessName],
        ["Owner email", item.ownerEmail],
        ["Owner phone", item.ownerPhone],
        ["Location", [item.parkingAddress, item.parkingCity, item.parkingState].filter(Boolean).join(", ")],
        ["Total", optionalMoney(item.totalCost)],
        ["Updated", optionalDate(item.statusUpdatedAt ?? item.updatedAt)],
        ["Updated by", item.statusUpdatedBy ?? item.updatedBy],
      ]),
    },
    {
      id: "purchases",
      label: "Car purchases",
      service: "carSales",
      icon: <BadgeDollarSign size={16} />,
      collectionName: "carPurchases",
      rows: data.purchases,
      statusField: "purchaseStatus",
      statusOptions: purchaseStatuses,
      title: (item) => `${text(item.carTitle, "Car purchase")} • ${text(item.buyerName, "Buyer")}`,
      subtitle: (item) => `${text(item.buyerEmail, "")} • ${formatMoney(item.depositAmount, text(item.depositCurrency, "USD"))} • ${text(item.paymentStatus, "payment")}`,
      details: (item) => detailRows([
        ["Business", item.businessName],
        ["Buyer phone", item.buyerPhone],
        ["Payment", item.paymentStatus],
        ["Hold until", optionalDate(item.holdUntilDate)],
        ["Appointment", optionalDate(item.appointmentStart)],
        ["Updated", optionalDate(item.purchaseStatusUpdatedAt ?? item.updatedAt)],
        ["Updated by", item.purchaseStatusUpdatedBy ?? item.updatedBy],
      ]),
    },
  ];
}

function OperationsView({
  shipments,
  transports,
  parkedCars,
  purchases,
  runAction,
  canService,
}: {
  shipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
  purchases: FirestoreRow[];
  runAction: (label: string, action: () => Promise<unknown>) => void;
  canService: (serviceId: string) => boolean;
}) {
  const modules = useMemo(
    () => buildServiceModules({ shipments, transports, parkedCars, purchases })
      .filter((mod) => canService(mod.service)),
    [shipments, transports, parkedCars, purchases, canService],
  );
  const [active, setActive] = useState("all");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");

  const total = modules.reduce((sum, mod) => sum + mod.rows.length, 0);
  const scope = active === "all" ? modules : modules.filter((mod) => mod.id === active);
  const scopeItems = scope.flatMap((mod) => mod.rows.map((item) => ({ mod, item })));
  const statusSet = Array.from(
    new Set(scopeItems.map(({ mod, item }) => text(item[mod.statusField], "pending").toLowerCase())),
  ).sort();

  const needle = search.trim().toLowerCase();
  const items = scopeItems.filter(({ mod, item }) => {
    const status = text(item[mod.statusField], "pending").toLowerCase();
    if (statusFilter !== "all" && status !== statusFilter) return false;
    if (!needle) return true;
    const detailsText = mod.details?.(item).map(([, value]) => value).join(" ") ?? "";
    return [mod.title(item), mod.subtitle(item), status, detailsText].join(" ").toLowerCase().includes(needle);
  });

  const activeLabel = active === "all"
    ? "All service records"
    : modules.find((mod) => mod.id === active)?.label ?? "Records";

  function selectService(id: string) {
    setActive(id);
    setStatusFilter("all");
  }

  return (
    <div className="stack">
      <SectionIntro
        title="Service operations"
        description="Every service request across all businesses, in one place. Pick a service to focus, or browse them all."
        stats={[
          ["Total records", String(total)],
          ["Services", String(modules.length)],
          ["Showing", String(items.length)],
        ]}
      />

      <div className="service-segments" role="tablist" aria-label="Service types">
        <button
          className={`segment ${active === "all" ? "active" : ""}`}
          onClick={() => selectService("all")}
          type="button"
        >
          <Activity size={16} />
          <span>All services</span>
          <b>{total}</b>
        </button>
        {modules.map((mod) => (
          <button
            key={mod.id}
            className={`segment ${active === mod.id ? "active" : ""}`}
            onClick={() => selectService(mod.id)}
            type="button"
          >
            {mod.icon}
            <span>{mod.label}</span>
            <b>{mod.rows.length}</b>
          </button>
        ))}
      </div>

      <Panel
        title={activeLabel}
        icon={<ClipboardList size={18} />}
        action={
          <div className="panel-tools">
            <label className="compact-search">
              <Search size={15} />
              <input
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search records"
                value={search}
              />
            </label>
            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
              <option value="all">All statuses</option>
              {statusSet.map((status) => (
                <option key={status} value={status}>
                  {statusLabel(status)}
                </option>
              ))}
            </select>
          </div>
        }
      >
        <div className="table">
          {items.map(({ mod, item }) => (
            <CollectionRow
              key={`${mod.id}-${item.id}`}
              item={item}
              label={mod.title}
              subtitle={mod.subtitle}
              statusField={mod.statusField}
              statusOptions={mod.statusOptions}
              collectionName={mod.collectionName}
              title={mod.label}
              details={mod.details}
              runAction={runAction}
              typeBadge={active === "all" ? mod.label : undefined}
            />
          ))}
          {total === 0 ? (
            <EmptyState text="No service records are currently loaded." />
          ) : items.length === 0 && (
            <EmptyState text="No records match the current filters." />
          )}
        </div>
      </Panel>
    </div>
  );
}

function barrelShipmentDetails(item: FirestoreRow) {
  return detailRows([
    ["Business", item.businessName],
    ["Sender", item.senderName],
    ["Sender phone", item.senderPhone],
    ["Sender email", item.senderEmail ?? item.customerEmail],
    ["Sender address", item.senderAddress],
    ["Pickup", item.pickupRequested === true ? "Requested" : "Not requested"],
    ["Pickup borough", item.pickupBorough],
    ["Pickup address", item.pickupAddress],
    ["Pickup time", optionalDate(item.pickupDateTime)],
    ["Receiver", item.receiverName],
    ["Receiver phone", item.receiverPhone],
    ["Destination", item.destinationCountryName],
    ["Delivery estimate", item.deliveryEstimateLabel],
    ["Shipping fee", optionalMoney(item.shippingFee)],
    ["Pickup fee", optionalMoney(item.pickupFee)],
    ["Total", optionalMoney(item.price)],
    ["Payment", item.paymentStatus],
    ["Created", optionalDate(item.createdAt)],
    ["Updated", optionalDate(item.statusUpdatedAt ?? item.updatedAt)],
    ["Updated by", item.statusUpdatedBy ?? item.updatedBy],
  ]);
}

function carListingDetails(item: FirestoreRow) {
  const soldInfo =
    item.soldInfo && typeof item.soldInfo === "object"
      ? (item.soldInfo as Record<string, unknown>)
      : {};
  return detailRows([
    ["Business status", item.businessStatus],
    ["VIN", item.vin],
    ["Stock", item.stockNumber],
    ["Mileage", item.mileage],
    ["Condition", item.condition],
    ["Body", item.bodyType],
    ["Transmission", item.transmission],
    ["Fuel", item.fuelType],
    ["Drivetrain", item.drivetrain],
    ["Exterior", item.exteriorColor],
    ["Interior", item.interiorColor],
    ["Contact", item.contactName],
    ["Contact phone", item.contactPhone],
    ["Contact email", item.contactEmail],
    ["Address", [item.locationAddressLine1, item.locationCity, item.locationState, item.locationPostalCode].filter(Boolean).join(", ")],
    ["Sold to", soldInfo.customerName],
    ["Sold phone", soldInfo.customerPhone],
    ["Sold email", soldInfo.customerEmail],
    ["Sold amount", optionalMoney(soldInfo.amount)],
    ["Sold date", optionalDate(soldInfo.soldDate)],
    ["Sold notes", soldInfo.notes],
    ["Created", optionalDate(item.createdAt)],
    ["Updated", optionalDate(item.statusUpdatedAt ?? item.updatedAt)],
    ["Updated by", item.statusUpdatedBy ?? item.updatedBy],
  ]);
}

function listingTitle(item: FirestoreRow) {
  return text(
      item.title,
      `${text(item.year, "")} ${text(item.make, "")} ${text(item.model, "")}`.trim() || item.id,
  );
}

function listingLocation(item: FirestoreRow) {
  return [
    item.locationCity,
    item.locationState,
    item.locationPostalCode,
  ].filter(Boolean).join(" ");
}

function imageCandidate(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (!value || typeof value !== "object") return "";
  const objectValue = value as Record<string, unknown>;
  return text(
      objectValue.url ??
      objectValue.imageUrl ??
      objectValue.downloadUrl ??
      objectValue.src ??
      objectValue.path,
      "",
  ).trim();
}

function listingImageUrl(item: FirestoreRow) {
  const directFields = [
    item.mainImageUrl,
    item.primaryImageUrl,
    item.coverImageUrl,
    item.thumbnailUrl,
    item.imageUrl,
    item.photoUrl,
  ];
  for (const candidate of directFields) {
    const url = imageCandidate(candidate);
    if (url) return url;
  }

  const listFields = [
    item.imageUrls,
    item.photoUrls,
    item.images,
    item.photos,
    item.carImages,
    item.listingImages,
  ];
  for (const field of listFields) {
    if (!Array.isArray(field)) continue;
    for (const candidate of field) {
      const url = imageCandidate(candidate);
      if (url) return url;
    }
  }

  return "";
}

function MarketplaceView({
  cars,
  businesses,
  pricing,
  destinations,
  errors,
  loading,
  refreshDestinations,
  runAction,
}: {
  cars: FirestoreRow[];
  businesses: FirestoreRow[];
  pricing: FirestoreRow[];
  destinations: FirestoreRow[];
  errors: string[];
  loading: boolean;
  refreshDestinations: () => void;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [destinationSearch, setDestinationSearch] = useState("");
  const [listingSearch, setListingSearch] = useState("");
  const [listingStatus, setListingStatus] = useState("all");
  const [listingBusinessId, setListingBusinessId] = useState("all");
  const [listingLocation, setListingLocation] = useState("");
  const [minPrice, setMinPrice] = useState("");
  const [maxPrice, setMaxPrice] = useState("");
  const filteredDestinations = useMemo(() => {
    const needle = destinationSearch.trim().toLowerCase();
    if (!needle) return destinations;
    return destinations.filter((item) =>
      [item.name, item.code, item.businessName, item.businessStatus]
        .map((value) => String(value ?? "").toLowerCase())
        .join(" ")
        .includes(needle),
    );
  }, [destinationSearch, destinations]);
  const filteredCars = useMemo(() => {
    const needle = listingSearch.trim().toLowerCase();
    const locationNeedle = listingLocation.trim().toLowerCase();
    const min = minPrice.trim() ? Number(minPrice) : null;
    const max = maxPrice.trim() ? Number(maxPrice) : null;
    const selectedBusiness = businesses.find((business) => {
      return text(business.id, "") === listingBusinessId;
    });
    return cars.filter((item) => {
      const status = rowStatus(item);
      if (listingStatus !== "all" && status !== listingStatus) return false;
      if (
        listingBusinessId !== "all" &&
        (!selectedBusiness || !belongsToBusiness(item, selectedBusiness))
      ) {
        return false;
      }
      const price = numberValue(item.price);
      if (min !== null && Number.isFinite(min) && price < min) return false;
      if (max !== null && Number.isFinite(max) && price > max) return false;
      const location = [
        item.locationCity,
        item.locationState,
        item.locationPostalCode,
      ].map((value) => String(value ?? "").toLowerCase()).join(" ");
      if (locationNeedle && !location.includes(locationNeedle)) return false;
      if (!needle) return true;
      return [
        listingTitle(item),
        item.make,
        item.model,
        item.year,
        item.vin,
        item.stockNumber,
        item.businessName,
        item.contactName,
        item.contactPhone,
        item.contactEmail,
        status,
        location,
      ].map((value) => String(value ?? "").toLowerCase())
          .join(" ")
          .includes(needle);
    });
  }, [
    businesses,
    cars,
    listingBusinessId,
    listingLocation,
    listingSearch,
    listingStatus,
    maxPrice,
    minPrice,
  ]);
  const businessesWithListings = useMemo(() => {
    return businesses
        .filter((business) => business._inferred !== true)
        .map((business) => ({
          business,
          listings: filteredCars.filter((item) => belongsToBusiness(item, business)),
          totalListings: cars.filter((item) => belongsToBusiness(item, business)).length,
        }))
        .filter((entry) => {
          if (listingBusinessId !== "all") {
            return text(entry.business.id, "") === listingBusinessId;
          }
          return entry.totalListings > 0 || entry.listings.length > 0;
        });
  }, [businesses, cars, filteredCars, listingBusinessId]);
  const groupedListingIds = new Set(
      businessesWithListings.flatMap((entry) => entry.listings.map((item) => item.id)),
  );
  const unassignedListings = filteredCars.filter((item) => !groupedListingIds.has(item.id));
  const activeFilters = [
    listingSearch ? `Search "${listingSearch}"` : "",
    listingStatus !== "all" ? statusLabel(listingStatus) : "",
    listingBusinessId !== "all"
      ? `Business ${text(businesses.find((item) => item.id === listingBusinessId)?.name, listingBusinessId)}`
      : "",
    listingLocation ? `Location "${listingLocation}"` : "",
    minPrice ? `Min ${formatMoney(minPrice)}` : "",
    maxPrice ? `Max ${formatMoney(maxPrice)}` : "",
  ].filter(Boolean);

  return (
    <div className="stack">
      <SectionIntro
        title="Marketplace controls"
        description="Review each business first, then inspect and control the listings that business published."
        stats={[
          ["Businesses", String(businessesWithListings.length)],
          ["Listings", String(cars.length)],
          ["Filtered", String(filteredCars.length)],
          ["Pricing rows", String(pricing.length)],
        ]}
      />
      {errors.map((error) => (
        <div className="inline-error" key={error}>{error}</div>
      ))}
      {loading && <div className="empty-state">Loading marketplace records...</div>}
      <Panel title="Business listings" icon={<Store size={18} />}>
        <div className="marketplace-filter-grid">
          <label className="compact-search wide">
            <Search size={15} />
            <input
              onChange={(event) => setListingSearch(event.target.value)}
              placeholder="Search title, VIN, stock, make, contact"
              value={listingSearch}
            />
          </label>
          <select value={listingBusinessId} onChange={(event) => setListingBusinessId(event.target.value)}>
            <option value="all">All businesses</option>
            {businesses
                .filter((business) => business._inferred !== true)
                .map((business) => (
                  <option key={business.id} value={business.id}>
                    {text(business.name, business.id)}
                  </option>
                ))}
          </select>
          <select value={listingStatus} onChange={(event) => setListingStatus(event.target.value)}>
            <option value="all">All statuses</option>
            {listingStatuses.map((status) => (
              <option key={status} value={status}>
                {statusLabel(status)}
              </option>
            ))}
          </select>
          <input
            onChange={(event) => setListingLocation(event.target.value)}
            placeholder="City, state, ZIP"
            value={listingLocation}
          />
          <input
            inputMode="decimal"
            min="0"
            onChange={(event) => setMinPrice(event.target.value)}
            placeholder="Min price"
            type="number"
            value={minPrice}
          />
          <input
            inputMode="decimal"
            min="0"
            onChange={(event) => setMaxPrice(event.target.value)}
            placeholder="Max price"
            type="number"
            value={maxPrice}
          />
          <button
            className="secondary-button"
            onClick={() => {
              setListingSearch("");
              setListingBusinessId("all");
              setListingStatus("all");
              setListingLocation("");
              setMinPrice("");
              setMaxPrice("");
            }}
            type="button"
          >
            Clear filters
          </button>
        </div>
        {activeFilters.length > 0 && (
          <div className="list-summary">
            {filteredCars.length.toLocaleString()} of {cars.length.toLocaleString()} listings match {activeFilters.join(" • ")}
          </div>
        )}
        <div className="marketplace-business-list">
          {businessesWithListings.map((entry) => (
            <MarketplaceBusinessCard
              key={entry.business.id}
              business={entry.business}
              listings={entry.listings}
              totalListings={entry.totalListings}
              runAction={runAction}
            />
          ))}
          {unassignedListings.length > 0 && (
            <MarketplaceBusinessCard
              business={{id: "unassigned", name: "Unassigned listings", status: "missing_profile"}}
              listings={unassignedListings}
              totalListings={unassignedListings.length}
              runAction={runAction}
            />
          )}
          {cars.length === 0 ? (
            <EmptyState text="No car listings are currently loaded." />
          ) : filteredCars.length === 0 ? (
            <EmptyState text="No listings match the current marketplace filters." />
          ) : null}
        </div>
      </Panel>
      <div className="split-grid">
        <Panel title="Shipment pricing" icon={<BadgeDollarSign size={18} />}>
          <div className="row-list">
            {pricing.map((item) => (
              <DataRow
                key={item.id}
                title={text(item.destinationCountryName ?? item.countryName, item.id)}
                subtitle={`${text(item.businessName, "Business")} • ${formatMoney(item.price ?? item.barrelShippingPrice)}`}
                badge={text(item.status ?? item.isActive, "pricing")}
              />
            ))}
            {pricing.length === 0 && (
              <EmptyState text="No legacy shipment pricing rows are loaded. Destination country coverage is shown on the right." />
            )}
          </div>
        </Panel>
        <Panel
          title="Destination countries"
          icon={<DatabaseZap size={18} />}
          action={
            <div className="panel-tools">
              <label className="compact-search">
                <Search size={15} />
                <input
                  onChange={(event) => setDestinationSearch(event.target.value)}
                  placeholder="Find country"
                  value={destinationSearch}
                />
              </label>
              <button className="secondary-button" disabled={loading} onClick={refreshDestinations}>
                <RefreshCw className={loading ? "spin" : ""} size={15} />
                Refresh
              </button>
            </div>
          }
        >
          <div className="row-list">
            {destinationSearch.trim() && (
              <div className="list-summary">
                {filteredDestinations.length.toLocaleString()} of {destinations.length.toLocaleString()} destinations
              </div>
            )}
            {filteredDestinations.map((item) => (
              <DestinationCoverageRow
                key={text(item._path, item.id)}
                destination={item}
                runAction={runAction}
              />
            ))}
            {destinations.length === 0 && (
              <div className="empty-state">No business destination rows are loaded. Use Production tools to seed destinations for a business.</div>
            )}
            {destinations.length > 0 && filteredDestinations.length === 0 && (
              <div className="empty-state">No destinations match this search.</div>
            )}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function MarketplaceBusinessCard({
  business,
  listings,
  totalListings,
  runAction,
}: {
  business: FirestoreRow;
  listings: FirestoreRow[];
  totalListings: number;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const statusCounts = countBy(listings, "status");
  return (
    <section className="marketplace-business-card">
      <div className="marketplace-business-head">
        <div>
          <strong>{text(business.name, business.id)}</strong>
          <small>
            {[
              statusLabel(business.status),
              business.phone,
              business.email,
              `${listings.length} shown`,
              `${totalListings} total`,
            ].filter(Boolean).join(" • ")}
          </small>
        </div>
        <div className="marketplace-status-strip">
          {listingStatuses.map((status) => (
            <span key={status}>
              {statusLabel(status)}
              <b>{statusCounts[status] ?? 0}</b>
            </span>
          ))}
        </div>
      </div>
      <div className="marketplace-listing-list">
        {listings.map((listing) => (
          <MarketplaceListingRow key={listing.id} listing={listing} runAction={runAction} />
        ))}
        {listings.length === 0 && (
          <EmptyState text="No listings from this business match the current filters." />
        )}
      </div>
    </section>
  );
}

function MarketplaceListingRow({
  listing,
  runAction,
}: {
  listing: FirestoreRow;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [open, setOpen] = useState(false);
  const details = carListingDetails(listing);
  const imageUrl = listingImageUrl(listing);
  return (
    <article className="marketplace-listing-row">
      <div className="listing-photo" aria-label={`${listingTitle(listing)} photo`}>
        {imageUrl ? (
          <img alt={`${listingTitle(listing)} photo`} loading="lazy" src={imageUrl} />
        ) : (
          <div className="listing-photo-placeholder">
            <Car size={30} />
            <span>No photo</span>
          </div>
        )}
      </div>
      <div className="listing-main">
        <strong>{listingTitle(listing)}</strong>
        <small>
          {[
            text(listing.make, ""),
            text(listing.model, ""),
            text(listing.year, ""),
            formatMoney(listing.price),
            listingLocation(listing),
          ].filter(Boolean).join(" • ")}
        </small>
        {details.length > 0 && (
          <button className="details-toggle" type="button" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide details" : "Details"}
            <span className={`chev ${open ? "up" : ""}`}>▾</span>
          </button>
        )}
        {open && details.length > 0 && (
          <dl className="row-detail-grid">
            {details.map(([detailLabel, detailValue]) => (
              <div key={detailLabel}>
                <dt>{detailLabel}</dt>
                <dd>{detailValue}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <select
        value={text(listing.status, "active")}
        onChange={(event) =>
          runAction("Listing status updated", () =>
            commitStatusChange({
              collectionName: "cars",
              targetId: listing.id,
              nextStatus: event.target.value,
            }),
          )
        }
      >
        {listingStatuses.map((status) => (
          <option key={status} value={status}>
            {statusLabel(status)}
          </option>
        ))}
      </select>
      <button
        className="danger-button"
        onClick={() => {
          if (window.confirm(`Delete ${listingTitle(listing)}?`)) {
            runAction("Listing deleted", () => deleteAdminRecord("cars", listing.id));
          }
        }}
      >
        <X size={15} />
        Delete
      </button>
    </article>
  );
}

function DestinationCoverageRow({
  destination,
  runAction,
}: {
  destination: FirestoreRow;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [price, setPrice] = useState(String(destination.barrelShippingPrice ?? ""));
  const [minDays, setMinDays] = useState(String(destination.deliveryEstimateMinDays ?? ""));
  const [maxDays, setMaxDays] = useState(String(destination.deliveryEstimateMaxDays ?? ""));
  const [destinationNote, setDestinationNote] = useState(text(destination.destinationNote ?? destination.details, ""));
  const [active, setActive] = useState(destination.isActive === true);

  useEffect(() => {
    setPrice(String(destination.barrelShippingPrice ?? ""));
    setMinDays(String(destination.deliveryEstimateMinDays ?? ""));
    setMaxDays(String(destination.deliveryEstimateMaxDays ?? ""));
    setDestinationNote(text(destination.destinationNote ?? destination.details, ""));
    setActive(destination.isActive === true);
  }, [destination]);

  async function save() {
    const nextPrice = Number(price);
    if (!Number.isFinite(nextPrice) || nextPrice < 0) {
      throw new Error("Barrel shipping price must be zero or more.");
    }
    if (active && nextPrice <= 0) {
      throw new Error("Active destinations need a barrel shipping fee greater than 0.");
    }

    const hasMin = minDays.trim() !== "";
    const hasMax = maxDays.trim() !== "";
    const nextMin = Number(minDays);
    const nextMax = Number(maxDays);
    if (hasMin !== hasMax) {
      throw new Error("Enter both min and max delivery days, or leave both empty.");
    }
    if (hasMin && (!Number.isInteger(nextMin) || !Number.isInteger(nextMax) || nextMin <= 0 || nextMax < nextMin)) {
      throw new Error("Delivery days must be positive whole numbers, with max greater than or equal to min.");
    }

    const businessId = text(destination.businessId, "");
    const countryId = text(destination.id, "");
    if (!businessId || !countryId) {
      throw new Error("Destination business or country ID is missing.");
    }
    await httpsCallable(functions, "updateDestinationCoverage")({
      businessId,
      countryId,
      barrelShippingPrice: nextPrice,
      deliveryEstimateMinDays: hasMin ? nextMin : undefined,
      deliveryEstimateMaxDays: hasMax ? nextMax : undefined,
      destinationNote: destinationNote.trim(),
      isActive: active,
    });
  }

  return (
    <div className="data-row destination-row">
      <div className="destination-title">
        <span className="country-flag" aria-hidden="true">{countryFlag(destination.code)}</span>
        <strong>{text(destination.name, destination.id)}</strong>
        <small>
          {[
            destination.businessName,
            destination.code,
            destination.businessStatus,
          ].filter(Boolean).join(" • ")}
        </small>
      </div>
      <div className="destination-controls">
        <label className="switch-line destination-active">
          <input
            checked={active}
            onChange={(event) => setActive(event.target.checked)}
            type="checkbox"
          />
          Active
        </label>
        <label className="destination-control">
          <span>Fee</span>
          <input
            aria-label={`${text(destination.name, destination.id)} barrel shipping fee`}
            className="small-input"
            inputMode="decimal"
            min="0"
            onChange={(event) => setPrice(event.target.value)}
            placeholder="Fee"
            type="number"
            value={price}
          />
        </label>
        <label className="destination-control">
          <span>Min</span>
          <input
            aria-label={`${text(destination.name, destination.id)} minimum delivery days`}
            className="small-input"
            inputMode="numeric"
            min="1"
            onChange={(event) => setMinDays(event.target.value)}
            placeholder="Days"
            type="number"
            value={minDays}
          />
        </label>
        <label className="destination-control">
          <span>Max</span>
          <input
            aria-label={`${text(destination.name, destination.id)} maximum delivery days`}
            className="small-input"
            inputMode="numeric"
            min="1"
            onChange={(event) => setMaxDays(event.target.value)}
            placeholder="Days"
            type="number"
            value={maxDays}
          />
        </label>
        <label className="destination-control destination-note-control">
          <span>Details</span>
          <input
            aria-label={`${text(destination.name, destination.id)} destination details`}
            className="destination-note-input"
            onChange={(event) => setDestinationNote(event.target.value)}
            placeholder="Destination details"
            value={destinationNote}
          />
        </label>
      </div>
      <button
        aria-label={`Save ${text(destination.name, destination.id)} destination`}
        className="secondary-button"
        onClick={() => runAction("Destination updated", save)}
      >
        <Check size={15} />
        Save
      </button>
    </div>
  );
}

function optionalText(value: unknown) {
  return text(value, "");
}

function amountFromRecord(
  row: FirestoreRow,
  centsFields: string[],
  amountFields: string[],
) {
  for (const field of centsFields) {
    const cents = Number(row[field]);
    if (Number.isFinite(cents) && cents !== 0) return cents / 100;
  }
  for (const field of amountFields) {
    const amount = Number(row[field]);
    if (Number.isFinite(amount) && amount !== 0) return amount;
  }
  return 0;
}

function firstText(row: FirestoreRow, fields: string[], fallback = "") {
  for (const field of fields) {
    const value = optionalText(row[field]);
    if (value) return value;
  }
  return fallback;
}

function firstDateValue(row: FirestoreRow) {
  const fields = [
    "createdAt",
    "paidAt",
    "completedAt",
    "requestedAt",
    "submittedAt",
    "updatedAt",
  ];
  for (const field of fields) {
    const date = asDate(row[field]);
    if (date) return row[field];
  }
  return row.createdAt ?? row.updatedAt ?? null;
}

function dateMs(value: unknown) {
  return asDate(value)?.getTime() ?? 0;
}

function businessIdentityForRow(row: FirestoreRow, businesses: FirestoreRow[]) {
  const match = businesses.find((business) => belongsToBusiness(row, business));
  return {
    id: optionalText(row.businessId) || optionalText(match?.id),
    name: optionalText(row.businessName) || optionalText(match?.name) || "Unassigned business",
  };
}

function customerNameForRow(row: FirestoreRow) {
  return firstText(row, [
    "customerName",
    "buyerName",
    "ownerName",
    "senderName",
    "receiverName",
    "fullName",
  ]);
}

function customerEmailForRow(row: FirestoreRow) {
  return firstText(row, [
    "customerEmail",
    "buyerEmail",
    "ownerEmail",
    "senderEmail",
    "receiverEmail",
    "email",
  ]);
}

function customerPhoneForRow(row: FirestoreRow) {
  return firstText(row, [
    "customerPhone",
    "buyerPhone",
    "ownerPhone",
    "senderPhone",
    "receiverPhone",
    "phone",
  ]);
}

function financeLedgerRow({
  row,
  source,
  sourceLabel,
  sourceCollection,
  title,
  statusField = "status",
  amount,
  businesses,
}: {
  row: FirestoreRow;
  source: string;
  sourceLabel: string;
  sourceCollection: string;
  title: string;
  statusField?: string;
  amount: number;
  businesses: FirestoreRow[];
}): FinanceLedgerRow {
  const occurredAt = firstDateValue(row);
  const business = businessIdentityForRow(row, businesses);
  const currency = firstText(row, ["currency", "depositCurrency"], "USD");
  const status = rowStatus(row, statusField);
  const customerName = customerNameForRow(row);
  const customerEmail = customerEmailForRow(row);
  const customerPhone = customerPhoneForRow(row);
  const sourceId = optionalText(row.id);
  const relatedLabel = `${sourceLabel} ${sourceId || title}`.trim();
  const searchText = [
    source,
    sourceLabel,
    title,
    sourceId,
    business.id,
    business.name,
    customerName,
    customerEmail,
    customerPhone,
    row.trackingCode,
    row.purchaseCode,
    row.paymentStatus,
    status,
    amount,
  ].map((value) => String(value ?? "").toLowerCase()).join(" ");

  return {
    id: `${sourceCollection}:${sourceId || title}`,
    source,
    sourceLabel,
    sourceCollection,
    sourceId,
    title,
    businessId: business.id,
    businessName: business.name,
    customerName,
    customerEmail,
    customerPhone,
    amount,
    currency,
    status,
    occurredAt,
    occurredAtMs: dateMs(occurredAt),
    relatedLabel,
    searchText,
    record: row,
  };
}

function buildFinanceLedgerRows({
  walletTransactions,
  refunds,
  shipments,
  transports,
  parkedCars,
  purchases,
  cars,
  businesses,
}: {
  walletTransactions: FirestoreRow[];
  refunds: FirestoreRow[];
  shipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
  purchases: FirestoreRow[];
  cars: FirestoreRow[];
  businesses: FirestoreRow[];
}) {
  const refundById = new Map(refunds.map((refund) => [refund.id, refund]));
  const rows: FinanceLedgerRow[] = [];

  walletTransactions.forEach((transaction) => {
    const refund = refundById.get(optionalText(transaction.refundRequestId));
    const merged = {
      ...refund,
      ...transaction,
      customerUid: transaction.customerUid ?? transaction._parentId ?? refund?.customerUid,
      customerEmail: transaction.customerEmail ?? refund?.customerEmail,
      customerName: transaction.customerName ?? refund?.customerName,
      customerPhone: transaction.customerPhone ?? refund?.customerPhone,
      businessId: transaction.businessId ?? refund?.businessId,
      businessName: transaction.businessName ?? refund?.businessName,
    };
    const amount = amountFromRecord(
      merged,
      ["amountCents", "walletAppliedCents"],
      ["amount", "walletAppliedAmount"],
    );
    rows.push(financeLedgerRow({
      row: merged,
      source: "wallet",
      sourceLabel: "Wallet transaction",
      sourceCollection: "wallets/transactions",
      title: firstText(merged, ["reason", "type"], "Wallet transaction"),
      amount,
      businesses,
    }));
  });

  refunds.forEach((refund) => {
    const amount = amountFromRecord(refund, ["amountCents"], ["amount"]);
    rows.push(financeLedgerRow({
      row: refund,
      source: "refund",
      sourceLabel: "Card return",
      sourceCollection: "walletRefundRequests",
      title: firstText(refund, ["customerEmail", "customerName"], "Card return request"),
      amount,
      businesses,
    }));
  });

  shipments.forEach((shipment) => {
    const amount = amountFromRecord(
      shipment,
      ["totalCents", "priceCents", "amountCents", "walletAppliedCents"],
      ["total", "price", "amount", "walletAppliedAmount"],
    );
    rows.push(financeLedgerRow({
      row: shipment,
      source: "barrel",
      sourceLabel: "Barrel shipment",
      sourceCollection: "barrelShipments",
      title: relatedRecordTitle(shipment, "Barrel shipment"),
      amount,
      businesses,
    }));
  });

  transports.forEach((transport) => {
    const amount = amountFromRecord(
      transport,
      ["totalCents", "priceCents", "amountCents"],
      ["totalCost", "price", "quoteAmount", "amount"],
    );
    rows.push(financeLedgerRow({
      row: transport,
      source: "transport",
      sourceLabel: "Transport",
      sourceCollection: "transportRequests",
      title: relatedRecordTitle(transport, "Transport request"),
      amount,
      businesses,
    }));
  });

  parkedCars.forEach((parking) => {
    const amount = amountFromRecord(
      parking,
      ["totalCents", "amountCents"],
      ["totalCost", "price", "amount"],
    );
    rows.push(financeLedgerRow({
      row: parking,
      source: "parking",
      sourceLabel: "Parking",
      sourceCollection: "parkedCars",
      title: relatedRecordTitle(parking, "Parked car"),
      amount,
      businesses,
    }));
  });

  purchases.forEach((purchase) => {
    const amount = amountFromRecord(
      purchase,
      ["depositAmountCents", "amountCents"],
      ["depositAmount", "amount", "price", "listingPrice"],
    );
    rows.push(financeLedgerRow({
      row: purchase,
      source: "purchase",
      sourceLabel: "Car purchase",
      sourceCollection: "carPurchases",
      statusField: "purchaseStatus",
      title: relatedRecordTitle(purchase, "Car purchase"),
      amount,
      businesses,
    }));
  });

  cars
      .filter((car) => ["sold", "reserved"].includes(rowStatus(car)))
      .forEach((car) => {
        const amount = amountFromRecord(car, ["priceCents"], ["price"]);
        rows.push(financeLedgerRow({
          row: car,
          source: "listing",
          sourceLabel: "Listing sale state",
          sourceCollection: "cars",
          title: listingTitle(car),
          amount,
          businesses,
        }));
      });

  return rows.sort((a, b) => b.occurredAtMs - a.occurredAtMs);
}

function supportDraftFromLedgerRow(row: FinanceLedgerRow): SupportDraft {
  return {
    businessId: row.businessId,
    priority: row.status === "pending" ? "urgent" : "normal",
    subject: `${row.sourceLabel}: ${row.title}`.slice(0, 120),
    message: [
      `Please review ${row.relatedLabel}.`,
      `Status: ${statusLabel(row.status)}.`,
      `Amount: ${formatMoney(row.amount, row.currency)}.`,
      row.customerName ? `Customer: ${row.customerName}.` : "",
      row.customerEmail ? `Email: ${row.customerEmail}.` : "",
      row.customerPhone ? `Phone: ${row.customerPhone}.` : "",
    ].filter(Boolean).join(" "),
    customerName: row.customerName,
    customerEmail: row.customerEmail,
    customerPhone: row.customerPhone,
    relatedCollection: row.sourceCollection,
    relatedId: row.sourceId,
    relatedLabel: row.relatedLabel,
  };
}

function amountFromWallet(wallet: FirestoreRow | undefined, centsField: string, amountField: string) {
  if (!wallet) return 0;
  const cents = Number(wallet[centsField] ?? 0);
  if (Number.isFinite(cents) && cents !== 0) return cents / 100;
  const amount = Number(wallet[amountField] ?? 0);
  return Number.isFinite(amount) ? amount : 0;
}

function refundCustomerId(item: FirestoreRow) {
  return text(item.customerUid ?? item.uid ?? item.userId ?? item.customerId, "");
}

function refundCustomerEmail(item: FirestoreRow) {
  return text(item.customerEmail ?? item.email ?? item.buyerEmail, "");
}

function walletCustomerId(wallet: FirestoreRow) {
  return text(wallet.customerUid ?? wallet.id, "");
}

function findWalletForRefund(item: FirestoreRow, wallets: FirestoreRow[]) {
  const customerId = refundCustomerId(item);
  if (!customerId) return undefined;
  return wallets.find((wallet) => walletCustomerId(wallet) === customerId);
}

function findUserForRefund(item: FirestoreRow, users: FirestoreRow[]) {
  const customerId = refundCustomerId(item);
  const customerEmail = refundCustomerEmail(item).toLowerCase();
  return users.find((user) => {
    const userId = text(user.uid ?? user.id, "");
    const email = text(user.email, "").toLowerCase();
    return Boolean(
      (customerId && userId === customerId) ||
      (customerEmail && email === customerEmail),
    );
  });
}

function RefundRequestRow({
  item,
  wallet,
  user,
  canManage,
  reviewRefund,
  runAction,
}: {
  item: FirestoreRow;
  wallet?: FirestoreRow;
  user?: FirestoreRow;
  canManage: boolean;
  reviewRefund: (requestId: string, decision: "completed" | "rejected", note: string) => Promise<void>;
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [note, setNote] = useState("");
  const status = rowStatus(item);
  const currency = text(item.currency, "USD");
  const balance = amountFromWallet(wallet, "balanceCents", "balance");
  const pending = amountFromWallet(wallet, "pendingRefundCents", "pendingRefund");
  const customerId = refundCustomerId(item);
  const accountLabel = user ? userDisplayName(user) : refundCustomerEmail(item) || customerId || "Customer";
  const walletLabel = wallet
    ? `Wallet available ${formatMoney(balance, currency)} • Pending return ${formatMoney(pending, currency)}`
    : "No wallet account loaded";

  return (
    <div className="data-row finance-row refund-account-row">
      <div className="finance-account-main">
        <strong>{formatMoney(item.amount, currency)}</strong>
        <small>
          {[
            accountLabel,
            refundCustomerEmail(item),
            customerId ? `UID ${customerId}` : "",
            formatDate(item.createdAt),
          ].filter(Boolean).join(" • ")}
        </small>
        <div className="finance-account-grid">
          <span>Wallet balance <b>{formatMoney(balance, currency)}</b></span>
          <span>Pending return <b>{formatMoney(pending, currency)}</b></span>
          <span>Request amount <b>{formatMoney(item.amount, currency)}</b></span>
          <span>{walletLabel}</span>
        </div>
      </div>
      <span className={`status-pill ${status === "pending" ? "warning" : ""}`}>
        {statusLabel(status)}
      </span>
      {status === "pending" && canManage ? (
        <div className="finance-review-tools">
          <input
            aria-label={`Review note for ${accountLabel}`}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Review note"
            value={note}
          />
          <div className="row-actions">
            <button
              className="secondary-button"
              onClick={() => runAction("Refund request completed", () => reviewRefund(item.id, "completed", note))}
            >
              <Check size={15} />
              Complete
            </button>
            <button
              className="danger-button"
              onClick={() => {
                if (window.confirm("Return this pending amount to the customer's wallet?")) {
                  runAction("Refund request rejected", () => reviewRefund(item.id, "rejected", note));
                }
              }}
            >
              <X size={15} />
              Reject
            </button>
          </div>
        </div>
      ) : (
        <span className="muted-action">{status === "pending" ? "View only" : "Reviewed"}</span>
      )}
    </div>
  );
}

function FinanceView({
  refunds,
  wallets,
  walletTransactions,
  businesses,
  users,
  cars,
  shipments,
  transports,
  parkedCars,
  purchases,
  supportRequests,
  runAction,
  canManage,
  canSendSupport,
}: {
  refunds: FirestoreRow[];
  wallets: FirestoreRow[];
  walletTransactions: FirestoreRow[];
  businesses: FirestoreRow[];
  users: FirestoreRow[];
  cars: FirestoreRow[];
  shipments: FirestoreRow[];
  transports: FirestoreRow[];
  parkedCars: FirestoreRow[];
  purchases: FirestoreRow[];
  supportRequests: FirestoreRow[];
  runAction: (label: string, action: () => Promise<unknown>) => void;
  canManage: boolean;
  canSendSupport: boolean;
}) {
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [businessFilter, setBusinessFilter] = useState("all");
  const [sourceFilter, setSourceFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [supportDraft, setSupportDraft] = useState<SupportDraft>(() => emptySupportDraft());
  const totalPending = refunds
    .filter((item) => item.status === "pending")
    .reduce((sum, item) => sum + Number(item.amount ?? 0), 0);
  const walletBalanceTotal = wallets.reduce(
    (sum, wallet) => sum + amountFromWallet(wallet, "balanceCents", "balance"),
    0,
  );
  const pendingWalletTotal = wallets.reduce(
    (sum, wallet) => sum + amountFromWallet(wallet, "pendingRefundCents", "pendingRefund"),
    0,
  );
  const ledgerRows = useMemo(() => buildFinanceLedgerRows({
    walletTransactions,
    refunds,
    shipments,
    transports,
    parkedCars,
    purchases,
    cars,
    businesses,
  }), [
    walletTransactions,
    refunds,
    shipments,
    transports,
    parkedCars,
    purchases,
    cars,
    businesses,
  ]);
  const sourceOptions = useMemo(() => {
    const options = new Map<string, string>();
    ledgerRows.forEach((row) => options.set(row.source, row.sourceLabel));
    return Array.from(options.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [ledgerRows]);
  const statusOptions = useMemo(() => {
    return Array.from(new Set(ledgerRows.map((row) => row.status).filter(Boolean))).sort();
  }, [ledgerRows]);
  const filteredLedgerRows = useMemo(() => {
    const needle = ledgerSearch.trim().toLowerCase();
    const selectedBusiness = businesses.find((business) => business.id === businessFilter);
    const selectedBusinessName = optionalText(selectedBusiness?.name).toLowerCase();
    return ledgerRows.filter((row) => {
      const matchesSearch = !needle || row.searchText.includes(needle);
      const matchesBusiness = businessFilter === "all" ||
        row.businessId === businessFilter ||
        row.businessName.toLowerCase() === selectedBusinessName;
      const matchesSource = sourceFilter === "all" || row.source === sourceFilter;
      const matchesStatus = statusFilter === "all" || row.status === statusFilter;
      return matchesSearch && matchesBusiness && matchesSource && matchesStatus;
    });
  }, [businessFilter, businesses, ledgerRows, ledgerSearch, sourceFilter, statusFilter]);
  const ledgerAmountTotal = filteredLedgerRows.reduce((sum, row) => sum + row.amount, 0);
  const businessOptions = businesses.filter((business) => business._inferred !== true);

  async function reviewRefund(requestId: string, decision: "completed" | "rejected", note: string) {
    await httpsCallable(functions, "reviewWalletRefundRequest")({
      requestId,
      decision,
      note: note.trim(),
    });
  }

  return (
    <div className="stack">
      <SectionIntro
        title="Finance queue"
        description="Monitor wallet balance return requests and finance readiness."
        stats={[
          ["Pending refunds", String(refunds.filter((item) => item.status === "pending").length)],
          ["Pending amount", formatMoney(totalPending)],
          ["Wallet balance", formatMoney(walletBalanceTotal)],
          ["Pending in wallets", formatMoney(pendingWalletTotal)],
          ["Ledger rows", String(ledgerRows.length)],
          ["Customers", String(users.filter((item) => item.role === "customer").length)],
        ]}
      />
      <div className="metric-grid">
        <article className="metric money">
          <span>Pending refund amount</span>
          <strong>{formatMoney(totalPending)}</strong>
        </article>
        <article className="metric attention">
          <span>Refund requests</span>
          <strong>{refunds.filter((item) => item.status === "pending").length}</strong>
        </article>
        <article className="metric good">
          <span>Customer wallet balance</span>
          <strong>{formatMoney(walletBalanceTotal)}</strong>
        </article>
        <article className="metric neutral">
          <span>Pending in wallets</span>
          <strong>{formatMoney(pendingWalletTotal)}</strong>
        </article>
      </div>
      <Panel title="All business transactions" icon={<BadgeDollarSign size={18} />}>
        <div className="marketplace-filter-grid finance-filter-grid">
          <label className="compact-search wide">
            <Search size={15} />
            <input
              onChange={(event) => setLedgerSearch(event.target.value)}
              placeholder="Search customer, business, phone, tracking, status"
              value={ledgerSearch}
            />
          </label>
          <select value={businessFilter} onChange={(event) => setBusinessFilter(event.target.value)}>
            <option value="all">All businesses</option>
            {businessOptions.map((business) => (
              <option key={business.id} value={business.id}>
                {text(business.name, business.id)}
              </option>
            ))}
          </select>
          <select value={sourceFilter} onChange={(event) => setSourceFilter(event.target.value)}>
            <option value="all">All sources</option>
            {sourceOptions.map(([source, label]) => (
              <option key={source} value={source}>{label}</option>
            ))}
          </select>
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}>
            <option value="all">All statuses</option>
            {statusOptions.map((status) => (
              <option key={status} value={status}>{statusLabel(status)}</option>
            ))}
          </select>
          <button
            className="secondary-button"
            onClick={() => {
              setLedgerSearch("");
              setBusinessFilter("all");
              setSourceFilter("all");
              setStatusFilter("all");
            }}
            type="button"
          >
            Clear filters
          </button>
        </div>
        <div className="list-summary">
          Showing {filteredLedgerRows.length.toLocaleString()} of {ledgerRows.length.toLocaleString()} finance rows • visible amount {formatMoney(ledgerAmountTotal)}
        </div>
        <div className="row-list finance-ledger-list">
          {filteredLedgerRows.map((row) => (
            <FinanceLedgerRecordRow
              key={row.id}
              row={row}
              canSendSupport={canSendSupport}
              onMessageBusiness={() => setSupportDraft(supportDraftFromLedgerRow(row))}
            />
          ))}
          {ledgerRows.length === 0 && (
            <EmptyState text="No finance records are loaded yet." />
          )}
          {ledgerRows.length > 0 && filteredLedgerRows.length === 0 && (
            <EmptyState text="No finance rows match the current filters." />
          )}
        </div>
      </Panel>
      <Panel title="Business support request" icon={<Send size={18} />}>
        {canSendSupport ? (
          <BusinessSupportRequestForm
            businesses={businessOptions}
            draft={supportDraft}
            onDraftChange={setSupportDraft}
            runAction={runAction}
          />
        ) : (
          <div className="info-band">
            This role can view finance records but cannot send business support requests.
          </div>
        )}
      </Panel>
      <Panel title="Recent business support requests" icon={<ClipboardList size={18} />}>
        <div className="row-list compact">
          {supportRequests.map((request) => (
            <DataRow
              key={request.id}
              title={text(request.subject, "Support request")}
              subtitle={[
                request.businessName,
                request.customerEmail ?? request.customerName ?? request.customerPhone,
                request.relatedLabel,
                formatDate(request.createdAt),
              ].filter(Boolean).join(" • ")}
              badge={`${statusLabel(request.status)} • ${text(request.priority, "normal")}`}
            />
          ))}
          {supportRequests.length === 0 && (
            <EmptyState text="No business support requests have been sent yet." />
          )}
        </div>
      </Panel>
      <Panel title="Wallet card return requests" icon={<BadgeDollarSign size={18} />}>
        <div className="info-band">
          Review the customer account and wallet balance before action. Complete after the external card return is done. Reject moves the pending amount back to the customer's wallet.
        </div>
        <div className="row-list">
          {refunds.map((item) => (
            <RefundRequestRow
              key={item.id}
              item={item}
              wallet={findWalletForRefund(item, wallets)}
              user={findUserForRefund(item, users)}
              canManage={canManage}
              reviewRefund={reviewRefund}
              runAction={runAction}
            />
          ))}
          {refunds.length === 0 && (
            <div className="empty-state">No wallet card return requests are loaded.</div>
          )}
        </div>
      </Panel>
    </div>
  );
}

function FinanceLedgerRecordRow({
  row,
  canSendSupport,
  onMessageBusiness,
}: {
  row: FinanceLedgerRow;
  canSendSupport: boolean;
  onMessageBusiness: () => void;
}) {
  return (
    <div className="data-row finance-row finance-ledger-row">
      <div className="finance-account-main">
        <strong>{row.title}</strong>
        <small>
          {[
            row.sourceLabel,
            row.businessName,
            row.customerName || row.customerEmail || row.customerPhone || "No customer contact",
            formatDate(row.occurredAt),
          ].filter(Boolean).join(" • ")}
        </small>
        <div className="finance-account-grid">
          <span>Amount <b>{formatMoney(row.amount, row.currency)}</b></span>
          <span>Business <b>{row.businessName}</b></span>
          <span>Customer <b>{row.customerName || row.customerEmail || row.customerPhone || "Unknown"}</b></span>
          <span>Record <b>{row.sourceId || row.relatedLabel}</b></span>
          <span>Status <b>{statusLabel(row.status)}</b></span>
          <span>Contact <b>{[row.customerEmail, row.customerPhone].filter(Boolean).join(" • ") || "Not set"}</b></span>
        </div>
      </div>
      <span className={`status-pill ${row.status === "pending" ? "warning" : ""}`}>
        {statusLabel(row.status)}
      </span>
      <div className="finance-review-tools">
        <button
          className="secondary-button"
          disabled={!canSendSupport || !row.businessId}
          onClick={onMessageBusiness}
          type="button"
        >
          <Send size={15} />
          Message business
        </button>
      </div>
    </div>
  );
}

function ToolsView({
  businesses,
  runAction,
}: {
  businesses: FirestoreRow[];
  runAction: (label: string, action: () => Promise<unknown>) => void;
}) {
  const [destinationBusinessId, setDestinationBusinessId] = useState("");
  const [legacyBusinessName, setLegacyBusinessName] = useState("");
  const [backfillCarIds, setBackfillCarIds] = useState("");
  const [reassignExplicitCarIds, setReassignExplicitCarIds] = useState(false);
  const [backfillResult, setBackfillResult] = useState<Record<string, unknown> | null>(null);
  const selectedBusinessId = destinationBusinessId || text(businesses[0]?.id, "");
  const reviewedBackfillCarIds = useMemo(() => {
    const typedIds = parseDelimitedIds(backfillCarIds);
    if (typedIds.length) return typedIds;
    return Array.isArray(backfillResult?.carIds)
      ? backfillResult.carIds.map((item) => text(item, "")).filter(Boolean)
      : [];
  }, [backfillCarIds, backfillResult]);

  async function runCarBackfillDryRun() {
    if (!selectedBusinessId) throw new Error("Select a business first.");
    const carIds = parseDelimitedIds(backfillCarIds);
    if (reassignExplicitCarIds && carIds.length === 0) {
      throw new Error("Wrong/default ownership fixes require explicit car IDs.");
    }
    const result = await httpsCallable(functions, "backfillBusinessCarListings")({
      businessId: selectedBusinessId,
      legacyBusinessName: legacyBusinessName.trim(),
      carIds,
      reassignExplicitCarIds,
      dryRun: true,
    });
    setBackfillResult((result.data || {}) as Record<string, unknown>);
  }

  async function applyReviewedCarBackfill() {
    if (!selectedBusinessId) throw new Error("Select a business first.");
    if (reviewedBackfillCarIds.length === 0) {
      throw new Error("Run a dry run or enter explicit car IDs before applying.");
    }
    const result = await httpsCallable(functions, "backfillBusinessCarListings")({
      businessId: selectedBusinessId,
      carIds: reviewedBackfillCarIds,
      reassignExplicitCarIds,
      dryRun: false,
    });
    setBackfillResult((result.data || {}) as Record<string, unknown>);
  }

  return (
    <div className="stack">
      <SectionIntro
        title="Production tools"
        description="Run setup utilities that already exist in the Firebase backend."
        stats={[
          ["Businesses", String(businesses.length)],
          ["Approved", String(countWhere(businesses, (item) => rowStatus(item) === "approved"))],
        ]}
      />
      <Panel title="Production setup tools" icon={<DatabaseZap size={18} />}>
        <div className="tool-list">
          <button
            className="secondary-button"
            onClick={() =>
              runAction("Default business migration complete", () =>
                httpsCallable(functions, "migrateDefaultBusiness")({}),
              )
            }
          >
            <RefreshCw size={16} />
            Migrate default business data
          </button>
          <button
            className="secondary-button"
            onClick={() =>
              runAction("Destination country seed complete", () =>
                httpsCallable(functions, "seedDestinationCountries")({
                  businessId: selectedBusinessId,
                }),
              )
            }
            disabled={!selectedBusinessId}
          >
            <DatabaseZap size={16} />
            Seed selected business destinations
          </button>
          <select
            aria-label="Business for destination seed"
            value={selectedBusinessId}
            onChange={(event) => setDestinationBusinessId(event.target.value)}
          >
            {businesses.length === 0 && <option value="">No businesses loaded</option>}
            {businesses.map((business) => (
              <option key={business.id} value={business.id}>
                {text(business.name, business.id)}
              </option>
            ))}
          </select>
        </div>
      </Panel>
      <Panel title="Legacy car listing backfill" icon={<Car size={18} />}>
        <div className="settings-form">
          <label>
            Business
            <select
              value={selectedBusinessId}
              onChange={(event) => setDestinationBusinessId(event.target.value)}
            >
              {businesses.length === 0 && <option value="">No businesses loaded</option>}
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>
                  {text(business.name, business.id)} ({business.id})
                </option>
              ))}
            </select>
          </label>
          <label>
            Legacy business name
            <input
              value={legacyBusinessName}
              onChange={(event) => setLegacyBusinessName(event.target.value)}
              placeholder="Optional old display name"
            />
          </label>
          <label className="wide-field">
            Explicit car IDs
            <textarea
              value={backfillCarIds}
              onChange={(event) => setBackfillCarIds(event.target.value)}
              placeholder="car_1, car_2, car_3"
              rows={3}
            />
          </label>
          <div className="switch-line wide-field">
            <input
              checked={reassignExplicitCarIds}
              onChange={(event) => setReassignExplicitCarIds(event.target.checked)}
              type="checkbox"
            />
            <span>Allow reassignment of explicit IDs that already have a wrong/default businessId</span>
          </div>
        </div>
        <div className="tool-list">
          <button
            className="secondary-button"
            disabled={!selectedBusinessId}
            onClick={() =>
              runAction("Legacy car backfill dry run complete", runCarBackfillDryRun)
            }
            type="button"
          >
            <Search size={16} />
            Dry run
          </button>
          <button
            className="primary-button"
            disabled={!selectedBusinessId || reviewedBackfillCarIds.length === 0}
            onClick={() =>
              runAction("Legacy car backfill applied", applyReviewedCarBackfill)
            }
            type="button"
          >
            <Check size={16} />
            Apply reviewed car IDs
          </button>
        </div>
        {backfillResult && (
          <pre className="code-block">
            {JSON.stringify(backfillResult, null, 2)}
          </pre>
        )}
      </Panel>
      <Panel title="Business inventory" icon={<Building2 size={18} />}>
        <div className="compact-stats">
          {businesses.map((business) => (
            <span key={business.id}>
              {text(business.name, business.id)} <b>{text(business.status, "pending")}</b>
            </span>
          ))}
        </div>
      </Panel>
    </div>
  );
}

function parseDelimitedIds(value: string) {
  return Array.from(new Set(
    value
      .split(/[\s,]+/)
      .map((item) => item.trim())
      .filter(Boolean),
  )).slice(0, 200);
}

function CollectionRow({
  item,
  label,
  subtitle,
  statusField,
  statusOptions,
  collectionName,
  title,
  details,
  runAction,
  typeBadge,
}: {
  item: FirestoreRow;
  label: (item: FirestoreRow) => string;
  subtitle: (item: FirestoreRow) => string;
  statusField: string;
  statusOptions: readonly string[];
  collectionName: string;
  title: string;
  details?: (item: FirestoreRow) => Array<[string, string]>;
  runAction: (label: string, action: () => Promise<unknown>) => void;
  typeBadge?: string;
}) {
  const [open, setOpen] = useState(false);
  const rowDetails = details?.(item) ?? [];
  return (
    <div className="table-row">
      <div>
        {typeBadge && <span className="type-badge">{typeBadge}</span>}
        <strong>{label(item)}</strong>
        <small>{subtitle(item)}</small>
        {rowDetails.length > 0 && (
          <button className="details-toggle" type="button" onClick={() => setOpen((v) => !v)}>
            {open ? "Hide details" : "Details"}
            <span className={`chev ${open ? "up" : ""}`}>▾</span>
          </button>
        )}
        {open && rowDetails.length > 0 && (
          <dl className="row-detail-grid">
            {rowDetails.map(([detailLabel, detailValue]) => (
              <div key={detailLabel}>
                <dt>{detailLabel}</dt>
                <dd>{detailValue}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <select
        value={text(item[statusField], "pending")}
        onChange={(event) =>
          runAction(`${title} updated`, () =>
            commitStatusChange({
              collectionName,
              targetId: item.id,
              nextStatus: event.target.value,
            }),
          )
        }
      >
        {statusOptions.map((status) => (
          <option key={status} value={status}>
            {statusLabel(status)}
          </option>
        ))}
      </select>
      <button
        className="danger-button"
        onClick={() => {
          if (window.confirm(`Delete ${label(item)}?`)) {
            runAction(`${title} item deleted`, () =>
              deleteAdminRecord(collectionName, item.id),
            );
          }
        }}
      >
        <X size={15} />
        Delete
      </button>
    </div>
  );
}

function SearchBox({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <label className="search-box">
      <Search size={17} />
      <input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
    </label>
  );
}

function Panel({
  title,
  icon,
  action,
  children,
}: {
  title: string;
  icon: ReactNode;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          {icon}
          <h2>{title}</h2>
        </div>
        {action && <div className="panel-action">{action}</div>}
      </div>
      {children}
    </section>
  );
}

function DataRow({
  title,
  subtitle,
  badge,
}: {
  title: string;
  subtitle: string;
  badge: string;
}) {
  return (
    <div className="data-row">
      <div>
        <strong>{title}</strong>
        <small>{subtitle}</small>
      </div>
      <span className="status-pill">{badge}</span>
    </div>
  );
}

function EmptyState({ text: message }: { text: string }) {
  return <div className="empty-state">{message}</div>;
}

function tabLabel(tab: Tab) {
  return {
    today: "Today",
    businesses: "Businesses",
    people: "People & access",
    operations: "Operations",
    marketplace: "Marketplace",
    finance: "Finance",
    website: "Website",
    tools: "Tools",
    settings: "Settings",
  }[tab];
}

function tabHint(tab: Tab) {
  return {
    today: "What needs you now",
    businesses: "Partner workspaces",
    people: "Admins & customers",
    operations: "Barrels, transport, parking",
    marketplace: "Listings by business",
    finance: "Refund queue",
    website: "Site content",
    tools: "Setup utilities",
    settings: "Roles & configuration",
  }[tab];
}

function tabIcon(tab: Tab) {
  const props = { size: 19 };
  return {
    today: <Activity {...props} />,
    people: <UserCog {...props} />,
    businesses: <Building2 {...props} />,
    operations: <Truck {...props} />,
    marketplace: <Car {...props} />,
    finance: <BadgeDollarSign {...props} />,
    website: <Store {...props} />,
    tools: <DatabaseZap {...props} />,
    settings: <SlidersHorizontal {...props} />,
  }[tab];
}
