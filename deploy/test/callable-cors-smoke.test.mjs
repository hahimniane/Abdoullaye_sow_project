import assert from "node:assert/strict";
import {test} from "node:test";

import {
  MARKETPLACE_PEOPLE_CALLABLES,
  assessCallablePreflight,
  browserCallablePreflightOptions,
  callableServiceUrl,
  smokeMarketplacePeopleCallableCors,
} from "../callable-cors-smoke-lib.mjs";

test("marketplace people manifest covers every browser access callable", () => {
  assert.deepEqual(MARKETPLACE_PEOPLE_CALLABLES.slice(0, 14), [
    "listMarketplacePeople",
    "getMarketplacePerson",
    "setMarketplaceUserStatus",
    "revokeUserSessions",
    "sendUserRecoveryEmail",
    "invitePlatformAdmin",
    "inviteBusinessMember",
    "resendAccessInvitation",
    "cancelAccessInvitation",
    "acceptAccessInvitation",
    "transferBusinessOwnership",
    "reviewAccountDeletion",
    "finalizeAccountDeletion",
    "listPlatformUsers",
  ]);
  assert.equal(new Set(MARKETPLACE_PEOPLE_CALLABLES).size,
      MARKETPLACE_PEOPLE_CALLABLES.length);
});

test("builds a browser-like callable OPTIONS request", () => {
  assert.equal(callableServiceUrl({
    projectId: "car-selling-flutter-app",
    region: "us-central1",
    functionName: "listMarketplacePeople",
  }), "https://us-central1-car-selling-flutter-app.cloudfunctions.net/" +
    "listMarketplacePeople");

  assert.deepEqual(
      browserCallablePreflightOptions("https://admin.laawoldigital.com"),
      {
        method: "OPTIONS",
        redirect: "manual",
        headers: {
          origin: "https://admin.laawoldigital.com",
          "access-control-request-method": "POST",
          "access-control-request-headers":
            "authorization,content-type,x-firebase-appcheck",
          "user-agent": "Laawol-Release-Smoke/1.0",
        },
      },
  );
});

test("preflight assessment accepts only 2xx and rejects transport 403", () => {
  assert.equal(assessCallablePreflight("ready", {status: 204}).ok, true);
  const forbidden = assessCallablePreflight("missingInvoker", {status: 403});
  assert.equal(forbidden.ok, false);
  assert.match(forbidden.detail, /HTTP 403/);
  assert.equal(assessCallablePreflight("redirect", {status: 302}).ok, false);
  assert.equal(assessCallablePreflight("error", {status: 500}).ok, false);
});

test("read-only smoke reports every failed callable without stopping early",
    async () => {
      const seen = [];
      const statuses = new Map([
        ["listMarketplacePeople", 204],
        ["getMarketplacePerson", 403],
        ["setMarketplaceUserStatus", 500],
      ]);
      const result = await smokeMarketplacePeopleCallableCors({
        projectId: "car-selling-flutter-app",
        functionNames: [...statuses.keys(), "revokeUserSessions"],
        request: async (url, options) => {
          const name = url.split("/").at(-1);
          seen.push({name, options});
          if (name === "revokeUserSessions") throw new Error("network down");
          return {status: statuses.get(name)};
        },
      });

      assert.equal(result.ok, false);
      assert.deepEqual(result.failed.map((item) => item.functionName), [
        "getMarketplacePerson",
        "setMarketplaceUserStatus",
        "revokeUserSessions",
      ]);
      assert.match(result.detail, /getMarketplacePerson.*HTTP 403/);
      assert.match(result.detail, /revokeUserSessions.*network down/);
      assert.equal(seen.length, 4);
      assert.equal(seen.every((item) =>
        item.options.method === "OPTIONS"), true);
    });

test("read-only smoke passes when every browser preflight is 2xx", async () => {
  const result = await smokeMarketplacePeopleCallableCors({
    projectId: "car-selling-flutter-app",
    functionNames: ["listMarketplacePeople", "getMarketplacePerson"],
    request: async () => ({status: 204}),
  });
  assert.equal(result.ok, true);
  assert.equal(result.failed.length, 0);
  assert.equal(result.detail, "2/2 callable CORS preflights passed");
});

test("callable smoke rejects malformed deployment coordinates", () => {
  assert.throws(() => callableServiceUrl({
    projectId: "bad/project",
    region: "us-central1",
    functionName: "listMarketplacePeople",
  }), /project ID is invalid/);
  assert.throws(() => browserCallablePreflightOptions("http://localhost:3000"),
      /HTTPS origin/);
});
