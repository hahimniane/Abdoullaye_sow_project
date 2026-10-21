import assert from "node:assert/strict";
import {test} from "node:test";
import {revisionsToPrune} from "../prune-plan.mjs";

const rev = (name, service) =>
  ({metadata: {name, labels: {"serving.knative.dev/service": service}}});

test("keeps the serving revision and every revision traffic names", () => {
  const services = [
    {metadata: {name: "a"}, status: {latestReadyRevisionName: "a-3",
      traffic: [{revisionName: "a-2", percent: 10}, {percent: 90}]}},
    {metadata: {name: "b"}, status: {latestReadyRevisionName: "b-1"}},
  ];
  const plan = revisionsToPrune(services,
      [rev("a-1", "a"), rev("a-2", "a"), rev("a-3", "a"), rev("b-1", "b")]);
  assert.deepEqual(plan.delete, ["a-1"]);
  assert.equal(plan.kept, 3);
});

test("never touches a service whose serving revision is unknown", () => {
  const plan = revisionsToPrune(
      [{metadata: {name: "c"}, status: {}}],
      [rev("c-1", "c"), rev("c-2", "c")]);
  assert.deepEqual(plan.delete, []);
  assert.deepEqual(plan.skippedServices, ["c"]);
});

test("ignores revisions of services it was not shown", () => {
  const plan = revisionsToPrune([], [rev("x-1", "x")]);
  assert.deepEqual(plan.delete, []);
});
