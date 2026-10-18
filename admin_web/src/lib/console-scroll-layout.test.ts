import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const styles = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8",
);

test("desktop .content rows take their content's height so clipped panels never collapse", () => {
  // Regression: on desktop .content is a fixed-height scrolling grid. Its
  // implicit rows got only their min-content height, and a .panel with
  // overflow: hidden has none, so the Zelle bank card and the notification
  // preferences panel under the documents list rendered 2px tall.
  const desktop = styles.indexOf("@media (min-width: 1051px)");
  assert.ok(desktop >= 0, "the desktop layout block exists");
  const block = styles.slice(desktop, styles.indexOf("\n}\n", desktop) + 3);
  const content = block.slice(block.indexOf(".content {"));
  const rule = content.slice(0, content.indexOf("}"));
  assert.match(rule, /overflow-y:\s*auto/);
  assert.match(rule, /grid-auto-rows:\s*max-content/);
});
