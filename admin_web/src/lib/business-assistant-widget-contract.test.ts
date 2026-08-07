// The business assistant is a floating bubble, not a sidebar destination.
//
// It used to be a sidebar tab ("assistant"), which meant a business had to
// navigate away from whatever they were doing to ask a question. These tests
// lock in the replacement: one launcher mounted for the whole console, on
// every tab, reachable and translated - and no leftover tab id.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { businessSidebarTabs } from "./business-sidebar.ts";
import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";

const consoleSource = readFileSync(
  "src/components/business-console.tsx",
  "utf8",
);
const widgetSource = readFileSync(
  "src/components/business/assistant-widget.tsx",
  "utf8",
);
const panelSource = readFileSync(
  "src/components/business/assistant-panel.tsx",
  "utf8",
);
const sidebarSource = readFileSync("src/lib/business-sidebar.ts", "utf8");
const stylesSource = readFileSync("src/app/globals.css", "utf8");

test("the assistant is no longer a sidebar tab", () => {
  assert.equal(
    // Cast: the tab id is gone from the union, and that removal is exactly
    // what this assertion guards at runtime.
    businessSidebarTabs.some((tab) => String(tab.id) === "assistant"),
    false,
    "the assistant must not appear in the sidebar",
  );
  assert.doesNotMatch(sidebarSource, /"assistant"/);
  assert.doesNotMatch(consoleSource, /activeTab === "assistant"/);
  assert.doesNotMatch(consoleSource, /assistant: </);
});

test("the console mounts the floating assistant once, outside the tab switch", () => {
  assert.match(
    consoleSource,
    /import \{AssistantWidget\} from "@\/components\/business\/assistant-widget"/,
  );
  const mounts = consoleSource.match(/<AssistantWidget/g) ?? [];
  assert.equal(mounts.length, 1, "the widget must be mounted exactly once");
  // Mounted after </main> closes, so it hovers over the console instead of
  // living inside whichever panel the active tab renders.
  assert.match(
    consoleSource,
    /<\/main>[\s\S]{0,400}<AssistantWidget businessId=\{businessId\} previewMode=\{previewMode\} \/>/,
  );
});

test("the widget keeps preview mode disabling the composer", () => {
  assert.match(widgetSource, /previewMode=\{previewMode\}/);
  assert.match(panelSource, /busy \|\| previewMode \|\| !businessId/);
  assert.match(panelSource, /The assistant is unavailable in preview mode\./);
});

test("the floating assistant is announced and closes on Escape", () => {
  assert.match(widgetSource, /aria-label=\{open \? "Close the assistant" : "Open the assistant"\}/);
  assert.match(widgetSource, /aria-expanded=\{open\}/);
  assert.match(widgetSource, /role="dialog"/);
  assert.match(widgetSource, /aria-label="Assistant"/);
  assert.match(widgetSource, /event\.key !== "Escape"/);
  // A non-modal helper: the console behind it must stay usable, so no focus
  // trap and no blocking overlay.
  assert.doesNotMatch(widgetSource, /focus-trap|modal-overlay/i);
});

test("the widget floats bottom-right and scrolls its own transcript", () => {
  assert.match(stylesSource, /\.assistant-widget \{[^}]*position: fixed;/);
  // It must clear the language toggle, which is also fixed bottom-right at
  // bottom:16px and is ~40px tall - the bubble used to land on top of it.
  const langBottom = Number(
    /\.console-lang-toggle \{[^}]*bottom: (\d+)px/.exec(stylesSource)?.[1] ?? "0",
  );
  const widgetBottom = Number(
    /\.assistant-widget \{[^}]*bottom: (\d+)px/.exec(stylesSource)?.[1] ?? "0",
  );
  assert.ok(
    widgetBottom >= langBottom + 40,
    `the bubble (bottom:${widgetBottom}px) must clear the language toggle (bottom:${langBottom}px)`,
  );
  assert.match(
    stylesSource,
    /\.assistant-widget-panel \{[^}]*width: min\(360px, calc\(100vw - 44px\)\);/,
  );
  assert.match(
    stylesSource,
    /\.assistant-widget-body \.assistant-chat \{[^}]*height: 320px;/,
  );
  assert.match(stylesSource, /\.assistant-widget-panel\.open \{/);
  assert.match(
    stylesSource,
    /@media \(prefers-reduced-motion: reduce\) \{\s*\.assistant-widget-launcher,\s*\.assistant-widget-panel \{ transition: none; \}/,
  );
});

test("the new widget strings read in French too", () => {
  for (const english of ["Open the assistant", "Close the assistant"]) {
    const french = TEXT_TRANSLATIONS[english];
    assert.ok(french, `${english} needs a French entry`);
    assert.notEqual(french, english, `${english} must not be an identity entry`);
    assert.equal(translateValue(english, "fr"), french);
  }
  // The panel subtitle reuses a wording the dictionary already carries.
  assert.equal(
    translateValue("Chat help for daily operations", "fr"),
    "Aide par chat pour les opérations quotidiennes",
  );
});
