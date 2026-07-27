const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

describe("service status notification triggers", () => {
  it("notifies a customer when their parking reservation " +
      "status changes", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    // Every other service (cars, barrels, freight, wallet, business
    // applications) has a Firestore trigger that calls
    // sendPreferenceNotification on a status change - parking reservations
    // previously had none, so a customer got no push/email/SMS at all when
    // their reservation was confirmed, completed, or cancelled.
    const triggerMatch = source.match(
        new RegExp(
            "exports\\.notifyParkingReservationStatus =\\s*" +
            "onDocumentUpdated\\(\\s*\\n[\\s\\S]*?\\n\\);\\n",
        ),
    );
    assert.ok(
        triggerMatch,
        "notifyParkingReservationStatus trigger not found",
    );
    const triggerSource = triggerMatch[0];
    assert.match(triggerSource, /"parkedCars\/\{reservationId\}"/);
    assert.match(triggerSource, /if \(!statusChanged\(event\)\) return;/);
    assert.match(
        triggerSource,
        /userIdFrom\(after, \["customerUid", "ownerUid", "uid"\]\)/,
    );
    assert.match(triggerSource, /preferenceKey: "carActivity"/);
    assert.match(triggerSource, /type: "parking_reservation_status"/);
  });

  it("writes an in-app notification record for every preference-gated " +
      "notification, ahead of the push-only gates", () => {
    const source = fs.readFileSync(
        path.join(__dirname, "..", "index.js"),
        "utf8",
    );
    const fnMatch = source.match(
        new RegExp(
            "async function sendPreferenceNotification\\(\\{" +
            "[\\s\\S]*?\\n\\}\\n",
        ),
    );
    assert.ok(fnMatch, "sendPreferenceNotification not found");
    const fnSource = fnMatch[0];

    const prefGateIndex = fnSource.indexOf(
        "if (prefs[preferenceKey] === false) return;",
    );
    const platformGateIndex = fnSource.indexOf(
        "if (!platformNotificationEnabled(settings, preferenceKey, " +
        "settingKey)) return;",
    );
    const inAppWriteIndex = fnSource.indexOf(
        ".collection(\"notifications\").doc().set(",
    );
    const pushOnlyGateIndex = fnSource.indexOf(
        "if (settings.pushEnabled === false || " +
        "prefs.pushNotifications === false) {",
    );

    // Every early-return here bypasses ALL notification types for this
    // event, so an in-app bell record must never be written if reached; a
    // record written before these gates would show a notification to a user
    // who explicitly disabled that category (or the platform disabled it).
    assert.ok(prefGateIndex >= 0, "category preference gate not found");
    assert.ok(platformGateIndex >= 0, "platform-enabled gate not found");
    assert.ok(inAppWriteIndex >= 0, "in-app notification write not found");
    // Push-token delivery failing/being disabled must not hide the event
    // from the in-app bell - only category/platform gates should apply.
    assert.ok(pushOnlyGateIndex >= 0, "push-only gate not found");
    assert.ok(
        prefGateIndex < inAppWriteIndex &&
        platformGateIndex < inAppWriteIndex,
        "in-app notification write must come after the category/platform " +
        "gates",
    );
    assert.ok(
        inAppWriteIndex < pushOnlyGateIndex,
        "in-app notification write must come before the push-only gate " +
        "so disabling push doesn't hide the in-app bell entry",
    );
    assert.match(fnSource, /read: false,/);
    assert.match(
        fnSource,
        /createdAt: FirestoreFieldValue\.serverTimestamp\(\)/,
    );
  });
});
