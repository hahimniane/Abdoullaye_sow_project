import assert from "node:assert/strict";
import test from "node:test";

import { closePendingTab, openPendingTab, sendPendingTab } from "./pending-tab.ts";

type FakeTab = { location: { href: string }; closed: boolean; opener: unknown; close: () => void };

function fakeTab(): FakeTab {
  const tab: FakeTab = { location: { href: "about:blank" }, closed: false, opener: {}, close: () => { tab.closed = true; } };
  return tab;
}

test("a pending tab opens blank, cut off from the console", () => {
  const tab = fakeTab();
  const calls: unknown[][] = [];
  const opened = openPendingTab({ open: (...args: unknown[]) => { calls.push(args); return tab as unknown as Window; } } as never);
  assert.equal(opened, tab);
  assert.deepEqual(calls, [["", "_blank"]]);
  assert.equal(tab.opener, null);
});

test("a blocked or throwing open gives null, so the caller shows the link", () => {
  assert.equal(openPendingTab({ open: () => null } as never), null);
  assert.equal(openPendingTab({ open: () => { throw new Error("blocked"); } } as never), null);
  assert.equal(openPendingTab(null), null);
});

test("the tab is sent to the URL once the server answers, unless it is gone", () => {
  const tab = fakeTab();
  assert.equal(sendPendingTab(tab as never, "https://laawoldigital.com/d?t=x"), true);
  assert.equal(tab.location.href, "https://laawoldigital.com/d?t=x");
  assert.equal(sendPendingTab(null, "https://x"), false);
  assert.equal(sendPendingTab(fakeTab() as never, ""), false);
  const closed = fakeTab();
  closed.closed = true;
  assert.equal(sendPendingTab(closed as never, "https://x"), false);
});

test("a failed request closes the waiting tab and tolerates none", () => {
  const tab = fakeTab();
  closePendingTab(tab as never);
  assert.equal(tab.closed, true);
  assert.doesNotThrow(() => closePendingTab(null));
});
