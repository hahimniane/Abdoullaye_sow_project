"use strict";

// Fleet in each team member's copy of the services (docs/FLEET.md
// section 17): the app reads users/{uid}.businessServices.

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {servicesWithFleet, memberServicesStale, keepFleetOnProfileSave} =
  require("../fleet_member_services");

describe("servicesWithFleet", () => {
  it("adds Fleet when the switch is on", () => {
    assert.deepEqual(servicesWithFleet(["barrelShipping"], true),
        ["barrelShipping", "fleet"]);
  });
  it("drops Fleet when the switch is off, even if listed", () => {
    assert.deepEqual(servicesWithFleet(["fleet", "freight"], false),
        ["freight"]);
  });
  it("never lists Fleet twice", () => {
    assert.deepEqual(servicesWithFleet(["fleet", "freight"], true),
        ["freight", "fleet"]);
  });
  it("copes with nothing", () => {
    assert.deepEqual(servicesWithFleet(undefined, true), ["fleet"]);
  });
});

describe("memberServicesStale", () => {
  it("a copy without Fleet is stale (Landa, 2026-11-27)", () => {
    assert.equal(memberServicesStale(["barrelShipping"],
        ["barrelShipping", "fleet"]), true);
  });
  it("order does not matter", () => {
    assert.equal(memberServicesStale(["fleet", "freight"],
        ["freight", "fleet"]), false);
  });
  it("a missing copy is stale", () => {
    assert.equal(memberServicesStale(undefined, ["fleet"]), true);
  });
  it("an extra service is stale", () => {
    assert.equal(memberServicesStale(["fleet", "inventory"], ["fleet"]),
        true);
  });
});

describe("keepFleetOnProfileSave", () => {
  it("a form without Fleet cannot drop it", () => {
    assert.deepEqual(keepFleetOnProfileSave(["barrelShipping"],
        {fleet: {enabled: true}}), ["barrelShipping", "fleet"]);
  });
  it("a form cannot add Fleet to a business without it", () => {
    assert.deepEqual(keepFleetOnProfileSave(["barrelShipping", "fleet"],
        {}), ["barrelShipping"]);
  });
});

describe("the wiring, read from the source", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const index = fs.readFileSync(path.join(__dirname, "../index.js"), "utf8");
  const handlers = fs.readFileSync(
      path.join(__dirname, "../fleet_handlers.js"), "utf8");
  it("a profile save keeps Fleet as it was", () => {
    const fn = index.slice(index.indexOf("exports.updateBusinessProfile"));
    assert.match(fn.slice(0, 8000), /keepFleetOnProfileSave\(/);
  });
  it("the switch and the 15-minute tick bring the team in step", () => {
    const at = (name) => handlers.slice(handlers.indexOf(name));
    const enable = at("async function setEnabled");
    assert.match(enable.slice(0, 1500), /syncMemberServices\(/);
    const tick = at("async function fleetBankTick");
    assert.match(tick.slice(0, 4000), /syncMemberServices\(/);
  });
});
