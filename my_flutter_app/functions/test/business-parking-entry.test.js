"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  BUSINESS_PARKING_DIRECT_METHODS,
  BUSINESS_PARKING_PAYMENT_METHODS,
  BUSINESS_PARKING_PAYMENT_TYPE,
  buildBusinessParkingEntryRecord,
  businessParkingPaidUpdate,
  businessParkingPaymentPlan,
  directPaymentPayoutFields,
  normalizeBusinessParkingEntry,
  normalizeDirectPaymentMethod,
} = require("../business_parking_entry");

const VALID_INPUT = Object.freeze({
  businessId: "biz_a",
  paymentMethod: "direct",
  customerName: "Aissatou Diallo",
  customerPhone: "+1 917 555 0134",
  customerEmail: "Aissatou@Example.com",
  carMake: "Toyota",
  carModel: "Camry",
  carYear: "2019",
  vinNumber: "4t1bf1fk5cu123456",
  startDate: "2026-08-10T12:00:00.000Z",
  endDate: "2026-08-20T12:00:00.000Z",
});

const OPTION = Object.freeze({
  businessName: "Keren Auto",
  city: "Bronx",
  address: "3184 Webster Ave",
  dailyRate: 20,
  weeklyRate: 100,
  monthlyRate: 350,
  minimumDays: 1,
  pickupFee: 40,
  instructions: "Ring the bell at gate 2",
});

const input = (overrides) => ({...VALID_INPUT, ...overrides});
const codes = (raw) => normalizeBusinessParkingEntry(raw).errors.sort();

describe("business parking entry input", () => {
  it("accepts a complete walk-up entry and normalizes it", () => {
    const {input: clean, errors} = normalizeBusinessParkingEntry(VALID_INPUT);
    assert.deepEqual(errors, []);
    assert.equal(clean.businessId, "biz_a");
    assert.equal(clean.paymentMethod, "direct");
    assert.equal(clean.customerName, "Aissatou Diallo");
    assert.equal(clean.customerEmail, "aissatou@example.com");
    assert.equal(clean.vinNumber, "4T1BF1FK5CU123456");
    assert.equal(clean.startDate.toISOString(), "2026-08-10T12:00:00.000Z");
    assert.equal(clean.endDate.toISOString(), "2026-08-20T12:00:00.000Z");
  });

  it("never invents a customer account", () => {
    const {input: clean} = normalizeBusinessParkingEntry(VALID_INPUT);
    assert.equal("customerUid" in clean, false);
  });

  it("treats a junk payload as every field missing, not as a crash", () => {
    for (const raw of [undefined, null, "", 7, []]) {
      const {input: clean, errors} = normalizeBusinessParkingEntry(raw);
      assert.equal(clean, null);
      assert.deepEqual(errors.sort(), [
        "business_required",
        "car_make_required",
        "car_model_required",
        "car_year_required",
        "customer_name_required",
        "customer_phone_required",
        "payment_method_invalid",
        "start_date_required",
      ]);
    }
  });

  it("reports every problem at once, not just the first", () => {
    assert.deepEqual(
        codes(input({customerName: "  ", carModel: "", carYear: ""})),
        ["car_model_required", "car_year_required", "customer_name_required"],
    );
  });

  it("requires a business", () => {
    assert.deepEqual(codes(input({businessId: "   "})), ["business_required"]);
  });

  it("only accepts the two settled payment methods", () => {
    for (const method of BUSINESS_PARKING_PAYMENT_METHODS) {
      assert.deepEqual(codes(input({paymentMethod: method})), []);
    }
    for (const method of ["", "wallet", "cash", "stripe", "DIRECT", null]) {
      assert.deepEqual(
          codes(input({paymentMethod: method})),
          ["payment_method_invalid"],
      );
    }
  });

  it("requires a name and a phone for the walk-up customer", () => {
    assert.deepEqual(
        codes(input({customerName: "", customerPhone: ""})),
        ["customer_name_required", "customer_phone_required"],
    );
  });

  it("treats email as optional but rejects a malformed one", () => {
    assert.deepEqual(codes(input({customerEmail: ""})), []);
    assert.deepEqual(codes(input({customerEmail: undefined})), []);
    assert.deepEqual(
        codes(input({customerEmail: "not-an-email"})),
        ["customer_email_invalid"],
    );
  });

  it("refuses a payment link with no way to deliver it", () => {
    assert.deepEqual(
        codes(input({
          paymentMethod: "payment_link",
          customerPhone: "",
          customerEmail: "",
        })).filter((code) => code !== "customer_phone_required"),
        ["payment_link_contact_required"],
    );
    // An email alone is enough to send the link; the missing phone is still
    // reported, but the link itself is deliverable.
    assert.equal(
        codes(input({
          paymentMethod: "payment_link",
          customerPhone: "",
          customerEmail: "walkup@example.com",
        })).includes("payment_link_contact_required"),
        false,
    );
  });

  it("requires the car's make, model and a plausible year", () => {
    assert.deepEqual(codes(input({carMake: " "})), ["car_make_required"]);
    assert.deepEqual(codes(input({carModel: " "})), ["car_model_required"]);
    for (const year of ["19", "20o4", "abcd", "99999"]) {
      assert.deepEqual(codes(input({carYear: year})), ["car_year_invalid"]);
    }
    for (const year of ["1899", "2101"]) {
      assert.deepEqual(codes(input({carYear: year})), ["car_year_invalid"]);
    }
    for (const year of ["1900", "2026", "2100"]) {
      assert.deepEqual(codes(input({carYear: year})), []);
    }
  });

  it("keeps the VIN optional and does not reject an odd one", () => {
    assert.deepEqual(codes(input({vinNumber: ""})), []);
    const {input: clean} = normalizeBusinessParkingEntry(
        input({vinNumber: "  short-vin  "}),
    );
    assert.deepEqual(codes(input({vinNumber: "short-vin"})), []);
    assert.equal(clean.vinNumber, "SHORT-VIN");
  });

  it("requires a start, allows open-ended, rejects an inverted window", () => {
    assert.deepEqual(codes(input({startDate: ""})), ["start_date_required"]);
    // A missing / unparseable end is an open-ended stay, not an error.
    assert.deepEqual(codes(input({endDate: "nonsense"})), []);
    assert.deepEqual(codes(input({endDate: ""})), []);
    assert.deepEqual(
        codes(input({
          startDate: "2026-08-20T12:00:00.000Z",
          endDate: "2026-08-10T12:00:00.000Z",
        })),
        ["end_date_before_start_date"],
    );
  });

  it("accepts a same-day window and real Date objects", () => {
    const day = new Date("2026-08-10T12:00:00.000Z");
    assert.deepEqual(codes(input({startDate: day, endDate: day})), []);
    assert.deepEqual(
        codes(input({startDate: new Date("nope"), endDate: day})),
        ["start_date_required"],
    );
  });
});

describe("business parking payment plan", () => {
  it("rejects an unvalidated method rather than guessing one", () => {
    for (const method of ["", "wallet", null, undefined]) {
      assert.equal(
          businessParkingPaymentPlan({paymentMethod: method, totalCents: 100}),
          null,
      );
    }
  });

  it("direct records the amount and creates nothing on Stripe", () => {
    const plan = businessParkingPaymentPlan({
      paymentMethod: "direct",
      totalCents: 24000,
    });
    assert.equal(plan.billedByPlatform, false);
    assert.equal(plan.createsStripeObject, false);
    assert.equal(plan.takesPlatformCut, false);
    assert.equal(plan.amountDueCents, 24000);
    assert.equal(plan.amountDue, 240);
    assert.equal(plan.paymentStatus, "awaiting_direct_payment");
    // Still occupies a space: "reserved" is inside ACTIVE_PARKING_STATUSES,
    // so the lot cannot resell the spot the car is standing in.
    assert.equal(plan.status, "reserved");
  });

  it("payment_link bills the customer and takes the platform's cut", () => {
    const plan = businessParkingPaymentPlan({
      paymentMethod: "payment_link",
      totalCents: 24000,
    });
    assert.equal(plan.billedByPlatform, true);
    assert.equal(plan.createsStripeObject, true);
    assert.equal(plan.takesPlatformCut, true);
    assert.equal(plan.status, "pending_payment");
    assert.equal(plan.paymentStatus, "pending");
  });

  it("bills the full stay, not a capped deposit", () => {
    const plan = businessParkingPaymentPlan({
      paymentMethod: "payment_link",
      totalCents: 123456,
    });
    assert.equal(plan.amountDueCents, 123456);
    assert.equal(plan.amountDue, 1234.56);
  });

  it("never leaves a zero-cost entry waiting on a payment", () => {
    for (const method of BUSINESS_PARKING_PAYMENT_METHODS) {
      const plan = businessParkingPaymentPlan({
        paymentMethod: method,
        totalCents: 0,
      });
      assert.equal(plan.status, "reserved");
      assert.equal(plan.paymentStatus, "not_required");
      assert.equal(plan.createsStripeObject, false);
      assert.equal(plan.takesPlatformCut, false);
    }
  });

  it("clamps a negative or unusable total to zero", () => {
    for (const total of [-1, -5000, NaN, undefined, "abc"]) {
      const plan = businessParkingPaymentPlan({
        paymentMethod: "payment_link",
        totalCents: total,
      });
      assert.equal(plan.amountDueCents, 0);
    }
  });

  it("rounds a fractional total to whole cents", () => {
    const plan = businessParkingPaymentPlan({
      paymentMethod: "direct",
      totalCents: 1999.6,
    });
    assert.equal(plan.amountDueCents, 2000);
  });

  it("skips Stripe under payment simulation but keeps the commission", () => {
    const plan = businessParkingPaymentPlan({
      paymentMethod: "payment_link",
      totalCents: 24000,
      simulatePayments: true,
    });
    assert.equal(plan.createsStripeObject, false);
    assert.equal(plan.takesPlatformCut, true);
    assert.equal(plan.status, "reserved");
    assert.equal(plan.paymentStatus, "succeeded");
  });

  it("simulation does not turn a direct entry into a paid one", () => {
    const plan = businessParkingPaymentPlan({
      paymentMethod: "direct",
      totalCents: 24000,
      simulatePayments: true,
    });
    assert.equal(plan.paymentStatus, "awaiting_direct_payment");
    assert.equal(plan.createsStripeObject, false);
  });

  it("is frozen so a caller cannot quietly rewrite the decision", () => {
    const plan = businessParkingPaymentPlan({
      paymentMethod: "direct",
      totalCents: 100,
    });
    assert.throws(() => {
      "use strict";
      plan.takesPlatformCut = true;
    });
  });
});

describe("direct payment payout fields", () => {
  it("records a zero platform fee and the full amount to the business", () => {
    assert.deepEqual(directPaymentPayoutFields(24000), {
      platformFeeCents: 0,
      businessPayoutCents: 24000,
      payoutStatus: "not_applicable",
      stripeChargeType: "none",
      stripeConnectedAccountId: "",
    });
  });

  it("never routes a direct entry through a connected account", () => {
    for (const value of [0, -10, NaN, undefined, "x"]) {
      const fields = directPaymentPayoutFields(value);
      assert.equal(fields.platformFeeCents, 0);
      assert.equal(fields.stripeChargeType, "none");
      assert.equal(fields.stripeConnectedAccountId, "");
      assert.ok(fields.businessPayoutCents >= 0);
    }
  });
});

describe("business parking entry record", () => {
  const recordFor = (paymentMethod, overrides = {}) => {
    const {input: clean} = normalizeBusinessParkingEntry(
        input({paymentMethod, ...overrides}),
    );
    const plan = businessParkingPaymentPlan({
      paymentMethod,
      totalCents: 24000,
      ...overrides,
    });
    return buildBusinessParkingEntryRecord({
      trackingCode: "PK-K7M4P2",
      input: clean,
      plan,
      option: OPTION,
      currency: "USD",
    });
  };

  it("never writes a customerUid - a walk-up has no account", () => {
    for (const method of BUSINESS_PARKING_PAYMENT_METHODS) {
      const record = recordFor(method);
      assert.equal("customerUid" in record, false);
      assert.equal(record.source, "business");
      assert.equal(record.enteredByBusiness, true);
    }
  });

  it("carries the tracking code, the business and the car", () => {
    const record = recordFor("direct");
    assert.equal(record.trackingCode, "PK-K7M4P2");
    assert.equal(record.businessId, "biz_a");
    assert.equal(record.businessName, "Keren Auto");
    assert.equal(record.parkingCity, "Bronx");
    assert.equal(record.parkingAddress, "3184 Webster Ave");
    assert.equal(record.carMake, "Toyota");
    assert.equal(record.carModel, "Camry");
    assert.equal(record.carYear, "2019");
    assert.equal(record.customerName, "Aissatou Diallo");
    assert.equal(record.ownerName, "Aissatou Diallo");
    assert.equal(record.currency, "usd");
  });

  it("records both the cents and dollar amounts owed", () => {
    const record = recordFor("direct");
    assert.equal(record.amountDueCents, 24000);
    assert.equal(record.amountDue, 240);
    assert.equal(record.totalCostCents, 24000);
    assert.equal(record.totalCost, 240);
  });

  it("marks a direct entry as awaiting off-platform payment", () => {
    const record = recordFor("direct");
    assert.equal(record.paymentMethod, "direct");
    assert.equal(record.platformBilled, false);
    assert.equal(record.paymentStatus, "awaiting_direct_payment");
    assert.equal(record.status, "reserved");
    // No Stripe object exists for this entry, so it must not look routable.
    assert.equal("paymentType" in record, false);
  });

  it("tags a billed entry so Stripe reconciliation can match it", () => {
    const record = recordFor("payment_link");
    assert.equal(record.platformBilled, true);
    assert.equal(record.paymentType, BUSINESS_PARKING_PAYMENT_TYPE);
    assert.equal(record.status, "pending_payment");
    assert.equal(record.paymentStatus, "pending");
  });

  it("does not tag a simulated entry Stripe never billed", () => {
    const record = recordFor("payment_link", {simulatePayments: true});
    assert.equal("paymentType" in record, false);
  });

  it("copies the business's rates and never assumes a pickup", () => {
    const record = recordFor("direct");
    assert.equal(record.dailyRate, 20);
    assert.equal(record.weeklyRate, 100);
    assert.equal(record.monthlyRate, 350);
    assert.equal(record.minimumDays, 1);
    assert.equal(record.pickupRequested, false);
    assert.equal(record.instructions, "Ring the bell at gate 2");
  });

  it("survives a sparse parking option without producing NaN", () => {
    const {input: clean} = normalizeBusinessParkingEntry(VALID_INPUT);
    const record = buildBusinessParkingEntryRecord({
      trackingCode: "PK-AAA111",
      input: clean,
      plan: businessParkingPaymentPlan({
        paymentMethod: "direct",
        totalCents: 500,
      }),
      option: {},
      currency: "usd",
    });
    for (const key of [
      "pickupFee", "dailyRate", "weeklyRate", "monthlyRate", "minimumDays",
    ]) {
      assert.equal(Number.isFinite(record[key]), true, key);
    }
    assert.equal(record.minimumDays, 1);
    assert.equal(record.businessName, "");
  });
});

describe("direct payment method normalization", () => {
  it("maps the ways a lot actually gets paid", () => {
    assert.equal(normalizeDirectPaymentMethod("Zelle"), "zelle");
    assert.equal(normalizeDirectPaymentMethod("  CASH "), "cash");
    assert.equal(normalizeDirectPaymentMethod("Cash App"), "cashapp");
    assert.equal(normalizeDirectPaymentMethod("cash_app"), "cashapp");
    assert.equal(normalizeDirectPaymentMethod("card-in-person"),
        "card_in_person");
  });

  it("records anything unrecognised as other, never verbatim", () => {
    for (const value of ["", null, undefined, "bank wire", "zelllle", 42]) {
      assert.equal(normalizeDirectPaymentMethod(value), "other");
    }
  });

  it("only ever returns a known method", () => {
    for (const value of ["zelle", "??", "Venmo", "check"]) {
      assert.ok(
          BUSINESS_PARKING_DIRECT_METHODS.includes(
              normalizeDirectPaymentMethod(value),
          ),
      );
    }
  });
});

describe("marking a direct payment received", () => {
  const awaiting = Object.freeze({
    source: "business",
    paymentMethod: "direct",
    status: "reserved",
    paymentStatus: "awaiting_direct_payment",
    amountDueCents: 24000,
    totalCostCents: 24000,
  });

  it("applies the payment once", () => {
    const result = businessParkingPaidUpdate({
      entry: awaiting,
      receivedVia: "Zelle",
      note: "Paid at the gate",
      markedByUid: "staff-1",
    });
    assert.equal(result.ok, true);
    assert.equal(result.alreadyPaid, false);
    assert.equal(result.amountPaidCents, 24000);
    assert.equal(result.update.paymentStatus, "paid");
    assert.equal(result.update.directPaymentReceived, true);
    assert.equal(result.update.directPaymentMethod, "zelle");
    assert.equal(result.update.directPaymentNote, "Paid at the gate");
    assert.equal(result.update.directPaymentMarkedByUid, "staff-1");
    assert.equal(result.update.amountPaid, 240);
    assert.equal(result.update.platformFeeCents, 0);
    assert.equal(result.update.businessPayoutCents, 24000);
    assert.equal(result.update.payoutStatus, "not_applicable");
  });

  it("is idempotent - a second call applies nothing", () => {
    const first = businessParkingPaidUpdate({
      entry: awaiting,
      receivedVia: "zelle",
    });
    const applied = {...awaiting, ...first.update};
    const second = businessParkingPaidUpdate({
      entry: applied,
      receivedVia: "cash",
    });
    assert.equal(second.ok, true);
    assert.equal(second.alreadyPaid, true);
    assert.equal(second.update, null);
    assert.equal(second.amountPaidCents, 24000);
    // The recorded method is not rewritten by the duplicate call.
    assert.equal(applied.directPaymentMethod, "zelle");

    const third = businessParkingPaidUpdate({entry: applied});
    assert.deepEqual(third, second);
  });

  it("refuses a payment_link entry - Stripe owns that status", () => {
    const result = businessParkingPaidUpdate({
      entry: {
        source: "business",
        paymentMethod: "payment_link",
        status: "pending_payment",
        paymentStatus: "pending",
        amountDueCents: 24000,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.update, null);
    assert.equal(result.reason, "payment_link_is_stripe_owned");
  });

  it("refuses a paid payment_link entry too", () => {
    const result = businessParkingPaidUpdate({
      entry: {
        source: "business",
        paymentMethod: "payment_link",
        paymentStatus: "succeeded",
        amountDueCents: 24000,
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "payment_link_is_stripe_owned");
  });

  it("refuses a customer-created reservation", () => {
    const result = businessParkingPaidUpdate({
      entry: {
        customerUid: "customer-1",
        paymentMethod: "direct",
        paymentStatus: "awaiting_direct_payment",
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_a_business_entry");
  });

  it("refuses a cancelled entry", () => {
    const result = businessParkingPaidUpdate({
      entry: {...awaiting, status: "cancelled"},
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "entry_cancelled");
  });

  it("refuses an entry that owes nothing", () => {
    const result = businessParkingPaidUpdate({
      entry: {...awaiting, paymentStatus: "not_required", amountDueCents: 0},
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, "not_awaiting_direct_payment");
  });

  it("refuses a junk or missing record instead of crashing", () => {
    for (const entry of [undefined, null, "", 5, {}, []]) {
      const result = businessParkingPaidUpdate({entry});
      assert.equal(result.ok, false);
      assert.equal(result.update, null);
      assert.equal(result.reason, "not_a_business_entry");
    }
  });

  it("falls back to the recorded total when amountDueCents is absent", () => {
    const result = businessParkingPaidUpdate({
      entry: {
        source: "business",
        paymentMethod: "direct",
        paymentStatus: "awaiting_direct_payment",
        totalCostCents: 5500,
      },
    });
    assert.equal(result.amountPaidCents, 5500);
    assert.equal(result.update.amountPaid, 55);
    assert.equal(result.update.businessPayoutCents, 5500);
  });

  it("never records a negative amount as paid", () => {
    const result = businessParkingPaidUpdate({
      entry: {...awaiting, amountDueCents: -1000},
    });
    assert.equal(result.amountPaidCents, 0);
    assert.equal(result.update.amountPaid, 0);
  });
});

describe("durable payment links", () => {
  const {
    PARKING_LINK_STATES,
    parkingPaymentLinkState,
    parkingCheckoutSessionReusable,
  } = require("../business_parking_entry");

  it("a paid entry stops being payable", () => {
    assert.equal(
        parkingPaymentLinkState({
          paymentMethod: "payment_link", paymentStatus: "succeeded",
          amountDueCents: 3500,
        }),
        PARKING_LINK_STATES.PAID,
    );
  });

  it("the lot can nullify a link, and a cancelled car nullifies it too", () => {
    assert.equal(
        parkingPaymentLinkState({
          paymentMethod: "payment_link", paymentStatus: "pending",
          amountDueCents: 3500, paymentLinkCancelledAt: "2026-08-06T00:00:00Z",
        }),
        PARKING_LINK_STATES.CANCELLED,
    );
    assert.equal(
        parkingPaymentLinkState({
          paymentMethod: "payment_link", paymentStatus: "pending",
          amountDueCents: 3500, status: "cancelled",
        }),
        PARKING_LINK_STATES.CANCELLED,
    );
  });

  it("an unpaid link stays payable no matter how old it is", () => {
    assert.equal(
        parkingPaymentLinkState({
          paymentMethod: "payment_link", paymentStatus: "pending",
          amountDueCents: 3500,
        }),
        PARKING_LINK_STATES.PAYABLE,
    );
  });

  it("direct entries and zero-amount rows have no link to serve", () => {
    assert.equal(
        parkingPaymentLinkState({
          paymentMethod: "direct", paymentStatus: "awaiting_direct_payment",
          amountDueCents: 3500,
        }),
        PARKING_LINK_STATES.UNAVAILABLE,
    );
    assert.equal(
        parkingPaymentLinkState({
          paymentMethod: "payment_link", paymentStatus: "pending",
          amountDueCents: 0,
        }),
        PARKING_LINK_STATES.UNAVAILABLE,
    );
  });

  it("reuses a live session and replaces a dead or paid one", () => {
    const now = 1786000000000;
    const future = Math.floor(now / 1000) + 3600;
    const past = Math.floor(now / 1000) - 10;
    assert.equal(parkingCheckoutSessionReusable({
      session: {status: "open", payment_status: "unpaid", expires_at: future},
      nowMs: now,
    }), true);
    assert.equal(parkingCheckoutSessionReusable({
      session: {status: "open", payment_status: "unpaid", expires_at: past},
      nowMs: now,
    }), false);
    assert.equal(parkingCheckoutSessionReusable({
      session: {status: "complete", payment_status: "paid", expires_at: future},
      nowMs: now,
    }), false);
    assert.equal(parkingCheckoutSessionReusable({session: null, nowMs: now}),
        false);
    // Expiring within the minute counts as dead.
    assert.equal(parkingCheckoutSessionReusable({
      session: {
        status: "open", payment_status: "unpaid",
        expires_at: Math.floor(now / 1000) + 30,
      },
      nowMs: now,
    }), false);
  });
});

describe("editing a walk-up record", () => {
  const {
    businessParkingEditPlan,
  } = require("../business_parking_entry");

  const unpaidLink = {
    source: "business", paymentMethod: "payment_link",
    paymentStatus: "pending",
  };

  it("refuses to touch a record whose money already moved", () => {
    for (const status of ["succeeded", "paid"]) {
      const plan = businessParkingEditPlan({
        entry: {...unpaidLink, paymentStatus: status},
        changes: {customerName: "New Name"},
      });
      assert.equal(plan.ok, false);
      assert.equal(plan.reason, "paid");
    }
  });

  it("refuses a record the business did not enter", () => {
    const plan = businessParkingEditPlan({
      entry: {paymentMethod: "payment_link", paymentStatus: "pending"},
      changes: {customerName: "x"},
    });
    assert.equal(plan.ok, false);
    assert.equal(plan.reason, "not_business_entered");
  });

  it("lets contact and vehicle details be corrected freely", () => {
    const plan = businessParkingEditPlan({
      entry: unpaidLink,
      changes: {customerEmail: "new@example.com", vinNumber: "ABC"},
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.repricing, false);
    // Correcting an email must not silently reissue the customer's link.
    assert.equal(plan.relinking, false);
    assert.deepEqual(plan.changes,
        {customerEmail: "new@example.com", vinNumber: "ABC"});
  });

  it("reissues the link whenever the dates move the price", () => {
    const plan = businessParkingEditPlan({
      entry: unpaidLink,
      changes: {endDate: "2026-09-01"},
    });
    assert.equal(plan.repricing, true);
    assert.equal(plan.relinking, true);
  });

  it("switching direct -> link issues one; link -> direct kills it", () => {
    const toLink = businessParkingEditPlan({
      entry: {...unpaidLink, paymentMethod: "direct",
        paymentStatus: "awaiting_direct_payment"},
      changes: {paymentMethod: "payment_link"},
    });
    assert.equal(toLink.methodChanged, true);
    assert.equal(toLink.relinking, true);
    assert.equal(toLink.cancelling, false);

    const toDirect = businessParkingEditPlan({
      entry: unpaidLink,
      changes: {paymentMethod: "direct"},
    });
    assert.equal(toDirect.methodChanged, true);
    assert.equal(toDirect.relinking, false);
    assert.equal(toDirect.cancelling, true);
  });

  it("rejects an edit that changes nothing, and unknown fields", () => {
    assert.equal(businessParkingEditPlan({
      entry: unpaidLink, changes: {},
    }).reason, "nothing_to_change");
    // A field not on the allowlist must not ride along - amountDueCents,
    // payoutStatus and platformFeeCents are the server's to compute.
    assert.equal(businessParkingEditPlan({
      entry: unpaidLink,
      changes: {amountDueCents: 1, payoutStatus: "paid"},
    }).reason, "nothing_to_change");
  });
});
