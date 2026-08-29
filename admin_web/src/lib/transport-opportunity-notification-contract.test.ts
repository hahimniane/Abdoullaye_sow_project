import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const console_ = readFileSync("src/components/business-console.tsx", "utf8");
const panels = readFileSync(
  "src/components/business/operations-panels.tsx",
  "utf8",
);
const bell = readFileSync("src/components/notification-bell.tsx", "utf8");
const functions = readFileSync(
  "../my_flutter_app/functions/index.js",
  "utf8",
);

// A transport opportunity expires at quoteDeadlineAt. Before this, a business
// only found out a request existed by happening to open the console, so a
// business that was not looking lost the job by default. The notification has
// to carry enough payload to land on the one request it is about - dropping the
// business on a list of every opportunity is what it replaced.
test("the server notifies each eligible business about a new request", () => {
  assert.match(functions, /type: "transport_opportunity"/);
  assert.match(functions, /preferenceKey: "businessActivity"/);
});

test("the notification carries the ids needed to deep-link", () => {
  const block = functions.slice(
    functions.indexOf('type: "transport_opportunity"'),
  );
  const payload = block.slice(0, 400);
  // requestId is what the console focuses on; without it the link is generic.
  assert.match(payload, /requestId: requestRef\.id/);
  assert.match(payload, /businessId: provider\.businessId/);
  assert.match(payload, /opportunityId: transportMarketplaceDocumentId\(/);
});

test("it is sent per eligible provider, not once per request", () => {
  // One shared notification cannot deep-link, since each business has its own
  // opportunity document and only sees its own.
  assert.match(functions, /providers\.map\(\(provider\) => \{/);
  assert.match(functions, /provider\.business\?\.ownerUid/);
});

test("a failed notification cannot fail the request itself", () => {
  // The customer's request is already committed by this point - a notification
  // problem must not surface as a failed submission.
  const block = functions.slice(
    functions.indexOf('type: "transport_opportunity"') - 900,
  );
  assert.match(block.slice(0, 900), /safeSendPreferenceNotification/);
});

test("the bell hands the notification payload to the console", () => {
  assert.match(bell, /onSelect\?\.\(item\.data \?\? \{\}\)/);
});

test("opening a transport notification opens the transport tab", () => {
  const routing = readFileSync("src/lib/notification-routing.ts", "utf8");
  assert.match(routing, /case "transport_opportunity":/);
  assert.match(console_, /businessTargetForNotification/);
});

test("the console forwards the request id to the transport panel", () => {
  assert.match(console_, /setNotificationFocusId\(target\.focusId \?\? ""\)/);
  assert.match(console_, /focusRequestId=\{notificationFocusId\}/);
  assert.match(console_, /focusView=\{notificationFocusView\}/);
});

test("the panel reveals the focused request instead of filtering it out", () => {
  // A stale search box would hide the card. View comes from the notification
  // type: paid/won jobs open Accepted jobs, new/lost quotes open Opportunities.
  assert.match(panels, /setView\(focusView === "jobs" \? "jobs" : "opportunities"\)/);
  assert.match(panels, /setSearch\(""\)/);
  assert.match(panels, /scrollIntoView/);
});

test("the focused card is marked so it can be seen after scrolling", () => {
  assert.match(panels, /focused \? " focused" : ""/);
  assert.match(panels, /ref=\{focused \? focusedCardRef : undefined\}/);
});
