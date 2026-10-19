import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { PEOPLE_SIGN_IN_STATES } from "./admin-directory.ts";
import { containerLineWhatsApp, containerLineWhatsAppText } from "./container-manifest.ts";
import { PACKAGE_REQUEST_REQUESTED_LABEL, guestServiceLabel } from "./guest-tracking.ts";
import {
  LINE_COUNTRY_CODE_WARNINGS,
  MY_PACKAGES_PATH,
  PHONE_FLAG_COPY,
  PHONE_REFUSAL_COPY,
  PHONE_REFUSAL_DETAIL_LABELS,
  PHONE_REFUSAL_REASONS,
  PHONE_ROLE_LABELS,
  appendShipmentPage,
  customerTabFromSearch,
  groupMyShipments,
  parseMyShipmentsPage,
  parsePhoneCodeChallenge,
  parsePhoneLinkResult,
  parsePhoneSignInToken,
  parseSignInHints,
  phoneRefusalOf,
  phoneRefusalText,
  recordPhoneFlags,
  recordPhoneWarnings,
  sanitizeLoginCode,
  secondsUntil,
  unflaggedLineWarnings,
  waitText,
  withTimeout,
  type MyShipmentItem,
} from "./phone-accounts.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

// ---------------------------------------------------------------------------
// Answers and refusals
// ---------------------------------------------------------------------------

test("a code request's answer is read defensively, with the 30 s resend as the fallback", () => {
  assert.deepEqual(
    parsePhoneCodeChallenge({
      challengeId: "a".repeat(32), channel: "whatsapp", lastTwo: "35",
      expiresAtMs: 1_800_000_000_000, resendAfterMs: 30_000,
    }),
    { challengeId: "a".repeat(32), channel: "whatsapp", lastTwo: "35", expiresAtMs: 1_800_000_000_000, resendAfterMs: 30_000 },
  );
  const odd = parsePhoneCodeChallenge({ challengeId: "x1", lastTwo: "3x", resendAfterMs: -5 });
  assert.equal(odd.lastTwo, "", "never more (or other) than two digits");
  assert.equal(odd.resendAfterMs, 30_000);
  assert.throws(() => parsePhoneCodeChallenge({}), /phone-code-challenge-invalid/);
  assert.throws(() => parsePhoneCodeChallenge(null));
});

test("a sign-in code answers a custom token; a link code answers linked/merged", () => {
  assert.deepEqual(parsePhoneSignInToken({ customToken: "tok", uid: "u1", isNewAccount: true }), {
    customToken: "tok", uid: "u1", isNewAccount: true,
  });
  assert.throws(() => parsePhoneSignInToken({ uid: "u1" }));
  assert.deepEqual(parsePhoneLinkResult({ linked: true, merged: true }), { linked: true, merged: true });
  assert.deepEqual(parsePhoneLinkResult({ linked: true }), { linked: true, merged: false });
  assert.throws(() => parsePhoneLinkResult({ linked: false }));
});

test("every documented refusal reason maps to its own console copy, never the server's message", () => {
  for (const reason of PHONE_REFUSAL_REASONS) {
    const refusal = phoneRefusalOf({ code: "functions/failed-precondition", message: "Server English", details: { reason } });
    assert.equal(refusal.reason, reason);
    const shown = phoneRefusalText(refusal);
    assert.equal(shown.message, PHONE_REFUSAL_COPY[reason]);
    assert.notEqual(shown.message, "Server English");
  }
  // The contract's full list (docs/PHONE_ACCOUNTS.md §5.1, §6).
  assert.deepEqual([...PHONE_REFUSAL_REASONS].sort(), [
    "challenge_not_found", "code_expired", "code_wrong", "needs_country_code", "no_phone_on_record",
    "no_verified_phone", "phone_in_use", "phone_invalid", "proof_invalid", "rate_limited",
    "record_invalid", "sign_in_required", "too_many_attempts", "tracking_not_found",
    "wrong_account", "whatsapp_unavailable", "phone_sign_in_unavailable",
  ].sort());
  // A network failure, a timeout or an unknown reason is "unknown".
  for (const error of [new Error("offline"), { code: "deadline-exceeded" }, { details: { reason: "brand_new" } }, null]) {
    assert.equal(phoneRefusalOf(error).reason, "unknown");
  }
});

test("rate_limited says when to ask again; code_wrong says how many tries are left", () => {
  const limited = phoneRefusalText(phoneRefusalOf({ details: { reason: "rate_limited", retryAfterMs: 125_000 } }));
  assert.deepEqual(limited.detail, { label: PHONE_REFUSAL_DETAIL_LABELS.retry, value: "3 min" });
  const limitedNoWait = phoneRefusalText(phoneRefusalOf({ details: { reason: "rate_limited" } }));
  assert.equal(limitedNoWait.detail, undefined);
  assert.equal(limitedNoWait.hint, PHONE_REFUSAL_DETAIL_LABELS.waitFewMinutes);
  const wrong = phoneRefusalText(phoneRefusalOf({ details: { reason: "code_wrong", attemptsLeft: 3 } }));
  assert.deepEqual(wrong.detail, { label: PHONE_REFUSAL_DETAIL_LABELS.attempts, value: "3" });
  assert.equal(waitText(400), "1 s");
  assert.equal(waitText(45_000), "45 s");
  assert.equal(waitText(60_000), "1 min");
  assert.equal(waitText(3 * 3_600_000), "3 h");
});

test("a typed code keeps six digits; the resend countdown counts whole seconds down to zero", () => {
  assert.equal(sanitizeLoginCode("12 34-56 78"), "123456");
  assert.equal(sanitizeLoginCode("abc"), "");
  assert.equal(secondsUntil(31_000, 1_000), 30);
  assert.equal(secondsUntil(1_500, 1_000), 1);
  assert.equal(secondsUntil(1_000, 5_000), 0);
  assert.equal(secondsUntil(Number.NaN, 0), 0);
});

test("withTimeout settles with the work, or rejects when it never answers", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 50, new Error("late")), 7);
  await assert.rejects(withTimeout(new Promise(() => undefined), 10, { code: "auth/verification-timeout" }), (error: unknown) =>
    (error as { code?: string }).code === "auth/verification-timeout");
});

// ---------------------------------------------------------------------------
// Tracking page hints and arrival
// ---------------------------------------------------------------------------

test("sign-in hints carry a role and two digits only, one per role", () => {
  assert.deepEqual(
    parseSignInHints([
      { role: "sender", lastTwo: "35" },
      { role: "receiver", lastTwo: "07" },
      { role: "receiver", lastTwo: "99" },
      { role: "owner", lastTwo: "12" },
      { role: "sender", lastTwo: "123" },
      "junk",
    ]),
    [{ role: "sender", lastTwo: "35" }, { role: "receiver", lastTwo: "07" }],
  );
  assert.deepEqual(parseSignInHints(undefined), []);
});

test("a phone sign-in from a tracking link lands on My packages", () => {
  assert.equal(MY_PACKAGES_PATH, "/?open=packages");
  assert.equal(customerTabFromSearch("?open=packages"), "packages");
  assert.equal(customerTabFromSearch(new URL(`https://x.test${MY_PACKAGES_PATH}`).search), "packages");
  assert.equal(customerTabFromSearch("?open=profile"), null);
  assert.equal(customerTabFromSearch(""), null);
});

// ---------------------------------------------------------------------------
// My packages
// ---------------------------------------------------------------------------

function item(key: string, role: "sender" | "receiver", businessId: string, createdAtMs: number, extra: Partial<MyShipmentItem> = {}): MyShipmentItem {
  return {
    key, collection: key.split("/")[0], role, roles: [role], businessId, businessName: `Biz ${businessId}`,
    service: "container", trackingCode: key.split("/")[1].toUpperCase(), stage: "booked", pieceCount: 1,
    parts: [], shipping: null, createdAtMs, updatedAtMs: createdAtMs, ...extra,
  };
}

test("My packages groups by business, newest first, a business where its newest package is", () => {
  const items = [
    item("containerLines/a1", "sender", "a", 100),
    item("containerLines/b1", "sender", "b", 300),
    item("barrelShipments/a2", "sender", "a", 400),
    item("containerLines/c1", "receiver", "c", 200),
    item("containerLines/b2", "receiver", "b", 500),
    item("containerLines/b3", "sender", "b", 50),
  ];
  const grouped = groupMyShipments(items);
  assert.deepEqual(grouped.mine.map((group) => [group.businessId, group.items.map((row) => row.key)]), [
    ["a", ["barrelShipments/a2", "containerLines/a1"]],
    ["b", ["containerLines/b1", "containerLines/b3"]],
  ]);
  assert.deepEqual(grouped.comingToYou.map((group) => [group.businessId, group.items.map((row) => row.key)]), [
    ["b", ["containerLines/b2"]],
    ["c", ["containerLines/c1"]],
  ]);
  assert.equal(grouped.mine[0].businessName, "Biz a");
});

test("two packages made the same millisecond keep the server's order; sent to oneself is the sender's", () => {
  const same = groupMyShipments([
    item("containerLines/x", "sender", "a", 100),
    item("containerLines/y", "sender", "a", 100),
    item("containerLines/z", "sender", "a", 100, { roles: ["sender", "receiver"] }),
  ]);
  assert.deepEqual(same.mine[0].items.map((row) => row.key), ["containerLines/x", "containerLines/y", "containerLines/z"]);
  assert.equal(same.comingToYou.length, 0);
  // No business id: grouped by the name rather than lumped together.
  const unnamed = groupMyShipments([
    item("parkedCars/p", "sender", "", 10, { businessName: "Lot" }),
    item("parkedCars/q", "sender", "", 5, { businessName: "Other" }),
  ]);
  assert.equal(unnamed.mine.length, 2);
});

test("getMyShipments' answer is read defensively and pages append without repeats", () => {
  const page = parseMyShipmentsPage({
    phoneLastTwo: "35",
    items: [
      {
        key: "containerLines/l1", collection: "containerLines", role: "receiver", roles: ["receiver"],
        businessId: "biz", businessName: "Atlantic", service: "container", trackingCode: "CL-K7M4P2",
        stage: "in_transit", pieceCount: 3, createdAtMs: 1000, updatedAtMs: 2000,
        parts: [{ trackingCode: "CL-K7M4P2", stage: "in_transit", pieceCount: 3, priceCents: 9000 }],
        shipping: { shippingLine: "Maersk", containerNumber: "MSKU1234567", notes: "x" },
        payment: { priceCents: 1 },
      },
      { key: "", role: "sender" },
      { key: "barrelShipments/b1", role: "owner" },
      "junk",
    ],
    nextCursor: { beforeMs: 1000, skipKeys: ["containerLines/l1"] },
  });
  assert.equal(page.items.length, 1);
  const [only] = page.items;
  assert.equal(only.role, "receiver");
  assert.deepEqual(only.shipping, { shippingLine: "Maersk", containerNumber: "MSKU1234567" });
  assert.deepEqual(only.parts, [{ trackingCode: "CL-K7M4P2", stage: "in_transit", pieceCount: 3 }]);
  assert.equal("payment" in only, false, "no money ever reaches the card");
  assert.deepEqual(page.nextCursor, { beforeMs: 1000, skipKeys: ["containerLines/l1"] });
  assert.equal(page.phoneLastTwo, "35");
  assert.deepEqual(parseMyShipmentsPage({ items: [], nextCursor: { beforeMs: 0 } }), { items: [], nextCursor: null, phoneLastTwo: "" });
  const merged = appendShipmentPage(page.items, [only, item("containerLines/l2", "sender", "biz", 500)]);
  assert.deepEqual(merged.map((row) => row.key), ["containerLines/l1", "containerLines/l2"]);
});

// ---------------------------------------------------------------------------
// Staff phone flags
// ---------------------------------------------------------------------------

test("a record's phone flags are read per field", () => {
  const row = { phoneCountryCodeMissing: ["receiverPhone"], phoneReportedNotMine: ["customerPhone", 3] };
  assert.deepEqual(recordPhoneFlags(row, "customerPhone"), { countryCodeMissing: false, reportedNotMine: true });
  assert.deepEqual(recordPhoneFlags(row, "receiverPhone"), { countryCodeMissing: true, reportedNotMine: false });
  assert.deepEqual(recordPhoneWarnings(row, "receiverPhone"), [PHONE_FLAG_COPY.countryCodeMissing]);
  assert.deepEqual(recordPhoneWarnings(row, "customerPhone"), [PHONE_FLAG_COPY.reportedNotMine]);
  assert.deepEqual(recordPhoneWarnings({}, "customerPhone"), []);
  assert.deepEqual(recordPhoneWarnings(null, "customerPhone"), []);
});

test("a number the server flags carries 'Add the country code' once, not the WhatsApp line's copy too", () => {
  const line = {
    ownerKind: "customer", customerPhone: "6201234567", receiverPhone: "620123456",
    phoneCountryCodeMissing: ["customerPhone"],
  };
  const { warnings } = containerLineWhatsAppText(containerLineWhatsApp(line));
  // The dedupe matches the manifest's own sentences, word for word.
  assert.deepEqual(warnings, [LINE_COUNTRY_CODE_WARNINGS.customerPhone, LINE_COUNTRY_CODE_WARNINGS.receiverPhone]);
  assert.deepEqual(unflaggedLineWarnings(line, warnings), [LINE_COUNTRY_CODE_WARNINGS.receiverPhone]);
  assert.deepEqual(unflaggedLineWarnings({}, warnings), warnings);
});

// ---------------------------------------------------------------------------
// French: every sentence the new screens show
// ---------------------------------------------------------------------------

function missingFrench(strings: readonly string[]): string[] {
  return strings.filter((english) => !(english in TEXT_TRANSLATIONS) && !(english in ATTRIBUTE_TRANSLATIONS));
}

test("the sentences the pure modules build have their French, and it converges", () => {
  const strings = [
    ...Object.values(PHONE_REFUSAL_COPY),
    ...Object.values(PHONE_REFUSAL_DETAIL_LABELS),
    ...Object.values(PHONE_ROLE_LABELS),
    ...Object.values(PHONE_FLAG_COPY),
    ...PEOPLE_SIGN_IN_STATES.map((option) => option.label),
    guestServiceLabel("package_request"),
    PACKAGE_REQUEST_REQUESTED_LABEL,
  ];
  assert.deepEqual(missingFrench(strings), []);
  for (const english of strings) {
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, english);
    assert.equal(translateValue(french, "fr"), french, `${english} converges`);
  }
});

const ATTRIBUTES_WITH_COPY = new Set(["placeholder", "title", "aria-label", "label", "alt"]);
const SPEAKING_CALLS = new Set(["setError", "setFlash", "setNotice", "setPhoneNotice", "setPhoneError"]);

/** The English a file shows: JSX text, copy attributes, and the messages its handlers raise. */
function screenStrings(source: string, fileName: string): string[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found = new Set<string>();
  const add = (raw: string) => {
    const value = raw.replace(/\s+/g, " ").trim();
    if (/[A-Za-z]{2}/.test(value)) found.add(value);
  };
  const literalsOf = (node: ts.Node | undefined): void => {
    if (!node) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
    else if (ts.isParenthesizedExpression(node)) literalsOf(node.expression);
    else if (ts.isConditionalExpression(node)) { literalsOf(node.whenTrue); literalsOf(node.whenFalse); }
    else if (ts.isBinaryExpression(node)) { literalsOf(node.right); }
    else if (ts.isObjectLiteralExpression(node)) {
      for (const prop of node.properties) if (ts.isPropertyAssignment(prop) && prop.name.getText() === "message") literalsOf(prop.initializer);
    }
  };
  const optedOut = (node: ts.Node): boolean => {
    for (let at: ts.Node | undefined = node; at; at = at.parent) {
      const attrs = ts.isJsxElement(at) ? at.openingElement.attributes : ts.isJsxSelfClosingElement(at) ? at.attributes : null;
      if (attrs?.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === "data-no-translate")) return true;
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && !optedOut(node)) add(node.getText().replace(/&amp;/g, "&").replace(/&apos;/g, "'"));
    if (ts.isJsxAttribute(node) && ATTRIBUTES_WITH_COPY.has(node.name.getText()) && !optedOut(node)) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) add(init.text);
      else if (init && ts.isJsxExpression(init)) literalsOf(init.expression);
    }
    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && !optedOut(node)) literalsOf(node.expression);
    // Props that are labels: the code entry's verify words, the back link.
    if (ts.isJsxAttribute(node) && /Label$/.test(node.name.getText())) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) add(init.text);
    }
    if (ts.isCallExpression(node) && SPEAKING_CALLS.has(node.expression.getText())) node.arguments.forEach(literalsOf);
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found];
}

for (const [name, path] of [
  ["the phone sign-in", "../components/phone-sign-in.tsx"],
  ["My packages", "../components/my-packages.tsx"],
  ["the app banner", "../components/get-app-banner.tsx"],
  ["the phone flags", "../components/phone-flags.tsx"],
] as const) {
  test(`every sentence on ${name} has its French`, () => {
    const strings = screenStrings(read(path), path);
    assert.ok(strings.length >= 1 || path.endsWith("phone-flags.tsx"), "the scan found nothing to check");
    assert.deepEqual(missingFrench(strings), []);
  });
}

test("the business's 'number isn't mine' notification reads in French around its code", () => {
  // The server's copy (phone_accounts.js reportShipmentNotMine), shown by the bell.
  assert.equal(translateValue("A customer says a number isn't theirs", "fr"), "Un client dit qu’un numéro n’est pas le sien");
  assert.equal(
    translateValue("Someone who signed in with the number on CL-K7M4P2 says it isn't theirs. Check the number.", "fr"),
    "Une personne connectée avec le numéro de CL-K7M4P2 dit qu’il n’est pas le sien. Vérifiez le numéro.",
  );
  const server = readFileSync("../my_flutter_app/functions/phone_accounts.js", "utf8");
  assert.ok(server.includes(`title: "A customer says a number isn't theirs"`));
  assert.ok(server.includes("Someone who signed in with the number on ${code} says it ` +"));
  assert.ok(server.includes(`"isn't theirs. Check the number."`));
});

test("the strings the other screens gained for phone accounts have their French", () => {
  const strings = [
    // console-router.tsx
    "Sign in with your phone",
    // guest-tracking.tsx
    "Is this your package?", "Sign in with a code to see every package sent with your number.",
    "Sign in as the number ending in",
    // customer-console.tsx
    "My packages", "Packages sent with your number", "Verify on WhatsApp instead",
    "Code sent on WhatsApp. Enter the 6-digit code below.",
    "Phone number verified. Packages recorded with it are now in My packages.",
    "This number is on packages a business recorded. Adding it to your account...",
    "For your security, sign out, sign in again with your phone, then request deletion.",
    "You signed in with your phone, so no password is needed. Required transaction records may be retained for legal and accounting obligations.",
    // package-staff-view.tsx
    "The person says this number isn't theirs - check it",
    // admin-console.tsx
    "Sign-in", "Filter by sign-in", "Not signed in yet", "No email",
    "No email on this account: the person signs in with a code sent to their phone, so there is no password to reset.",
  ];
  assert.deepEqual(missingFrench(strings), []);
  const sources = [
    read("../components/console-router.tsx"), read("../components/guest-tracking.tsx"),
    read("../components/customer-console.tsx"), read("../components/package-staff-view.tsx"),
    read("../components/admin-console.tsx"),
  ].join("\n").replace(/&apos;/g, "'").replace(/\s+/g, " ");
  for (const english of strings) assert.ok(sources.includes(english), `${english} is on a screen`);
});

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

test("every phone call goes through the one callable, and the screens never show its English", () => {
  const client = read("./phone-accounts-client.ts");
  assert.match(read("./phone-accounts.ts"), /PHONE_ACCOUNT_CALLABLE = "phoneAccount"/);
  assert.match(client, /httpsCallable\(functions, PHONE_ACCOUNT_CALLABLE, \{ timeout: CALL_TIMEOUT_MS \}\)/);
  assert.match(client, /call\(\{ \.\.\.data, action \}\)/);
  for (const path of ["../components/phone-sign-in.tsx", "../components/my-packages.tsx"]) {
    const source = read(path);
    assert.doesNotMatch(source, /(?:caught|error)\.message/, `${path} reads the server's message`);
    assert.doesNotMatch(source, /httpsCallable\(/, `${path} calls a function directly`);
  }
});

test("My packages never shows money", () => {
  const source = read("../components/my-packages.tsx");
  assert.doesNotMatch(source, /priceCents|moneyText|formatMoney|payment/);
});

test("the sign-in form offers the phone only on the customer host, as its own panel", () => {
  const router = read("../components/console-router.tsx");
  assert.match(router, /\{phoneMode && customerSignUp \? \(/);
  assert.match(router, /\{mode === "sign-in" && customerSignUp && \(/);
  // A first SMS sign-in waits for the profile instead of the invitation setup.
  assert.match(router, /if \(!snap\.exists\(\) && phoneOnlyAccount\(user\)\) \{\s*await completePhoneSignInOnce\(user\.uid\)/);
});

test("the masked flow sends its code once, and the reCAPTCHA is the shared invisible one", () => {
  const signIn = read("../components/phone-sign-in.tsx");
  assert.match(signIn, /if \(!autoStart \|\| !hint \|\| started\.current\) return;\s*started\.current = true;/);
  assert.match(signIn, /if \(busyRef\.current\) return;/);
  assert.match(signIn, /invisibleRecaptcha\(recaptchaId\)/);
  assert.match(read("../components/customer-console.tsx"), /invisibleRecaptcha\("customer-phone-recaptcha"\)/);
  assert.match(read("./phone-accounts-client.ts"), /new RecaptchaVerifier\(auth, containerId, \{ size: "invisible" \}\)/);
});

test("the merge proof signs in on a secondary app that is always signed out and deleted", () => {
  const firebase = read("./firebase.ts");
  assert.match(firebase, /initializeAuth\(secondaryApp, \{ persistence: inMemoryPersistence \}\)/);
  assert.match(firebase, /finally \{\s*await signOut\(secondary\)/);
  assert.match(firebase, /finally \{\s*await deleteApp\(secondaryApp\)/);
  const profile = read("../components/customer-console.tsx");
  assert.match(profile, /authErrorCode\(caught\) === "auth\/credential-already-in-use"\s*\? phoneCredentialFromError\(caught\)/);
  assert.match(profile, /await linkPhoneFromCredential\(held\)/);
  assert.match(read("./phone-accounts-client.ts"), /callPhoneAccount\("completePhoneSignIn", \{ placeholderIdToken \}\)/);
});

test("the tracking page is app-first for everyone but staff, whose page is unchanged", () => {
  const guest = read("../components/guest-tracking.tsx");
  assert.match(guest, /\{offerApp \? \(\s*<>[\s\S]*?<GetAppBanner variant=\{arrivedWithCode \? "track" : "follow"\} \/>\s*\{resultSection\}\s*\{lookupSection\}\s*<\/>\s*\) : \(\s*<>\s*\{lookupSection\}\s*\{resultSection\}\s*<\/>\s*\)\}/);
  assert.match(guest, /onSignedIn=\{\(\) => window\.location\.assign\(MY_PACKAGES_PATH\)\}/);
  assert.match(guest, /\{!authenticated && record\.signIn && record\.signIn\.length > 0 && \(/);
});
