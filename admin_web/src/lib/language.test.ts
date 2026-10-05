import assert from "node:assert/strict";
import test from "node:test";

import { currentWebLanguage, readStoredLanguage, storeLanguage } from "./language.ts";

function withWindow(storage: Partial<Storage>, run: () => void) {
  const scope = globalThis as unknown as { window?: unknown };
  const previous = scope.window;
  scope.window = { localStorage: storage };
  try {
    run();
  } finally {
    scope.window = previous;
  }
}

// Regression: with site data blocked, `localStorage.getItem` throws a
// SecurityError. currentWebLanguage() runs during render, so the throw blanked
// the whole console instead of falling back to the device language.
test("blocked storage falls back instead of throwing", () => {
  const blocked = {
    getItem() {
      throw new Error("SecurityError: The operation is insecure.");
    },
    setItem() {
      throw new Error("SecurityError: The operation is insecure.");
    },
  };
  withWindow(blocked, () => {
    assert.equal(readStoredLanguage(), null);
    assert.doesNotThrow(() => currentWebLanguage());
    assert.ok(["en", "fr"].includes(currentWebLanguage()));
    assert.equal(storeLanguage("fr"), false);
  });
});

test("a saved choice is read and written through storage", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
  };
  withWindow(storage, () => {
    assert.equal(storeLanguage("fr"), true);
    assert.equal(readStoredLanguage(), "fr");
    assert.equal(currentWebLanguage(), "fr");
  });
});
