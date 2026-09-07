import assert from "node:assert/strict";
import test from "node:test";

import { lotCustomerCarLabel, lotCustomerFromRow, matchLotCustomers } from "./lot-customers.ts";

const rows = [
  { id: "1", name: "Amadou Ba", phone: "2015550100", email: "", cars: [{ vin: "1hgcm8", make: "Honda", model: "Accord", year: "2003" }], lastSeenAt: { seconds: 10 } },
  { id: "2", name: "Fatou Diallo", phone: "9175550123", email: "fatou@x.co", cars: [], lastSeenAt: { seconds: 20 } },
  { id: "3", name: "Ibrahima Amadou", phone: "", email: "", cars: [], lastSeenAt: { seconds: 30 } },
].map(lotCustomerFromRow);

test("customers come back as staff type: name prefix first, then word prefix", () => {
  assert.deepEqual(matchLotCustomers(rows, "a"), []);
  assert.deepEqual(matchLotCustomers(rows, "am").map((r) => r.name), ["Amadou Ba", "Ibrahima Amadou"]);
});

test("phone digits, email and a car's VIN find the customer too", () => {
  assert.equal(matchLotCustomers(rows, "917-555")[0].name, "Fatou Diallo");
  assert.equal(matchLotCustomers(rows, "fatou@")[0].name, "Fatou Diallo");
  assert.equal(matchLotCustomers(rows, "1HGCM")[0].name, "Amadou Ba");
  assert.equal(rows[0].cars[0].vin, "1HGCM8");
});

test("a car is labelled year make model · VIN", () => {
  assert.equal(lotCustomerCarLabel(rows[0].cars[0]), "2003 Honda Accord · 1HGCM8");
  assert.equal(lotCustomerCarLabel({ vin: "", make: "Toyota", model: "", year: "" }), "Toyota");
});
