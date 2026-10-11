import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBusinessSidebarGroups,
  businessSidebarTabs,
  normalizePinnedTabs,
} from "./business-sidebar.ts";

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
});
