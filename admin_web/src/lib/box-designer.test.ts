import assert from "node:assert/strict";
import test from "node:test";

import {
  BOX_SHARE_MIN,
  DASH_GAP_IN,
  DASH_IN,
  DEFAULT_ANGLES,
  FOV_DEG,
  MIN_SHOWN,
  boxHeightLabel,
  cameraDistance,
  clampLabel,
  dashSpans,
  feetInchesText,
  frameOf,
  metersText,
  parseBox3dQuery,
  personLabel,
  poleHeightOf,
  poleTicks,
  readSetDims,
  sceneLabel,
  sceneLayoutOf,
  tapeWidthIn,
  tickLabel,
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


// ---------------------------------------------------------------------------
// The 3D scene's pure half: pole, labels, framing, the page's query.
// ---------------------------------------------------------------------------

test("the pole has a tick every foot, 1 ft to 5 ft for the 5 ft 6 in person", () => {
  assert.deepEqual(
    poleTicks().map((tick) => [tick.feet, tick.inches]),
    [[1, 12], [2, 24], [3, 36], [4, 48], [5, 60]],
  );
  assert.deepEqual(poleTicks(72).map((tick) => tick.feet), [1, 2, 3, 4, 5], "a tick is never drawn at the very top");
  assert.deepEqual(poleTicks(12), []);
  assert.equal(poleTicks(124).length, 10, "a pole over a tall box keeps counting feet");
});

test("the pole stands as tall as the person, or a little over a taller box", () => {
  assert.equal(poleHeightOf({ l: 20, w: 16, h: 14 }), PERSON_IN.h);
  assert.equal(poleHeightOf({ l: 20, w: 16, h: 62 }), 66);
  assert.equal(poleHeightOf({ l: 20, w: 16, h: 100 }), 104);
});

test("labels read in English and French: feet and inches, metres, the French inch and decimal comma", () => {
  assert.equal(feetInchesText(66), "5 ft 6 in");
  assert.equal(feetInchesText(66, "fr"), "5 pi 6 po");
  assert.equal(feetInchesText(60), "5 ft");
  assert.equal(feetInchesText(9), "9 in");
  assert.equal(feetInchesText(9.5, "fr"), "9.5 po");
  assert.equal(metersText(66), "1.68 m");
  assert.equal(metersText(66, "fr"), "1,68 m");
  assert.equal(personLabel(), "5 ft 6 in · 1.68 m");
  assert.equal(personLabel("fr"), "5 pi 6 po · 1,68 m");
  assert.equal(boxHeightLabel(14), "14 in");
  assert.equal(boxHeightLabel(14.5, "fr"), "14.5 po");
  assert.equal(tickLabel(3), "3 ft");
  assert.equal(tickLabel(3, "fr"), "3 pi");
});

test("the 3D layout puts the pole beside the person, away from the box, and keeps everything inside the radius", () => {
  for (const dims of [{ l: 6, w: 6, h: 6 }, { l: 20, w: 16, h: 14 }, { l: 60, w: 40, h: 40 }, { l: 120, w: 120, h: 120 }]) {
    const layout = sceneLayoutOf(dims);
    assert.ok(Math.hypot(layout.pole.x - layout.person.x, layout.pole.z - layout.person.z) >= PERSON_IN.w / 2, "the pole does not stand inside the person");
    assert.ok(Math.hypot(layout.pole.x, layout.pole.z) > Math.hypot(layout.person.x, layout.person.z), "the person is between the pole and the box");
    for (const spot of [layout.pole, layout.person, layout.sneaker]) assert.ok(Math.hypot(spot.x, spot.z) < layout.radius);
    assert.ok(layout.personYaw > 0 && layout.personYaw < 90, "the person faces the box");
    assert.equal(layout.height, Math.max(dims.h, PERSON_IN.h));
  }
  assert.deepEqual({ ...sceneLayoutOf(DEFAULT_DIMS), pole: undefined, personYaw: undefined, radius: undefined }.person, layoutOf(DEFAULT_DIMS).person);
});

test("the camera shows the whole scene for a normal box, and tightens (never past MIN_SHOWN) for a small one", () => {
  for (const aspect of [0.7, 1, 1.25, 1.8]) {
    for (const dims of [{ l: 18, w: 18, h: 18 }, DEFAULT_DIMS, { l: 30, w: 24, h: 24 }, { l: 60, w: 60, h: 60 }, { l: 120, w: 120, h: 120 }]) {
      const frame = frameOf(sceneLayoutOf(dims), aspect);
      const layout = sceneLayoutOf(dims);
      assert.ok(frame.viewHeight * aspect >= 2 * layout.radius, `sideways fit ${JSON.stringify(dims)} @${aspect}`);
      assert.ok(frame.boxShare > 0 && frame.boxShare <= 1);
      assert.ok(Number.isFinite(frame.targetY) && frame.targetY > 0);
    }
  }
  for (const dims of [{ l: 18, w: 18, h: 18 }, DEFAULT_DIMS, { l: 30, w: 24, h: 24 }]) {
    assert.equal(frameOf(sceneLayoutOf(dims), 1.25).cropped, false, `the person and the pole are fully in view for ${JSON.stringify(dims)}`);
  }
  assert.ok(frameOf(sceneLayoutOf(DEFAULT_DIMS), 1.25).boxShare >= BOX_SHARE_MIN - 0.01);
  const shoebox = frameOf(sceneLayoutOf({ l: 12, w: 10, h: 8 }), 1.25);
  assert.equal(shoebox.cropped, true, "a small box tightens the frame");
  assert.ok(shoebox.boxShare >= BOX_SHARE_MIN - 0.04, "so the box stays prominent");
  // However small the box, the frame keeps MIN_SHOWN of the full scene (the full scene is what a Large box needs).
  const full = frameOf(sceneLayoutOf({ l: 4, w: 4, h: 4 }), 1.25);
  const reference = frameOf({ ...sceneLayoutOf({ l: 4, w: 4, h: 4 }), box: { l: 200, w: 200, h: 200 } }, 1.25);
  assert.equal(reference.cropped, false);
  assert.ok(full.viewHeight >= reference.viewHeight * MIN_SHOWN - 0.5, "never tighter than MIN_SHOWN of the full scene");
  assert.ok(full.cropped);
  // A bigger box never gets a visibly smaller share of the frame than a smaller one (1% slack where the frame stops tightening).
  const shares = [8, 12, 18, 24, 36, 60, 100].map((side) => frameOf(sceneLayoutOf({ l: side, w: side, h: side }), 1.25).boxShare);
  for (let i = 1; i < shares.length; i += 1) assert.ok(shares[i] >= shares[i - 1] - 0.01, `share grows ${shares.join(",")}`);
  // A bad aspect does not break the frame.
  assert.ok(Number.isFinite(frameOf(sceneLayoutOf(DEFAULT_DIMS), 0).viewHeight));
  assert.ok(Number.isFinite(frameOf(sceneLayoutOf(DEFAULT_DIMS), Number.NaN).viewHeight));
});

test("camera distance follows the field of view", () => {
  const near = cameraDistance(50);
  const far = cameraDistance(100);
  assert.ok(Math.abs(far - near * 2) < 0.05);
  // At that distance the target plane is exactly viewHeight tall.
  assert.ok(Math.abs(2 * far * Math.tan((FOV_DEG * Math.PI) / 360) - 100) < 0.2);
});

test("a label is pulled back inside the stage, and says which edge it hit", () => {
  const stage = { w: 300, h: 200 };
  const size = { w: 80, h: 20 };
  assert.deepEqual(clampLabel({ x: 150, y: 100 }, size, stage), { x: 150, y: 100, edge: null });
  assert.deepEqual(clampLabel({ x: 5, y: 100 }, size, stage), { x: 44, y: 100, edge: null });
  assert.deepEqual(clampLabel({ x: 400, y: 100 }, size, stage), { x: 256, y: 100, edge: null });
  assert.deepEqual(clampLabel({ x: 150, y: -50 }, size, stage), { x: 150, y: 14, edge: "top" });
  assert.deepEqual(clampLabel({ x: 150, y: 500 }, size, stage), { x: 150, y: 186, edge: "bottom" });
  // A label wider than the stage still lands on a real spot.
  const wide = clampLabel({ x: 0, y: 0 }, { w: 500, h: 20 }, stage);
  assert.ok(Number.isFinite(wide.x) && Number.isFinite(wide.y));
});

test("the standalone page reads its query, and a bad link still shows the default box", () => {
  assert.deepEqual(parseBox3dQuery("?l=30&w=24&h=24&lang=fr"), { dims: { l: 30, w: 24, h: 24 }, lang: "fr" });
  assert.deepEqual(parseBox3dQuery("l=20&w=16,5&h=14.5&lang=en"), { dims: { l: 20, w: 16.5, h: 14.5 }, lang: "en" });
  assert.deepEqual(parseBox3dQuery("?l=20&w=16&h=14"), { dims: { l: 20, w: 16, h: 14 }, lang: "en" }, "no lang = English");
  assert.deepEqual(parseBox3dQuery("?l=20&w=16&h=14&lang=FR").lang, "fr");
  assert.deepEqual(parseBox3dQuery("?l=20&w=16&h=14&lang=de").lang, "en");
  for (const bad of ["", "?l=20&w=16", "?l=0&w=16&h=14", "?l=20&w=abc&h=14", "?l=500&w=16&h=14", "?l=-3&w=16&h=14&lang=fr"]) {
    assert.deepEqual(parseBox3dQuery(bad).dims, { ...DEFAULT_DIMS }, bad);
  }
  assert.equal(parseBox3dQuery("?l=-3&w=16&h=14&lang=fr").lang, "fr", "a bad size keeps the language");
});

test("window.laawolBox3d.setDims reads an object of inches, nothing else", () => {
  assert.deepEqual(readSetDims({ l: 20, w: "16", h: 14.5 }), { l: 20, w: 16, h: 14.5 });
  assert.equal(readSetDims({ l: 20, w: 16 }), null);
  assert.equal(readSetDims({ l: 0, w: 16, h: 14 }), null);
  assert.equal(readSetDims(null), null);
  assert.equal(readSetDims("20x16x14"), null);
});

test("the dashed line is dashes and gaps that fit its length", () => {
  assert.deepEqual(dashSpans(0), []);
  assert.deepEqual(dashSpans(-3), []);
  const spans = dashSpans(30);
  assert.equal(spans[0].from, 0);
  assert.equal(spans[0].length, DASH_IN);
  assert.equal(spans[1].from, DASH_IN + DASH_GAP_IN);
  for (const span of spans) assert.ok(span.from + span.length <= 30 + 1e-9);
  assert.ok(spans.length > 5 && spans.length < 15);
});

test("the tape is 2 in wide, never more than a third of the width; the scene label is unchanged", () => {
  assert.equal(tapeWidthIn({ l: 20, w: 16, h: 14 }), 2);
  assert.equal(tapeWidthIn({ l: 20, w: 3, h: 14 }), 1);
  assert.equal(sceneLabel({ l: 20, w: 16, h: 14 }, "en"), "Box 20 × 16 × 14 in, with a sneaker and a 5 ft 6 in person for scale");
});
