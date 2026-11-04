import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_ANGLES,
  DEFAULT_DIMS,
  DIM_MAX_IN,
  MAX_PX_PER_IN,
  MIN_PX_PER_IN,
  PERSON_IN,
  SNEAKER_IN,
  TILT_MAX_DEG,
  TILT_MIN_DEG,
  clampDim,
  clampTilt,
  dimText,
  dimsOf,
  dimsText,
  dragAngles,
  fitScale,
  gridOf,
  keyAngles,
  layoutOf,
  placeTransform,
  prismFaces,
  readDim,
  readDims,
  sliderValue,
  sneakerParts,
  tapeWidthPx,
  withDim,
  wrapSpin,
} from "./box-designer.ts";
import { BOX_DIM_MAX_IN } from "./package-price-list.ts";

test("typed inches: tenths, a French comma, 1 to 120, nothing else", () => {
  assert.equal(readDim("12"), 12);
  assert.equal(readDim(" 12.5 "), 12.5);
  assert.equal(readDim("12,5"), 12.5);
  assert.equal(readDim("12.46"), 12.5, "rounded to a tenth");
  assert.equal(readDim("1"), 1);
  assert.equal(readDim("120"), 120);
  for (const bad of ["", "0", "0.4", "121", "-3", "abc", "1e2", "12 in", "1,2,3", null, undefined]) {
    assert.equal(readDim(bad), null, String(bad));
  }
  assert.equal(readDim("0.95"), 1, "0.95 rounds to 1.0 and is allowed");
  assert.equal(DIM_MAX_IN, BOX_DIM_MAX_IN, "the designer allows what the server allows");
});

test("all three dimensions must read", () => {
  assert.deepEqual(readDims({ l: "20", w: "16,5", h: "14" }), { l: 20, w: 16.5, h: 14 });
  assert.equal(readDims({ l: "20", w: "", h: "14" }), null);
  assert.equal(readDims({ l: "20", w: "16", h: "200" }), null);
});

test("clamping and slider position", () => {
  assert.equal(clampDim(0), 1);
  assert.equal(clampDim(500), 120);
  assert.equal(clampDim(12.34), 12.3);
  assert.equal(clampDim(Number.NaN), 1);
  assert.equal(sliderValue(90), 60, "the slider stops at 60 while the number may go on");
  assert.equal(sliderValue(0.2), 1);
  assert.equal(sliderValue(33.4), 33);
  assert.deepEqual(withDim({ l: 10, w: 10, h: 10 }, "h", 75.55), { l: 10, w: 10, h: 75.6 });
  assert.equal(dimText(12), "12");
  assert.equal(dimText(12.5), "12.5");
  assert.equal(dimsText({ l: 20, w: 16, h: 14.5 }), "20 × 16 × 14.5 in");
  assert.equal(dimsText({ l: 20, w: 16, h: 14 }, "fr"), "20 × 16 × 14 po");
});

test("stored inches are read defensively", () => {
  assert.deepEqual(dimsOf({ l: 20, w: "16", h: 14 }), { l: 20, w: 16, h: 14 });
  assert.equal(dimsOf(null), null);
  assert.equal(dimsOf({ l: 20, w: 16 }), null);
  assert.equal(dimsOf({ l: 20, w: 16, h: 500 }), null);
});

test("dragging spins sideways and tilts up and down, clamped", () => {
  const next = dragAngles(DEFAULT_ANGLES, 100, 0);
  assert.equal(next.tilt, DEFAULT_ANGLES.tilt);
  assert.notEqual(next.spin, DEFAULT_ANGLES.spin);
  assert.ok(dragAngles(DEFAULT_ANGLES, 0, 10000).tilt === TILT_MIN_DEG);
  assert.ok(dragAngles(DEFAULT_ANGLES, 0, -10000).tilt === TILT_MAX_DEG);
  for (const spin of [-1000, -181, 0, 179, 181, 720, 100000]) {
    const wrapped = wrapSpin(spin);
    assert.ok(wrapped >= -180 && wrapped < 180, `${spin} -> ${wrapped}`);
  }
  assert.equal(clampTilt(0), TILT_MAX_DEG);
  assert.equal(clampTilt(Number.NaN), DEFAULT_ANGLES.tilt);
});

test("arrow keys turn the box; other keys do nothing", () => {
  const right = keyAngles(DEFAULT_ANGLES, "ArrowRight");
  const left = keyAngles(right, "ArrowLeft");
  assert.equal(left.spin, DEFAULT_ANGLES.spin);
  assert.ok(keyAngles(DEFAULT_ANGLES, "ArrowDown").tilt < DEFAULT_ANGLES.tilt);
  assert.deepEqual(keyAngles(DEFAULT_ANGLES, "a"), DEFAULT_ANGLES);
  let tilt = DEFAULT_ANGLES;
  for (let i = 0; i < 50; i++) tilt = keyAngles(tilt, "ArrowUp");
  assert.equal(tilt.tilt, TILT_MAX_DEG);
});

test("the layout puts the sneaker beside the box and the person behind it, inside the radius", () => {
  for (const dims of [DEFAULT_DIMS, { l: 1, w: 1, h: 1 }, { l: 120, w: 120, h: 120 }, { l: 30, w: 5, h: 90 }]) {
    const layout = layoutOf(dims);
    assert.ok(layout.sneaker.x - SNEAKER_IN.w / 2 >= dims.l / 2, "clear of the box's side");
    assert.ok(layout.person.z < -dims.w / 2, "behind the box");
    assert.equal(layout.height, Math.max(dims.h, PERSON_IN.h));
    const reach = (spot: { x: number; z: number }, extra: number) => Math.hypot(spot.x, spot.z) + extra;
    assert.ok(layout.radius >= Math.hypot(dims.l / 2, dims.w / 2) - 0.01);
    assert.ok(layout.radius >= reach(layout.person, 0) - 0.01);
    assert.ok(layout.radius >= reach(layout.sneaker, 0) - 0.01);
  }
});

test("auto-fit keeps a big box in frame and never zooms past the limits", () => {
  const viewport = { w: 340, h: 300 };
  const small = fitScale(layoutOf({ l: 1, w: 1, h: 1 }), viewport);
  const medium = fitScale(layoutOf(DEFAULT_DIMS), viewport);
  const huge = fitScale(layoutOf({ l: 120, w: 120, h: 120 }), viewport);
  assert.ok(small >= medium && medium > huge, `${small} >= ${medium} > ${huge}`);
  for (const scale of [small, medium, huge]) assert.ok(scale >= MIN_PX_PER_IN && scale <= MAX_PX_PER_IN);
  for (const dims of [DEFAULT_DIMS, { l: 120, w: 120, h: 120 }, { l: 60, w: 10, h: 100 }]) {
    const layout = layoutOf(dims);
    const scale = fitScale(layout, viewport);
    assert.ok(2 * layout.radius * scale <= viewport.w + 0.5, `width ${JSON.stringify(dims)}`);
    assert.ok(layout.height * scale <= viewport.h + 0.5, `height ${JSON.stringify(dims)}`);
  }
  // A 375px phone: the stage is narrower than the desktop one and the box still fits.
  const phone = fitScale(layoutOf({ l: 120, w: 60, h: 30 }), { w: 311, h: 300 });
  assert.ok(2 * layoutOf({ l: 120, w: 60, h: 30 }).radius * phone <= 311);
  assert.ok(Number.isFinite(fitScale(layoutOf(DEFAULT_DIMS), { w: 0, h: 0 })), "a not-yet-measured stage still gives a number");
});

test("the floor grid is a whole, even number of one-foot squares past every object", () => {
  for (const dims of [DEFAULT_DIMS, { l: 1, w: 1, h: 1 }, { l: 120, w: 120, h: 120 }]) {
    const layout = layoutOf(dims);
    const grid = gridOf(layout);
    assert.equal(grid.cells % 2, 0);
    assert.equal(grid.sizeIn, grid.cells * 12);
    if (grid.cells < 40) assert.ok(grid.sizeIn >= 2 * layout.radius);
  }
});

test("a block has five faces sized from its inches at the scale", () => {
  const faces = prismFaces({ l: 20, w: 10, h: 5 }, 4);
  assert.deepEqual(faces.map((f) => f.id), ["front", "back", "right", "left", "top"]);
  const by = Object.fromEntries(faces.map((f) => [f.id, f]));
  assert.deepEqual([by.front.width, by.front.height], [80, 20]);
  assert.deepEqual([by.back.width, by.back.height], [80, 20]);
  assert.deepEqual([by.right.width, by.right.height], [40, 20]);
  assert.deepEqual([by.top.width, by.top.height], [80, 40]);
  assert.match(by.front.transform, /translateZ\(20px\)/, "half the width");
  assert.match(by.right.transform, /rotateY\(90deg\) translateZ\(40px\)/, "half the length");
  assert.match(by.top.transform, /rotateX\(90deg\) translateZ\(10px\)/, "half the height");
});

test("a block stands on the floor at its lift and turns on the spot", () => {
  const t = placeTransform({ x: 2, z: -3 }, { l: 4, w: 4, h: 10 }, 5, 0);
  assert.equal(t, "translate3d(10px, -25px, -15px)");
  assert.match(placeTransform({ x: 0, z: 0 }, { l: 1, w: 1, h: 2 }, 10, 3, 45), /translate3d\(0px, -40px, 0px\) rotateY\(45deg\)/);
});

test("the tape is 2 inches wide, a third of the width at most", () => {
  assert.equal(tapeWidthPx({ l: 20, w: 16, h: 14 }, 3), 6);
  assert.equal(tapeWidthPx({ l: 20, w: 3, h: 14 }, 3), 3);
});

test("the sneaker is 12 x 4.5 x 5 in: a foot and a collar at the heel", () => {
  const parts = sneakerParts();
  const height = Math.max(...parts.map((p) => p.lift + p.dims.h));
  assert.equal(height, SNEAKER_IN.h);
  assert.ok(parts.every((p) => p.dims.l === SNEAKER_IN.w));
  assert.equal(parts[0].dims.w, SNEAKER_IN.l);
  assert.ok(parts[1].spot.z < 0, "the collar is at the back");
});
