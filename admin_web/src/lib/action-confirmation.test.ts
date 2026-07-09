import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { confirmationMessage } from "./action-confirmation.ts";

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
