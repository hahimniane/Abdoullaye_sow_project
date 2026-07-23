import assert from "node:assert/strict";
import test from "node:test";

import {
  CALLING_CODE_OPTIONS,
  callingCodeOptionForPhone,
  composeInternationalPhone,
} from "./calling-code-catalog.ts";

test("web phone picker stays complete and aligned with mobile", () => {
  assert.ok(CALLING_CODE_OPTIONS.length >= 230);
  assert.equal(CALLING_CODE_OPTIONS[0].code, "US");
  assert.equal(
    callingCodeOptionForPhone("+224 620 00 00 00")?.code,
    "GN",
  );
  assert.equal(composeInternationalPhone("224", "620 00 00 00"), "+224620000000");
});
