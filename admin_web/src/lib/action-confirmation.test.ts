import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { confirmationIsFinal, confirmationMessage } from "./action-confirmation.ts";

describe("action confirmation copy", () => {
  it("uses English confirmation copy for English users", () => {
    assert.equal(
      confirmationMessage("Sign out?", "Se déconnecter ?", "en"),
      "Sign out?",
    );
  });

  it("uses French confirmation copy for French users", () => {
    assert.equal(
      confirmationMessage("Sign out?", "Se déconnecter ?", "fr"),
      "Se déconnecter ?",
    );
  });

  it("falls back to English when a French override is not supplied", () => {
    assert.equal(
      confirmationMessage("Approve this business?", undefined, "fr"),
      "Approve this business?",
    );
  });
});

// 2026-11-20: a French confirm text that named a driver was translated a
// second time by the page translator ("Made Up Eight" -> "Made Monter Eight").
it("a message already in the reader's language is not translated again", () => {
  assert.equal(confirmationIsFinal("Donner ce dépôt à Made Up Eight ?", "fr"), true);
  assert.equal(confirmationIsFinal("Donner ce dépôt à Made Up Eight ?", "en"), true);
  assert.equal(confirmationIsFinal(undefined, "en"), true);
  // English shown to a French reader: the translator still has to do it.
  assert.equal(confirmationIsFinal(undefined, "fr"), false);
  assert.equal(confirmationIsFinal("", "fr"), false);
});
