"use strict";

// "Full access" staff (docs/STAFF_FULL_ACCESS.md): owner-level rights in
// one business, granted only by its real owner or a super admin.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  FULL_ACCESS_MESSAGES, effectiveUser, fullAccessGrantRefusal,
} = require("../staff_full_access");
const {bankRoleOf} = require("../zelle_check");

const staff = (extra = {}) => ({id: "s1", role: "staff", businessId: "b1",
  businessPermissions: ["parking"], ...extra});
const owner = {id: "o1", role: "businessOwner", businessId: "b1"};

describe("who counts as the owner", () => {
  it("a full-access staff member acts as the owner of their business", () => {
    const user = effectiveUser(staff({fullAccess: true}));
    assert.equal(user.role, "businessOwner");
    assert.equal(user.storedRole, "staff");
    assert.equal(user.businessId, "b1");
  });

  it("nobody else changes", () => {
    for (const user of [staff(), staff({fullAccess: false}),
      staff({fullAccess: "true"}), staff({fullAccess: true, businessId: ""}),
      owner, {role: "customer", fullAccess: true},
      {role: "admin", fullAccess: true}, null]) {
      assert.equal(effectiveUser(user), user);
    }
  });
});

describe("who may give full access", () => {
  const target = staff();
  it("the real owner of the business, or a super admin", () => {
    assert.equal(fullAccessGrantRefusal({caller: owner, superAdmin: false,
      businessId: "b1", staff: target}), "");
    assert.equal(fullAccessGrantRefusal({caller: {role: "admin"},
      superAdmin: true, businessId: "b1", staff: target}), "");
  });

  it("never a full-access staff member, ordinary staff or another owner",
      () => {
        const actingOwner = effectiveUser(staff({id: "s2", fullAccess: true}));
        for (const caller of [actingOwner, staff({id: "s3"}),
          {...owner, businessId: "b2"}, {role: "admin"}]) {
          assert.equal(fullAccessGrantRefusal({caller, superAdmin: false,
            businessId: "b1", staff: target}), "full_access_owner_only",
          JSON.stringify(caller));
        }
        // Not even for themselves.
        assert.equal(fullAccessGrantRefusal({caller: actingOwner,
          superAdmin: false, businessId: "b1",
          staff: staff({id: "s2", fullAccess: true})}),
        "full_access_owner_only");
      });

  it("only for staff of that business", () => {
    for (const target2 of [owner, staff({businessId: "b2"}),
      {role: "customer"}, null]) {
      assert.equal(fullAccessGrantRefusal({caller: owner, superAdmin: false,
        businessId: "b1", staff: target2}), "full_access_staff_only");
    }
    assert.ok(FULL_ACCESS_MESSAGES.full_access_owner_only);
    assert.ok(FULL_ACCESS_MESSAGES.full_access_staff_only);
  });
});

describe("what stays the real owner's", () => {
  it("connecting the bank: full access is staff there", () => {
    const business = {ownerUid: "o1"};
    assert.equal(bankRoleOf({uid: "o1", businessId: "b1", business,
      user: owner}), "owner");
    assert.equal(bankRoleOf({uid: "s1", businessId: "b1", business,
      user: effectiveUser(staff({fullAccess: true}))}), "staff");
    assert.equal(bankRoleOf({uid: "s1", businessId: "b1", business,
      user: effectiveUser(staff({fullAccess: true, businessPermissions: []}))}),
    "staff");
  });
});
