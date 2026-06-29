const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const {describe, it} = require("node:test");

const STRIPE_CALLABLES = [
  "createBarrelPool",
  "requestJoinBarrelPool",
  "completeBarrelPoolDepositPayment",
  "cancelPendingBarrelPoolDeposit",
  "createBarrelPoolBalancePaymentIntent",
  "completeBarrelPoolBalancePayment",
  "createBarrelShipmentPaymentIntent",
  "createBarrelOrderPaymentIntent",
  "completeBarrelShipmentPayment",
  "completeBarrelOrderPayment",
  "cancelPendingBarrelShipment",
  "cancelPendingBarrelOrder",
  "createBusinessStripeAccountLink",
  "refreshBusinessStripeAccountStatus",
  "createCarDepositPaymentIntent",
  "createCarPurchasePaymentIntent",
  "completeCarPurchase",
  "cancelPendingCarPurchase",
  "completeCarDepositReservation",
  "createPaidHoldExtensionPaymentIntent",
  "completePaidHoldExtensionPayment",
];

describe("payment runtime configuration", () => {
  it("declares Stripe secrets on real-payment callables", () => {
    const script = `
      process.env.GCLOUD_PROJECT = "demo-test";
      const functions = require("./index");
      const names = ${JSON.stringify(STRIPE_CALLABLES)};
      const result = Object.fromEntries(names.map((name) => {
        const endpoint = functions[name].__endpoint || {};
        const secrets = endpoint.secretEnvironmentVariables || [];
        return [name, secrets.map((secret) => secret.key)];
      }));
      process.stdout.write(JSON.stringify(result));
    `;
    const output = execFileSync(process.execPath, ["-e", script], {
      cwd: __dirname + "/..",
      env: {
        ...process.env,
        GCLOUD_PROJECT: "demo-test",
        SIMULATE_PAYMENTS: "false",
      },
      encoding: "utf8",
    });
    const secretsByCallable = JSON.parse(output);
    for (const name of STRIPE_CALLABLES) {
      assert.deepEqual(secretsByCallable[name], ["STRIPE_SECRET_KEY"], name);
    }
  });
});
