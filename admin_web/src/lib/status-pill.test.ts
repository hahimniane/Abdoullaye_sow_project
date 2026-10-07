// Container and invoice states rendered with the car listing's `.lst-badge`,
// which is absolutely positioned over a card photo: in a list row or a panel
// header it floated off the card or behind the header and the state was
// not visible at all. These pin the in-flow pill and the CSS split.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import { STATUS_PILL_TONES, statusPillClass } from "./status-pill.ts";
import { CONTAINER_STATUS_TONES } from "./container-manifest.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const css = read("../app/globals.css");

function rule(selector: string) {
  const start = css.indexOf(`\n${selector} {`);
  assert.ok(start >= 0, `${selector} must exist`);
  return css.slice(start, css.indexOf("}", start));
}

describe("in-flow status pills", () => {
  test("container and invoice panels never use the floating listing badge", () => {
    for (const file of ["../components/business/containers-panel.tsx", "../components/business/invoices-panel.tsx"]) {
      const source = read(file);
      assert.doesNotMatch(source, /lst-badge/, `${file} must not use .lst-badge`);
      assert.match(source, /statusPillClass\(/, `${file} renders its state with statusPillClass`);
    }
  });

  test("the pill is the shared status-pill and is never positioned", () => {
    assert.equal(statusPillClass("ok"), "status-pill compact ok");
    assert.equal(statusPillClass("bogus"), "status-pill compact");
    assert.doesNotMatch(rule(".status-pill"), /position\s*:/);
    for (const tone of STATUS_PILL_TONES) {
      assert.doesNotMatch(rule(`.status-pill.${tone}`), /position\s*:/);
    }
    // The listing badge stays pinned to its photo - that is why it cannot be reused.
    assert.match(rule(".lst-badge"), /position:\s*absolute/);
  });

  test("every container status has a pill tone", () => {
    for (const tone of Object.values(CONTAINER_STATUS_TONES)) {
      assert.ok((STATUS_PILL_TONES as readonly string[]).includes(tone), tone);
    }
  });
});

describe("totals that fail to load", () => {
  test("offer a retry on the same line, not a dead end", () => {
    const source = read("../components/totals-status.tsx");
    assert.match(source, /error \? "Retry" : "Refresh"/);
    // The button is rendered outside the error branch, so it is there when the count failed.
    const button = source.indexOf("<button");
    const errorBranch = source.indexOf('className="totals-status-error"');
    assert.ok(button > errorBranch && errorBranch > 0);
    assert.match(source, /disabled=\{loading\}/);
    const french = read("./french-dom.ts");
    assert.match(french, /\n {2}"?Retry"?: "Réessayer",/);
  });
});
