import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createSessionGate } from "./auth-session-gate.ts";

// Regression: signing out left the previous user's live profile listener
// subscribed, and a profile load that resolved after sign-out wrote the old
// profile back into the router.
test("a new auth session stops the previous session's listener", () => {
  const gate = createSessionGate();
  const signedIn = gate.begin();
  let stopped = 0;
  gate.follow(signedIn, () => {
    stopped += 1;
  });
  assert.equal(stopped, 0);

  const signedOut = gate.begin();
  assert.equal(stopped, 1);
  assert.equal(signedIn(), false);
  assert.equal(signedOut(), true);
});

test("a load that finishes after sign-out is ignored and its listener dropped", () => {
  const gate = createSessionGate();
  const slowSession = gate.begin();
  gate.begin(); // sign-out while the profile was still loading
  assert.equal(slowSession(), false);

  let stopped = 0;
  gate.follow(slowSession, () => {
    stopped += 1;
  });
  assert.equal(stopped, 1, "a listener from an ended session is unsubscribed at once");
});

test("closing the gate ends the session and its listener", () => {
  const gate = createSessionGate();
  const session = gate.begin();
  let stopped = 0;
  gate.follow(session, () => {
    stopped += 1;
  });
  gate.close();
  assert.equal(stopped, 1);
  assert.equal(session(), false);
  gate.close();
  assert.equal(stopped, 1, "never unsubscribes twice");
});

test("the console router gates every profile write on the session", () => {
  const source = readFileSync("src/components/console-router.tsx", "utf8");
  assert.match(source, /const isCurrent = gate\.begin\(\);/);
  assert.match(source, /if \(!active \|\| !isCurrent\(\)\) return;/);
  assert.match(source, /gate\.follow\(isCurrent, follow\);/);
  assert.match(source, /gate\.close\(\);/);
});
