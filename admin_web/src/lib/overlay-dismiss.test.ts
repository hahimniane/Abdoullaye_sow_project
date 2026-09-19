import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { overlayDismiss } from "./overlay-dismiss.ts";

const overlay = {};
const inside = {};

function press(handlers: ReturnType<typeof overlayDismiss>, down: object, up: object) {
  handlers.onMouseDown({ target: down, currentTarget: overlay });
  handlers.onClick({ target: up, currentTarget: overlay });
}

test("a click that starts and ends on the overlay closes the modal", () => {
  let closed = 0;
  press(overlayDismiss(() => { closed += 1; }), overlay, overlay);
  assert.equal(closed, 1);
});

// The reported bug: the press begins on a suggestion inside the form, the
// suggestion menu closes itself before mouse-up, and the click is delivered
// to the overlay underneath.
test("a press that began inside the modal never closes it", () => {
  let closed = 0;
  press(overlayDismiss(() => { closed += 1; }), inside, overlay);
  assert.equal(closed, 0);
});

test("a press that began on the overlay but ended inside does not close it", () => {
  let closed = 0;
  press(overlayDismiss(() => { closed += 1; }), overlay, inside);
  assert.equal(closed, 0);
});

test("each press is judged on its own", () => {
  let closed = 0;
  const handlers = overlayDismiss(() => { closed += 1; });
  press(handlers, inside, overlay);
  press(handlers, overlay, overlay);
  assert.equal(closed, 1);
});

// Every modal overlay in the business panels uses it; a bare onClick on an
// overlay reintroduces the race for that one form.
test("no business-panel overlay closes on a bare click", () => {
  for (const file of [
    "src/components/business/operations-panels.tsx",
    "src/components/business/containers-panel.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(
      source, /className="lst-modal-overlay"[^>]*onClick=\{closeModal\}/,
      `${file}: an overlay still closes on a bare click`);
    assert.match(source, /\{\.\.\.overlayDismiss\(closeModal\)\}/);
  }
});
