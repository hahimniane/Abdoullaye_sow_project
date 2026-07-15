import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildBusinessSidebarGroups,
  businessSidebarTabs,
  normalizePinnedTabs,
} from "./business-sidebar.ts";

describe("business sidebar navigation", () => {
  it("groups destinations under transport and shipping", () => {
    const groups = buildBusinessSidebarGroups(businessSidebarTabs, [], "");
    const transport = groups.find((group) => group.id === "transport");

    assert.equal(transport?.label, "Transport & shipping");
    assert.deepEqual(
      transport?.tabs.map((tab) => tab.id),
      ["barrels", "freight", "transport", "destinations", "parking"],
    );
  });

  it("keeps pinned sections on top and out of their source group", () => {
    const groups = buildBusinessSidebarGroups(businessSidebarTabs, ["destinations"], "");

    assert.equal(groups[0]?.id, "pinned");
    assert.deepEqual(groups[0]?.tabs.map((tab) => tab.id), ["destinations"]);
    assert.equal(
      groups.find((group) => group.id === "transport")?.tabs.some((tab) => tab.id === "destinations"),
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
      ["listings", "purchases"],
    );
  });

  it("drops pinned tabs that are no longer visible", () => {
    assert.deepEqual(
      normalizePinnedTabs(["today", "missing", "barrels"], businessSidebarTabs),
      ["today", "barrels"],
    );
  });
});
