import assert from "node:assert/strict";
import { test } from "node:test";

import {
  destinationCountryById,
  destinationCountryName,
  destinationCountryOptionForRow,
  withSelectedDestinationCountry,
  DESTINATION_COUNTRIES,
} from "./destination-countries.ts";

test("full catalog destination ids resolve to their own country", () => {
  assert.equal(destinationCountryName("argentina"), "Argentina");
  assert.equal(destinationCountryName("argentina"), destinationCountryById("argentina")?.name);
  assert.notEqual(destinationCountryName("argentina"), "Guinea");
});

test("legacy destination ids still resolve for existing rows", () => {
  assert.equal(destinationCountryName("guinea_bissau"), "Guinea-Bissau");
  assert.equal(destinationCountryName("sierra_leone"), "Sierra Leone");
  assert.equal(destinationCountryName("burkina_faso"), "Burkina Faso");
});

test("editing option keeps the clicked row selected instead of falling back", () => {
  const argentina = destinationCountryOptionForRow({
    id: "argentina",
    destinationCountryName: "Argentina",
    code: "AR",
  });
  const options = withSelectedDestinationCountry(DESTINATION_COUNTRIES, argentina);

  assert.equal(argentina.id, "argentina");
  assert.equal(argentina.name, "Argentina");
  assert.equal(options[0].id, "afghanistan");
  assert.ok(options.some((country) => country.id === "argentina"));
});
