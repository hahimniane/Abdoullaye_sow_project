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
  assert.match(
    source,
    /enabledServices\.includes\("barrelShipping"\)[\s\S]*enabledServices\.includes\("sharedBarrels"\)/,
  );
  assert.match(
    source,
    /No approved shared-barrel destinations are available right now\./,
  );
  assert.match(
    source,
    /disabled=\{destinationLoading \|\| destinations\.length === 0\}/,
  );
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

// A customer typed "Bronx" and got "No parking is available" while KEREN sat
// a mile away — its parking city is stored as "New York". A free-text box that
// must match exactly can never find a lot the customer does not already know
// the name of, and the search button stayed disabled until they guessed.
test("a customer can browse parking without naming a town", () => {
  // The search no longer waits for a city.
  const valid = source.slice(source.indexOf("const validSearch ="));
  assert.ok(
    !/city\.trim\(\)\.length > 1/.test(valid.slice(0, valid.indexOf(";"))),
    "search must not require a typed city",
  );
  // No free-text city box: the pickers are built from the lots that exist.
  assert.doesNotMatch(source, /placeholder="Enter a city"/);
  assert.match(source, /browseStates\.map/);
  assert.match(source, /browseCities\.map/);
  // Every lot loads before the customer chooses anything.
  assert.match(source, /setAllPlaces\(/);
  assert.match(source, /aria-label="Places to park"/);
});

test("the search narrows only by what the customer chose", () => {
  // Tapping a lot narrows to its town, so the search reads the town it was
  // handed rather than only the pickers.
  assert.match(source, /\.\.\.\(searchCity\.trim\(\) \? \{city: searchCity\.trim\(\)\} : \{\}\)/);
  assert.match(source, /\.\.\.\(searchState\.trim\(\) \? \{state: searchState\.trim\(\)\} : \{\}\)/);
});

test("distance is shown only when the customer shared where they are", () => {
  const browse = source.slice(source.indexOf('aria-label="Places to park"'));
  const block = browse.slice(0, browse.indexOf("</section>"));
  assert.match(block, /place\.distanceMiles !== null/);
  // Without it, the row says how much room there is instead of inventing miles.
  assert.match(block, /free today/);
  assert.match(block, /Full today/);
});

test("the browse list has styles to render", () => {
  for (const selector of [".customer-browse-list", ".customer-browse-row", ".customer-browse-meta"]) {
    assert.ok(styles.includes(selector), `${selector} is unstyled`);
  }
});


// Tapping a lot in the list must pick that lot, not merely filter to its town.
// It is priced for the form's dates first: a browsing row only knows one day
// at the lot's rate, and a reservation must be quoted on the real window.
test("tapping a lot in the list selects it for booking", () => {
  const fn = source.slice(source.indexOf("async function chooseBrowsedPlace"));
  const body = fn.slice(0, fn.indexOf("\n  }\n"));
  assert.match(body, /await searchParking\(\{ city: placeCity, state: placeState \}\)/);
  assert.match(body, /option\.businessId === place\.businessId/);
  assert.match(body, /if \(match\) setSelected\(match\)/);
  // The row calls it, and cannot be double-fired while a search is running.
  const list = source.slice(source.indexOf('aria-label="Places to park"'));
  const rows = list.slice(0, list.indexOf("</section>"));
  assert.match(rows, /onClick=\{\(\) => void chooseBrowsedPlace\(place\)\}/);
  assert.match(rows, /disabled=\{loading\}/);
});
