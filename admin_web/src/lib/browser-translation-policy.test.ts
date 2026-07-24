import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { test } from "node:test";

const layoutSource = readFileSync("src/app/layout.tsx", "utf8");
const frenchDomSource = readFileSync("src/lib/french-dom.ts", "utf8");

test("web consoles opt out of browser auto-translation", () => {
  assert.match(layoutSource, /google:\s*"notranslate"/);
  assert.match(layoutSource, /<html[^>]*className="notranslate"/);
  assert.match(layoutSource, /<html[^>]*translate="no"/);
});

test("web consoles still expose their selected language to the browser", () => {
  assert.match(layoutSource, /<html[^>]*lang="en"/);
  assert.match(
    frenchDomSource,
    /document\.documentElement\.lang\s*=\s*currentLang\(\)/,
  );
});

test("every public website page opts out of browser auto-translation", () => {
  const publicPages = readdirSync("../public_site")
    .filter((name) => name.endsWith(".html"))
    .sort();

  assert.ok(publicPages.length > 0);
  for (const page of publicPages) {
    const source = readFileSync(`../public_site/${page}`, "utf8");
    assert.match(
      source,
      /<html[^>]*class="notranslate"/,
      `${page} must use the notranslate class`,
    );
    assert.match(
      source,
      /<html[^>]*translate="no"/,
      `${page} must disable browser translation`,
    );
    assert.match(
      source,
      /<meta\s+name="google"\s+content="notranslate"\s*\/?>/,
      `${page} must declare the Google notranslate policy`,
    );
  }
});
