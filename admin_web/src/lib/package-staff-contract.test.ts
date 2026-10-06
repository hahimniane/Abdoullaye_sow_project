import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";

/** Spelled the same in both languages, and listed in the dictionary as such. */
const SAME_IN_FRENCH = new Set(["Description", "Destination"]);

// The staff view of a package on the tracking page. These tests pin the
// wiring that keeps it away from everyone it is not for - the public
// tracking result stays exactly what customers and guests always saw - and
// the scoping that keeps staff inside their own business.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const entrySource = read("../components/customer-service-entry.tsx");
const guestSource = read("../components/guest-tracking.tsx");
const staffSource = read("../components/package-staff-view.tsx");
const routerSource = read("../components/console-router.tsx");
const rulesSource = readFileSync("../my_flutter_app/firestore.rules", "utf8");

test("the public tracking view is unchanged for everyone who is not staff", () => {
  // The public lookup still renders for every tracking visit, with the same
  // props it always had (the found-code callback is optional and inert).
  assert.match(entrySource, /\{initialService === "tracking" && \(\s*<GuestTracking\s+authenticated=\{authenticated\}\s+onAccountAccess=/);
  // The staff view is gated on a signed-in staff candidate and a CL- code.
  assert.match(entrySource, /\{staffCandidate && packageCode && \(\s*<PackageStaffView code=\{packageCode\} firebaseUser=\{firebaseUser\} profile=\{profile\} \/>\s*\)\}/);
  assert.match(entrySource, /const staffCandidate =\s*initialService === "tracking" &&\s*authenticated &&\s*packageStaffCandidate\(\{/);
  // Customers never download it: a dynamic import, never a static one.
  assert.match(entrySource, /const PackageStaffView = dynamic\(\s*\(\) => import\("@\/components\/package-staff-view"\)/);
  assert.doesNotMatch(entrySource, /import \{[^}]*\bPackageStaffView\b[^}]*\} from/);
  // The public view itself knows nothing about the staff view or its data.
  assert.doesNotMatch(guestSource, /package-staff|containerLines|PackageStaffView/);
  assert.match(guestSource, /onFound\?: \(trackingCode: string\) => void;/);
  assert.match(guestSource, /onFound\?\.\(parsed\.record\.trackingCode\);/);
  // The privacy line and the sign-in upsell are still there for guests.
  assert.match(guestSource, /For your privacy, only the booking status is shown here\./);
  assert.match(guestSource, /\{!authenticated && \(\s*<aside className="guest-tracking-upsell">/);
});

test("the staff view renders nothing for anyone outside its scope", () => {
  assert.match(staffSource, /const active = scope\.kind !== "none" && Boolean\(code\);/);
  assert.match(staffSource, /if \(!active\) return null;/);
  // The scope comes from the one tested rule, not a check of its own.
  assert.match(staffSource, /packageStaffScope\(\{\s*profile,\s*signedIn: Boolean\(firebaseUser\),\s*isAnonymous: firebaseUser\?\.isAnonymous === true,\s*adminOperations,\s*\}\)/);
});

test("staff look only inside their own business; the rules allow exactly that", () => {
  // Business scope: businessId AND trackingCode, limit 1 - the app's query.
  assert.match(staffSource, /\? \[where\("businessId", "==", scopeBusinessId\), where\("trackingCode", "==", code\)\]/);
  assert.match(staffSource, /query\(collection\(db, "containerLines"\), \.\.\.constraints, limit\(1\)\)/);
  // The rules: lines and containers are read by the business's own managers
  // (owner/staff of that business) or a platform admin - never a customer.
  assert.match(rulesSource, /match \/containerLines\/\{lineId\} \{\s*allow read: if lotLedgerRead\(resource\.data\.businessId\);\s*allow write: if false;/);
  assert.match(rulesSource, /match \/containers\/\{containerId\} \{\s*allow read: if lotLedgerRead\(resource\.data\.businessId\);/);
  assert.match(rulesSource, /function lotLedgerRead\(businessId\) \{\s*return request\.auth != null &&\s*\(isAdmin\(request\.auth\.uid\) \|\|\s*canManageBusiness\(request\.auth\.uid, businessId\)\);/);
});

test("every loading state resolves: a timeout on the line, the container and the admin role", () => {
  assert.match(staffSource, /const LOAD_TIMEOUT_MS = 15_000;/);
  const timers = staffSource.match(/window\.setTimeout\(\(\) => \{/g) ?? [];
  assert.equal(timers.length, 3, "the line, the container and the admin role each need a safety timeout");
  // Listener errors resolve too.
  assert.match(staffSource, /\(\) => \{\s*answered = true;\s*window\.clearTimeout\(timer\);\s*setLineState\(\{ key, status: "failed", line: null \}\);/);
  assert.match(staffSource, /\(\) => \{\s*answered = true;\s*window\.clearTimeout\(timer\);\s*setContainerState\(\{ key: containerId, row: null \}\);/);
});

test("staff and admins on the customer host reach the tracking page, not their console", () => {
  assert.match(routerSource, /if \(serviceIntent && serviceEntryApplies\(serviceIntent, resolvedKind\)\) \{/);
});

test("reprinting reuses the containers panel's labels dialog", () => {
  assert.match(staffSource, /import \{ ContainerLabelsDialog \} from "@\/components\/business\/container-labels-dialog";/);
  assert.match(staffSource, /<ContainerLabelsDialog\s+businessId=\{view\.businessId\}\s+container=\{containerRow\}\s+line=\{line\}/);
  // The console link is the owners' and staff's; admins work elsewhere.
  assert.match(staffSource, /\{scope\.kind === "business" && \(\s*<a className="secondary-button" href=\{view\.consoleLink\}/);
});

test("what people typed is marked so the French pass leaves it alone", () => {
  for (const marked of [
    /<code data-no-translate>\{view\.code\}<\/code>/,
    /<strong data-no-translate>\{view\.title\}<\/strong>/,
    /<b data-no-translate>\{view\.vin\}<\/b>/,
    /<b data-no-translate>\{view\.description\}<\/b>/,
    /<b data-no-translate>\{box\.title\}<\/b>/,
    /<small data-no-translate>\{box\.subtitle\}<\/small>/,
    /<span data-no-translate>\{person\.name\}<\/span>/,
    /<span data-no-translate>\{person\.phone\}<\/span>/,
  ]) {
    assert.match(staffSource, marked);
  }
});

test("every staff view string has French", () => {
  const strings = [
    "Package",
    "Staff view",
    "Loading the package…",
    "This package could not be loaded. Check your connection and try again.",
    "This code is not on any of your containers. The public tracking result is below.",
    "No container line has this code. The public tracking result is below.",
    "Only your team sees this. The customer's public tracking result is below.",
    "What it is",
    "Kind",
    "Quantity",
    "VIN",
    "Description",
    "Car",
    "Barrels",
    "Other goods",
    "Owner",
    "Business stock",
    "Receiver",
    "No receiver recorded.",
    "No name",
    "No phone",
    "Add the country code so WhatsApp updates can reach this number.",
    "Call",
    "Container",
    "Destination",
    "No destination yet",
    "Sailed",
    "Arrived",
    "Container not found.",
    "Loading the container…",
    "WhatsApp updates",
    "No update has been sent yet. The first goes out when the container sails.",
    "Reprint labels",
    "Open in business console",
    // Built by package-staff.ts.
    "Last update: left port",
    "Last update: at the destination port",
    "Last update: arrived",
    "Latest update",
    ...["Customer", "Receiver"].flatMap((who) => [
      "sent",
      "failed to send",
      "waiting for WhatsApp to be connected",
      "queued to send",
      "sending",
      "retrying after a failed try",
      "not sent, no phone",
      "not sent, updates switched off",
      "not sent, the phone has no country code",
      "not sent",
    ].map((phrase) => `${who}: ${phrase}`)),
  ];
  const libSource = read("./package-staff.ts");
  for (const english of strings) {
    if (!english.includes(": ") && english !== "Latest update") {
      // Rendered straight from the component (the JSX apostrophe is escaped there).
      assert.ok(staffSource.includes(english.replace("'", "&apos;")), `"${english}" is not in the staff view`);
    } else if (english.startsWith("Last update") || english === "Latest update") {
      assert.ok(libSource.includes(english), `"${english}" is not in package-staff.ts`);
    }
    const french = translateValue(english, "fr");
    if (SAME_IN_FRENCH.has(english)) {
      assert.equal(TEXT_TRANSLATIONS[english], english, `"${english}" is not in the dictionary`);
      continue;
    }
    assert.notEqual(french, english, `no French for "${english}"`);
    assert.equal(translateValue(french, "en"), english, `"${english}" does not round-trip`);
  }
});
