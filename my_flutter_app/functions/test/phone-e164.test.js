"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {CALLING_CODE_BY_COUNTRY} = require("../calling_code_catalog");
const {ALL_COUNTRIES} = require("../country_catalog");
const {
  STATUS,
  lastTwo,
  loginLanguage,
  regionIsoForCountry,
  sameNumber,
  strictE164,
  toE164,
} = require("../phone_e164");

const ok = (e164) => ({status: STATUS.OK, e164});
const needs = {status: STATUS.NEEDS_COUNTRY_CODE, e164: ""};
const invalid = {status: STATUS.INVALID, e164: ""};

describe("calling code catalog port", () => {
  it("is the Dart catalog, pair for pair", () => {
    const source = readFileSync(path.join(__dirname, "..", "..", "lib",
        "data", "calling_code_catalog.dart"), "utf8");
    const block = source.split("byCountryCode = <String, String>{")[1]
        .split("};")[0];
    const dart = Object.fromEntries([...block.matchAll(
        /'([A-Z]{2})': '(\d+)'/g)].map((m) => [m[1], m[2]]));
    assert.ok(Object.keys(dart).length > 200);
    assert.deepEqual({...CALLING_CODE_BY_COUNTRY}, dart);
  });
});

describe("toE164 - international numbers", () => {
  it("accepts the canonical field's +<code><number> form", () => {
    assert.deepEqual(toE164("+12025550123"), ok("+12025550123"));
    assert.deepEqual(toE164("+224 622 12 34 56"), ok("+224622123456"));
    assert.deepEqual(toE164("+221 77 123 45 67"), ok("+221771234567"));
    assert.deepEqual(toE164("+225 07 12 34 56 78"), ok("+2250712345678"));
    assert.deepEqual(toE164("+33 6 12 34 56 78"), ok("+33612345678"));
  });
  it("reads 00 as the international prefix and drops a (0) trunk", () => {
    assert.deepEqual(toE164("00224622123456"), ok("+224622123456"));
    assert.deepEqual(toE164("+33 (0)6 12 34 56 78"), ok("+33612345678"));
    assert.deepEqual(toE164("+44 07700 900123"), ok("+447700900123"));
  });
  it("refuses numbers that do not fit a known plan", () => {
    assert.deepEqual(toE164("+1 202 555 012"), invalid); // 9 digits
    assert.deepEqual(toE164("+1 102 555 0123"), invalid); // area code 1xx
    assert.deepEqual(toE164("+224 522 12 34 56"), invalid);
    assert.deepEqual(toE164("+225 12345678"), invalid); // old 8-digit CI
  });
  it("length-checks a country without a curated plan", () => {
    assert.deepEqual(toE164("+49 30 1234567"), ok("+49301234567"));
    assert.deepEqual(toE164("+4930"), invalid);
    assert.deepEqual(toE164("+999 1234 5678"), invalid); // no such code
    assert.deepEqual(toE164("+1234567890123456"), invalid); // 16 digits
  });
  it("refuses text, empties and junk", () => {
    assert.deepEqual(toE164(""), {status: STATUS.EMPTY, e164: ""});
    assert.deepEqual(toE164(null), {status: STATUS.EMPTY, e164: ""});
    assert.deepEqual(toE164("call me"), invalid);
    assert.deepEqual(toE164("+1-202-555-0123 ext 4"), invalid);
    assert.deepEqual(toE164("++12025550123"), invalid);
  });
});

describe("toE164 - local numbers", () => {
  it("adds +1 for a US business when the number is valid NANP", () => {
    assert.deepEqual(toE164("(202) 555-0123", {regionIso: "US"}),
        ok("+12025550123"));
    assert.deepEqual(toE164("1 202 555 0123", {regionIso: "US"}),
        ok("+12025550123"));
    assert.deepEqual(toE164("2025550123", {regionIso: "CA"}),
        ok("+12025550123"));
  });
  it("does not guess a number that does not fit the business's country", () => {
    // A Guinean mobile typed bare at a US shop.
    assert.deepEqual(toE164("622123456", {regionIso: "US"}), needs);
    // Exchange 1xx is not NANP.
    assert.deepEqual(toE164("6221234567", {regionIso: "US"}), needs);
    assert.deepEqual(toE164("555 0123", {regionIso: "US"}), needs);
    // No country known at all.
    assert.deepEqual(toE164("2025550123"), needs);
    // A country with no curated plan.
    assert.deepEqual(toE164("030 1234567", {regionIso: "DE"}), needs);
  });
  it("never guesses outside NANP, even a number that fits the country", () => {
    // Owner decision: only US/Canada (NANP) businesses get a code added.
    for (const [raw, regionIso] of [["622 12 34 56", "GN"],
      ["77 123 45 67", "SN"], ["76 12 34 56", "ML"],
      ["07 12 34 56 78", "CI"], ["701 2345", "GM"], ["076 123456", "SL"],
      ["06 12 34 56 78", "FR"], ["024 412 3456", "GH"],
      ["0803 123 4567", "NG"], ["07700 900123", "GB"]]) {
      assert.deepEqual(toE164(raw, {regionIso}), needs, `${regionIso} ${raw}`);
    }
  });
  it("still checks international numbers against the curated plans", () => {
    assert.deepEqual(toE164("+224 622 12 34 56", {regionIso: "GN"}),
        ok("+224622123456"));
    assert.deepEqual(toE164("+221 77 123 45 67"), ok("+221771234567"));
    assert.deepEqual(toE164("+234 0803 123 4567"), ok("+2348031234567"));
    assert.deepEqual(toE164("+224 522 12 34 56"), invalid);
  });
});

describe("helpers", () => {
  it("strictE164 only accepts an already-international number", () => {
    assert.equal(strictE164("+12025550123"), "+12025550123");
    assert.equal(strictE164("2025550123"), "");
    assert.equal(strictE164("+1202"), "");
  });
  it("sameNumber follows the raw field, so a changed number leaves", () => {
    assert.equal(sameNumber("+1 202 555 0123", "+12025550123"), true);
    assert.equal(sameNumber("(202) 555-0123", "+12025550123"), true);
    assert.equal(sameNumber("06 12 34 56 78", "+33612345678"), true);
    assert.equal(sameNumber("+12025550199", "+12025550123"), false);
    assert.equal(sameNumber("", "+12025550123"), false);
    assert.equal(sameNumber("0123", "+12025550123"), false);
  });
  it("picks French for francophone codes or a French profile", () => {
    assert.equal(loginLanguage("+224622123456"), "fr");
    assert.equal(loginLanguage("+33612345678"), "fr");
    assert.equal(loginLanguage("+2250712345678"), "fr");
    assert.equal(loginLanguage("+12025550123"), "en");
    assert.equal(loginLanguage("+12025550123", "fr"), "fr");
    assert.equal(loginLanguage("+224622123456", "en"), "en");
    // +1 242 (Bahamas) is not +242 (Congo).
    assert.equal(loginLanguage("+12423561234"), "en");
  });
  it("shows two digits and nothing more", () => {
    assert.equal(lastTwo("+12025550135"), "35");
    assert.equal(lastTwo(""), "");
    assert.equal(lastTwo("+1"), "");
  });
  it("maps a business's stored country to its ISO code", () => {
    assert.equal(regionIsoForCountry("United States", ALL_COUNTRIES), "US");
    assert.equal(regionIsoForCountry("guinea", ALL_COUNTRIES), "GN");
    assert.equal(regionIsoForCountry("SN", ALL_COUNTRIES), "SN");
    assert.equal(regionIsoForCountry("", ALL_COUNTRIES), "");
    assert.equal(regionIsoForCountry("Atlantis", ALL_COUNTRIES), "");
  });
});
