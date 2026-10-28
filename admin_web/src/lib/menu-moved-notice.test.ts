import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  MENU_MOVED_NOTICE_UNTIL_MS,
  menuMovedLines,
  shouldShowMenuMovedNotice,
} from "./menu-moved-notice.ts";
import { visibleBusinessTabs, visibleShippingSteps } from "./business-sidebar.ts";

function linesFor(offered: string[], permissions: string[] | "owner") {
  const holds = (permission: string) => permissions === "owner" || permissions.includes(permission);
  const offers = (id: string) => offered.includes(id);
  return menuMovedLines(
    visibleBusinessTabs(offers, holds).map((tab) => tab.id),
    visibleShippingSteps(offers, holds).map((step) => step.id),
  );
}

describe("the one-time 'menu has moved' message", () => {
  it("tells an owner of a shipper and car lot about every move", () => {
    const lines = linesFor(["barrelShipping", "carSales", "carParking", "carTransport"], "owner");
    assert.equal(lines.length, 5);
    assert.match(lines[0], /one page: Shipping/);
    assert.match(lines[1], /Barrel orders/);
    assert.match(lines[2], /under Cars/);
    assert.match(lines[3], /under Money/);
    assert.match(lines[4], /Profile/);
  });

  it("tells staff only about the sections they can open", () => {
    // Destination staff who only deliver: Shipping, nothing else.
    assert.deepEqual(
      linesFor(["barrelShipping"], ["deliveries"]).map((line) => line.slice(0, 20)),
      ["Requests, Waiting li"],
    );
    // A shop: Inventory under Money only.
    assert.deepEqual(linesFor(["inventory"], ["inventory"]), ["Invoices and Inventory are under Money."]);
  });

  it("shows once, until dismissed, and stops after the cut-off", () => {
    const lines = ["x"];
    const before = MENU_MOVED_NOTICE_UNTIL_MS - 1;
    assert.equal(shouldShowMenuMovedNotice(before, false, lines), true);
    assert.equal(shouldShowMenuMovedNotice(before, true, lines), false);
    assert.equal(shouldShowMenuMovedNotice(MENU_MOVED_NOTICE_UNTIL_MS, false, lines), false);
    assert.equal(shouldShowMenuMovedNotice(before, false, []), false);
  });

  it("has French for every sentence it can show", () => {
    const all = linesFor(["barrelShipping", "freight", "carSales", "carParking", "carTransport", "inventory"], "owner");
    for (const english of [
      ...all,
      "The menu has a new layout",
      "Everything is still here, grouped by the work you do.",
      "Can't find something? Type its old name in the search box above the menu.",
      "Show me Shipping",
      "Got it",
    ]) {
      assert.notEqual(translateValue(english, "fr"), english, english);
    }
  });

  it("is decided once the business has loaded, and dismissing remembers it", () => {
    const source = readFileSync(new URL("../components/business-console.tsx", import.meta.url), "utf8");
    assert.match(source, /if \(menuMovedChecked\.current \|\| !business \|\| menuMoved\.length === 0\) return;/);
    assert.match(source, /const closeMenuMoved = useCallback\(\(\) => \{\s*writeMenuMovedDismissed\(\);\s*setMenuMovedOpen\(false\);/);
  });
});
