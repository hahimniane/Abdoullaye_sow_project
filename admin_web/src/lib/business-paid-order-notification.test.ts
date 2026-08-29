import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const console_ = readFileSync("src/components/business-console.tsx", "utf8");
const functions = readFileSync(
  "../my_flutter_app/functions/index.js",
  "utf8",
);

// Every notification in functions/index.js was addressed to the customer -
// customerUid, buyerUid, senderUid. A business had no way to learn a paid order
// had arrived except by opening the console and looking, so work sat unstarted
// for as long as nobody checked.
test("every paying service notifies the business", () => {
  for (const service of [
    "barrels",
    "freight",
    "parking",
    "purchases",
    "transport",
  ]) {
    assert.match(
        functions,
        new RegExp(`service: "${service}"`),
        `${service} does not notify the business when it is paid`,
    );
  }
});

test("the notification fires only on the transition into paid", () => {
  // An edit to an already-paid order must not notify again.
  const helper = functions.slice(
      functions.indexOf("function paymentJustSucceeded"),
  ).slice(0, 400);
  assert.match(helper, /after === "succeeded"/);
  assert.match(helper, /before !== "succeeded"/);
});

test("it is addressed to the business owner, not the customer", () => {
  const helper = functions.slice(
      functions.indexOf("async function notifyBusinessOfPaidOrder"),
  ).slice(0, 900);
  assert.match(helper, /collection\("businesses"\)\.doc\(id\)/);
  assert.match(helper, /ownerUid/);
  assert.match(helper, /preferenceKey: "businessActivity"/);
});

test("a notification failure cannot break the payment write", () => {
  const helper = functions.slice(
      functions.indexOf("async function notifyBusinessOfPaidOrder"),
  ).slice(0, 900);
  // The order is already paid by this point; a notification problem must not
  // surface as a failed payment.
  assert.match(helper, /safeSendPreferenceNotification/);
});

test("transport credits the winning business, not the requester", () => {
  // transportRequests carries both a businessId and the selected bidder;
  // paying the wrong one would notify a business that did not win the job.
  assert.match(
      functions,
      /businessId: paidAfter\.selectedBusinessId \|\| paidAfter\.businessId/,
  );
});

test("each service opens its own tab", () => {
  const routing = readFileSync("src/lib/notification-routing.ts", "utf8");
  assert.match(routing, /if \(type === "business_order_paid"\)/);
  for (const [service, tab] of [
    ["barrels", "barrels"],
    ["freight", "freight"],
    ["transport", "transport"],
    ["parking", "parking"],
    ["purchases", "purchases"],
  ]) {
    assert.match(
        routing,
        new RegExp(`case "${service}":\\s*\\n\\s*return "${tab}";`),
        `${service} does not route to the ${tab} tab`,
    );
  }
});

test("the console forwards the service so routing can use it", () => {
  assert.match(console_, /businessTargetForNotification\(data\)/);
  assert.match(console_, /focusRecordId=\{notificationFocusId\}/);
});
