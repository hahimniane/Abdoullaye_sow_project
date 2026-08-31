const test = require("node:test");
const assert = require("node:assert/strict");

const {humanStatusLabel} = require("../status_label");

test("a database enum becomes words a customer can read", () => {
  // "Your freight shipment is now awaiting_weight_confirmation." went out
  // to a real customer; the underscore form must never reach a sentence.
  assert.equal(
      humanStatusLabel("awaiting_weight_confirmation"),
      "awaiting weight confirmation",
  );
  assert.equal(humanStatusLabel("in_transit"), "in transit");
  assert.equal(humanStatusLabel("delivered"), "delivered");
});

test("an absent status falls back instead of printing emptiness", () => {
  assert.equal(humanStatusLabel(""), "updated");
  assert.equal(humanStatusLabel(null), "updated");
  assert.equal(humanStatusLabel(undefined), "updated");
  assert.equal(humanStatusLabel("   "), "updated");
});

test("the notification bodies use the label, not the raw status", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(`${__dirname}/../index.js`, "utf8");
  assert.match(
      source,
      /barrel shipment is now \$\{humanStatusLabel\(after\.status\)\}/,
  );
  assert.match(
      source,
      /freight shipment is now \$\{humanStatusLabel\(after\.status\)\}/,
  );
  assert.doesNotMatch(source, /is now \$\{after\.status \|\| "updated"\}/);
});
