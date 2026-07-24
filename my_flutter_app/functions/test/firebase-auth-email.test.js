"use strict";

const assert = require("node:assert/strict");
const {describe, it} = require("node:test");
const {
  firebaseAuthEmailErrorCode,
  normalizeAuthEmailLocale,
  sendFirebasePasswordSetupEmail,
} = require("../firebase_auth_email");

describe("Firebase Auth invitation email fallback", () => {
  it("normalizes supported email locales", () => {
    assert.equal(normalizeAuthEmailLocale("fr-CA"), "fr");
    assert.equal(normalizeAuthEmailLocale("en-US"), "en");
    assert.equal(normalizeAuthEmailLocale(""), "en");
  });

  it(
      "sends a Firebase password-setup email without exposing a password",
      async () => {
        const calls = [];
        const result = await sendFirebasePasswordSetupEmail({
          apiKey: "public-web-api-key",
          email: " New.Person@Example.com ",
          locale: "fr",
          request: async (url, options) => {
            calls.push({url, options});
            return {
              ok: true,
              status: 200,
              json: async () => ({email: "new.person@example.com"}),
            };
          },
        });

        assert.deepEqual(result, {
          email: "new.person@example.com",
          provider: "firebaseAuth",
          status: "sent",
        });
        assert.equal(calls.length, 1);
        assert.match(
            calls[0].url,
            /accounts:sendOobCode\?key=public-web-api-key$/,
        );
        assert.equal(calls[0].options.method, "POST");
        assert.equal(calls[0].options.headers["x-firebase-locale"], "fr");
        assert.deepEqual(JSON.parse(calls[0].options.body), {
          requestType: "PASSWORD_RESET",
          email: "new.person@example.com",
        });
      },
  );

  it("fails closed when Firebase rejects the email request", async () => {
    await assert.rejects(
        sendFirebasePasswordSetupEmail({
          apiKey: "public-web-api-key",
          email: "person@example.com",
          request: async () => ({
            ok: false,
            status: 400,
            json: async () => ({
              error: {message: "EMAIL_NOT_FOUND : Account is missing"},
            }),
          }),
        }),
        (error) => {
          assert.equal(error.code, "EMAIL_NOT_FOUND");
          assert.equal(error.status, 400);
          return true;
        },
    );
    assert.equal(
        firebaseAuthEmailErrorCode({
          error: {message: "TOO_MANY_ATTEMPTS_TRY_LATER"},
        }),
        "TOO_MANY_ATTEMPTS_TRY_LATER",
    );
  });

  it("validates configuration and recipient before any request", async () => {
    await assert.rejects(
        sendFirebasePasswordSetupEmail({
          apiKey: "",
          email: "person@example.com",
          request: async () => {
            throw new Error("request should not run");
          },
        }),
        /FIREBASE_WEB_API_KEY is required/,
    );
    await assert.rejects(
        sendFirebasePasswordSetupEmail({
          apiKey: "public-web-api-key",
          email: "not-an-email",
          request: async () => {
            throw new Error("request should not run");
          },
        }),
        /valid invitation email/,
    );
  });
});
