import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { phoneVerificationErrorMessage } from "./phone-verification.ts";

const source = readFileSync("src/components/customer-console.tsx", "utf8");

test("an unverified customer opens on Profile so phone verification is discoverable", () => {
  assert.match(
    source,
    /useState<CustomerTab>\(\(\) =>\s*firebaseUser\.phoneNumber\s*\?\s*"home"\s*:\s*"profile",?\s*\)/,
  );
});

test("a valid international phone exposes the send-code action", () => {
  const start = source.indexOf("{!verificationId && (");
  const end = source.indexOf("{verificationId && (", start);
  assert.notEqual(start, -1, "missing initial phone-verification state");
  assert.notEqual(end, -1, "missing transition to the OTP state");

  const initialStep = source.slice(start, end);
  assert.match(initialStep, /disabled=\{verifying \|\| !isValidE164\(phone\)\}/);
  assert.match(initialStep, /onClick=\{\(\) => void sendPhoneCode\(\)\}/);
  assert.match(initialStep, /Send verification code/);
  assert.match(source, /verifyPhoneNumber\(normalizedDraft, recaptcha\.current\)/);
});

test("a verification ID exposes the OTP and resend actions", () => {
  const start = source.indexOf("{verificationId && (");
  const end = source.indexOf('<div id="customer-phone-recaptcha"', start);
  assert.notEqual(start, -1, "missing code-sent state");
  assert.notEqual(end, -1, "missing phone reCAPTCHA boundary");

  const codeStep = source.slice(start, end);
  assert.match(codeStep, /6-digit verification code/);
  assert.match(codeStep, /autoComplete="one-time-code"/);
  assert.match(codeStep, /maxLength=\{6\}/);
  assert.match(codeStep, /onClick=\{\(\) => void confirmPhone\(\)\}/);
  assert.match(codeStep, /Verify phone/);
  assert.match(codeStep, /onClick=\{\(\) => void sendPhoneCode\(\)\}/);
  assert.match(codeStep, /Resend code/);
});

test("phone verification errors give actionable Firebase-specific guidance", () => {
  assert.equal(
    phoneVerificationErrorMessage(
      { code: "auth/unauthorized-domain" },
      "127.0.0.1",
    ),
    "Phone verification is not configured for this local address. Add it to Firebase Authorized domains.",
  );
  assert.equal(
    phoneVerificationErrorMessage(
      { code: "auth/unauthorized-domain" },
      "admin.laawoldigital.com",
    ),
    "Phone verification is not configured for this website. Contact Laawol support.",
  );
  assert.equal(
    phoneVerificationErrorMessage({ code: "auth/quota-exceeded" }),
    "SMS verification is temporarily unavailable. Try again later.",
  );
  assert.equal(
    phoneVerificationErrorMessage({ code: "auth/too-many-requests" }),
    "Too many verification attempts. Wait a few minutes and try again.",
  );
});

test("both send and confirmation failures use the user-facing error mapper", () => {
  const uses = source.match(
    /phoneVerificationErrorMessage\(caught, window\.location\.hostname\)/g,
  );
  assert.equal(uses?.length, 2);
});
