import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { dropdownPlacement } from "./dropdown-placement.ts";

// Regressions from the release 1.0.17 click-through at 390 px (the console on
// a phone): each rule below was the cause of something sliding off screen.
const styles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

function rule(selector: string, from = 0): string {
  const at = styles.indexOf(`${selector} {`, from);
  assert.ok(at >= 0, `${selector} exists`);
  return styles.slice(at, styles.indexOf("}", at) + 1);
}

function mediaBlock(query: string, containing: string): string {
  let at = styles.indexOf(`@media (${query}) {`);
  while (at >= 0) {
    const end = styles.indexOf("\n}\n", at);
    const block = styles.slice(at, end + 2);
    if (block.includes(containing)) return block;
    at = styles.indexOf(`@media (${query}) {`, at + 1);
  }
  assert.fail(`no @media (${query}) block contains ${containing}`);
}

test("a form field and its control can shrink below their content width", () => {
  // Register a package / Received: the pieces editor measured 649 px in a
  // 350 px dialog because an <input>'s intrinsic width set the grid's minimum.
  assert.match(rule(".lst-field"), /min-width:\s*0/);
  assert.match(rule(".lst-field input, .lst-field select, .lst-field textarea"), /min-width:\s*0/);
  assert.match(rule(".lst-field input, .lst-field select, .lst-field textarea"), /max-width:\s*100%/);
});

test("the pieces editor's size fields use shrinkable columns at phone width", () => {
  const tablet = mediaBlock("max-width: 720px", ".pcs-fields");
  assert.match(tablet, /\.pcs-fields \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  assert.doesNotMatch(tablet, /\.pcs-fields \{ grid-template-columns: 1fr 1fr 1fr/);
  assert.match(tablet, /\.wpk-size-grid \{ grid-template-columns: repeat\(3, minmax\(0, 1fr\)\); \}/);
  const phone = mediaBlock("max-width: 480px", ".pcs-fields");
  assert.match(phone, /\.lst-modal-body \{ padding: 16px; \}/);
  assert.match(phone, /\.pcs-fee \.lst-field \{ max-width: none; \}/);
});

test("a dialog footer wraps, and on a phone each action takes its own row", () => {
  // The estimate dialog's three actions put "Decline request" at x = -24.
  assert.match(rule(".lst-modal-foot"), /flex-wrap:\s*wrap/);
  const phone = mediaBlock("max-width: 480px", ".lst-modal-foot > button");
  assert.match(phone, /\.lst-modal-foot > button,\s*\.lst-modal-foot > a \{ flex: 1 1 100%;/);
});

test("Volume tiles render their figure in the strong, never in a label-styled span", () => {
  // `.metric span` is the tile's label (12px uppercase muted). A <Count>
  // (a span) inside `.metric strong` took that look: tiny main numbers.
  assert.match(rule(".metric span"), /font-size:\s*12px/);
  const source = readFileSync(new URL("../components/volume-views.tsx", import.meta.url), "utf8");
  const tiles = source.slice(source.indexOf("function VolumeTiles"), source.indexOf("function ContainerList"));
  assert.doesNotMatch(tiles, /<strong[^>]*>\s*<Count/);
  assert.equal((tiles.match(/<strong className="vol-figure[^"]*" data-no-translate>/g) ?? []).length, 4);
  assert.match(rule(".vol-tiles .metric strong.vol-figure"), /font-size:\s*32px/);
  const note = rule(".vol-tiles .metric small span");
  assert.match(note, /text-transform:\s*none/);
  assert.match(note, /display:\s*inline/);
});

test("the notification dropdown stays inside a phone's screen", () => {
  // At 390 px the bell sits mid-header; right-aligned, the 340 px panel
  // started 123 px left of the screen.
  const phone = dropdownPlacement({ anchorLeft: 181, anchorRight: 217, viewportWidth: 390 });
  const pageLeft = 181 + phone.left;
  assert.ok(pageLeft >= 16, `left edge ${pageLeft} inside the gutter`);
  assert.ok(pageLeft + phone.width <= 390 - 16, `right edge ${pageLeft + phone.width} inside the gutter`);
  assert.equal(phone.width, 340);
  // 320 px: narrower than the panel, so it narrows to the screen.
  const tiny = dropdownPlacement({ anchorLeft: 250, anchorRight: 286, viewportWidth: 320 });
  assert.equal(tiny.width, 288);
  assert.equal(250 + tiny.left, 16);
  // Desktop: right-aligned to the bell, as before.
  const desktop = dropdownPlacement({ anchorLeft: 1364, anchorRight: 1400, viewportWidth: 1440 });
  assert.deepEqual(desktop, { left: 36 - 340, width: 340 });
  assert.match(rule(".notification-dropdown"), /max-width:\s*calc\(100vw - 32px\)/);
  const bell = readFileSync(new URL("../components/notification-bell.tsx", import.meta.url), "utf8");
  assert.match(bell, /dropdownPlacement\(/);
  assert.match(bell, /addEventListener\("resize", place\)/);
});

test("the public tracking card fits a 375 px phone", () => {
  // /t/<code> on a phone measured 415 px: the four journey columns (1fr with
  // nowrap stage names) set the minimum, and the phone two-by-two block sat
  // earlier in the file than the base rules, so it never applied.
  assert.match(rule(".guest-tracking-layout"), /grid-template-columns: minmax\(0, 1fr\)/);
  const base = styles.indexOf(".trk-journey {");
  assert.match(rule(".trk-journey"), /repeat\(4, minmax\(0, 1fr\)\)/);
  const phone = mediaBlock("max-width: 560px", ".trk-journey");
  assert.match(phone, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(phone, /\.trk-step-text \{ white-space: normal; \}/);
  assert.ok(styles.indexOf(phone) > base, "the phone journey rules come after the base rules");
});
