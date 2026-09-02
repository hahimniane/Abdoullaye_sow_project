import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  customerServiceFromSearch,
  customerServiceUrl,
} from "./customer-service-intent.ts";
import { translateValue } from "./french-dom.ts";

test("public customer service links select every supported customer journey", () => {
  assert.equal(customerServiceFromSearch("?service=freight"), "freight");
  assert.equal(customerServiceFromSearch("?service=barrel"), "barrel");
  assert.equal(customerServiceFromSearch("?service=car-transport"), "car-transport");
  assert.equal(customerServiceFromSearch("?service=parking"), "parking");
  assert.equal(customerServiceFromSearch("?service=shared-barrels"), "shared-barrels");
  assert.equal(customerServiceFromSearch("?service=cars"), "cars");
  assert.equal(customerServiceFromSearch("?service=tracking"), "tracking");
  assert.equal(customerServiceFromSearch("?service=unknown"), null);
  assert.equal(customerServiceUrl("freight"), "https://customer.laawoldigital.com/?service=freight");
});

test("guest service entry gates only final submission and preserves the mounted form", () => {
  const entry = readFileSync("src/components/customer-service-entry.tsx", "utf8");
  const shipping = readFileSync(
    "src/components/customer-shipping-services.tsx",
    "utf8",
  );
  const router = readFileSync("src/components/console-router.tsx", "utf8");

  assert.doesNotMatch(
    entry,
    /No account needed/,
  );
  assert.doesNotMatch(
    entry,
    /Sign in or create a free account only/,
  );
  assert.doesNotMatch(
    entry,
    /Compare first\. Create an account only when you continue\./,
  );
  assert.match(entry, /Compare services and prepare your request\./);
  assert.match(entry, /Your details will stay here\./);
  assert.match(entry, /setAuthIntent\("account-access"\)/);
  assert.match(entry, /setAuthIntent\("service-continuation"\)/);
  assert.match(entry, /Access your Laawol account/);
  assert.match(entry, /authIntent === "account-access" \? accountMode : "sign-up"/);
  assert.match(entry, /<CustomerShippingServices/);
  assert.match(entry, /<GuestTracking/);
  // Barrel and freight now offer a guest path, so their submit buttons must
  // not promise a sign-in the customer no longer needs. Car transport is
  // still account-only and keeps its sign-in label.
  assert.doesNotMatch(shipping, /Sign in to save & continue/);
  assert.match(shipping, /"Sign in to send request"/);
  assert.match(shipping, /if \(!authenticated\) \{\s*onAuthenticationRequired\?\.\(\)/);
  // Guest barrel/freight submit waits for Continue-as-guest (or a real
  // sign-in) and then proceeds to checkout. Returning without that wait is
  // what dumped the customer back on Review & pay with no Stripe.
  assert.match(shipping, /ensureGuestOrAccount/);
  assert.match(entry, /askHowToContinue/);
  assert.match(entry, /finishContinuation\(true\)/);
  assert.match(router, /customerServiceFromSearch/);
  assert.match(router, /user\.isAnonymous/);
  assert.match(router, /!firebaseUser\.isAnonymous/);
});

test("a returning guest with session and contact is not asked again", () => {
  // guestReady was decided once, at mount - which races Firebase's async
  // session restore. Arriving by navigation (tracking's Continue-to-booking
  // above all), auth.currentUser is still null at that instant, so a guest
  // whose anonymous session AND stored contact both survived was asked for
  // their email and phone a second time.
  const entry = readFileSync("src/components/customer-service-entry.tsx", "utf8");
  assert.match(
    entry,
    /auth\.currentUser\?\.isAnonymous === true && recallGuestContact\(\) !== null/,
  );
  // The re-check must run when the restored session arrives, keyed on the
  // live auth subscription - not the one-shot mount read.
  assert.match(
    entry,
    /firebaseUser\?\.isAnonymous === true && recallGuestContact\(\) !== null/,
  );
  assert.match(entry, /\}, \[firebaseUser\]\);/);
});

test("public CTAs deep-link to every guest customer journey", () => {
  const home = readFileSync("../public_site/index.html", "utf8");
  const services = readFileSync("../public_site/services.html", "utf8");
  const publicTranslations = readFileSync(
    "../public_site/assets/i18n.js",
    "utf8",
  );
  for (const service of [
    "barrel",
    "freight",
    "car-transport",
    "parking",
    "shared-barrels",
    "cars",
  ]) {
    const expected = `https://customer.laawoldigital.com/?service=${service}`;
    assert.ok(home.includes(expected), `homepage ${service} CTA`);
    assert.ok(services.includes(expected), `services page ${service} CTA`);
  }
  assert.match(services, /Fret aérien ou maritime/);
  assert.match(services, /Commencer une demande de fret/);
  assert.match(
    publicTranslations,
    /frToEn\["Transport de véhicules"\] = "Car transport"/,
  );
});

test("the public tracking page sends guests to the lookup, not sign-in", () => {
  // Someone with a tracking code has no account and no reason to make one.
  // Both CTAs on that page have to land on the guest lookup itself; a link
  // to the bare console drops them at a sign-in wall instead.
  const tracking = readFileSync("../public_site/tracking.html", "utf8");
  // The hero now carries a box: it posts the number the visitor typed to the
  // same lookup rather than sending them there to type it again. The closing
  // CTA is still a plain deep link.
  assert.match(
    tracking,
    /<form[^>]*action="https:\/\/customer\.laawoldigital\.com\/"[^>]*method="get"/,
  );
  assert.match(tracking, /name="service" value="tracking"/);
  assert.match(tracking, /name="code"/);
  assert.match(
    tracking,
    /href="https:\/\/customer\.laawoldigital\.com\/\?service=tracking"/,
    "the closing CTA must still deep-link to guest tracking",
  );
  // A bare console link anywhere on this page is the regression: it looks
  // right and lands the guest on a login screen.
  assert.doesNotMatch(
    tracking,
    /href="https:\/\/customer\.laawoldigital\.com\/?"/,
    "no CTA may point at the console root",
  );
});

test("every string on the tracking result card is translated", () => {
  // "Copy number" shipped in English to French users because the label
  // lives inside a ternary rather than as plain markup text, so it was
  // invisible to a read-through of the component.
  for (const [english, french] of [
    ["Copy number", "Copier le numéro"],
    ["Copied", "Copié"],
    ["Tracking result", "Résultat du suivi"],
    ["Track another", "Suivre un autre envoi"],
  ] as const) {
    assert.equal(translateValue(english, "fr"), french, english);
  }
});

test("guest continuation copy is localized in French", () => {
  assert.equal(translateValue("Continue", "fr"), "Continuer");
  assert.equal(
    translateValue("Sign in to send request", "fr"),
    "Se connecter pour envoyer la demande",
  );
  assert.equal(
    translateValue("Save your parking request", "fr"),
    "Enregistrez votre demande de stationnement",
  );
});

test("guest service forms keep their header copy readable on narrow screens", () => {
  const styles = readFileSync("src/app/globals.css", "utf8");
  assert.match(
    styles,
    /\.customer-request-form > \.panel-header > div\s*\{[\s\S]*display: grid;[\s\S]*gap: 5px;/,
  );
  assert.match(
    styles,
    /@media \(max-width: 480px\)\s*\{[\s\S]*\.customer-entry-header\s*\{[\s\S]*display: grid;[\s\S]*\.customer-entry-header-actions \.secondary-button\s*\{[\s\S]*width: 100%;/,
  );
});
