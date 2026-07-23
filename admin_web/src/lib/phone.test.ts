import assert from "node:assert/strict";
import test from "node:test";

import { isValidE164, isValidPhone, normalizePhone } from "./phone.ts";

test("phone validation matches the mobile normalization contract", () => {
  assert.equal(normalizePhone("+1 (212) 555-0100"), "+12125550100");
  assert.equal(isValidE164("+1 (212) 555-0100"), true);
  assert.equal(isValidE164("2125550100"), false);
  assert.equal(isValidPhone("212-555-0100"), true);
  assert.equal(isValidPhone("call-me"), false);
});
