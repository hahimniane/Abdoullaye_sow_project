import assert from "node:assert/strict";
import { test } from "node:test";

import { isGenericOfficeDropOffAddress } from "./office-drop-off.ts";

test("treats empty and sentinel office labels as generic", () => {
  assert.equal(isGenericOfficeDropOffAddress(""), true);
  assert.equal(isGenericOfficeDropOffAddress("the business office"), true);
  assert.equal(isGenericOfficeDropOffAddress("Drop-off office"), true);
});

test("keeps a headquarters street as a real drop-off address", () => {
  assert.equal(
    isGenericOfficeDropOffAddress("12 Kaloum Street, Conakry, Guinea"),
    false,
  );
});
