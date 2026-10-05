import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  canonicalMake,
  canonicalModel,
  carCatalogLoaded,
  getMakes,
  getModels,
  getYears,
  setCarCatalogData,
  subscribeCarCatalog,
} from "./car-catalog.ts";
import { matchDecodedVehicle } from "./vin-lookup.ts";

// The catalog is fetched on demand now; until it arrives the getters answer
// with empty lists, and a subscribed picker re-renders when it lands.
test("the catalog is empty until loaded, then answers and notifies", () => {
  assert.equal(carCatalogLoaded(), false);
  assert.deepEqual(getMakes(), []);
  assert.equal(canonicalMake("toyota"), "");

  let notified = 0;
  const unsubscribe = subscribeCarCatalog(() => {
    notified += 1;
  });
  const rows = JSON.parse(readFileSync("src/lib/car-models-data.json", "utf8"));
  setCarCatalogData(rows);
  unsubscribe();

  assert.equal(notified, 1);
  assert.equal(carCatalogLoaded(), true);
  assert.ok(getMakes().length >= 80, "every make in the catalog");
  assert.equal(canonicalMake("toyota"), "Toyota");
  assert.ok(getModels("Toyota").includes("Camry"));
  assert.equal(canonicalModel("toyota", "camry"), "Camry");
  assert.ok(getYears("Toyota", "Camry").length > 10);
  assert.equal(
    matchDecodedVehicle({ Make: "TOYOTA", Model: "Camry", ModelYear: "2019" }).make,
    "Toyota",
  );
});
