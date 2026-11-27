import assert from "node:assert/strict";
import test from "node:test";

import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { businessTargetForNotification } from "./notification-routing.ts";
import {
  fleetAlertsChoices,
  fleetAlertsHint,
  fleetAlertsLabel,
  fleetAlertsLevel,
} from "./notification-preferences.ts";

// Fleet alerts to admins, console side (docs/FLEET.md section 18). Made-up data.

const alert = (extra: Record<string, string>) => ({ type: "fleet_alert", businessId: "b", ...extra });

test("what needs the person opens Needs you", () => {
  for (const fleetKind of ["deposit_waiting", "claim_needs_office", "bank_took_back"]) {
    assert.deepEqual(
      businessTargetForNotification(alert({ fleetKind, fleetTab: "needs", driverId: "d1" })),
      { tab: "fleet" },
      fleetKind,
    );
  }
});

test("a new plate opens that plate, a new driver that driver", () => {
  assert.deepEqual(
    businessTargetForNotification(alert({ fleetKind: "plate_added", fleetTab: "plates", carId: "c1" })),
    { tab: "fleetCars", focusId: "c1" },
  );
  assert.deepEqual(businessTargetForNotification(alert({ fleetKind: "plate_added" })), { tab: "fleetCars" });
  assert.deepEqual(
    businessTargetForNotification(alert({ fleetKind: "driver_added", fleetTab: "drivers", driverId: "d1" })),
    { tab: "fleetDrivers", focusId: "d1" },
  );
});

test("a payment opens its driver, or Payments with none; a bank check opens Payments", () => {
  assert.deepEqual(
    businessTargetForNotification(alert({ fleetKind: "payment_recorded", driverId: "d2", paymentId: "p1" })),
    { tab: "fleetDrivers", focusId: "d2" },
  );
  assert.deepEqual(businessTargetForNotification(alert({ fleetKind: "payment_recorded" })), { tab: "fleetPayments" });
  assert.deepEqual(businessTargetForNotification(alert({ fleetKind: "bank_matched" })), { tab: "fleetPayments" });
});

test("an unknown kind follows fleetTab, then Needs you", () => {
  assert.deepEqual(businessTargetForNotification(alert({ fleetKind: "new_thing", fleetTab: "paperwork" })), {
    tab: "fleetPaperwork",
  });
  assert.deepEqual(businessTargetForNotification(alert({ fleetKind: "new_thing" })), { tab: "fleet" });
});

test("the setting reads everything when missing or unknown", () => {
  assert.equal(fleetAlertsLevel(undefined), "all");
  assert.equal(fleetAlertsLevel({}), "all");
  assert.equal(fleetAlertsLevel({ fleetAlerts: "sometimes" }), "all");
  assert.equal(fleetAlertsLevel({ fleetAlerts: "needs" }), "needs");
  assert.equal(fleetAlertsLevel({ fleetAlerts: "off" }), "off");
  assert.deepEqual(fleetAlertsChoices.map((c) => c.value), ["all", "needs", "off"]);
});

test("the setting reads in French", () => {
  for (const english of [fleetAlertsLabel, fleetAlertsHint, ...fleetAlertsChoices.map((c) => c.label)]) {
    assert.ok(english in TEXT_TRANSLATIONS, english);
    assert.notEqual(translateValue(english, "fr"), english, english);
  }
});
