"use strict";

// A team member's own car on the lot (docs/PARKING_TEAM_CARS.md): tied to
// the person, named from them, never messaged, invoiced or given a customer
// account.

const assert = require("node:assert/strict");
const test = require("node:test");

const team = require("../parking_team");
const {normalizeBusinessParkingEntry, buildBusinessParkingEntryRecord,
  businessParkingEditPlan} = require("../business_parking_entry");
const parkingWhatsApp = require("../parking_whatsapp");
const parkingInvoices = require("../parking_invoices");
const {parkingCustomerKey} = require("../parking_month_statement");
const phoneAccounts = require("../phone_accounts");

const links = {
  abd: {customerKey: "phone:3475628973", customerName: "Abdoulaye Sow",
    customerPhone: "+13475628973"},
  yao: {customerKey: "phone:9293711987", customerName: "Yao",
    customerPhone: "+19293711987"},
};

test("the team is the owner and every staff member of this business", () => {
  const business = {ownerUid: "own"};
  assert.ok(team.isTeamMember(null, "own", "lot", business), "the owner");
  assert.ok(team.isTeamMember({role: "staff", businessId: "lot"}, "s", "lot",
      business));
  assert.ok(!team.isTeamMember({role: "staff", businessId: "other"}, "s",
      "lot", business));
  assert.ok(!team.isTeamMember({role: "customer", businessId: "lot"}, "c",
      "lot", business));
});

test("a picked member's car takes the linked customer, else their name", () => {
  assert.deepEqual(team.teamCarFields({staffId: "abd",
    user: {fullName: "Abdoulaye Sow"}, link: links.abd}),
  {forStaffId: "abd", forStaffName: "Abdoulaye Sow",
    customerName: "Abdoulaye Sow", customerPhone: "+13475628973"});
  assert.deepEqual(team.teamCarFields({staffId: "mu",
    user: {fullName: "Musa Kante"}, link: null}),
  {forStaffId: "mu", forStaffName: "Musa Kante", customerName: "Musa Kante",
    customerPhone: ""});
});

test("a typed number the owner linked ties the car, whatever its form", () => {
  for (const typed of ["3475628973", "+13475628973", "+1 347 562 8973",
    "(347) 562-8973"]) {
    assert.equal(team.linkedStaffForPhone(typed, links), "abd", typed);
  }
  assert.equal(team.linkedStaffForPhone("6466840661", links), "");
  assert.equal(team.linkedStaffForPhone("", links), "");
  // Two members on one number: the owner has to say which.
  assert.equal(team.linkedStaffForPhone("3475628973", {...links,
    other: {customerPhone: "3475628973"}}), "");
});

test("keys: staff:{uid} for a team car, the number otherwise", () => {
  assert.equal(team.teamCustomerKey("abd"), "staff:abd");
  assert.equal(team.staffIdOfKey("staff:abd"), "abd");
  assert.equal(team.staffIdOfKey("phone:3475628973"), "");
  assert.equal(parkingCustomerKey({forStaffId: "abd",
    customerPhone: "+13475628973"}), "staff:abd");
  assert.equal(parkingCustomerKey({customerPhone: "+13475628973"}),
      "phone:3475628973");
});

test("a team car needs no name or phone typed, and records the person", () => {
  const raw = {businessId: "lot", paymentMethod: "direct", forStaffId: "abd",
    carMake: "Toyota", carModel: "Camry", carYear: "2015",
    startDate: "2026-10-10"};
  const {input, errors} = normalizeBusinessParkingEntry(raw);
  assert.deepEqual(errors, []);
  assert.equal(input.forStaffId, "abd");
  const customer = normalizeBusinessParkingEntry({...raw, forStaffId: ""});
  assert.ok(customer.errors.includes("customer_name_required"));
  assert.ok(customer.errors.includes("customer_phone_required"));
  const record = buildBusinessParkingEntryRecord({trackingCode: "PK-1",
    input: {...input, forStaffName: "Abdoulaye Sow"},
    plan: {paymentMethod: "direct", status: "reserved",
      paymentStatus: "awaiting_direct_payment"},
    option: {}, currency: "usd"});
  assert.equal(record.forStaffId, "abd");
  assert.equal(record.forStaffName, "Abdoulaye Sow");
  const plain = buildBusinessParkingEntryRecord({trackingCode: "PK-2",
    input: {...input, forStaffId: ""}, plan: {paymentMethod: "direct"},
    option: {}, currency: "usd"});
  assert.equal("forStaffId" in plain, false);
});

test("an edit may tie or untie a car", () => {
  const entry = {source: "business", paymentStatus: "awaiting_direct_payment",
    paymentMethod: "direct"};
  const tie = businessParkingEditPlan({entry, changes: {forStaffId: "abd"}});
  assert.equal(tie.ok, true);
  assert.equal(tie.changes.forStaffId, "abd");
  const untie = businessParkingEditPlan({entry, changes: {forStaffId: ""}});
  assert.equal(untie.changes.forStaffId, "");
});

test("no customer WhatsApp, welcome, invoice or account for a team car", () => {
  const car = {source: "business", forStaffId: "abd",
    customerPhone: "+13475628973", parkingDate: "2026-10-01"};
  assert.equal(parkingWhatsApp.carIsMessageable(car), false);
  assert.equal(parkingWhatsApp.carIsMessageable({...car, forStaffId: ""}),
      true);
  const welcome = parkingWhatsApp.welcomeRecipients({cars: [{...car,
    id: "c1"}], business: {country: "United States"}, welcomed: new Set(),
  now: new Date("2026-10-20T12:00:00Z")});
  assert.equal(welcome.recipients.length, 0);
  const summary = {monthKey: "2026-10", customers: [{key: "staff:abd",
    customerName: "Abdoulaye Sow", customerPhone: "+13475628973",
    dueCents: 5000, cars: [{id: "c1", vehicle: "Camry", stillParked: true}],
    olderCars: [], activities: [], olderActivities: []}]};
  const book = parkingInvoices.invoiceRecipients(summary, null,
      new Date("2026-11-01T12:00:00Z"), {business: {}});
  assert.equal(book.recipients.length + book.skipped.length, 0);
  assert.deepEqual(phoneAccounts.recordPhones("parkedCars", car, "US"), []);
  assert.ok(phoneAccounts.recordPhones("parkedCars",
      {...car, forStaffId: ""}, "US").length > 0);
});
