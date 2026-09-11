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

  it("stores only the name and phone — never a car", () => {
    const first = mergeLotCustomer(null, {
      customerName: "Amadou Ba", customerPhone: "2015550100",
      // A car is passed in, but a customer is a person, not a car - it is
      // decoded onto the record from its VIN and never kept against the person.
      vinNumber: "1hgcm82633a004352", carMake: "Honda", carModel: "Accord",
      carYear: "2003",
    }, {businessId: "b1", source: "activity", staffId: "s1"});
    assert.equal(first.seenCount, 1);
    assert.equal(first.name, "Amadou Ba");
    assert.equal(first.phone, "2015550100");
    assert.equal(first.cars, undefined); // no car kept on the customer
    assert.equal(first.email, undefined); // only name + phone
    const second = mergeLotCustomer(first, {
      customerName: "Amadou Ba", customerPhone: "",
    }, {businessId: "b1", source: "parking", staffId: "s2"});
    assert.equal(second.phone, "2015550100"); // blank did not erase it
    assert.equal(second.seenCount, 2);
    assert.equal(second.cars, undefined);
    assert.equal(second.lastSource, "parking");
  });
});

describe("offering customers back as staff type", () => {
  const rows = [
    {name: "Amadou Ba", phone: "2015550100", lastSeenMs: 10},
    {name: "Fatou Diallo", phone: "9175550123", lastSeenMs: 20},
    {name: "Ibrahima Amadou", phone: "", lastSeenMs: 30},
  ];
  it("needs two characters and ranks a name prefix first", () => {
    assert.deepEqual(matchLotCustomers(rows, "a"), []);
    assert.deepEqual(matchLotCustomers(rows, "am").map((r) => r.name),
        ["Amadou Ba", "Ibrahima Amadou"]);
  });
  it("finds by phone digits", () => {
    assert.equal(matchLotCustomers(rows, "917-555")[0].name, "Fatou Diallo");
  });
});
