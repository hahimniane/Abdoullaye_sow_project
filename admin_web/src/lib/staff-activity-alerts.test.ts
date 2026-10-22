import assert from "node:assert/strict";
import test from "node:test";

import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import {
  adminTargetForNotification,
  businessTargetForNotification,
  customerTargetForNotification,
  focusFromNotification,
} from "./notification-routing.ts";
import {
  defaultNotificationPreferences,
  mergeNotificationPreferences,
  packageNotificationPreferenceFields,
  parkedCarNotificationPreferenceFields,
} from "./notification-preferences.ts";

// Staff activity alerts (functions staff_activity_alerts.js): "Car parked" /
// "Package saved" by someone else of the business, and their summaries.

test("a car parked by the team opens that car on Parking", () => {
  const data = {type: "parked_car", businessId: "b", parkedCarId: "pc-1",
    trackingCode: "PK-7Q2M", relatedCollection: "parkedCars", relatedId: "pc-1"};
  assert.deepEqual(businessTargetForNotification(data), {tab: "parking", focusId: "pc-1"});
  assert.deepEqual(focusFromNotification(data), {collection: "parkedCars", id: "pc-1"});
  // A summary names no car: the parking list.
  assert.deepEqual(businessTargetForNotification({type: "parked_car", summary: "true", count: "4"}),
      {tab: "parking", focusId: ""});
  // Only the business console acts on it.
  assert.deepEqual(adminTargetForNotification(data), {tab: "today"});
  assert.deepEqual(customerTargetForNotification(data), {tab: "home"});
});

test("a package saved by the team opens that package", () => {
  const data = {type: "container_line", businessId: "b", lineId: "line-1", containerId: "",
    trackingCode: "CL-K7M4P2", relatedCollection: "containerLines", relatedId: "line-1"};
  assert.deepEqual(businessTargetForNotification(data),
      {tab: "containers", focusId: "line-1", panelView: "line"});
  assert.deepEqual(businessTargetForNotification({type: "container_line", summary: "true", count: "12"}),
      {tab: "containers"});
});

test("both switches are on by default and saved as their own keys", () => {
  const defaults = defaultNotificationPreferences();
  assert.equal(defaults.parkedCarAlerts, true);
  assert.equal(defaults.packageAlerts, true);
  const saved = mergeNotificationPreferences({packageAlerts: false});
  assert.equal(saved.packageAlerts, false);
  assert.equal(saved.parkedCarAlerts, true);
  assert.deepEqual(parkedCarNotificationPreferenceFields.map((f) => f.key), ["parkedCarAlerts"]);
  assert.deepEqual(packageNotificationPreferenceFields.map((f) => f.key), ["packageAlerts"]);
});

test("the switches read in French", () => {
  for (const field of [...parkedCarNotificationPreferenceFields, ...packageNotificationPreferenceFields]) {
    for (const english of [field.label, field.hint]) {
      assert.ok(english in TEXT_TRANSLATIONS, english);
      assert.notEqual(translateValue(english, "fr"), english, english);
    }
  }
  assert.equal(translateValue("Cars parked by my team", "fr"), "Voitures garées par mon équipe");
  assert.equal(translateValue("Packages saved by my team", "fr"), "Colis enregistrés par mon équipe");
});
