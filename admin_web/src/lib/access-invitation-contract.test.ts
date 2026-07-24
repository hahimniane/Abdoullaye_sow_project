import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {test} from "node:test";

import {translateValue} from "./french-dom.ts";

const source = readFileSync(
  new URL("../components/console-router.tsx", import.meta.url),
  "utf8",
);

test("a signed-in invited user can verify and activate access without a profile", () => {
  assert.match(source, /profileMissing/);
  assert.match(source, /<AccessInvitationSetup/);
  assert.match(source, /sendEmailVerification/);
  assert.match(source, /currentUser\.reload\(\)/);
  assert.match(source, /getIdToken\(true\)/);
  assert.match(source, /"acceptAccessInvitation"/);
  assert.match(source, /onActivated/);
  assert.match(source, /activationInFlight/);
  assert.match(source, /verificationCooldown/);
  assert.match(source, /recoveredProfile\.exists\(\)/);
  assert.match(source, /disabled=\{Boolean\(busy\)\}/);
});

test("invitation activation copy is bilingual", () => {
  for (const label of [
    "Invitation security",
    "Finish setting up your access",
    "Password created",
    "Verify invited email",
    "Activate assigned access",
    "Activate my access",
    "I verified — continue",
    "Sign out and use another account",
    "No active invitation was found for this account. Ask the sender to resend it.",
    "More than one active invitation was found. Ask Laawol support to choose the correct access.",
    "This invitation has expired or was cancelled. Ask the sender to resend it.",
  ]) {
    assert.notEqual(
      translateValue(label, "fr"),
      label,
      `missing French translation for "${label}"`,
    );
  }
});
