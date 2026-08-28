"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  TRACKING_ALPHABET,
  TRACKING_CODE_LENGTH,
  buildTrackingCode,
  normalizeTrackingCode,
} = require("../tracking_code");

// Deterministic stand-in for crypto.randomInt so codes are predictable.
const cycling = (values) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe("tracking codes", () => {
  it("builds a short prefixed code", () => {
    const code = buildTrackingCode("BS", cycling([0, 1, 2, 3, 4, 5]));
    assert.equal(code, "BS-234567");
    // The whole point of the change: short enough to read aloud.
    assert.equal(code.length, 9);
  });

  it("uppercases and trims the prefix", () => {
    assert.equal(buildTrackingCode(" fr ", () => 0), "FR-222222");
  });

  it("rejects a missing prefix rather than emitting a bare code", () => {
    assert.throws(() => buildTrackingCode("", () => 0), /prefix is required/);
  });

  it("never emits characters that are misread or spell words", () => {
    // No 0/O, no 1/I/L, and no vowels at all.
    assert.equal(/[01OIL]/.test(TRACKING_ALPHABET), false);
    assert.equal(/[AEIOU]/.test(TRACKING_ALPHABET), false);
    assert.equal(TRACKING_ALPHABET.length, 28);
  });

  it("draws from the whole alphabet", () => {
    const last = TRACKING_ALPHABET.length - 1;
    assert.equal(
        buildTrackingCode("TR", cycling([last])),
        `TR-${TRACKING_ALPHABET[last].repeat(TRACKING_CODE_LENGTH)}`,
    );
  });

  it("accepts however a human retypes a short code", () => {
    for (const typed of ["BS-K7M4P2", "bs-k7m4p2", "bs k7m4p2", "BSK7M4P2"]) {
      assert.equal(normalizeTrackingCode(typed), "BS-K7M4P2");
    }
  });

  it("leaves legacy long codes intact so old shipments still resolve", () => {
    // Pre-existing codes must keep working - they are printed on receipts.
    assert.equal(
        normalizeTrackingCode("BS-MS9TTES1-OMVYTL"),
        "BS-MS9TTES1-OMVYTL",
    );
    assert.equal(
        normalizeTrackingCode("bsms9ttes1omvytl"),
        "BS-MS9TTES1-OMVYTL",
    );
    assert.notEqual(normalizeTrackingCode("BS-MS9TTES1-OMVYTL"), "");
  });

  it("returns empty for unusable input", () => {
    assert.equal(normalizeTrackingCode(""), "");
    assert.equal(normalizeTrackingCode("   "), "");
    assert.equal(normalizeTrackingCode(null), "");
  });
});
