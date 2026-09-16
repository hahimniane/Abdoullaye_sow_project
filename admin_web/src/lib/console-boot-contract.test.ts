import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { translateValue } from "./french-dom.ts";

const source = readFileSync("src/components/console-router.tsx", "utf8");

test("console profile loading has a timeout and session-preserving retry", () => {
  assert.match(source, /PROFILE_LOAD_TIMEOUT_MS = 15_000/);
  assert.match(source, /Promise\.race/);
  assert.match(source, /setProfileRetry\(\(value\) => value \+ 1\)/);
  assert.match(source, /Retry without signing out or losing your session\./);
  assert.match(source, /if \(firebaseUser && authError\)/);
});

test("console loading failures use localized human-readable copy", () => {
  assert.equal(
    translateValue(
      "The connection is slow. We could not safely load your account role.",
      "fr",
    ),
    "La connexion est lente. Nous n’avons pas pu charger votre rôle de compte en toute sécurité.",
  );
  assert.equal(
    translateValue("We could not open your console", "fr"),
    "Nous n’avons pas pu ouvrir votre console",
  );
});

test("customer accounts enter the dedicated customer console", () => {
  // Code-split: the console is fetched once the router knows the role,
  // rather than shipped to every signed-out visitor.
  assert.match(source, /const CustomerConsole = dynamic\(/);
  assert.match(source, /import\("@\/components\/customer-console"\)/);
  assert.match(source, /consoleKind === "customer"/);
  assert.match(source, /<CustomerConsole/);
});

// A signed-out visitor opening a booking link was downloading all three
// consoles - the admin one alone is 13,000 lines - and parsing them before the
// form could paint. Each console is reachable only after the router knows who
// is signed in, so each is fetched then. A plain `import { X } from` here puts
// it back in the entry bundle without anything else failing, which is why this
// is pinned rather than left to review.
test("the consoles stay out of the entry bundle", () => {
  for (const name of ["AdminConsole", "BusinessConsole", "CustomerConsole"]) {
    assert.doesNotMatch(
      source, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from`),
      `${name} is statically imported by console-router, which ships it to ` +
      `every signed-out visitor. Use dynamic() instead.`);
    assert.match(source, new RegExp(`const ${name} = dynamic\\(`));
  }
});

// Same trap one level down: the guest entry renders one service panel, chosen
// before render, but a static import shipped all of them. Shipping is the
// exception - it is what most links point at, so it stays eager.
test("the guest entry only ships the service panel it renders", () => {
  const entry = readFileSync("src/components/customer-service-entry.tsx", "utf8");
  for (const name of ["CustomerCars", "CustomerParkingPools", "GuestTracking"]) {
    assert.doesNotMatch(
      entry, new RegExp(`import \\{[^}]*\\b${name}\\b[^}]*\\} from`),
      `${name} is statically imported by the guest service entry.`);
    assert.match(entry, new RegExp(`const ${name} = dynamic\\(`));
  }
  assert.match(entry, /import \{ CustomerShippingServices \} from/);
});

// The marketplace needs five option lists and a label helper. Importing them
// from operations-panels dragged all 9,000 lines of the business panels onto
// the guest's first paint, which is why they live in their own module.
test("the marketplace does not reach into the business panels", () => {
  const cars = readFileSync("src/components/customer-cars.tsx", "utf8");
  assert.doesNotMatch(cars, /from "@\/components\/business\/operations-panels"/);
  assert.match(cars, /from "@\/lib\/vehicle-options"/);
});
