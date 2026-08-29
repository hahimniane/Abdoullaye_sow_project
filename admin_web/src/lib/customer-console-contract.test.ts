import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/customer-console.tsx", "utf8");

test("customer activity listeners are ownership scoped", () => {
  assert.match(source, /"barrelShipments", "customerUid", uid/);
  assert.match(source, /"freightShipments", "customerUid", uid/);
  assert.match(source, /"transportRequests", "customerUid", uid/);
  assert.match(source, /"parkedCars", "customerUid", uid/);
  assert.match(source, /"carPurchases", "buyerUid", uid/);
  assert.match(source, /where\(ownerField, "==", uid\)/);
});

test("the customer console no longer touches wallets at all", () => {
  // The wallet is removed (docs/PLAN-2026-08-backlog.md #3) - the platform
  // holds no customer money, so the console must not read or show a balance.
  assert.doesNotMatch(source, /"wallets"/);
  assert.doesNotMatch(source, /WalletView|useWallet|CustomerWalletActions/);
});

test("customer marketplace only requests active public listings", () => {
  assert.match(source, /where\("status", "==", "active"\)/);
  assert.match(source, /\.filter\(customerCarListingIsEligible\)/);
});

test("a shipment appears once on the orders page, not twice", () => {
  // Barrels used to be listed as plain order rows AND rendered as tracking
  // cards on the same screen, both headed by the same BS- number, so the
  // page read as though every shipment existed twice.
  assert.match(
    source,
    /TRACKED_COLLECTIONS = new Set\(\[\s*"barrelShipments",\s*"freightShipments",\s*"transportRequests",?\s*\]\)/,
  );
  // Tracked shipments still never reach the order list. Price requests are
  // excluded here too: they have their own tab, and the leftover bucket is
  // titled "Cars & parking", which a parcel awaiting a price is not.
  assert.match(source, /!TRACKED_COLLECTIONS\.has\(order\.collectionName\)/);
  assert.match(
    source,
    /order\.collectionName !== "freightQuoteRequests"/,
  );
  // The list the panel renders must come from the untracked set - now
  // additionally filtered by the active tab and status chip, never the raw
  // orders array.
  // The panel renders the filtered set for whichever order-shaped tab is
  // showing, never the raw orders array.
  assert.match(source, /visibleOrders=\{[\s\S]{0,160}shownOrders/);
  assert.doesNotMatch(source, /visibleOrders=\{orders\}/);
  assert.match(
    source,
    /const shownOrders = orderRowsForTab\.filter/,
  );
});

test("removing the rows does not remove the actions they carried", () => {
  // Paying, cancelling and reviewing a shipment all live in the order
  // drawer. With the row gone, the tracking card is the only way in - if
  // this handoff breaks, a customer cannot cancel a barrel at all.
  assert.match(source, /onOpenDetails=\{\(record\) =>/);
  assert.match(source, /setOpenKey\(`\$\{text\(record\.relatedCollection, ""\)\}:\$\{record\.id\}`\)/);
  // openKey is matched against orderKey(), which is collection:id.
  assert.match(source, /function orderKey\(order: TaggedRow\) \{\s*return `\$\{order\.collectionName\}:\$\{order\.row\.id\}`/);
  // The drawer has to outlive its own list, or the card opens nothing.
  assert.match(source, /const showSection = visibleOrders === undefined \|\| listed\.length > 0/);
});

test("the orders panel is titled for what is left in it", () => {
  // With shipments gone it holds parking, car purchases and transport, so
  // "Orders & tracking" would name a panel that has no tracking in it.
  assert.doesNotMatch(source, /title="Orders & tracking"/);
  // Named for whichever set it is actually showing: the leftover services,
  // or the price requests that now have their own tab.
  assert.match(source, /"Cars, transport & parking"/);
  assert.match(source, /shownTab === "priceRequests"\s*\?\s*"Price requests"/);
});

test("the console opens on Home, never on the profile form", () => {
  // It used to open on Profile whenever the Auth user had no phoneNumber -
  // true for every customer who signed up by email and never did SMS
  // verification. It fired on every reload AND on the return from Stripe, so
  // paying for a barrel landed the customer on an account form.
  assert.match(source, /useState<CustomerTab>\("home"\)/);
  assert.doesNotMatch(source, /firebaseUser\.phoneNumber \? "home" : "profile"/);
});

test("the orders page is organised by service tab with status chips", () => {
  // One tab per service, so barrels and a car in transit are not
  // interleaved; chips filter by bucket within the tab. Empty tabs are
  // hidden - an empty Freight tab is noise, not navigation.
  assert.match(source, /\.filter\(\(tab\) => tab\.count > 0\)/);
  assert.match(source, /customer-orders-tabs/);
  // The status filter reuses the services screen's segment pills - one
  // "narrow this list" design across the console, not a second one.
  assert.match(source, /service-segments service-sort-segments/);
  assert.doesNotMatch(source, /customer-orders-chips/);
  assert.match(source, /statusBucket\(/);
  // A notification deep-link must land on the tab its record lives in.
  assert.match(
    source,
    /focusedRecord\.collection === "barrelShipments"\) setActiveTab\("barrels"\)/,
  );
});

test("the profile follows its Firestore document for the whole session", () => {
  // The profile used to be fetched once at sign-in. Verify a phone and the
  // console kept saying "Not verified" - a success banner and a stale badge
  // contradicting each other on the same screen - until a full reload.
  const router = readFileSync("src/components/console-router.tsx", "utf8");
  assert.match(router, /onSnapshot\(doc\(db, "users", user\.uid\)/);
  // The follower must die with the session, or a sign-out leaks a listener
  // that resurrects the previous user's profile.
  assert.match(router, /profileFollowRef\.current\?\.\(\);/);
});
