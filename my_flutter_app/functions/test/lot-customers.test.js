"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  lotCustomerKey,
  mergeLotCustomer,
  matchLotCustomers,
} = require("../lot_customers");

describe("a customer is remembered once per business", () => {
  it("keys on the phone first, then email, then name", () => {
    assert.equal(lotCustomerKey({customerPhone: "(201) 555-0100",
      customerName: "Amadou"}), "p:2015550100");
    assert.equal(lotCustomerKey({customerPhone: "+1 201 555 0100"}),
        "p:2015550100");
    assert.equal(lotCustomerKey({customerEmail: "A@B.co", customerName: "x"}),
        "e:a@b.co");
    assert.equal(lotCustomerKey({customerName: "  Fatou   Diallo "}),
        "n:fatou diallo");
    assert.equal(lotCustomerKey({}), "");
  });

  it("merges a second sighting: newest wins, blanks never erase", () => {
    const first = mergeLotCustomer(null, {
      customerName: "Amadou Ba", customerPhone: "2015550100",
      vinNumber: "1hgcm82633a004352", carMake: "Honda", carModel: "Accord",
      carYear: "2003",
    }, {businessId: "b1", source: "activity", staffId: "s1"});
    assert.equal(first.seenCount, 1);
    assert.equal(first.cars[0].vin, "1HGCM82633A004352");
    const second = mergeLotCustomer(first, {
      customerName: "Amadou Ba", customerPhone: "", customerEmail: "a@b.co",
      vinNumber: "1HGCM82633A004352", carMake: "Honda", carModel: "Accord",
      carYear: "2003",
    }, {businessId: "b1", source: "parking", staffId: "s2"});
    assert.equal(second.phone, "2015550100"); // blank did not erase it
    assert.equal(second.email, "a@b.co");
    assert.equal(second.seenCount, 2);
    assert.equal(second.cars.length, 1); // same VIN, not duplicated
    assert.equal(second.lastSource, "parking");
  });

  it("keeps a customer's cars as a set, newest first, capped", () => {
    let c = null;
    for (let i = 0; i < 25; i += 1) {
      c = mergeLotCustomer(c, {
        customerName: "Busy", customerPhone: "2015550100",
        vinNumber: `VIN${String(i).padStart(14, "0")}`,
      }, {businessId: "b1"});
    }
    assert.equal(c.cars.length, 20);
    assert.equal(c.cars[0].vin, "VIN00000000000024");
  });
});

describe("offering customers back as staff type", () => {
  const rows = [
    {name: "Amadou Ba", phone: "2015550100", email: "", cars: [{vin: "1HGCM8"}],
      lastSeenMs: 10},
    {name: "Fatou Diallo", phone: "9175550123", email: "fatou@x.co", cars: [],
      lastSeenMs: 20},
    {name: "Ibrahima Amadou", phone: "", email: "", cars: [], lastSeenMs: 30},
  ];
  it("needs two characters and ranks a name prefix first", () => {
    assert.deepEqual(matchLotCustomers(rows, "a"), []);
    assert.deepEqual(matchLotCustomers(rows, "am").map((r) => r.name),
        ["Amadou Ba", "Ibrahima Amadou"]);
  });
  it("finds by phone digits, email and VIN", () => {
    assert.equal(matchLotCustomers(rows, "917-555")[0].name, "Fatou Diallo");
    assert.equal(matchLotCustomers(rows, "fatou@")[0].name, "Fatou Diallo");
    assert.equal(matchLotCustomers(rows, "1hgcm")[0].name, "Amadou Ba");
  });
});
