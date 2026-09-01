const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const {publicGuestTrackingRecord} = require("../guest_tracking");

const source = fs.readFileSync(`${__dirname}/../index.js`, "utf8");

test("a tracked price request says how many answers are waiting", () => {
  const record = publicGuestTrackingRecord({
    id: "abc",
    service: "freight_quote",
    data: {
      trackingCode: "FQ-6KXQZ8",
      status: "quote_requested",
      quoteStatus: "collecting",
      quoteCount: 2,
    },
  });
  assert.equal(record.quoteCount, 2);
  assert.equal(record.quoteStatus, "collecting");
  // A count is public; a price never is.
  assert.equal("amountCents" in record, false);
});

test("a shipment record carries no quote fields at all", () => {
  const record = publicGuestTrackingRecord({
    id: "abc",
    service: "freight",
    data: {trackingCode: "FR-XZHPBK", status: "pending", quoteCount: 9},
  });
  assert.equal("quoteCount" in record, false);
});

test("junk counts are floored to an honest zero", () => {
  const record = publicGuestTrackingRecord({
    id: "abc",
    service: "freight_quote",
    data: {trackingCode: "FQ-X", status: "quote_requested",
      quoteCount: "wat"},
  });
  assert.equal(record.quoteCount, 0);
});

test("claiming moves a guest request into the session holding the code",
    () => {
      // The request lives in one browser's anonymous session; the email
      // receipt carries the code, and code + that email is how the customer
      // proves it is theirs from any device.
      assert.match(source, /exports\.claimFreightQuoteRequest = onCall\(/);
      assert.match(source, /claimQuoteRequestHour/);
      assert.match(source,
          /That email does not match this request/);
      // A signed-in account's request never moves on an email alone.
      assert.match(source, /owner\.providerData\.length > 0/);
      assert.match(source, /claimedFromUid/);
    });

test("both quote-request moments email the customer", () => {
  // A guest has no push token and no account inbox: the email IS the
  // receipt, and its code is the way back in.
  assert.match(source, /Your Laawol price request \$\{trackingCode\}/);
  assert.match(source, /You have a price for /);
  const links = source.match(
      /customer\.laawoldigital\.com\/\?service=tracking&code=/g,
  );
  assert.ok(links && links.length >= 2, "both emails carry the return link");
});
