const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  PARKING_LINK_STATES,
  parkingPaymentLinkState,
} = require("../business_parking_entry");

const source = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");

/**
 * A walk-up recorded as "paid in person" is unpaid, so its document is an
 * invoice - but it can never be paid through the durable link. A lot printed
 * one for $120, the customer scanned the QR on it, and the page answered
 * "Nothing to pay. There is no payment outstanding on this parking."
 *
 * Two separate faults: a QR that refuses the money it is printed beside, and
 * a page that reports "not payable here" as "nothing is owed".
 */
describe("a parking settled in person", () => {
  const directEntry = {
    paymentMethod: "direct",
    paymentStatus: "awaiting_direct_payment",
    amountDueCents: 12000,
    trackingCode: "PK-W8Y3BD",
    businessName: "KEREN AUTO SALES",
  };

  it("is not payable through the link, though money is owed", () => {
    assert.equal(
        parkingPaymentLinkState(directEntry),
        PARKING_LINK_STATES.UNAVAILABLE,
    );
    assert.ok(directEntry.amountDueCents > 0);
  });

  it("prints no payment QR, because the code would refuse the money", () => {
    assert.match(source, /const payableOnline =/);
    assert.match(
        source,
        /parkingPaymentLinkState\(entry\) === PARKING_LINK_STATES\.PAYABLE;/,
    );
    assert.match(source, /const payUrl = isInvoice && payableOnline \?/);
  });

  it("never reports an outstanding amount as nothing to pay", () => {
    const branch = source.slice(
        source.indexOf("if (state !== PARKING_LINK_STATES.PAYABLE)"),
    );
    const body = branch.slice(0, branch.indexOf("\n      }\n"));

    // The outstanding case is decided before the "nothing owed" reply, and
    // it is decided on the money, not on the method alone.
    assert.match(body, /const directOutstanding =/);
    assert.match(body, /outstandingCents > 0/);
    assert.ok(
        body.indexOf("Pay at the parking lot") <
          body.indexOf("Nothing to pay"),
        "the outstanding reply must come before the nothing-owed reply",
    );
    // And it tells them where the money goes instead.
    assert.match(body, /still owed - please pay them in person/);
    assert.match(body, /take card payments/);
  });
});
