// The limits that actually stopped two deploys on 2026-08-07, and the batching
// that keeps inside them.
//
// The first version of this file tested the wrong model: a "reserved CPU"
// figure summed from cpu x maxInstances, against an assumed 4,000 ceiling.
// Cloud Run enforces no such quota. These tests are written against the values
// read off the project's own quota page - 20,000 MILLI vCPU and 4,000 active
// revisions in us-central1 - so a future reader can check them against the
// console rather than trusting the arithmetic.

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_ACTIVE_REVISION_LIMIT,
  DEFAULT_CPU_LIMIT_MILLI,
  DEFAULT_FUNCTION_CPU_MILLI,
  batchFunctionNames,
  revisionCapacity,
  safeDeployBatchSize,
} from "../cloud-run-capacity-lib.mjs";

test("the measured quota values are the ones being defended", () => {
  // If these drift from the console, every number below is meaningless.
  assert.equal(DEFAULT_CPU_LIMIT_MILLI, 20000, "20 vCPU, expressed in milli");
  assert.equal(DEFAULT_ACTIVE_REVISION_LIMIT, 4000);
  assert.equal(DEFAULT_FUNCTION_CPU_MILLI, 1000, "1 vCPU per starting container");
});

test("a batch leaves room for the traffic already being served", () => {
  // 20 vCPU total, 60% of it for the rollout, 1 vCPU per starting container.
  assert.equal(safeDeployBatchSize(), 12);
});

test("the batch size follows the quota, not the function count", () => {
  assert.equal(safeDeployBatchSize({cpuLimitMilli: 40000}), 24);
  assert.equal(safeDeployBatchSize({safetyFraction: 1}), 20);
  assert.equal(safeDeployBatchSize({perFunctionMilli: 500}), 24);
});

test("a batch is never zero, however tight the ceiling", () => {
  // Deploying nothing is not a safe outcome, it is a stuck one.
  assert.equal(safeDeployBatchSize({cpuLimitMilli: 100}), 1);
  assert.equal(safeDeployBatchSize({safetyFraction: 0.001}), 1);
});

test("unusable overrides fall back to the measured values", () => {
  assert.equal(safeDeployBatchSize({cpuLimitMilli: 0}), 12);
  assert.equal(safeDeployBatchSize({cpuLimitMilli: -5}), 12);
  assert.equal(safeDeployBatchSize({safetyFraction: 4}), 12);
  assert.equal(safeDeployBatchSize({perFunctionMilli: NaN}), 12);
});

test("every function lands in exactly one batch", () => {
  const names = Array.from({length: 175}, (_, index) => `fn${index}`);
  const batches = batchFunctionNames(names, 12);
  assert.equal(batches.length, 15);
  assert.equal(batches.flat().length, 175, "nothing dropped");
  assert.deepEqual(new Set(batches.flat()).size, 175, "nothing duplicated");
  assert.ok(
      batches.every((batch) => batch.length <= 12),
      "no batch exceeds the ceiling",
  );
});

test("batching an empty or junk list produces no batches", () => {
  assert.deepEqual(batchFunctionNames([], 12), []);
  assert.deepEqual(batchFunctionNames(undefined, 12), []);
  assert.deepEqual(batchFunctionNames([null, "", "a"], 12), [["a"]]);
});

test("the deploy that broke production would be refused", () => {
  // 4,605 revisions had accumulated against a 4,000 limit before anything was
  // deployed. This is the check that would have said so first.
  const verdict = revisionCapacity({activeRevisions: 4605, functionCount: 175});
  assert.equal(verdict.fits, false);
  assert.match(verdict.remedy, /prune/);
});

test("a pruned project has room for a full deploy", () => {
  const verdict = revisionCapacity({activeRevisions: 175, functionCount: 175});
  assert.equal(verdict.fits, true);
  assert.equal(verdict.projected, 350);
  assert.equal(verdict.headroom, 3650);
  assert.equal(verdict.remedy, "");
});

test("the revision check counts the incoming revisions, not just the held", () => {
  // One revision per function is created and the old ones stay until pruned.
  const verdict = revisionCapacity({activeRevisions: 3900, functionCount: 175});
  assert.equal(verdict.fits, false);
  assert.equal(verdict.projected, 4075);
});

test("missing numbers read as zero rather than throwing", () => {
  const verdict = revisionCapacity({});
  assert.equal(verdict.fits, true);
  assert.equal(verdict.projected, 0);
});
