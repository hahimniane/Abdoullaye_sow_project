import assert from "node:assert/strict";
import test from "node:test";

import { lotCustomerCarLabel, lotCustomerFromRow, lotCustomerFromStaffRow, lotCustomerSources, matchLotCustomers } from "./lot-customers.ts";

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

test("the lot's own people can be the customer without being saved first", () => {
  const staff = lotCustomerFromStaffRow({ id: "u1", fullName: "Mariama Bah", email: "M.Bah@Example.com", phone: "917-555-0100" });
  assert.ok(staff);
  assert.equal(staff.name, "Mariama Bah");
  assert.equal(staff.email, "m.bah@example.com");
  assert.equal(staff.staff, true);
  assert.deepEqual(staff.cars, []);
  // A row with nothing to show is not offered.
  assert.equal(lotCustomerFromStaffRow({ id: "u2", phone: "917-555-0101" }), null);
  // A name-only colleague is still worth offering.
  assert.equal(lotCustomerFromStaffRow({ id: "u3", fullName: "Sekou" })?.name, "Sekou");
});

test("staff and remembered customers merge without offering the same person twice", () => {
  const saved = lotCustomerFromRow({
    id: "c1", name: "Mariama Bah", phone: "(917) 555-0100", email: "m.bah@example.com",
    cars: [{ vin: "1HGCM82633A004352", make: "Honda", model: "Accord", year: "2019" }],
  });
  const asStaff = lotCustomerFromStaffRow({ id: "u1", fullName: "Mariama Bah", email: "m.bah@example.com", phone: "917-555-0100" })!;
  const other = lotCustomerFromStaffRow({ id: "u2", fullName: "Sekou Camara", email: "sekou@example.com" })!;

  const merged = lotCustomerSources([saved], [asStaff, other]);
  assert.equal(merged.length, 2, "the same phone number is one person");
  // The saved record wins: it carries the cars and a real last-seen.
  assert.equal(merged[0].cars.length, 1);
  assert.equal(merged[0].staff, undefined);
  assert.equal(merged[1].name, "Sekou Camara");

  // A colleague nobody has parked for yet is still findable by name.
  assert.equal(matchLotCustomers(merged, "sek")[0].name, "Sekou Camara");
  // And someone with no phone, email or name is not a person to offer.
  assert.deepEqual(lotCustomerSources([], [{ id: "x", name: "", phone: "", email: "", cars: [], lastSeenMs: 0 }]), []);
});
