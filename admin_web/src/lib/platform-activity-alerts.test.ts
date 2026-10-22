import assert from "node:assert/strict";
import test from "node:test";

import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import {
  adminTargetForNotification,
  customerTargetForNotification,
} from "./notification-routing.ts";
import {
  defaultNotificationPreferences,
  mergeNotificationPreferences,
  platformActivityNotificationPreferenceFields,
  receivesPlatformActivityAlerts,
} from "./notification-preferences.ts";

// Platform activity alerts (functions platform_activity_alerts.js): platform
// admins hear about cars parked, packages saved and shop sales in every
// business, and about someone joining a business as staff.

test("a platform activity alert opens that business on Businesses", () => {
  const data = {type: "platform_activity", businessId: "biz-1", kind: "car",
    summary: "false", relatedCollection: "parkedCars", relatedId: "pc-1"};
  assert.deepEqual(adminTargetForNotification(data), {tab: "businesses", businessId: "biz-1"});
  // A 10-minute summary names the business too, no record.
  assert.deepEqual(
      adminTargetForNotification({type: "platform_activity", businessId: "biz-2", kind: "", summary: "true"}),
      {tab: "businesses", businessId: "biz-2"});
  // No business id: the list as it is.
  assert.deepEqual(adminTargetForNotification({type: "platform_activity"}),
      {tab: "businesses", businessId: ""});
  // The customer console never routes it anywhere special.
  assert.deepEqual(customerTargetForNotification(data), {tab: "home"});
});

test("someone joining a business opens that business", () => {
  assert.deepEqual(
      adminTargetForNotification({type: "business_member_joined", businessId: " biz-3 ", uid: "u-1"}),
      {tab: "businesses", businessId: "biz-3"});
});

test("the platform activity switch is on by default and saved as its own key", () => {
  assert.equal(defaultNotificationPreferences().platformActivity, true);
  const off = mergeNotificationPreferences({platformActivity: false});
  assert.equal(off.platformActivity, false);
  // Switching it off leaves every other preference as it was.
  assert.equal(off.parkedCarAlerts, true);
  assert.equal(mergeNotificationPreferences({packageAlerts: false}).platformActivity, true);
  assert.equal(mergeNotificationPreferences(undefined).platformActivity, true);
  assert.deepEqual(platformActivityNotificationPreferenceFields.map((f) => f.key), ["platformActivity"]);
});

test("only super admins and operations managers get the switch", () => {
  assert.equal(receivesPlatformActivityAlerts("admin", "superAdmin"), true);
  assert.equal(receivesPlatformActivityAlerts("admin", "operationsManager"), true);
  assert.equal(receivesPlatformActivityAlerts("admin", "financeManager"), false);
  assert.equal(receivesPlatformActivityAlerts("admin", "supportAdmin"), false);
  assert.equal(receivesPlatformActivityAlerts("admin", undefined), false);
  // An adminRole left on a non-admin account does not count.
  assert.equal(receivesPlatformActivityAlerts("businessOwner", "superAdmin"), false);
});

test("the switch reads in French", () => {
  const english = [
    "My alerts",
    "Platform activity alerts on",
    "Platform activity alerts off",
    ...platformActivityNotificationPreferenceFields.flatMap((f) => [f.label, f.hint]),
  ];
  for (const value of english) {
    assert.ok(value in TEXT_TRANSLATIONS, value);
    assert.notEqual(translateValue(value, "fr"), value, value);
  }
  assert.equal(translateValue("My alerts", "fr"), "Mes alertes");
  assert.equal(translateValue("Platform activity", "fr"), "Activité de la plateforme");
});
