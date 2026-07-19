import assert from "node:assert/strict";
import {test} from "node:test";

import {
  assessPaymentFunctionDeployment,
  discoverStripeBoundFunctionNames,
  stripeBoundFunctionNames,
} from "../payment-functions-lib.mjs";

function endpoint(...secretNames) {
  return {
    __endpoint: {
      secretEnvironmentVariables: secretNames.map((key) => ({key})),
    },
  };
}

test("derives every Stripe-bound callable, webhook, and schedule from metadata", () => {
  const exports = {
    ordinaryCallable: endpoint("ANTHROPIC_API_KEY"),
    createPayment: endpoint("STRIPE_SECRET_KEY"),
    paymentWebhook: endpoint("STRIPE_WEBHOOK_SECRET", "STRIPE_SECRET_KEY"),
    reconcilePayments: endpoint("STRIPE_SECRET_KEY"),
  };

  assert.deepEqual(stripeBoundFunctionNames(exports), [
    "createPayment",
    "paymentWebhook",
    "reconcilePayments",
  ]);
  assert.deepEqual(discoverStripeBoundFunctionNames({
    functionsEntry: "/fixture/functions/index.js",
    loadModule: (entry) => {
      assert.match(entry, /fixture\/functions\/index\.js$/);
      return exports;
    },
  }), [
    "createPayment",
    "paymentWebhook",
    "reconcilePayments",
  ]);
});

test("fails closed when a Stripe-bound source export is missing or inactive", () => {
  const assessment = assessPaymentFunctionDeployment({
    requiredFunctionNames: [
      "completeFreightSettlementPayment",
      "confirmFreightShipmentWeight",
      "createFreightSettlementPayment",
      "reconcileStaleStripePayments",
      "retryFreightSettlementRefunds",
    ],
    deployedFunctions: [
      {id: "confirmFreightShipmentWeight", state: "ACTIVE"},
      {id: "reconcileStaleStripePayments", state: "FAILED"},
    ],
  });

  assert.equal(assessment.ok, false);
  assert.deepEqual(assessment.missing, [
    "completeFreightSettlementPayment",
    "createFreightSettlementPayment",
    "retryFreightSettlementRefunds",
  ]);
  assert.deepEqual(assessment.inactive, ["reconcileStaleStripePayments"]);
  assert.match(assessment.detail, /completeFreightSettlementPayment/);
  assert.match(assessment.detail, /inactive: reconcileStaleStripePayments/);
});

test("passes only when every derived function is deployed and active", () => {
  const assessment = assessPaymentFunctionDeployment({
    requiredFunctionNames: ["paymentWebhook", "createPayment"],
    deployedFunctions: [
      {id: "paymentWebhook", state: "ACTIVE"},
      {name: "projects/demo/locations/us/functions/createPayment", state: "ACTIVE"},
    ],
  });

  assert.equal(assessment.ok, true);
  assert.equal(assessment.detail, "2/2 Stripe-bound functions deployed and ACTIVE");
});

test("fails closed when source discovery returns no Stripe functions", () => {
  const assessment = assessPaymentFunctionDeployment({
    requiredFunctionNames: [],
    deployedFunctions: [],
  });

  assert.equal(assessment.ok, false);
  assert.match(assessment.detail, /no Stripe-bound source exports found/);
});
