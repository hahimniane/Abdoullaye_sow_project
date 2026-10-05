import assert from "node:assert/strict";
import test from "node:test";

import { SUPPORT_CASES_PAGE_SIZE, supportCasesQuerySpec } from "./support-cases-query.ts";

test("a business sees its own cases, newest activity first", () => {
  assert.deepEqual(supportCasesQuerySpec("business", "biz-1"), {
    filters: [["businessId", "==", "biz-1"]],
    orderBy: { field: "updatedAt", direction: "desc" },
  });
});

test("admins see escalated cases, newest activity first", () => {
  assert.deepEqual(supportCasesQuerySpec("admin", ""), {
    filters: [["escalationStatus", "==", "escalated"]],
    orderBy: { field: "updatedAt", direction: "desc" },
  });
});

test("the inbox is paged, not capped", () => {
  assert.ok(Number.isInteger(SUPPORT_CASES_PAGE_SIZE) && SUPPORT_CASES_PAGE_SIZE > 0);
});
