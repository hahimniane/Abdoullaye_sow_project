const assert = require("node:assert/strict");
const {describe, it} = require("node:test");

const {
  DEPOSIT_SERVICES,
  MAX_CUTOFF_DAYS,
  MAX_DEPOSIT_PCT,
  MIN_WORTHWHILE_DEPOSIT,
  PLATFORM_MAX_DEPOSIT,
  depositPolicy,
  freeCancellationWindow,
  quoteDeposit,
  validateDepositSettings,
} = require("../deposit_policy");

const DAY = 24 * 60 * 60 * 1000;

describe("a business that has set nothing", () => {
  it("asks for no deposit rather than erroring", () => {
    // Some businesses would rather have the booking than the security. That
    // is a real choice, so it is the default.
    const policy = depositPolicy({});
    assert.equal(policy.takesDeposit, false);
    assert.equal(policy.depositPct, 0);
  });

  it("leaves the whole order to pay at the cutoff", () => {
    const quote = quoteDeposit({business: {}, orderTotal: 220});
    assert.equal(quote.deposit, 0);
    assert.equal(quote.balance, 220);
    assert.equal(quote.reason, "business_takes_no_deposit");
  });
});

describe("what the customer puts down", () => {
  it("takes the business's percentage of the order", () => {
    const quote = quoteDeposit({
      business: {reservationDepositPct: 25},
      orderTotal: 220,
    });
    assert.equal(quote.deposit, 55);
    assert.equal(quote.balance, 165);
    assert.equal(quote.reason, "deposit_applies");
  });

  it("always leaves deposit plus balance equal to the order", () => {
    // The two numbers are shown side by side. If they do not add up the
    // customer is right not to trust either of them.
    for (const total of [10, 99.99, 220, 337.5, 1000]) {
      const quote = quoteDeposit({
        business: {reservationDepositPct: 30},
        orderTotal: total,
      });
      assert.equal(
          Math.round((quote.deposit + quote.balance) * 100) / 100,
          Math.round(total * 100) / 100,
          `total ${total}`,
      );
    }
  });

  it("rounds to the cent, so the quote is what gets charged", () => {
    const quote = quoteDeposit({
      business: {reservationDepositPct: 33},
      orderTotal: 99.99,
    });
    assert.equal(quote.deposit, 33);
    assert.equal(quote.balance, 66.99);
  });
});

describe("the platform's bounds", () => {
  it("clamps a stale setting above the ceiling when reading it", () => {
    // Reading someone else's saved data is where clamping is right - the
    // customer must not be quoted a deposit the platform would refuse.
    const policy = depositPolicy({reservationDepositPct: 90});
    assert.equal(policy.depositPct, MAX_DEPOSIT_PCT);
  });

  it("caps the deposit in dollars however large the order", () => {
    // A percentage that is fine on a $200 barrel order is not fine on a large
    // consignment. A deposit covers an empty slot; it does not finance a trip.
    const quote = quoteDeposit({
      business: {reservationDepositPct: 50},
      orderTotal: 4000,
    });
    assert.equal(quote.deposit, PLATFORM_MAX_DEPOSIT);
    assert.equal(quote.balance, 4000 - PLATFORM_MAX_DEPOSIT);
  });

  it("never asks for more than the order is worth", () => {
    const quote = quoteDeposit({
      business: {reservationDepositPct: 50},
      orderTotal: 12,
    });
    assert.ok(quote.deposit <= 12);
    assert.ok(quote.balance >= 0);
  });
});

describe("when a deposit is not worth taking", () => {
  it("takes nothing rather than a token amount", () => {
    // Stripe keeps roughly 2.9% + $0.30 on a refund. On a few dollars that is
    // most of the deposit, burned every time someone cancels inside the free
    // window - the exact waste this design exists to stop.
    const quote = quoteDeposit({
      business: {reservationDepositPct: 10},
      orderTotal: 40,
    });
    assert.ok(4 < MIN_WORTHWHILE_DEPOSIT);
    assert.equal(quote.deposit, 0);
    assert.equal(quote.balance, 40);
    assert.equal(quote.reason, "below_worthwhile_floor");
  });

  it("takes the deposit once it clears the floor", () => {
    const quote = quoteDeposit({
      business: {reservationDepositPct: 10},
      orderTotal: 200,
    });
    assert.equal(quote.deposit, 20);
    assert.equal(quote.reason, "deposit_applies");
  });
});

describe("saving the setting", () => {
  it("accepts a figure inside the bounds", () => {
    const result = validateDepositSettings({reservationDepositPct: 25});
    assert.equal(result.ok, true);
    assert.equal(result.reservationDepositPct, 25);
  });

  it("treats blank as no deposit", () => {
    for (const blank of [null, undefined, ""]) {
      const result = validateDepositSettings({reservationDepositPct: blank});
      assert.equal(result.ok, true, String(blank));
      assert.equal(result.reservationDepositPct, 0, String(blank));
    }
  });

  it("refuses too high rather than silently clamping", () => {
    // A business that types 80 must be told the limit is 50, not saved as 50
    // and left believing it charges 80.
    const result = validateDepositSettings({reservationDepositPct: 80});
    assert.equal(result.ok, false);
    assert.equal(result.error, "deposit_pct_too_high");
  });

  it("refuses nonsense", () => {
    for (const bad of [-5, "abc", NaN]) {
      const result = validateDepositSettings({reservationDepositPct: bad});
      assert.equal(result.ok, false, String(bad));
      assert.equal(result.error, "deposit_pct_invalid");
    }
  });
});

describe("no order to deposit against", () => {
  it("says so instead of quoting zero as though it were a policy", () => {
    for (const total of [0, -20, "abc", null]) {
      const quote = quoteDeposit({
        business: {reservationDepositPct: 25},
        orderTotal: total,
      });
      assert.equal(quote.deposit, 0, String(total));
      assert.equal(quote.reason, "no_order_total", String(total));
    }
  });
});

describe("setting it per service", () => {
  // A barrel leaving monthly and a car viewing next Tuesday are not the same
  // commitment, so a business can answer differently for each.
  const business = {
    reservationDepositPct: 10,
    cancellationCutoffDays: 2,
    serviceReservationDepositPct: {freight: 30, carParking: 0},
    serviceCancellationCutoffDays: {freight: 7},
  };

  it("uses this service's value when there is one", () => {
    assert.equal(depositPolicy(business, "freight").depositPct, 30);
    assert.equal(depositPolicy(business, "freight").cutoffDays, 7);
  });

  it("falls back to the blanket value when there is not", () => {
    assert.equal(depositPolicy(business, "barrelShipping").depositPct, 10);
    assert.equal(depositPolicy(business, "barrelShipping").cutoffDays, 2);
  });

  it("treats a per-service zero as a real answer, not as unset", () => {
    // "No deposit for parking" has to stop the chain. Falling through to the
    // blanket 10% would make the setting impossible to express.
    assert.equal(depositPolicy(business, "carParking").depositPct, 0);
    assert.equal(depositPolicy(business, "carParking").takesDeposit, false);
  });

  it("prices the same order differently per service", () => {
    const freight = quoteDeposit({business, service: "freight",
      orderTotal: 200});
    const barrel = quoteDeposit({business, service: "barrelShipping",
      orderTotal: 200});
    assert.equal(freight.deposit, 60);
    assert.equal(barrel.deposit, 20);
  });

  it("still bounds a per-service value the platform would refuse", () => {
    const stale = {serviceReservationDepositPct: {freight: 90}};
    assert.equal(depositPolicy(stale, "freight").depositPct, MAX_DEPOSIT_PCT);
  });
});

describe("when free cancellation ends", () => {
  const business = {cancellationCutoffDays: 3};
  const serviceAtMs = 1000 * DAY;

  it("ends the stated number of days before the service", () => {
    const window = freeCancellationWindow({
      business, serviceAtMs, nowMs: serviceAtMs - 10 * DAY,
    });
    assert.equal(window.cutoffAtMs, serviceAtMs - 3 * DAY);
    assert.equal(window.alreadyPast, false);
  });

  it("is over once the cutoff has passed", () => {
    const window = freeCancellationWindow({
      business, serviceAtMs, nowMs: serviceAtMs - 2 * DAY,
    });
    assert.equal(window.alreadyPast, true);
  });

  it("is already over for someone booking inside the window", () => {
    // Booking two days before a departure with a three-day cutoff means the
    // free window never existed. That has to be said at checkout, not
    // discovered at cancellation.
    const window = freeCancellationWindow({
      business, serviceAtMs, nowMs: serviceAtMs - 1 * DAY,
    });
    assert.equal(window.alreadyPast, true);
  });

  it("stays free until the service when no cutoff is set", () => {
    const window = freeCancellationWindow({
      business: {}, serviceAtMs, nowMs: serviceAtMs - 1 * DAY,
    });
    assert.equal(window.cutoffAtMs, serviceAtMs);
    assert.equal(window.alreadyPast, false);
    assert.equal(window.reason, "free_until_service");
  });
});

describe("saving per-service settings", () => {
  it("keeps a value for each service the platform knows", () => {
    const result = validateDepositSettings({
      serviceReservationDepositPct: {freight: 30, barrelShipping: 15},
      serviceCancellationCutoffDays: {freight: 7},
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.serviceReservationDepositPct,
        {freight: 30, barrelShipping: 15});
    assert.deepEqual(result.serviceCancellationCutoffDays, {freight: 7});
  });

  it("drops a service the platform does not offer this for", () => {
    // Storing a setting nothing will ever read is how stale config outlives
    // the feature that created it.
    const result = validateDepositSettings({
      serviceReservationDepositPct: {freight: 30, sharedBarrels: 20},
    });
    assert.equal(result.ok, true);
    assert.deepEqual(result.serviceReservationDepositPct, {freight: 30});
    assert.equal(DEPOSIT_SERVICES.includes("sharedBarrels"), false);
  });

  it("refuses a per-service value over the ceiling", () => {
    const result = validateDepositSettings({
      serviceReservationDepositPct: {freight: 80},
    });
    assert.equal(result.ok, false);
    assert.equal(result.error, "deposit_pct_too_high");
  });

  it("refuses a cutoff further out than anyone books", () => {
    const result = validateDepositSettings({cancellationCutoffDays: 60});
    assert.equal(result.ok, false);
    assert.equal(result.error, "cutoff_days_too_high");
    assert.equal(MAX_CUTOFF_DAYS, 30);
  });
});
