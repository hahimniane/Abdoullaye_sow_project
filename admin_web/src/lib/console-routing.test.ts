import assert from "node:assert/strict";
import test from "node:test";

import { resolveConsoleKind } from "./console-routing.ts";

test("routes every supported account role to its own console", () => {
  assert.equal(resolveConsoleKind("admin"), "admin");
  assert.equal(resolveConsoleKind("businessOwner"), "business");
  assert.equal(resolveConsoleKind("staff"), "business");
  assert.equal(resolveConsoleKind("customer"), "customer");
});

test("fails closed for missing and unknown account roles", () => {
  assert.equal(resolveConsoleKind(undefined), "unsupported");
  assert.equal(resolveConsoleKind(null), "unsupported");
  assert.equal(resolveConsoleKind("owner"), "unsupported");
  assert.equal(resolveConsoleKind(""), "unsupported");
});
