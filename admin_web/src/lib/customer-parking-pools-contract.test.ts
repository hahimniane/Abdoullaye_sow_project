import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  "src/components/customer-parking-pools.tsx",
  "utf8",
);
const styles = readFileSync("src/app/globals.css", "utf8");

test("parking uses server search pricing and the shared checkout path", () => {
  assert.match(source, /"listParkingOptions"/);
  assert.match(source, /"listPublicParkingOptions"/);
  assert.match(source, /startCheckout\("parking", \{/);
  for (const key of [
    "businessId",
    "customerName",
    "customerPhone",
    "carMake",
    "carModel",
    "carYear",
    "vinNumber",
    "startDate",
    "endDate",
    "pickupRequested",
    "marketplaceDisclosure",
  ]) {
    assert.match(source, new RegExp(`\\b${key}(?:\\s*:|,)`));
  }
  assert.doesNotMatch(source, /(?:amount|price):\s*option\./);
});

test("shared barrels use customer-scoped membership and public open-pool reads", () => {
  assert.match(
    source,
    /query\(collection\(db, "openBarrels"\), where\("status", "==", "open"\)\)/,
  );
  assert.match(
    source,
    /collection\(db, "users", firebaseUser\.uid, "barrelPools"\)/,
  );
  assert.match(source, /"listOpenBarrelPoolOptions"/);
});

test("shared barrel actions use exact callables and checkout order types", () => {
  assert.match(source, /functions,\s*"listActiveBarrelDestinationOptions"/);
  assert.match(source, /startCheckout\("barrelPoolDeposit", \{/);
  assert.match(source, /startCheckout\("barrelPoolJoin", \{/);
  assert.match(source, /startCheckout\("barrelPoolBalance", \{/);
  assert.match(source, /owner \? "cancelBarrelPool" : "leaveBarrelPool"/);
  for (const key of [
    "contentsAttested",
    "prohibitedItemsAcknowledged",
    "sharedLiabilityAccepted",
    "marketplaceDisclosure",
  ]) {
    assert.match(source, new RegExp(`${key}[,:]`));
  }
});

test("every remote loading path has an explicit safety timeout", () => {
  assert.match(source, /ACTION_TIMEOUT_MS = 30_000/);
  assert.match(source, /SNAPSHOT_TIMEOUT_MS = 15_000/);
  assert.match(source, /async function withTimeout/);
});

test("shared-barrel acknowledgements keep compact checkboxes inside the form", () => {
  assert.match(
    styles,
    /\.customer-form-grid \.customer-choice-row > input\[type="checkbox"\]/,
  );
  assert.match(
    styles,
    /\.customer-form-grid \.customer-disclosure > input\[type="checkbox"\]/,
  );
  assert.match(styles, /flex: 0 0 18px;/);
  assert.match(styles, /overflow-wrap: anywhere;/);
});

test("narrow parking layouts keep headings and fields in one readable column", () => {
  const tabletBreakpoint = styles.lastIndexOf("@media (max-width: 820px)");
  const narrowBreakpoint = styles.lastIndexOf("@media (max-width: 560px)");
  assert.ok(narrowBreakpoint > tabletBreakpoint);
  const narrowStyles = styles.slice(narrowBreakpoint);
  assert.match(
    narrowStyles,
    /\.customer-service-search \.panel-header > div\s*\{[^}]*display: grid;/s,
  );
  assert.match(
    narrowStyles,
    /\.customer-parking-search-grid\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\);/s,
  );
});
