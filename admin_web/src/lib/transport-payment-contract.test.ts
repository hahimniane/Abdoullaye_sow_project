import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

// Accepting a transport quote now charges (hold-first, like every service).
// These pin the three client-side halves of that contract: the customer pays
// at acceptance, an unpaid job can be paid again, and the carrier is not
// offered work the server will refuse.

const services = readFileSync(
  "src/components/customer-shipping-services.tsx",
  "utf8",
);
const console_ = readFileSync("src/components/customer-console.tsx", "utf8");
const businessPanel = readFileSync(
  "src/components/business/operations-panels.tsx",
  "utf8",
);

test("accepting a transport quote leads straight into payment", () => {
  assert.match(
    services,
    /callFunction\("selectTransportQuote"[\s\S]{0,400}startCheckout\("transportJob", \{requestId: activeRequest\.id\}\)/,
  );
});

test("an accepted-but-unpaid job offers Pay now, not silence", () => {
  // The customer can abandon Stripe's page; without a retry button the job
  // would sit at pending_payment forever with no way back in.
  assert.match(services, /"succeeded" && \(/);
  assert.match(services, /payForJob/);
});

test("a paid transport job cancels through the secured path", () => {
  assert.match(
    console_,
    /case "transportRequests":[\s\S]{0,600}orderType: "transportJob"/,
  );
});

test("the carrier panel offers only cancel while payment is pending", () => {
  assert.match(businessPanel, /awaitingPayment/);
  assert.match(
    businessPanel,
    /\.filter\(\s*\(next\) => next === "cancelled",?\s*\)/,
  );
});

test("a won or dead opportunity leaves the Quote opportunities tab", () => {
  // A selected opportunity lives in Accepted jobs; listing it under Quote
  // opportunities too made every accepted job appear twice, and closed or
  // cancelled ones sat there forever as clutter.
  assert.match(
    businessPanel,
    /status !== "selected" && status !== "closed" &&\s*status !== "cancelled"/,
  );
});

test("a transported car is tracked like a barrel", () => {
  // Journey card, milestone feed and carrier subscription all speak
  // transportRequests now - customers watch the car, carriers post updates.
  const consoleSource = readFileSync(
    "src/components/customer-console.tsx",
    "utf8",
  );
  assert.match(consoleSource, /relatedCollection: "transportRequests"/);
  assert.match(consoleSource, /id: "transport" as const/);
  assert.match(
    businessPanel,
    /TrackingUpdatesSection[\s\S]{0,120}relatedCollection="transportRequests"/,
  );
  assert.match(
    businessPanel,
    /ContainerTrackingCard[\s\S]{0,120}relatedCollection="transportRequests"/,
  );
});
