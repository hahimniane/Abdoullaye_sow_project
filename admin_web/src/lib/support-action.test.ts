import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { executeSupportAction } from "./support-action.ts";

describe("executeSupportAction", () => {
  it("reports a successful mutation", async () => {
    const result = await executeSupportAction("Support request sent", async () => {});

    assert.deepEqual(result, { completed: true, error: "" });
  });

  it("preserves the failure when the console action runner swallows it", async () => {
    const result = await executeSupportAction(
      "Support request sent",
      async () => {
        throw new Error("Service unavailable");
      },
      async (_label, action) => {
        try {
          await action();
        } catch {
          // Mirrors the console runner: it shows a toast and resolves.
        }
      },
    );

    assert.deepEqual(result, {
      completed: false,
      error: "Service unavailable",
    });
  });

  it("reports a runner failure even when the mutation never starts", async () => {
    const result = await executeSupportAction(
      "Support request sent",
      async () => {
        throw new Error("should not run");
      },
      async () => {
        throw new Error("Runner unavailable");
      },
    );

    assert.deepEqual(result, {
      completed: false,
      error: "Runner unavailable",
    });
  });
});
