"use strict";

// Staff statements (docs/PARKING_INVOICES.md section 6): a team member's
// month-end numbers - parking and jobs, less expenses not yet credited, plus
// the cash they hold at the month's end - and who gets a statement. Pure: no
// Firestore.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {parkingMonthSummary} = require("../parking_month_statement");
const invoices = require("../parking_invoices");
const pdf = require("../parking_invoice_pdf");
const statement = require("../staff_statement");
const {parkingTemplateMessage, PARKING_TEMPLATE} =
  require("../whatsapp_templates");

const FIXTURE = require("./fixtures/staff-statement-cases.json");

describe("a team member's statement (the shared fixture)", () => {
  for (const c of FIXTURE.cases) {
    it(c.name, () => {
      const out = statement.staffStatements(c.customers,
          {monthKey: c.monthKey, ...c.ctx});
      assert.deepEqual(out.statements.map((s) => ({
        staffId: s.staffId,
        name: s.name,
        key: s.key,
        parkingJobsCents: s.parkingJobsCents,
        expenseCents: s.expenseCents,
        expenseLineCount: s.expenseLines.length,
        earlierExpenseCents: s.earlierExpenseCents,
        cashHeldCents: s.cashHeldCents,
        owesCents: s.owesCents,
        stillParked: s.stillParked,
      })), c.expected);
      assert.deepEqual(out.customerKeys, c.customerKeys);
    });
  }
});

describe("the end of a month, New York time", () => {
  it("is the last millisecond before the next month's midnight there", () => {
    // October 2026 ends in EDT (UTC-4), November in EST (UTC-5).
    assert.equal(new Date(statement.monthEndMs("2026-10")).toISOString(),
        "2026-11-01T03:59:59.999Z");
    assert.equal(new Date(statement.monthEndMs("2026-11")).toISOString(),
        "2026-12-01T04:59:59.999Z");
    // March 2027: the clocks went forward on the 14th.
    assert.equal(new Date(statement.monthEndMs("2027-03")).toISOString(),
        "2027-04-01T03:59:59.999Z");
    assert.equal(new Date(statement.monthEndMs("2026-12")).toISOString(),
        "2027-01-01T04:59:59.999Z");
  });

  it("is nothing for a bad month", () => {
    for (const bad of ["", "2026-13", "2026-1", null, undefined, 202610]) {
      assert.equal(statement.monthEndMs(bad), 0, String(bad));
    }
  });
});

describe("cash held as of the end of a month", () => {
  const END = statement.monthEndMs("2026-10");
  const NOW = new Date("2026-11-04T15:00:00Z");
  const car = (id, payments, extra = {}) => ({id, parkingDate: "2026-10-01",
    parkingEndDate: "2026-10-10", parkingPayments: payments,
    paymentStatus: "paid", ...extra});
  const pay = (staff, amountCents, at, extra = {}) => ({amountCents,
    receivedByStaffId: staff, receivedVia: "cash", at: new Date(at), ...extra});
  const held = (sources, handovers = [], extra = {}) =>
    statement.staffHeldAsOf({sources, handovers, asOfMs: END, now: NOW,
      ...extra});

  it("counts what they collected by then, not what came in after", () => {
    const out = held({parkedCars: [car("c1", [
      pay("alh", 3600, "2026-10-15T16:00:00Z"),
      pay("alh", 1000, "2026-10-31T23:59:59Z"),
      pay("alh", 9999, "2026-11-01T04:00:00Z"),
    ])]});
    assert.deepEqual(out, {alh: 4600});
  });

  it("is not changed by a handover confirmed after the month ended", () => {
    const sources = {parkedCars: [car("c1", [
      pay("alh", 3600, "2026-10-15T16:00:00Z")])]};
    const handover = (status, confirmedAtMs, extra = {}) => ({id: "h",
      kind: "handover", fromStaffId: "alh", toId: "business_account",
      amountCents: 3600, status, confirmedAtMs, createdAtMs: confirmedAtMs,
      ...extra});
    const after = Date.parse("2026-11-02T15:00:00Z");
    assert.deepEqual(held(sources, [handover("confirmed", after)]),
        {alh: 3600});
    // The same handover confirmed BEFORE the month ended does change it...
    const before = Date.parse("2026-10-20T15:00:00Z");
    assert.deepEqual(held(sources, [handover("confirmed", before)]),
        {alh: 0});
    // ...a pending, declined or voided one never does.
    for (const status of ["pending", "declined", "voided"]) {
      assert.deepEqual(held(sources, [handover(status, before)]),
          {alh: 3600}, status);
    }
  });

  it("an opening amount, and money handed from person to person, count " +
      "from the moment they were confirmed", () => {
    const sources = {parkedCars: [car("c1", [
      pay("alh", 5000, "2026-10-05T16:00:00Z")])]};
    const out = held(sources, [
      {id: "o", kind: "opening", fromStaffId: "alh",
        toId: "business_account", amountCents: 1000, status: "confirmed",
        createdAtMs: Date.parse("2026-10-10T12:00:00Z")},
      {id: "p", kind: "handover", fromStaffId: "alh", toId: "yao",
        amountCents: 1500, status: "confirmed",
        confirmedAtMs: Date.parse("2026-10-12T12:00:00Z")},
      {id: "late", kind: "handover", fromStaffId: "yao", toId: "alh",
        amountCents: 700, status: "confirmed",
        confirmedAtMs: Date.parse("2026-11-03T12:00:00Z")},
    ]);
    assert.deepEqual(out, {alh: 2500, yao: 1500});
  });

  it("follows the business's 'What counts', and Business account money " +
      "belongs to nobody", () => {
    const sources = {
      parkedCars: [car("c1", [pay("alh", 3000, "2026-10-05T16:00:00Z"),
        pay("business_account", 7000, "2026-10-06T16:00:00Z")])],
      invoicePayments: [{id: "i1", amountCents: 2000, method: "cash",
        receivedByStaffId: "alh", paidAt: new Date("2026-10-07T16:00:00Z")}],
    };
    assert.deepEqual(held(sources), {alh: 3000});
    assert.deepEqual(held(sources, [], {counted: {invoice: true}}),
        {alh: 5000});
    assert.deepEqual(held(sources, [], {counted: {parking: false}}), {});
  });

  it("counts a car marked paid in full from when it was marked, and money " +
      "with no date as old", () => {
    const out = held({parkedCars: [
      car("done", [], {receivedByStaffId: "alh", amountDueCents: 4000,
        totalCostCents: 4000, amountPaidCents: 4000,
        directPaymentReceivedAt: new Date("2026-10-12T12:00:00Z"),
        // A later edit must not move the payment out of October.
        updatedAt: new Date("2026-11-03T12:00:00Z")}),
      car("later", [], {receivedByStaffId: "alh", amountDueCents: 9000,
        totalCostCents: 9000, amountPaidCents: 9000,
        directPaymentReceivedAt: new Date("2026-11-02T12:00:00Z")}),
      car("undated", [pay("alh", 300, null)]),
    ]});
    assert.deepEqual(out, {alh: 4300});
  });
});

// October 2026 as the console shows it for Alhoussaine: $1,226 of parking
// and lot jobs, a $35 expense from September not yet credited, $36 held.
describe("a team member's statement, end to end (Alhoussaine, October)",
    () => {
      const NOW = new Date("2026-11-04T15:00:00Z");
      const day = (iso) => new Date(`${iso}T12:00:00Z`);
      const BUSINESS = {name: "Keren Auto Sales", country: "United States",
        phone: "+13475596214"};
      const mine = {customerName: "Alhoussaine Barry",
        customerPhone: "+13475550101"};
      const CARS = [
        {id: "a1", ...mine, carYear: "2015", carMake: "Honda",
          carModel: "Accord", trackingCode: "PK-ALH001",
          parkingDate: day("2026-10-02"), parkingEndDate: day("2026-10-20"),
          amountDueCents: 90000, totalCostCents: 90000,
          paymentMethod: "direct"},
        {id: "a2", ...mine, carYear: "2012", carMake: "Ford",
          carModel: "Focus", trackingCode: "PK-ALH002",
          parkingDate: day("2026-10-05"), parkingEndDate: day("2026-10-25"),
          amountDueCents: 20000, totalCostCents: 20000,
          paymentMethod: "direct"},
        // A customer's car whose $36 Alhoussaine took in cash on Oct 15.
        {id: "z1", customerName: "Zed Camara", customerPhone: "+12015550099",
          carYear: "2010", carMake: "Kia", carModel: "Rio",
          trackingCode: "PK-ZED001", parkingDate: day("2026-10-03"),
          parkingEndDate: day("2026-10-10"), amountDueCents: 50000,
          totalCostCents: 50000, paymentMethod: "direct", amountPaidCents: 3600,
          parkingPayments: [{amountCents: 3600, receivedByStaffId: "alh",
            receivedVia: "cash", at: day("2026-10-15")}]},
      ];
      const ACTIVITIES = [
        {id: "j1", ...mine, activityDate: day("2026-10-14"),
          activityTypeLabel: "Tire change", feeCents: 12600,
          carYear: "2015", carMake: "Honda", carModel: "Accord",
          trackingCode: "PK-ALH001", paymentStatus: "awaiting_direct_payment"},
      ];
      const CREDIT = {
        links: {alh: {customerKey: "phone:3475550101",
          customerPhone: "+13475550101"}},
        staffNames: {alh: "Alhoussaine Barry"},
        lines: [],
        repayments: [],
        entries: [{id: "e-sep", paidByStaffId: "alh", amountCents: 3500,
          month: "2026-09", spentAt: day("2026-09-06"), note: "cups"}],
      };
      const summary = () => parkingMonthSummary(CARS, "2026-10", NOW,
          ACTIVITIES);
      const heldAtMonthEnd = (handovers = []) => statement.staffHeldAsOf({
        asOfMs: statement.monthEndMs("2026-10"), now: NOW, handovers,
        sources: {parkedCars: CARS, lotActivities: ACTIVITIES}});
      const book = (extra = {}, credit = CREDIT) =>
        invoices.invoiceRecipients(summary(), credit, NOW,
            {business: BUSINESS, held: heldAtMonthEnd(), ...extra});

      it("Month end showed $1,191 (no cash line); the statement is $1,227",
          () => {
            const netted = invoices.nettedCustomers(summary().customers,
                "2026-10", CREDIT);
            const card = netted.find((c) => c.key === "phone:3475550101");
            assert.equal(card.dueBeforeExpensesCents, 122600);
            assert.equal(card.expenseCreditCents, 3500);
            assert.equal(card.dueCents, 119100);
            assert.deepEqual(heldAtMonthEnd(), {alh: 3600});

            const [st] = statement.staffStatements(netted, {
              monthKey: "2026-10", entries: CREDIT.entries.map((e) =>
                ({...e, spentAtMs: e.spentAt.getTime()})),
              repayments: [], lines: [], staffNames: CREDIT.staffNames,
              held: heldAtMonthEnd()}).statements;
            assert.equal(st.parkingJobsCents, 122600);
            assert.equal(st.expenseCents, 3500);
            assert.equal(st.cashHeldCents, 3600);
            assert.equal(st.owesCents, 122700);
          });

      it("the WhatsApp statement shows the same $1,227, numbered ST-, " +
          "and is not also invoiced as a customer", () => {
        const result = book();
        const alh = result.recipients.filter((r) =>
          r.phoneDigits === "13475550101");
        assert.equal(alh.length, 1);
        assert.equal(alh[0].kind, "statement");
        assert.equal(alh[0].staffId, "alh");
        assert.equal(alh[0].totalDueCents, 122700);
        assert.equal(alh[0].statement.owesCents, 122700);
        assert.equal(alh[0].invoiceNumber, "ST-202610-0101-1");
        assert.deepEqual(alh[0].cars.map((c) => c.trackingCode),
            ["PK-ALH001", "PK-ALH002"].reverse());
        assert.equal(alh[0].name, "Alhoussaine Barry");
        // Zed is a customer: unchanged, an invoice for what is left.
        const zed = result.recipients.find((r) =>
          r.phoneDigits === "12015550099");
        assert.equal(zed.kind, "invoice");
        assert.equal(zed.totalDueCents, 46400);
        assert.equal(zed.invoiceNumber, "INV-202610-0099-1");
        assert.equal(result.totalDueCents, 122700 + 46400);
      });

      it("sends the same template as an invoice, with the statement's " +
          "amount as the balance due", () => {
        const st = book().recipients.find((r) => r.kind === "statement");
        const values = invoices.invoiceMessageValues(st, BUSINESS);
        assert.equal(values.dueEn, "$1,227.00");
        assert.equal(values.monthEn, "October 2026");
        assert.equal(values.name, "Alhoussaine Barry");
        for (const template of [PARKING_TEMPLATE.INVOICE,
          PARKING_TEMPLATE.INVOICE_NO_BUTTON]) {
          const body = parkingTemplateMessage({template, phone: st.phone,
            values: {...values, documentLink: "https://example.test/d",
              documentFilename: invoices.invoiceFilename(st.invoiceNumber)}});
          assert.equal(body.template.name, template);
          assert.equal(body.template.components[0].parameters[0].document
              .filename, "Statement ST-202610-0101-1.pdf");
        }
      });

      it("a handover confirmed after the month ended does not change the " +
          "statement", () => {
        const after = book({held: heldAtMonthEnd([{id: "h",
          kind: "handover", fromStaffId: "alh", toId: "business_account",
          amountCents: 3600, status: "confirmed",
          confirmedAtMs: Date.parse("2026-11-02T15:00:00Z")}])});
        const st = after.recipients.find((r) => r.kind === "statement");
        assert.equal(st.owesCents, 122700);
      });

      it("draws a STATEMENT with the month's lines, the expenses, the " +
          "cash held and the balance the business is owed", () => {
        const st = book().recipients.find((r) => r.kind === "statement");
        const model = pdf.staffStatementModel({business: BUSINESS,
          recipient: st, monthKey: "2026-10", issuedMs: NOW.getTime(),
          paymentInstructions: "Zelle 347-559-6214"});
        assert.equal(model.title, "STATEMENT / RELEVÉ");
        assert.equal(model.reference, "ST-202610-0101-1");
        assert.equal(model.rows[0].label, "Team member / Membre de l'équipe");
        assert.equal(model.rows[0].value, "Alhoussaine Barry");
        assert.deepEqual(model.sections.map((s) => s.heading),
            ["Parking / Stationnement", "Activities / Activités"]);
        const labels = model.summary.map((r) => [r.label, r.value]);
        assert.deepEqual(labels, [
          ["Parking and lot jobs for October 2026 / " +
            "Stationnement et travaux de octobre 2026", "$1,226.00"],
          ["Less expenses you paid for the lot / " +
            "Moins les dépenses payées pour le parking", "-$35.00"],
          ["Cash you hold for the business / " +
            "Argent que vous gardez pour l'entreprise", "+$36.00"],
        ]);
        assert.equal(model.summary[1].sub.length, 1);
        assert.match(model.summary[1].sub[0].label,
            /Expenses from earlier months/);
        assert.equal(model.balance.label,
            "YOU OWE THE BUSINESS / VOUS DEVEZ À L'ENTREPRISE");
        assert.equal(model.balance.value, "$1,227.00");
        assert.equal(model.status.paidInFull, false);
        assert.equal(model.instructions.text, "Zelle 347-559-6214");
      });

      it("renders to a real PDF", async () => {
        const st = book().recipients.find((r) => r.kind === "statement");
        const model = pdf.staffStatementModel({business: BUSINESS,
          recipient: st, monthKey: "2026-10", issuedMs: NOW.getTime()});
        const bytes = await pdf.renderInvoicePdf(model,
            {compress: false, fetchLogo: () => Promise.resolve(null)});
        assert.equal(bytes.subarray(0, 5).toString("latin1"), "%PDF-");
        const drawn = bytes.toString("latin1");
        assert.ok(drawn.includes("/Title"), "has a title");
      });

      it("has no statement when there is nothing to net (no credit)", () => {
        const result = invoices.invoiceRecipients(summary(), null, NOW,
            {business: BUSINESS});
        assert.ok(result.recipients.every((r) => r.kind === "invoice"));
      });
    });

describe("when the business owes the team member", () => {
  const NOW = new Date("2026-11-04T15:00:00Z");
  const day = (iso) => new Date(`${iso}T12:00:00Z`);
  const BUSINESS = {name: "Keren Auto Sales", country: "United States"};
  const carOf = (extra = {}) => ({id: "m1", forStaffId: "musa",
    customerName: "Musa Kante", customerPhone: "", carYear: "2016",
    carMake: "Toyota", carModel: "Camry", trackingCode: "PK-MUSA01",
    parkingDate: day("2026-10-10"), parkingEndDate: day("2026-10-14"),
    amountDueCents: 20000, totalCostCents: 20000, paymentMethod: "direct",
    ...extra});
  const CREDIT = {links: {}, staffNames: {musa: "Musa Kante"}, lines: [],
    repayments: [], entries: [{id: "e1", paidByStaffId: "musa",
      amountCents: 50000, month: "2026-10", spentAt: day("2026-10-12"),
      note: "paint"}]};
  const run = (cars, extra = {}) => invoices.invoiceRecipients(
      parkingMonthSummary(cars, "2026-10", NOW, []), CREDIT, NOW,
      {business: BUSINESS, ...extra});

  it("gets no statement when the business owes them and no car is " +
      "still parked", () => {
    const result = run([carOf()], {held: {musa: 5000},
      staffPhones: {musa: "+13475550177"}});
    assert.deepEqual(result.recipients, []);
    assert.deepEqual(result.skipped, []);
  });

  it("still gets one for $0.00 when a car is still parked, and the PDF " +
      "says the business owes them", () => {
    const result = run([carOf({parkingEndDate: null,
      amountDueCents: null, totalCostCents: null, dailyRate: 10})],
    {held: {musa: 5000}, staffPhones: {musa: "+13475550177"}});
    assert.equal(result.recipients.length, 1);
    const [st] = result.recipients;
    assert.equal(st.kind, "statement");
    assert.ok(st.owesCents < 0);
    assert.equal(st.totalDueCents, 0);
    const model = pdf.staffStatementModel({business: BUSINESS, recipient: st,
      monthKey: "2026-10", issuedMs: NOW.getTime()});
    assert.equal(model.balance.label,
        "THE BUSINESS OWES YOU / L'ENTREPRISE VOUS DOIT");
    assert.equal(model.balance.value,
        `$${(Math.abs(st.owesCents) / 100).toLocaleString("en-US", {
          minimumFractionDigits: 2})}`);
    assert.equal(model.status.paidInFull, true);
    assert.equal(model.instructions, null);
  });

  it("their profile's phone comes first, then the linked customer's", () => {
    const parked = carOf({parkingEndDate: null, amountDueCents: null,
      totalCostCents: null, dailyRate: 10});
    const profile = run([parked], {staffPhones: {musa: "+13475550177"}});
    assert.equal(profile.recipients[0].phoneDigits, "13475550177");
    const linkedCredit = {...CREDIT, links: {musa: {
      customerKey: "phone:3475550188", customerPhone: "+13475550188"}}};
    const linked = invoices.invoiceRecipients(
        parkingMonthSummary([parked], "2026-10", NOW, []), linkedCredit, NOW,
        {business: BUSINESS});
    assert.equal(linked.recipients[0].phoneDigits, "13475550188");
  });

  it("lists a team member with no phone under skipped, with why", () => {
    const parked = carOf({parkingEndDate: null, amountDueCents: null,
      totalCostCents: null, dailyRate: 10});
    const result = run([parked]);
    assert.deepEqual(result.recipients, []);
    assert.equal(result.skipped.length, 1);
    assert.equal(result.skipped[0].kind, "statement");
    assert.equal(result.skipped[0].name, "Musa Kante");
    assert.equal(result.skipped[0].reason, "no_phone");
  });

  it("a number another recipient already has is not sent to twice", () => {
    const owing = carOf({amountDueCents: 90000, totalCostCents: 90000});
    const customer = {id: "c9", customerName: "Customer",
      customerPhone: "+13475550177", carYear: "2011", carMake: "Kia",
      carModel: "Rio", trackingCode: "PK-C9", parkingDate: day("2026-10-02"),
      parkingEndDate: day("2026-10-03"), amountDueCents: 1000,
      totalCostCents: 1000, paymentMethod: "direct"};
    const result = run([owing, customer],
        {staffPhones: {musa: "+13475550177"}});
    assert.deepEqual(result.recipients.map((r) => r.kind), ["invoice"]);
    assert.equal(result.skipped[0].reason, "duplicate_phone");
  });
});
