const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {smsDestination} = require("../phone_number");

describe("smsDestination", () => {
  it("never guesses +1 for a local number from another country", () => {
    // Guinea mobile, as a Conakry customer types it. This used to go out as
    // +1622112233 - a stranger's number in North America.
    assert.equal(smsDestination("622112233"), "");
    assert.equal(smsDestination("622 11 22 33"), "");
    assert.equal(smsDestination("0622112233"), "");
    // Ten digits, but area code 0xx/1xx and exchange 0xx/1xx are not NANP.
    assert.equal(smsDestination("1234567890"), "");
    assert.equal(smsDestination("2011234567"), "");
  });

  it("uses an international number as typed, minus formatting", () => {
    assert.equal(smsDestination("+224622112233"), "+224622112233");
    assert.equal(smsDestination("+224 622 11 22 33"), "+224622112233");
    assert.equal(smsDestination("+33 (6) 12.34.56.78"), "+33612345678");
    assert.equal(smsDestination(" +1 201-555-0147 "), "+12015550147");
  });

  it("adds +1 only to a clear US/Canada number", () => {
    assert.equal(smsDestination("(201) 555-0147"), "+12015550147");
    assert.equal(smsDestination("201.555.0147"), "+12015550147");
    assert.equal(smsDestination("1 201 555 0147"), "+12015550147");
    assert.equal(smsDestination("1-201-555-0147"), "+12015550147");
  });

  it("rejects malformed international numbers", () => {
    assert.equal(smsDestination("+0224622112233"), "");
    assert.equal(smsDestination("+1234567"), "");
    assert.equal(smsDestination("+1234567890123456"), "");
    assert.equal(smsDestination("++224622112233"), "");
    assert.equal(smsDestination("224+622112233"), "");
  });

  it("rejects empty and non-numeric input", () => {
    for (const value of [undefined, null, "", "   ", "call me", 42]) {
      assert.equal(smsDestination(value), "");
    }
    assert.equal(smsDestination("201-555-0147 ext 2"), "");
  });

  it("is idempotent on its own output", () => {
    for (const value of ["+224622112233", "(201) 555-0147"]) {
      const once = smsDestination(value);
      assert.equal(smsDestination(once), once);
    }
  });
});

describe("walk-up parking SMS", () => {
  it("routes the Twilio recipient through smsDestination", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    const start = source.indexOf("async function smsWalkUpParkingCustomer(");
    assert.notEqual(start, -1);
    const body = source.slice(start, source.indexOf("\n}\n", start));
    assert.match(body, /smsDestination\(to\)/);
    assert.match(body, /To: destination,/);
    assert.doesNotMatch(body, /`\+1\$\{/);
  });
});
