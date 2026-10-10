import assert from "node:assert/strict";
import { test } from "node:test";

import { destinationIsInUse } from "./destination-visibility.ts";

test("a destination is listed when it is active, main, or has a service on", () => {
  assert.equal(destinationIsInUse({ isActive: true }, false), true);
  assert.equal(destinationIsInUse({ isMain: true }, false), true);
  assert.equal(destinationIsInUse({}, true), true);
});

test("a seeded, paused country with nothing configured is hidden by default", () => {
  assert.equal(destinationIsInUse({ isActive: false }, false), false);
  assert.equal(destinationIsInUse({}, false), false);
  assert.equal(destinationIsInUse({ isActive: "yes", isMain: 1 }, false), false);
});
