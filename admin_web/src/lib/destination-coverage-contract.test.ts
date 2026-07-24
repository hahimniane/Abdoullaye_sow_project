import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { translateValue } from "./french-dom.ts";

const operationsSource = readFileSync(
  new URL("../components/business/operations-panels.tsx", import.meta.url),
  "utf8",
);
const consoleSource = readFileSync(
  new URL("../components/business-console.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);
const customerSource = readFileSync(
  new URL("../components/customer-shipping-services.tsx", import.meta.url),
  "utf8",
);

describe("business destination service coverage", () => {
  it("persists the complete v2 service map and derives country activity", () => {
    assert.match(operationsSource, /destinationCoverageVersion:\s*2/);
    assert.match(operationsSource, /serviceAvailability:\s*availability/);
    assert.match(
      operationsSource,
      /isActive:\s*Object\.values\(availability\)\.some\(Boolean\)/,
    );
    assert.match(
      operationsSource,
      /carTransportAvailable:\s*availability\.carTransport/,
    );
  });

  it("offers independent barrel, air, sea, and quote-based car controls", () => {
    for (const service of [
      "barrelShipping",
      "freightAir",
      "freightSea",
      "carTransport",
    ]) {
      assert.match(operationsSource, new RegExp(`draft\\.${service}`));
    }
    assert.match(operationsSource, /Car transport quotes/);
    assert.match(
      operationsSource,
      /You set the route price when responding\./,
    );
    assert.doesNotMatch(
      operationsSource,
      /Car transport price/,
    );
  });

  it("captures freight schedules and shows delivery logistics to customers", () => {
    assert.match(operationsSource, /freightAirDepartureDays/);
    assert.match(operationsSource, /freightSeaDepartureDays/);
    assert.match(operationsSource, /Air freight departure days/);
    assert.match(customerSource, /Typical delivery/);
    assert.match(customerSource, /Regular departure days/);
  });

  it("lets car-transport-only businesses open destination configuration", () => {
    assert.match(
      consoleSource,
      /services\.has\("carTransport"\)/,
    );
  });

  it("uses a responsive operational list and full-height country drawer", () => {
    assert.match(styles, /\.destination-coverage-list/);
    assert.match(styles, /\.destination-drawer/);
    assert.match(styles, /@media \(max-width: 700px\)/);
    assert.match(styles, /padding-bottom: max\(16px, env\(safe-area-inset-bottom\)\)/);
  });

  it("localizes the new workflow and quote language in French", () => {
    assert.equal(
      translateValue("Service coverage by country", "fr"),
      "Couverture des services par pays",
    );
    assert.equal(
      translateValue("Car transport quotes", "fr"),
      "Devis de transport de véhicules",
    );
    assert.equal(
      translateValue("Save configuration", "fr"),
      "Enregistrer la configuration",
    );
    assert.equal(
      translateValue("Regular departure days", "fr"),
      "Jours de départ habituels",
    );
  });
});
