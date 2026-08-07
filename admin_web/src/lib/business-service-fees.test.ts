// The console's per-service commission editor is only useful if it agrees with
// the backend about (a) which of the three levels wins and (b) which typed
// values are storable. These tests lock both against
// functions/platform_fees.js, plus the two mistakes that would silently break
// billing: clearing an override by writing 0, and offering fewer than the
// seven service keys the backend reads.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  SERVICE_FEE_KEYS,
  SERVICE_FEE_LABELS,
  SERVICE_PLATFORM_FEE_FIELD,
  hasStoredServiceFeeOverride,
  parseServiceFeePercent,
  platformServiceFeeRate,
  resolveServiceFeeForKey,
  serviceFeeKeyChain,
  storedServiceFeeRate,
  usableFeeRate,
} from "./business-service-fees.ts";

const pricing = {
  platformFeePct: 0.1,
  parkingPlatformFeePct: 0.05,
  barrelPlatformFeePct: 0.12,
  freightPlatformFeePct: 0.08,
};

test("a usable rate is a number in [0, 1) - everything else is ignored", () => {
  assert.equal(usableFeeRate(0), 0);
  assert.equal(usableFeeRate(0.075), 0.075);
  assert.equal(usableFeeRate(0.999999), 0.999999);
  assert.equal(usableFeeRate("0.2"), 0.2);

  for (const bad of [1, 1.5, 5, -0.01, NaN, Infinity, "", null, undefined, "abc", {}]) {
    assert.equal(usableFeeRate(bad), null, `${String(bad)} must be ignored`);
  }
});

test("the business's service override wins over its blanket rate and the platform", () => {
  const business = {
    platformFeePct: 0.2,
    [SERVICE_PLATFORM_FEE_FIELD]: { parkingPlatformFeePct: 0.03 },
  };
  const parking = resolveServiceFeeForKey(pricing, business, "parkingPlatformFeePct");
  assert.deepEqual(parking, {
    pct: 0.03,
    source: "business_service",
    key: "parkingPlatformFeePct",
  });

  // A service with no override of its own still takes the blanket rate.
  const freight = resolveServiceFeeForKey(pricing, business, "freightPlatformFeePct");
  assert.deepEqual(freight, { pct: 0.2, source: "business", key: "" });
});

test("the platform rate wins only when the business has neither level", () => {
  const resolved = resolveServiceFeeForKey(pricing, {}, "parkingPlatformFeePct");
  assert.deepEqual(resolved, {
    pct: 0.05,
    source: "platform",
    key: "parkingPlatformFeePct",
  });
  assert.deepEqual(
    resolveServiceFeeForKey(pricing, null, "carPurchasePlatformFeePct"),
    { pct: 0.1, source: "platform", key: "carPurchasePlatformFeePct" },
  );
});

test("an out-of-range override falls through instead of being clamped", () => {
  const business = {
    platformFeePct: 0.2,
    // 5 was meant as "5%" - the backend refuses it, so the console must show
    // the blanket rate as the one actually in force.
    [SERVICE_PLATFORM_FEE_FIELD]: { parkingPlatformFeePct: 5 },
  };
  assert.deepEqual(
    resolveServiceFeeForKey(pricing, business, "parkingPlatformFeePct"),
    { pct: 0.2, source: "business", key: "" },
  );

  const noBlanket = { [SERVICE_PLATFORM_FEE_FIELD]: { parkingPlatformFeePct: 5 } };
  assert.equal(
    resolveServiceFeeForKey(pricing, noBlanket, "parkingPlatformFeePct").source,
    "platform",
  );
});

test("0 is a real rate, not an absent one", () => {
  const business = {
    platformFeePct: 0.2,
    [SERVICE_PLATFORM_FEE_FIELD]: { freightPlatformFeePct: 0 },
  };
  assert.deepEqual(
    resolveServiceFeeForKey(pricing, business, "freightPlatformFeePct"),
    { pct: 0, source: "business_service", key: "freightPlatformFeePct" },
  );
  assert.equal(storedServiceFeeRate(business, "freightPlatformFeePct"), 0);
  assert.equal(storedServiceFeeRate(business, "parkingPlatformFeePct"), null);
  assert.equal(hasStoredServiceFeeOverride(business, "freightPlatformFeePct"), true);
  assert.equal(hasStoredServiceFeeOverride(business, "parkingPlatformFeePct"), false);
});

test("an unusable stored value is still present, so it stays clearable", () => {
  const business = { [SERVICE_PLATFORM_FEE_FIELD]: { parkingPlatformFeePct: 5 } };
  assert.equal(storedServiceFeeRate(business, "parkingPlatformFeePct"), null);
  assert.equal(hasStoredServiceFeeOverride(business, "parkingPlatformFeePct"), true);
});

test("shared barrels inherit the barrel rate at every level", () => {
  assert.deepEqual(serviceFeeKeyChain("sharedBarrelPlatformFeePct"), [
    "sharedBarrelPlatformFeePct",
    "barrelPlatformFeePct",
  ]);
  assert.deepEqual(serviceFeeKeyChain("barrelPlatformFeePct"), [
    "barrelPlatformFeePct",
  ]);

  // Level 1: the business's barrel override covers shared barrels...
  const barrelOnly = {
    [SERVICE_PLATFORM_FEE_FIELD]: { barrelPlatformFeePct: 0.04 },
  };
  assert.deepEqual(
    resolveServiceFeeForKey(pricing, barrelOnly, "sharedBarrelPlatformFeePct"),
    { pct: 0.04, source: "business_service", key: "barrelPlatformFeePct" },
  );

  // ...unless shared barrels have been given their own.
  const both = {
    [SERVICE_PLATFORM_FEE_FIELD]: {
      barrelPlatformFeePct: 0.04,
      sharedBarrelPlatformFeePct: 0.01,
    },
  };
  assert.deepEqual(
    resolveServiceFeeForKey(pricing, both, "sharedBarrelPlatformFeePct"),
    { pct: 0.01, source: "business_service", key: "sharedBarrelPlatformFeePct" },
  );

  // Level 3: same ordering against the pricing document.
  assert.deepEqual(
    resolveServiceFeeForKey(pricing, {}, "sharedBarrelPlatformFeePct"),
    { pct: 0.12, source: "platform", key: "sharedBarrelPlatformFeePct" },
  );
});

test("the platform level keeps the backend's present-but-unusable quirk", () => {
  // Present but unusable reads as zero rather than falling through to the
  // next key: an admin who set it meant to set it.
  assert.equal(platformServiceFeeRate({ parkingPlatformFeePct: 4 }, ["parkingPlatformFeePct"]), 0);
  // An explicit null still ENDS the key search (it is present), but reads as
  // "not set" afterwards - so it falls through to the pricing document's
  // blanket rate rather than to the next service key.
  assert.equal(
    platformServiceFeeRate(
      {
        sharedBarrelPlatformFeePct: null,
        barrelPlatformFeePct: 0.12,
        platformFeePct: 0.1,
      },
      ["sharedBarrelPlatformFeePct", "barrelPlatformFeePct"],
    ),
    0.1,
  );
  // A key that is absent entirely does fall through to the next one.
  assert.equal(
    platformServiceFeeRate({ barrelPlatformFeePct: 0.12, platformFeePct: 0.1 }, [
      "sharedBarrelPlatformFeePct",
      "barrelPlatformFeePct",
    ]),
    0.12,
  );
  // Nothing configured at all: the compiled-in 10% default.
  assert.equal(platformServiceFeeRate(null, ["freightPlatformFeePct"]), 0.1);
});

test("an empty box means inherit, and inherit means remove the field", () => {
  assert.deepEqual(parseServiceFeePercent(""), { ok: true, action: "clear" });
  assert.deepEqual(parseServiceFeePercent("   "), { ok: true, action: "clear" });
  // Zero is NOT clearing - it stores a real "take nothing" rate.
  assert.deepEqual(parseServiceFeePercent("0"), {
    ok: true,
    action: "set",
    rate: 0,
  });
});

test("a typed percentage is stored as a fraction, or refused", () => {
  assert.deepEqual(parseServiceFeePercent("7.5"), {
    ok: true,
    action: "set",
    rate: 0.075,
  });
  assert.deepEqual(parseServiceFeePercent("99.99"), {
    ok: true,
    action: "set",
    rate: 0.9999,
  });

  for (const bad of ["100", "100.01", "-1", "-0.5", "abc", "1e9"]) {
    const result = parseServiceFeePercent(bad);
    assert.equal(result.ok, false, `${bad} must be refused`);
  }

  // Rounding must not push a value into the range the backend ignores.
  assert.equal(parseServiceFeePercent("99.99999").ok, false);
});

test("every stored rate the parser accepts is a rate the backend will use", () => {
  for (const percent of ["0", "0.001", "1", "12.5", "50", "99.98", "99.9999"]) {
    const result = parseServiceFeePercent(percent);
    if (!result.ok || result.action !== "set") continue;
    assert.notEqual(
      usableFeeRate(result.rate),
      null,
      `${percent}% stored as ${result.rate} would be ignored by the backend`,
    );
  }
});

const source = readFileSync("src/components/admin-console.tsx", "utf8");

test("the console offers all seven service keys the backend reads", () => {
  assert.equal(SERVICE_FEE_KEYS.length, 7);
  for (const key of [
    "parkingPlatformFeePct",
    "freightPlatformFeePct",
    "barrelPlatformFeePct",
    "sharedBarrelPlatformFeePct",
    "carPurchasePlatformFeePct",
    "carDepositPlatformFeePct",
    "holdExtensionPlatformFeePct",
  ]) {
    assert.ok(
      (SERVICE_FEE_KEYS as readonly string[]).includes(key),
      `missing service key ${key}`,
    );
    assert.ok(
      SERVICE_FEE_LABELS[key as keyof typeof SERVICE_FEE_LABELS],
      `missing label for ${key}`,
    );
  }
  assert.match(source, /SERVICE_FEE_KEYS\.map/);
});

test("clearing a per-service override deletes the field instead of writing 0", () => {
  // Writing 0 would read as "the platform takes nothing" forever, not as
  // "inherit". The clear path must use deleteField(), as the blanket-rate
  // reset already does.
  assert.match(
    source,
    /clearBusinessServiceFee[\s\S]{0,900}deleteField\(\)/,
    "the per-service clear handler must call deleteField()",
  );
  assert.match(
    source,
    /\[`\$\{SERVICE_PLATFORM_FEE_FIELD\}\.\$\{key\}`\]: deleteField\(\)/,
  );
  assert.doesNotMatch(
    source,
    /clearBusinessServiceFee[\s\S]{0,900}\]: 0,/,
    "the per-service clear handler must not write 0",
  );
});

test("the editor renders the level in force for each service", () => {
  assert.match(source, /resolveServiceFeeForKey/);
  for (const label of [
    "Service override",
    "Business rate",
    "Platform default",
  ]) {
    assert.ok(source.includes(`"${label}"`), `missing source label ${label}`);
  }
});

test("the new per-service commission strings translate to French", () => {
  for (const english of [
    "Per-service commission overrides",
    "Service override",
    "Business rate",
    "Platform default",
    "Effective rate",
    "In force",
    "Override (%)",
    "Car deposit",
    "Hold extension",
    "Inherit",
    "Select a business to review and edit its per-service commissions.",
    "Enter a commission of at least 0% and under 100%, or leave it empty to inherit.",
  ]) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, `missing French for "${english}"`);
    // Round-trips must settle, or the runtime observer rewrites forever.
    assert.equal(translateValue(french, "fr"), french);
  }
});
