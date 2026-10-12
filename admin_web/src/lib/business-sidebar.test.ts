import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBusinessSidebarGroups,
  businessPermissionHeld,
  businessSidebarTabs,
  businessTabServiceAllowed,
  normalizePinnedTabs,
  shippingServiceIds,
} from "./business-sidebar.ts";

// What the console does to pick the tabs a team member sees: the service rule
// and the permission rule, over the real tab list.
function visibleTabIds(offered: string[], permissions: string[] | "owner") {
  return businessSidebarTabs
    .filter((tab) =>
      businessTabServiceAllowed(tab, (id) => offered.includes(id)) &&
      (!tab.permission || permissions === "owner" || businessPermissionHeld(permissions, tab.permission)),
    )
    .map((tab) => tab.id);
}

describe("business sidebar navigation", () => {
  it("groups service configuration with business setup", () => {
    const groups = buildBusinessSidebarGroups(businessSidebarTabs, [], "");
    const business = groups.find((group) => group.id === "business");
    const transport = groups.find((group) => group.id === "transport");

    assert.equal(business?.label, "Business setup");
    assert.deepEqual(
      business?.tabs.map((tab) => tab.id),
      ["profile", "destinations", "people"],
    );
    assert.equal(transport?.label, "Transport & shipping");
    assert.deepEqual(
      transport?.tabs.map((tab) => tab.id),
      ["barrels", "freight", "transport", "parking", "ledger", "containers"],
    );
  });

  it("lists Inventory under Manage, gated on its own service and permission", () => {
    const groups = buildBusinessSidebarGroups(businessSidebarTabs, [], "");
    const manage = groups.find((group) => group.id === "manage");
    assert.deepEqual(
      manage?.tabs.map((tab) => tab.id),
      ["invoices", "inventory", "reviews", "cases", "growth"],
    );
    const entry = businessSidebarTabs.find((tab) => tab.id === "inventory");
    assert.equal(entry?.service, "inventory");
    assert.equal(entry?.permission, "inventory");
    // The sidebar filter finds it by name and by its service.
    for (const needle of ["inventory", "counter"]) {
      assert.deepEqual(
        buildBusinessSidebarGroups(businessSidebarTabs, [], needle).flatMap((group) => group.tabs.map((tab) => tab.id)),
        ["inventory"],
        needle,
      );
    }
  });

  it("keeps pinned sections on top and out of their source group", () => {
    const groups = buildBusinessSidebarGroups(businessSidebarTabs, ["destinations"], "");

    assert.equal(groups[0]?.id, "pinned");
    assert.deepEqual(groups[0]?.tabs.map((tab) => tab.id), ["destinations"]);
    assert.equal(
      groups.find((group) => group.id === "business")?.tabs.some((tab) => tab.id === "destinations"),
      false,
    );
  });

  it("filters by labels, descriptions, services, and group names", () => {
    const groups = buildBusinessSidebarGroups(businessSidebarTabs, [], "routes");
    assert.deepEqual(
      groups.flatMap((group) => group.tabs.map((tab) => tab.id)),
      ["destinations"],
    );

    const serviceGroups = buildBusinessSidebarGroups(businessSidebarTabs, [], "carSales");
    assert.deepEqual(
      serviceGroups.flatMap((group) => group.tabs.map((tab) => tab.id)),
      // Viewings is a carSales tab too: same records and same staff as
      // purchases, but its own queue, because an appointment request is not a
      // sale and gets lost among holds and deposits.
      ["listings", "purchases", "viewings"],
    );
  });

  it("drops pinned tabs that are no longer visible", () => {
    assert.deepEqual(
      normalizePinnedTabs(["today", "missing", "barrels"], businessSidebarTabs),
      ["today", "barrels"],
    );
  });

  it("shows Containers only when the business offers a shipping service", () => {
    const tab = businessSidebarTabs.find((entry) => entry.id === "containers");
    assert.deepEqual(tab?.services, ["barrelShipping", "freight", "carTransport", "carParking"]);
    assert.deepEqual(tab?.services, shippingServiceIds);
    // An Inventory-only or car-sales-only business has no loading lists, owner or staff.
    for (const offered of [["inventory"], ["carSales"], []]) {
      assert.equal(visibleTabIds(offered, "owner").includes("containers"), false, `owner ${offered}`);
      assert.equal(visibleTabIds(offered, ["containers"]).includes("containers"), false, `staff ${offered}`);
    }
    // ANY one shipping service is enough.
    for (const service of shippingServiceIds) {
      assert.equal(visibleTabIds([service], "owner").includes("containers"), true, service);
      assert.equal(visibleTabIds(["inventory", service], ["containers"]).includes("containers"), true, service);
    }
    // Still behind the permission for staff.
    assert.equal(visibleTabIds(["barrelShipping"], ["barrels"]).includes("containers"), false);
    // The Vehicle sales group is empty for an Inventory-only business.
    const groups = buildBusinessSidebarGroups(
      businessSidebarTabs.filter((tab) => visibleTabIds(["inventory"], "owner").includes(tab.id)),
      [],
      "",
    );
    assert.equal(groups.some((group) => group.id === "sales"), false);
    assert.equal(groups.some((group) => group.tabs.some((tab) => tab.id === "containers")), false);
  });

  it("falls back to a single service for the tabs that name one", () => {
    assert.equal(businessTabServiceAllowed({service: "carSales"}, (id) => id === "carSales"), true);
    assert.equal(businessTabServiceAllowed({service: "carSales"}, () => false), false);
    assert.equal(businessTabServiceAllowed({}, () => false), true);
  });

  it("gates Invoices on its own permission, and ledger implies it", () => {
    const entry = businessSidebarTabs.find((tab) => tab.id === "invoices");
    assert.equal(entry?.permission, "invoices");
    assert.equal(entry?.service, undefined);
    assert.equal(entry?.group, "manage");
    assert.equal(visibleTabIds([], ["invoices"]).includes("invoices"), true);
    // Nobody who held ledger loses the tab.
    assert.equal(visibleTabIds([], ["ledger"]).includes("invoices"), true);
    assert.equal(visibleTabIds([], ["people", "parking"]).includes("invoices"), false);
    assert.equal(visibleTabIds([], "owner").includes("invoices"), true);
  });

  it("only ledger implies invoices, and not the other way round", () => {
    assert.equal(businessPermissionHeld(["ledger"], "invoices"), true);
    assert.equal(businessPermissionHeld(["invoices"], "invoices"), true);
    assert.equal(businessPermissionHeld(["invoices"], "ledger"), false, "invoices must not unlock the lot ledger");
    assert.equal(businessPermissionHeld(["containers"], "invoices"), false);
    assert.equal(businessPermissionHeld([], "invoices"), false);
    assert.equal(businessPermissionHeld(["ledger"], "inventory"), false);
  });
});
