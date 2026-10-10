import assert from "node:assert/strict";
import { test } from "node:test";

import { adminSectionAccess, DEFAULT_ADMIN_ROLES, mergedAdminRoles } from "./admin-access.ts";
import {
  BUSINESS_CONSOLE_ORIGIN,
  adminHasOperationsAccess,
  businessConsoleContainerLink,
  containerDeepLinkFromSearch,
  packageCallHref,
  packageCodeFrom,
  packageLastUpdate,
  packageStaffCandidate,
  packageStaffScope,
  packageStaffViewModel,
  packageUpdateResultText,
  packageUpdateResultTone,
  packageWhatsAppHref,
  type PackageStaffProfile,
} from "./package-staff.ts";

// ---------------------------------------------------------------------------
// The code.
// ---------------------------------------------------------------------------

test("a container-line code is read the way the app's scanner reads it", () => {
  assert.equal(packageCodeFrom("CL-K7M4P2"), "CL-K7M4P2");
  assert.equal(packageCodeFrom(" cl k7m4p2 "), "CL-K7M4P2");
  assert.equal(packageCodeFrom("CLK7M4P2"), "CL-K7M4P2");
  // Not a container line, or not the short alphabet (a zero, an O, a vowel).
  assert.equal(packageCodeFrom("BS-K7M4P2"), "");
  assert.equal(packageCodeFrom("CL-K7M4P0"), "");
  assert.equal(packageCodeFrom("CL-K7M4PO"), "");
  assert.equal(packageCodeFrom("CL-K7M4P"), "");
  assert.equal(packageCodeFrom("CL-K7M4P22"), "");
  assert.equal(packageCodeFrom(null), "");
  assert.equal(packageCodeFrom(""), "");
});

// ---------------------------------------------------------------------------
// Who may see it. The public view must stay the only view for everyone else.
// ---------------------------------------------------------------------------

const signedIn = { signedIn: true, isAnonymous: false, adminOperations: false };

function scope(profile: PackageStaffProfile | null, overrides: Partial<typeof signedIn> = {}) {
  return packageStaffScope({ profile, ...signedIn, ...overrides });
}

test("owners see their own business's packages", () => {
  assert.deepEqual(scope({ role: "businessOwner", businessId: "biz1" }), { kind: "business", businessId: "biz1" });
  assert.deepEqual(scope({ role: "businessOwner", businessId: "  biz1 " }), { kind: "business", businessId: "biz1" });
  // An owner with no business has nowhere to look.
  assert.deepEqual(scope({ role: "businessOwner" }), { kind: "none" });
});

test("staff need the Containers permission and a business", () => {
  assert.deepEqual(
    scope({ role: "staff", businessId: "biz1", businessPermissions: ["parking", "containers"] }),
    { kind: "business", businessId: "biz1" },
  );
  assert.deepEqual(scope({ role: "staff", businessId: "biz1", businessPermissions: ["parking"] }), { kind: "none" });
  assert.deepEqual(scope({ role: "staff", businessId: "biz1" }), { kind: "none" });
  assert.deepEqual(scope({ role: "staff", businessPermissions: ["containers"] }), { kind: "none" });
});

test("customers, guests, signed-out and disabled accounts only ever get the public view", () => {
  assert.deepEqual(scope({ role: "customer", businessId: "biz1", businessPermissions: ["containers"] }), { kind: "none" });
  assert.deepEqual(scope({ id: "guest", role: "customer" } as PackageStaffProfile), { kind: "none" });
  assert.deepEqual(scope(null), { kind: "none" });
  assert.deepEqual(scope({ role: "businessOwner", businessId: "biz1" }, { signedIn: false }), { kind: "none" });
  assert.deepEqual(scope({ role: "businessOwner", businessId: "biz1" }, { isAnonymous: true }), { kind: "none" });
  assert.deepEqual(scope({ role: "businessOwner", businessId: "biz1", disabled: true }), { kind: "none" });
  assert.deepEqual(scope({ role: "owner", businessId: "biz1" }), { kind: "none" });
  assert.deepEqual(scope({}), { kind: "none" });
  // A customer is never even a candidate, so the staff code never loads.
  for (const profile of [{ role: "customer" }, { role: "customer", businessId: "biz1", businessPermissions: ["containers"] }, {}]) {
    assert.equal(packageStaffCandidate({ profile, signedIn: true, isAnonymous: false }), false);
  }
  assert.equal(packageStaffCandidate({ profile: null, signedIn: false, isAnonymous: false }), false);
  assert.equal(packageStaffCandidate({ profile: { role: "businessOwner", businessId: "b" }, signedIn: true, isAnonymous: true }), false);
});

test("platform admins see every business's packages only with operations access", () => {
  assert.deepEqual(scope({ role: "admin", adminRole: "superAdmin" }, { adminOperations: true }), { kind: "admin" });
  assert.deepEqual(scope({ role: "admin", adminRole: "contentManager" }, { adminOperations: false }), { kind: "none" });
  // Before the role is read an admin is a candidate (the staff code loads to read it).
  assert.equal(packageStaffCandidate({ profile: { role: "admin" }, signedIn: true, isAnonymous: false }), true);
  assert.equal(packageStaffCandidate({ profile: { role: "businessOwner", businessId: "b" }, signedIn: true, isAnonymous: false }), true);
});

test("operations access follows the admin role, its stored overrides, and fails closed", () => {
  assert.equal(adminHasOperationsAccess("superAdmin", null), true);
  assert.equal(adminHasOperationsAccess("operationsManager", null), true);
  assert.equal(adminHasOperationsAccess("financeManager", {}), true, "view is enough to look");
  assert.equal(adminHasOperationsAccess("supportAdmin", null), true);
  assert.equal(adminHasOperationsAccess("contentManager", null), false);
  assert.equal(adminHasOperationsAccess("", null), false);
  assert.equal(adminHasOperationsAccess(undefined, null), false);
  assert.equal(adminHasOperationsAccess("madeUpRole", null), false);
  // Stored config overrides the built-in role, and custom roles count.
  const config = {
    roles: {
      operationsManager: { label: "Ops", sections: { operations: "none" as const }, services: [] },
      yard: { label: "Yard", sections: { operations: "view" as const }, services: [] },
    },
  };
  assert.equal(adminHasOperationsAccess("operationsManager", config), false);
  assert.equal(adminHasOperationsAccess("yard", config), true);
  assert.equal(adminSectionAccess("yard", config, "finance"), "none");
});

test("the admin role defaults moved out of the admin console unchanged", () => {
  assert.deepEqual(Object.keys(DEFAULT_ADMIN_ROLES), ["operationsManager", "financeManager", "supportAdmin", "contentManager"]);
  assert.equal(DEFAULT_ADMIN_ROLES.operationsManager.sections.operations, "manage");
  const merged = mergedAdminRoles({ roles: { custom: { label: "  ", sections: { website: "view" }, services: ["freight"] } } });
  assert.equal(merged.custom.label, "custom", "a blank label falls back to the key");
  assert.deepEqual(merged.custom.services, ["freight"]);
  // The defaults themselves are not mutated by a merge.
  mergedAdminRoles(null).operationsManager.sections.operations = "none";
  assert.equal(DEFAULT_ADMIN_ROLES.operationsManager.sections.operations, "manage");
});

// ---------------------------------------------------------------------------
// Call and WhatsApp.
// ---------------------------------------------------------------------------

test("Call dials the number with its plus and digits; nothing to dial is null", () => {
  assert.equal(packageCallHref("+224 620 12 34 56"), "tel:+224620123456");
  assert.equal(packageCallHref("(207) 555-0100"), "tel:2075550100");
  assert.equal(packageCallHref("12"), null);
  assert.equal(packageCallHref(""), null);
  assert.equal(packageCallHref(undefined), null);
});

test("WhatsApp opens wa.me only for a full international number", () => {
  assert.equal(packageWhatsAppHref("+224 620-12-34-56"), "https://wa.me/224620123456");
  assert.equal(packageWhatsAppHref("+1 (207) 555-0100"), "https://wa.me/12075550100");
  // A local number would open a chat with a stranger in another country.
  assert.equal(packageWhatsAppHref("2075550100"), null);
  assert.equal(packageWhatsAppHref("+0224620123456"), null);
  assert.equal(packageWhatsAppHref("+1234"), null);
  assert.equal(packageWhatsAppHref(""), null);
});

// ---------------------------------------------------------------------------
// WhatsApp update status.
// ---------------------------------------------------------------------------

test("every update outcome reads as a whole sentence with its tone", () => {
  const cases: Array<[string, string, string, string]> = [
    ["sender", "sent", "", "Customer: sent"],
    ["receiver", "failed", "", "Receiver: failed to send"],
    ["sender", "waiting_for_whatsapp", "", "Customer: waiting for WhatsApp to be connected"],
    ["sender", "queued", "", "Customer: queued to send"],
    ["receiver", "sending", "", "Receiver: sending"],
    ["receiver", "retrying", "", "Receiver: retrying after a failed try"],
    ["sender", "skipped", "no_phone", "Customer: not sent, no phone"],
    ["receiver", "skipped", "switched_off", "Receiver: not sent, updates switched off"],
    ["sender", "skipped", "needs_country_code", "Customer: not sent, the phone has no country code"],
    ["sender", "skipped", "", "Customer: not sent"],
    ["receiver", "something_new", "", "Receiver: not sent"],
  ];
  for (const [role, status, reason, expected] of cases) {
    assert.equal(packageUpdateResultText(role, status, reason), expected);
  }
  assert.equal(packageUpdateResultTone("sent"), "ok");
  assert.equal(packageUpdateResultTone("failed"), "error");
  assert.equal(packageUpdateResultTone("waiting_for_whatsapp"), "warn");
  assert.equal(packageUpdateResultTone("queued"), "info");
  assert.equal(packageUpdateResultTone("sending"), "info");
  assert.equal(packageUpdateResultTone("retrying"), "warn");
  assert.equal(packageUpdateResultTone("skipped"), "muted");
});

test("the last update is read like the app reads it; anything malformed is no update", () => {
  const last = packageLastUpdate({
    update: "shipped",
    atMs: Date.UTC(2026, 9, 3, 15, 5),
    results: [
      { role: "sender", status: "sent" },
      { role: "receiver", status: "skipped", reason: "needs_country_code" },
      { role: "", status: "sent" },
      "junk",
    ],
  });
  assert.ok(last);
  assert.equal(last.sentence, "Last update: left port");
  assert.equal(last.at?.toISOString(), "2026-10-03T15:05:00.000Z");
  assert.deepEqual(last.results.map((r) => r.text), ["Customer: sent", "Receiver: not sent, the phone has no country code"]);
  assert.equal(packageLastUpdate({ update: "at_port", results: [] })?.sentence, "Last update: at the destination port");
  assert.equal(packageLastUpdate({ update: "arrived" })?.sentence, "Last update: arrived");
  assert.equal(packageLastUpdate({ update: "arrived" })?.at, null);
  assert.equal(packageLastUpdate({ update: "customs" })?.sentence, "Latest update");
  // A Firestore Timestamp in `at` is read when there is no atMs.
  const at = new Date(Date.UTC(2026, 8, 1));
  assert.equal(packageLastUpdate({ update: "arrived", at: { toDate: () => at } })?.at, at);
  assert.equal(packageLastUpdate(null), null);
  assert.equal(packageLastUpdate({}), null);
  assert.equal(packageLastUpdate("shipped"), null);
});

// ---------------------------------------------------------------------------
// The view model.
// ---------------------------------------------------------------------------

const carLine = {
  id: "line1",
  businessId: "biz1",
  containerId: "box1",
  kind: "car",
  vinNumber: "1hgcm82633a004352",
  carYear: "2019",
  carMake: "Toyota",
  carModel: "Camry",
  quantity: 1,
  ownerKind: "customer",
  customerName: "Aissatou Bah",
  customerPhone: "+12075550100",
  receiverName: "Mamadou Diallo",
  receiverPhone: "620123456",
  notifyCustomer: true,
  notifyReceiver: true,
  trackingCode: "cl-k7m4p2",
  lastCustomerUpdate: { update: "shipped", atMs: 1, results: [{ role: "sender", status: "sent" }] },
};

const box = {
  id: "box1",
  containerNumber: "MSKU1234567",
  label: "Sailing Oct 3",
  status: "shipped",
  destinationCountryId: "guinea",
  destinationCountryName: "Guinea",
  sailedAt: { toDate: () => new Date(Date.UTC(2026, 9, 3)) },
};

test("a car line becomes the app's package view", () => {
  const view = packageStaffViewModel(carLine, box);
  assert.equal(view.code, "CL-K7M4P2");
  assert.equal(view.title, "2019 Toyota Camry");
  assert.equal(view.kind, "car");
  assert.equal(view.quantity, 0, "a car shows its VIN, not a count");
  assert.equal(view.vin, "1HGCM82633A004352");
  assert.equal(view.stock, false);
  assert.deepEqual(view.owner, {
    name: "Aissatou Bah",
    phone: "+12075550100",
    callHref: "tel:+12075550100",
    whatsAppHref: "https://wa.me/12075550100",
    needsCountryCode: false,
  });
  // The receiver's number has no country code: callable, not on WhatsApp.
  assert.equal(view.receiver?.callHref, "tel:620123456");
  assert.equal(view.receiver?.whatsAppHref, null);
  assert.equal(view.receiver?.needsCountryCode, true);
  assert.equal(view.container?.title, "MSKU1234567");
  assert.equal(view.container?.subtitle, "Sailing Oct 3");
  assert.equal(view.container?.status, "shipped");
  assert.equal(view.container?.destinationId, "guinea");
  assert.equal(view.container?.sailedAt?.toISOString(), "2026-10-03T00:00:00.000Z");
  assert.equal(view.container?.arrivedAt, null);
  assert.equal(view.whatsApp.summary, "WhatsApp updates: customer");
  assert.deepEqual(view.whatsApp.warnings, ["Receiver's phone needs a country code"]);
  assert.equal(view.lastUpdate?.results[0].text, "Customer: sent");
  assert.equal(view.consoleLink, `${BUSINESS_CONSOLE_ORIGIN}/?container=box1&line=line1`);
});

test("stock, barrels, no receiver, and a container not yet loaded", () => {
  const view = packageStaffViewModel(
    { id: "l2", containerId: "box1", kind: "barrels", quantity: 12, ownerKind: "stock", customerName: "ignored" },
    null,
  );
  assert.equal(view.title, "12 barrels");
  assert.equal(view.quantity, 12);
  assert.equal(view.vin, "");
  assert.equal(view.stock, true);
  assert.equal(view.owner, null);
  assert.equal(view.receiver, null);
  assert.equal(view.container, null);
  assert.equal(view.lastUpdate, null);
  assert.equal(view.whatsApp.summary, "No WhatsApp updates");
  // Only the line's own container is shown under it.
  assert.equal(packageStaffViewModel({ ...carLine, containerId: "box2" }, box).container, null);
  // A working name with no number is the title, with no sub-line.
  const named = packageStaffViewModel(carLine, { id: "box1", label: "Box 2" }).container;
  assert.equal(named?.title, "Box 2");
  assert.equal(named?.subtitle, "");
  assert.equal(named?.status, "loading");
});

// ---------------------------------------------------------------------------
// The business console deep link.
// ---------------------------------------------------------------------------

test("the business console link opens on the container with the line marked, and reads back", () => {
  const link = businessConsoleContainerLink("box 1", "line&1");
  assert.equal(link, "https://business.laawoldigital.com/?container=box+1&line=line%261");
  assert.deepEqual(containerDeepLinkFromSearch(new URL(link).search), { containerId: "box 1", lineId: "line&1" });
  assert.equal(businessConsoleContainerLink("box1"), "https://business.laawoldigital.com/?container=box1");
  assert.equal(businessConsoleContainerLink(""), "https://business.laawoldigital.com/");
  assert.deepEqual(containerDeepLinkFromSearch("?container=box1"), { containerId: "box1", lineId: "" });
  assert.equal(containerDeepLinkFromSearch(""), null);
  assert.equal(containerDeepLinkFromSearch("?service=tracking&code=CL-K7M4P2"), null);
  assert.equal(containerDeepLinkFromSearch("?container=a/b"), null, "not a document id");
  assert.deepEqual(containerDeepLinkFromSearch("?container=box1&line=x/y"), { containerId: "box1", lineId: "" });
});

// ---------------------------------------------------------------------------
// A package that has no container yet.
// ---------------------------------------------------------------------------

test("a waiting package has no container to show, but carries its size, country and money", () => {
  const view = packageStaffViewModel(
    {
      id: "w1", businessId: "biz", kind: "barrels", quantity: 2, containerId: "", containerStatus: "waiting",
      trackingCode: "CL-K7M4P2", customerName: "Fatou Diallo", customerPhone: "+12075550101",
      destinationCountryId: "guinea", destinationCountryName: "Guinea",
      lengthIn: 40, widthIn: 30, heightIn: 20, priceCents: 5000, paidCents: 2000, payOnArrival: true,
    },
    // A stale snapshot of some container never shows under a waiting line.
    { id: "box1", status: "loading" },
  );
  assert.equal(view.waiting, true);
  assert.equal(view.container, null);
  assert.equal(view.destinationId, "guinea");
  assert.equal(view.destinationName, "Guinea");
  assert.equal(view.size?.dimensionsText, "40 × 30 × 20 in");
  assert.equal(view.size?.volumeText, "13.89 ft³");
  assert.equal(view.payment.status, "partial");
  assert.equal(view.payment.balanceCents, 3000);
  // No container to open on: the link is the console itself.
  assert.equal(view.consoleLink, `${BUSINESS_CONSOLE_ORIGIN}/`);
});

test("a line on a container is not waiting, and an old line has no size or price", () => {
  const view = packageStaffViewModel({ id: "l1", containerId: "box1", containerStatus: "loading", kind: "barrels", quantity: 1 }, null);
  assert.equal(view.waiting, false);
  assert.equal(view.size, null);
  assert.equal(view.payment.status, "no_price");
  assert.equal(view.payment.balanceCents, null);
});
