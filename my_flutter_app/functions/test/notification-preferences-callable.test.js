const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

describe("updateNotificationPreferences callable", () => {
  it("lets any authenticated user update only their notification " +
      "preferences, without requiring a valid fullName/phone", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    const fnMatch = source.match(
        new RegExp(
            "exports\\.updateNotificationPreferences = onCall\\(" +
            "[\\s\\S]*?\\n\\);\\n",
        ),
    );
    assert.ok(fnMatch, "updateNotificationPreferences export not found");
    const fnSource = fnMatch[0];

    // Business staff/owners and admins have no full-name/phone editing flow
    // on the web consoles, so this callable must not reuse
    // updateCustomerProfile's requireValidPhoneNumber/fullName-required
    // gates - those would reject every business/admin caller.
    assert.match(fnSource, /const uid = requireAuth\(request\);/);
    assert.doesNotMatch(fnSource, /requireValidPhoneNumber/);
    assert.doesNotMatch(fnSource, /invalid-argument/);
    assert.match(
        fnSource,
        new RegExp(
            "normalizeNotificationPreferences\\(\\s*" +
            "request\\.data\\?\\.notificationPreferences,?\\s*\\)",
        ),
    );
    assert.match(fnSource, /\.collection\("users"\)\.doc\(uid\)\.set\(\{/);
    assert.match(fnSource, /notificationPreferences,/);
  });
});
