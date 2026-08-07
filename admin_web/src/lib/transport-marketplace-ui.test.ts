import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { translateValue } from "./french-dom.ts";

const customerSource = readFileSync(
  new URL("../components/customer-shipping-services.tsx", import.meta.url),
  "utf8",
);
const businessSource = readFileSync(
  new URL("../components/business/operations-panels.tsx", import.meta.url),
  "utf8",
);
const styles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("car transport customer journey matches by route without requiring a business picker", () => {
  const start = customerSource.indexOf("function TransportRequestForm");
  const end = customerSource.indexOf("function CustomerTransportQuotes", start);
  const form = customerSource.slice(start, end);

  assert.ok(start > 0 && end > start);
  assert.match(form, /label="Destination country"/);
  assert.match(form, /Pickup area/);
  // The exact address is now split across named fields (street, apartment,
  // city, state, ZIP, country) rather than one opaque suggestion string.
  assert.match(form, /streetLabel="Exact pickup street address \(optional\)"/);
  assert.match(form, /<StructuredAddressFields/);
  assert.match(form, /destinationCountryId: destinationCountry\?\.id/);
  assert.match(form, /destinationCountryName: destinationCountry\?\.name/);
  assert.match(form, /pickupArea: pickupArea\.trim\(\)/);
  assert.match(form, /vehicleOperable/);
  assert.match(form, /requestedTransportMethod: transportMethod/);
  assert.match(form, /flexibleDates/);
  assert.doesNotMatch(form, /<DestinationPicker/);
  assert.doesNotMatch(form, /businessId:/);
  assert.match(
    form,
    /Eligible approved businesses serving this route can now review the[\s\S]*vehicle and send you a quote/,
  );
});

test("customer quote cards expose a complete comparable offer and protected actions", () => {
  const start = customerSource.indexOf("function CustomerTransportQuotes");
  const end = customerSource.indexOf("function DestinationPicker", start);
  const quotes = customerSource.slice(start, end);

  for (const label of [
    "Total quote",
    "Estimated delivery",
    "Transport method",
    "Terms and inclusions",
    "Quote expiry",
    "Choose this carrier",
  ]) {
    assert.match(quotes, new RegExp(label));
  }
  assert.match(quotes, /"selectTransportQuote"/);
  assert.match(quotes, /"cancelTransportQuoteRequest"/);
  assert.match(quotes, /confirmImportantAction/);
  assert.match(quotes, /aria-busy=\{busyAction/);
  assert.match(quotes, /quotes\.rows\.filter\(\(quote\) => quote\.status !== "withdrawn"\)/);
});

test("business transport panel separates quote opportunities from accepted jobs", () => {
  const start = businessSource.indexOf("export function TransportPanel");
  const end = businessSource.indexOf("export function ParkingPanel", start);
  const panel = businessSource.slice(start, end);

  assert.match(panel, /useBusinessRows\("transportOpportunities"/);
  assert.match(panel, /useBusinessRows\("transportQuotes"/);
  assert.match(panel, /Quote opportunities/);
  assert.match(panel, /Accepted jobs/);
  assert.match(panel, /"submitTransportQuote"/);
  assert.match(panel, /"withdrawTransportQuote"/);
  assert.match(panel, /"updateTransportFulfillmentStatus"/);
  assert.match(panel, /Total quote \(USD\)/);
  assert.match(panel, /Estimated pickup date/);
  assert.match(panel, /Estimated delivery date/);
  assert.match(panel, /Terms and inclusions/);
  assert.doesNotMatch(panel, /quoteDeadlineAt/);
  assert.doesNotMatch(panel, /expiresAt: new Date/);
});

test("transport marketplace layout is responsive and localized", () => {
  assert.match(
    styles,
    /\.customer-transport-layout\s*\{[\s\S]*grid-template-columns: minmax\(0, 1fr\) minmax\(250px, 300px\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*\.customer-transport-quote-grid,[\s\S]*grid-template-columns: minmax\(0, 1fr\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 560px\)[\s\S]*\.transport-opportunity-card dl\s*\{ grid-template-columns: repeat\(2/,
  );

  assert.equal(
    translateValue("Tell us about the route and vehicle", "fr"),
    "Décrivez-nous l’itinéraire et le véhicule",
  );
  assert.equal(
    translateValue("Choose this carrier", "fr"),
    "Choisir ce transporteur",
  );
  assert.equal(
    translateValue("Quote opportunities", "fr"),
    "Possibilités de devis",
  );
  assert.equal(
    translateValue("Terms and inclusions", "fr"),
    "Conditions et inclusions",
  );
});

test("the accepted-jobs card routes every status change through the callable", () => {
  const start = businessSource.indexOf("export function TransportPanel");
  const end = businessSource.indexOf("export function ParkingPanel", start);
  const panel = businessSource.slice(start, end);

  // The legacy escape hatch: a direct `transportRequests` write that skipped
  // the transition table and the container-number gate entirely.
  assert.doesNotMatch(panel, /doc\(db, "transportRequests"/);
  assert.doesNotMatch(businessSource, /const transportStatuses = \[/);

  // Only the moves the table allows are offered, and the decision comes from
  // the pure module rather than being spelled out again here.
  assert.match(panel, /transportFulfillmentNextStatuses\(status\)/);
  assert.match(panel, /nextStatuses\.map\(\(next\) =>/);
  assert.match(panel, /validateTransportFulfillmentChange\(\{/);
  assert.match(panel, /transportJobCurrentStatus\(row\)/);
  assert.match(panel, /nextStatuses\.some\(transportFulfillmentRequiresContainer\)/);

  // The server's own sentence is what the operator reads.
  assert.match(panel, /error instanceof Error && error\.message\s*\?\s*error\.message/);
});

test("the accepted-jobs status copy is translated", () => {
  for (const [english, french] of [
    [
      "This job is finished. There is nothing left to move.",
      "Cette mission est terminée. Il n’y a plus rien à faire avancer.",
    ],
    [
      "This job is on a status the transport workflow did not set, so no transport action applies here.",
      "Cette mission est à un statut qui ne vient pas du transport : aucune action de transport ne s’applique ici.",
    ],
    [
      "Add the container number before marking this transport in transit.",
      "Ajoutez le numéro de conteneur avant de mettre ce transport en transit.",
    ],
    ["Container on file", "Conteneur enregistré"],
    ["This job was already on that status.", "Cette mission était déjà à ce statut."],
    ["e.g. MSKU1234567", "ex. MSKU1234567"],
  ]) {
    assert.equal(translateValue(english, "fr"), french);
    assert.equal(translateValue(french, "en"), english);
  }
});
