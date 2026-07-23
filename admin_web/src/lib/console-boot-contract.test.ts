import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { translateValue } from "./french-dom.ts";

const source = readFileSync("src/components/console-router.tsx", "utf8");

test("console profile loading has a timeout and session-preserving retry", () => {
  assert.match(source, /PROFILE_LOAD_TIMEOUT_MS = 15_000/);
  assert.match(source, /Promise\.race/);
  assert.match(source, /setProfileRetry\(\(value\) => value \+ 1\)/);
  assert.match(source, /Retry without signing out or losing your session\./);
  assert.match(source, /if \(firebaseUser && authError\)/);
});

test("console loading failures use localized human-readable copy", () => {
  assert.equal(
    translateValue(
      "The connection is slow. We could not safely load your account role.",
      "fr",
    ),
    "La connexion est lente. Nous n’avons pas pu charger votre rôle de compte en toute sécurité.",
  );
  assert.equal(
    translateValue("We could not open your console", "fr"),
    "Nous n’avons pas pu ouvrir votre console",
  );
});

test("customer accounts enter the dedicated customer console", () => {
  assert.match(source, /import \{ CustomerConsole \}/);
  assert.match(source, /consoleKind === "customer"/);
  assert.match(source, /<CustomerConsole/);
});
