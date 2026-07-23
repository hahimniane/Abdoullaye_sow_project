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

  assert.match(entry, /No account needed to compare options and prepare your request\./);
  assert.match(entry, /Your details will stay here\./);
  assert.match(entry, /setAuthIntent\("account-access"\)/);
  assert.match(entry, /setAuthIntent\("service-continuation"\)/);
  assert.match(entry, /Access your Laawol account/);
  assert.match(entry, /authIntent === "account-access" \? "sign-in" : "sign-up"/);
  assert.match(entry, /<CustomerShippingServices/);
  assert.match(shipping, /Sign in to save & continue/);
  assert.match(shipping, /if \(!authenticated\) \{\s*onAuthenticationRequired\?\.\(\)/);
  assert.match(router, /customerServiceFromSearch/);
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

test("guest continuation copy is localized in French", () => {
  assert.equal(
    translateValue(
      "No account needed to compare options and prepare your request.",
      "fr",
    ),
    "Aucun compte n’est nécessaire pour comparer les options et préparer votre demande.",
  );
  assert.equal(
    translateValue("Sign in to save & continue", "fr"),
    "Se connecter pour enregistrer et continuer",
  );
  assert.equal(
    translateValue("Save your parking request", "fr"),
    "Enregistrez votre demande de stationnement",
  );
});
