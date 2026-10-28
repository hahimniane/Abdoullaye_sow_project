import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBusinessSidebarGroups,
  businessPermissionHeld,
  businessSidebarTabs,
  businessTabServiceAllowed,
  normalizePinnedTabs,
  shippingServiceIds,
  shippingStepForTab,
  shippingSteps,
  visibleBusinessTabs,
  visibleShippingSteps,
} from "./business-sidebar.ts";

// What the console does to pick what a team member sees, over the real lists.
function holder(permissions: string[] | "owner") {
  return (permission: string) =>
    permissions === "owner" || businessPermissionHeld(permissions, permission);
}
function visibleTabIds(offered: string[], permissions: string[] | "owner", hasListings = false) {
  return visibleBusinessTabs((id) => offered.includes(id), holder(permissions), {hasListings})
    .map((tab) => tab.id);
}
function visibleStepIds(offered: string[], permissions: string[] | "owner") {
  return visibleShippingSteps((id) => offered.includes(id), holder(permissions)).map((step) => step.id);
}

describe("business sidebar navigation", () => {
  it("has four groups: Overview, Cars, Money, Business", () => {
    const groups = buildBusinessSidebarGroups(businessSidebarTabs, [], "");
    assert.deepEqual(
      groups.map((group) => [group.label, group.tabs.map((tab) => tab.id)]),
      [
        ["Overview", ["today", "shipping"]],
        ["Cars", ["parking", "ledger", "transport", "listings", "purchases", "viewings"]],
        ["Money", ["invoices", "inventory"]],
        ["Business", ["profile", "destinations", "people", "reviews", "cases", "growth"]],
      ],
    );
  });

  it("puts every shipping list on one Shipping page, in the order a package moves", () => {
    assert.deepEqual(
      shippingSteps.map((step) => [step.id, step.flow]),
      [
        ["requests", true],
        ["waiting", true],
        ["containers", true],
        ["deliveries", true],
        ["barrels", false],
        ["freight", false],
        ["volume", false],
      ],
    );
    // None of the old shipping tabs is its own sidebar entry any more.
    for (const old of ["barrels", "freight", "containers", "deliveries", "volume"]) {
      assert.equal(businessSidebarTabs.some((tab) => tab.id === old), false, old);
    }
  });

  it("shows Shipping only when the viewer can open at least one step", () => {
    // An Inventory-only or car-sales-only business has no loading lists, owner or staff.
    for (const offered of [["inventory"], ["carSales"], []]) {
      assert.equal(visibleTabIds(offered, "owner").includes("shipping"), false, `owner ${offered}`);
      assert.equal(visibleTabIds(offered, ["containers"]).includes("shipping"), false, `staff ${offered}`);
    }
    // ANY one shipping service is enough.
    for (const service of shippingServiceIds) {
      assert.equal(visibleTabIds([service], "owner").includes("shipping"), true, service);
      assert.equal(visibleTabIds(["inventory", service], ["containers"]).includes("shipping"), true, service);
    }
    // Staff without any shipping permission do not see it.
    assert.equal(visibleTabIds(["barrelShipping"], ["ledger", "parking"]).includes("shipping"), false);
  });

  it("gives an owner of a barrel shipper every step but Freight", () => {
    assert.deepEqual(
      visibleStepIds(["barrelShipping", "carSales", "carParking", "carTransport"], "owner"),
      ["requests", "waiting", "containers", "deliveries", "barrels", "volume"],
    );
    assert.deepEqual(
      visibleStepIds(["freight"], "owner"),
      ["requests", "waiting", "containers", "deliveries", "freight", "volume"],
    );
  });

  it("keeps each step behind the permission its old tab had", () => {
    // Containers holders: the three lists, Deliveries (implied) and the month.
    assert.deepEqual(
      visibleStepIds(["barrelShipping"], ["containers"]),
      ["requests", "waiting", "containers", "deliveries", "volume"],
    );
    // A deliveries-only person sees Deliveries and nothing of the loading lists.
    assert.deepEqual(visibleStepIds(["barrelShipping"], ["deliveries"]), ["deliveries"]);
    assert.equal(businessPermissionHeld(["deliveries"], "containers"), false, "deliveries must not open Containers");
    // Barrel orders and Freight keep their own permissions.
    assert.deepEqual(visibleStepIds(["barrelShipping", "freight"], ["barrels"]), ["barrels"]);
    assert.deepEqual(visibleStepIds(["barrelShipping", "freight"], ["freight"]), ["freight"]);
    // And their own service.
    assert.deepEqual(visibleStepIds(["carParking"], ["barrels", "freight"]), []);
  });

  it("opens the matching step for the old tab ids notifications and links still use", () => {
    assert.equal(shippingStepForTab("containers"), "containers");
    assert.equal(shippingStepForTab("containers", "requests"), "requests");
    assert.equal(shippingStepForTab("containers", "waiting"), "waiting");
    assert.equal(shippingStepForTab("containers", "line"), "containers");
    assert.equal(shippingStepForTab("deliveries"), "deliveries");
    assert.equal(shippingStepForTab("barrels"), "barrels");
    assert.equal(shippingStepForTab("freight", "requests"), "freight");
    assert.equal(shippingStepForTab("volume"), "volume");
    for (const other of ["today", "parking", "transport", "invoices", "profile", "shipping"]) {
      assert.equal(shippingStepForTab(other), null, other);
    }
  });

  it("turns pins saved on old shipping tabs into one Shipping pin", () => {
    assert.deepEqual(
      normalizePinnedTabs(["containers", "barrels", "parking", "deliveries"], businessSidebarTabs),
      ["shipping", "parking"],
    );
    assert.deepEqual(
      normalizePinnedTabs(["today", "missing", "shipping"], businessSidebarTabs),
      ["today", "shipping"],
    );
  });

  it("lists Inventory under Money, gated on its own service and permission", () => {
    const entry = businessSidebarTabs.find((tab) => tab.id === "inventory");
    assert.equal(entry?.group, "money");
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
      // purchases, but its own queue.
      ["listings", "purchases", "viewings"],
    );

    // Typing an old section's name still finds where it went.
    for (const needle of ["containers", "deliveries", "waiting", "barrels", "freight", "volume"]) {
      assert.deepEqual(
        buildBusinessSidebarGroups(businessSidebarTabs, [], needle).flatMap((group) => group.tabs.map((tab) => tab.id)),
        ["shipping"],
        needle,
      );
    }
  });

  it("hides empty groups: an Inventory-only shop has no Cars group", () => {
    const groups = buildBusinessSidebarGroups(
      visibleBusinessTabs((id) => id === "inventory", () => true),
      [],
      "",
    );
    assert.deepEqual(groups.map((group) => group.id), ["overview", "money", "business"]);
  });

  it("keeps Listings while a business that stopped selling cars still has some", () => {
    assert.equal(visibleTabIds(["barrelShipping"], "owner").includes("listings"), false);
    assert.equal(visibleTabIds(["barrelShipping"], "owner", true).includes("listings"), true);
    assert.equal(visibleTabIds(["barrelShipping"], ["parking"], true).includes("listings"), false);
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
    assert.equal(entry?.group, "money");
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
