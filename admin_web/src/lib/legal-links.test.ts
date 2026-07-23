import assert from "node:assert/strict";
import test from "node:test";

import {
  PUBLIC_SITE_ORIGIN,
  SUPPORT_URL,
  legalUrlForLanguage,
} from "./legal-links.ts";

test("legal links match the canonical mobile app destinations", () => {
  assert.equal(PUBLIC_SITE_ORIGIN, "https://laawoldigital.com");
  assert.equal(
    legalUrlForLanguage("terms", "en"),
    "https://laawoldigital.com/terms-en.html",
  );
  assert.equal(
    legalUrlForLanguage("privacy", "en"),
    "https://laawoldigital.com/privacy-en.html",
  );
  assert.equal(
    legalUrlForLanguage("terms", "fr"),
    "https://laawoldigital.com/terms.html",
  );
  assert.equal(
    legalUrlForLanguage("privacy", "fr"),
    "https://laawoldigital.com/privacy.html",
  );
  assert.equal(SUPPORT_URL, "https://laawoldigital.com/contact.html");
});
