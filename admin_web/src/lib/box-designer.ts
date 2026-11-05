/**
 * The box designer's pure half (docs/PACKAGE_BOX_SIZES_PAY_NOW.md section 4):
 * how typed inches are read, how a box, a sneaker and a person are laid out
 * on a one-foot floor grid, how the scene is zoomed to stay in frame, how
 * dragging spins it, and the CSS 3D transform of every face.
 *
 * Pure: no React, no DOM. `box-designer.test.ts` runs it. The component
 * (`components/box-designer/box-designer.tsx`) computes this once per
 * dimension change, never per render or per pointer move.
 *
 * World units are inches. The floor is the XZ plane, the origin is the
 * middle of the box's footprint, +x is the box's length, +z faces the viewer
 * at spin 0, and up is CSS -y. A face is a div centred on its own anchor,
 * moved by `transform` only.
 */

export type Dims = { l: number; w: number; h: number };
export type DimKey = keyof Dims;

export const DIM_KEYS: readonly DimKey[] = ["l", "w", "h"];
export const DIM_MIN_IN = 1;
/** The sliders stop here; a typed number may go up to DIM_MAX_IN (the server's 120). */
export const DIM_SLIDER_MAX_IN = 60;
export const DIM_MAX_IN = 120;
/** The box the designer opens with: about a Medium. */
export const DEFAULT_DIMS: Readonly<Dims> = Object.freeze({ l: 20, w: 16, h: 14 });
/** A sneaker (US men's 10), as a scale reference. */
export const SNEAKER_IN = Object.freeze({ l: 12, w: 4.5, h: 5 });
/** A person 5 ft 6 in tall. */
export const PERSON_IN = Object.freeze({ h: 66, w: 20 });
export const FOOT_IN = 12;

/** Rotation about the vertical axis is free; the tilt (rotateX) stays above the floor. */
export const TILT_MIN_DEG = -89;
export const TILT_MAX_DEG = -6;
export const DEFAULT_SPIN_DEG = -32;
export const DEFAULT_TILT_DEG = -22;

const SPIN_PER_PX = 0.6;
const TILT_PER_PX = 0.4;
const KEY_STEP_DEG = 8;

const round = (value: number, places = 2): number => {
  const k = 10 ** places;
  return Math.round(value * k) / k;
};

// ---------------------------------------------------------------------------
// Inches, as typed.
// ---------------------------------------------------------------------------

/** One dimension as typed ("12", "12.5", "12,5") to a tenth of an inch, or null outside 1 to 120. */
export function readDim(typed: unknown): number | null {
  const raw = String(typed ?? "").trim().replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(raw)) return null;
  const n = Math.round(Number(raw) * 10) / 10;
  return n >= DIM_MIN_IN && n <= DIM_MAX_IN ? n : null;
}

/** A dimension as the field shows it: "12", "12.5". */
export function dimText(value: number): string {
  return Number.isInteger(value) ? String(value) : String(round(value, 1));
}

/** The slider's own position: it stops at 60 even when the number is bigger. */
export function sliderValue(value: number): number {
  return Math.min(DIM_SLIDER_MAX_IN, Math.max(DIM_MIN_IN, Math.round(value)));
}

/** A dimension clamped into 1 to 120 and rounded to a tenth (what a slider or arrow key sets). */
export function clampDim(value: number): number {
  const n = Number.isFinite(value) ? value : DIM_MIN_IN;
  return round(Math.min(DIM_MAX_IN, Math.max(DIM_MIN_IN, n)), 1);
}

export function withDim(dims: Dims, key: DimKey, value: number): Dims {
  return { ...dims, [key]: clampDim(value) };
}

/** All three read from typed text, or null when any is not 1 to 120. */
export function readDims(typed: { l: unknown; w: unknown; h: unknown }): Dims | null {
  const l = readDim(typed.l);
  const w = readDim(typed.w);
  const h = readDim(typed.h);
  return l !== null && w !== null && h !== null ? { l, w, h } : null;
}

/** "20 × 16 × 14 in" / "20 × 16 × 14 po" (the French inch). */
export function dimsText(dims: Dims, lang: "en" | "fr" = "en"): string {
  return `${dimText(dims.l)} × ${dimText(dims.w)} × ${dimText(dims.h)} ${lang === "fr" ? "po" : "in"}`;
}

/** Whether a stored value is a usable {l, w, h} (a request piece's `dimsIn`). */
export function dimsOf(raw: unknown): Dims | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const l = Number(row.l);
  const w = Number(row.w);
  const h = Number(row.h);
  const fine = (n: number) => Number.isFinite(n) && n >= DIM_MIN_IN && n <= DIM_MAX_IN;
  return fine(l) && fine(w) && fine(h) ? { l, w, h } : null;
}

// ---------------------------------------------------------------------------
// Angles.
// ---------------------------------------------------------------------------

export type Angles = { spin: number; tilt: number };

export function clampTilt(deg: number): number {
  const n = Number.isFinite(deg) ? deg : DEFAULT_TILT_DEG;
  return Math.min(TILT_MAX_DEG, Math.max(TILT_MIN_DEG, n));
}

/** Spin kept in -180 to 180 so the number never grows without bound. */
export function wrapSpin(deg: number): number {
  const n = Number.isFinite(deg) ? deg : DEFAULT_SPIN_DEG;
  return ((((n + 180) % 360) + 360) % 360) - 180;
}

export const DEFAULT_ANGLES: Readonly<Angles> = Object.freeze({ spin: DEFAULT_SPIN_DEG, tilt: DEFAULT_TILT_DEG });

/** Dragging by (dx, dy) pixels from `start`: sideways spins, down looks from above (tilt is clamped). */
export function dragAngles(start: Angles, dx: number, dy: number): Angles {
  return { spin: wrapSpin(start.spin + dx * SPIN_PER_PX), tilt: clampTilt(start.tilt - dy * TILT_PER_PX) };
}

/** An arrow key's turn, so the box can be spun without a pointer. */
export function keyAngles(angles: Angles, key: string): Angles {
  if (key === "ArrowLeft") return { ...angles, spin: wrapSpin(angles.spin - KEY_STEP_DEG) };
  if (key === "ArrowRight") return { ...angles, spin: wrapSpin(angles.spin + KEY_STEP_DEG) };
  if (key === "ArrowUp") return { ...angles, tilt: clampTilt(angles.tilt + KEY_STEP_DEG) };
  if (key === "ArrowDown") return { ...angles, tilt: clampTilt(angles.tilt - KEY_STEP_DEG) };
  return angles;
}

// ---------------------------------------------------------------------------
// Layout and zoom.
// ---------------------------------------------------------------------------

export type Spot = { x: number; z: number };
export type Layout = {
  box: Dims;
  /** The middle of the sneaker's footprint, its long side running front to back. */
  sneaker: Spot;
  /** The middle of the person billboard's feet. */
  person: Spot;
  /** Every object lies inside this circle around the origin (so a spin never leaves the frame). */
  radius: number;
  /** The tallest thing: the box or the person. */
  height: number;
};

/** Where the box, the sneaker beside it and the person behind it stand. Once per dimension change. */
export function layoutOf(dims: Dims): Layout {
  const sneaker: Spot = { x: dims.l / 2 + 4 + SNEAKER_IN.w / 2, z: dims.w / 2 - SNEAKER_IN.l / 2 };
  const person: Spot = { x: -(dims.l / 2 + 8), z: -(dims.w / 2 + 10) };
  const boxReach = Math.hypot(dims.l / 2, dims.w / 2);
  const sneakerReach = Math.hypot(Math.abs(sneaker.x) + SNEAKER_IN.w / 2, Math.abs(sneaker.z) + SNEAKER_IN.l / 2);
  const personReach = Math.hypot(person.x, person.z) + PERSON_IN.w / 2;
  return {
    box: dims,
    sneaker,
    person,
    radius: round(Math.max(boxReach, sneakerReach, personReach), 2),
    height: Math.max(dims.h, PERSON_IN.h),
  };
}

export const MIN_PX_PER_IN = 0.3;
export const MAX_PX_PER_IN = 7;

/** Pixels per inch so the whole scene (radius and height) stays inside a viewport, spun or tilted. */
export function fitScale(layout: Pick<Layout, "radius" | "height">, viewport: { w: number; h: number }, pad = 14): number {
  const availW = Math.max(40, viewport.w - pad * 2);
  const availH = Math.max(40, viewport.h - pad * 2);
  const byWidth = availW / (2 * layout.radius);
  // A tilted floor takes depth: reserve a share of the radius on top of the height.
  const byHeight = availH / (layout.height + layout.radius * 0.7);
  const scale = Math.min(byWidth, byHeight);
  return round(Math.min(MAX_PX_PER_IN, Math.max(MIN_PX_PER_IN, scale)), 3);
}

/** The floor grid: one square a foot, big enough to reach past every object, always an even number of squares. */
export function gridOf(layout: Pick<Layout, "radius">): { sizeIn: number; cells: number } {
  const cells = Math.min(40, Math.max(4, 2 * Math.ceil((2 * layout.radius) / FOOT_IN / 2) + 2));
  return { sizeIn: cells * FOOT_IN, cells };
}

// ---------------------------------------------------------------------------
// Faces.
// ---------------------------------------------------------------------------

export type FaceId = "front" | "back" | "left" | "right" | "top";
export type Face = { id: FaceId; width: number; height: number; transform: string };

/**
 * The five visible faces of a block (the bottom is never seen: the tilt stays
 * above the floor), each centred on the block's middle and sized in pixels.
 */
export function prismFaces(dims: Dims, scale: number): Face[] {
  const L = round(dims.l * scale);
  const W = round(dims.w * scale);
  const H = round(dims.h * scale);
  return [
    { id: "front", width: L, height: H, transform: `translateZ(${round(W / 2)}px)` },
    { id: "back", width: L, height: H, transform: `rotateY(180deg) translateZ(${round(W / 2)}px)` },
    { id: "right", width: W, height: H, transform: `rotateY(90deg) translateZ(${round(L / 2)}px)` },
    { id: "left", width: W, height: H, transform: `rotateY(-90deg) translateZ(${round(L / 2)}px)` },
    { id: "top", width: L, height: W, transform: `rotateX(90deg) translateZ(${round(H / 2)}px)` },
  ];
}

/**
 * Where a block's middle goes in the world: its footprint centre `spot`, its
 * floor at `lift` inches, turned about the vertical axis by `rotY` degrees.
 */
export function placeTransform(spot: Spot, dims: Dims, scale: number, lift = 0, rotY = 0): string {
  const x = round(spot.x * scale);
  const z = round(spot.z * scale);
  const y = round(-(lift + dims.h / 2) * scale);
  return `translate3d(${x}px, ${y}px, ${z}px)${rotY ? ` rotateY(${rotY}deg)` : ""}`;
}

/** The width of the tape stripe over the box's top: 2 inches, never more than a third of the width. */
export function tapeWidthPx(dims: Dims, scale: number): number {
  return round(Math.min(2, dims.w / 3) * scale);
}

/** The sneaker as two blocks (the foot, and the ankle collar at the heel), in its own frame. */
export function sneakerParts(): { id: string; dims: Dims; spot: Spot; lift: number }[] {
  const foot: Dims = { l: SNEAKER_IN.w, w: SNEAKER_IN.l, h: 3 };
  const collar: Dims = { l: SNEAKER_IN.w, w: 5, h: SNEAKER_IN.h - 3 };
  // The long side runs along z: the heel is at the back (-z).
  return [
    { id: "foot", dims: foot, spot: { x: 0, z: 0 }, lift: 0 },
    { id: "collar", dims: collar, spot: { x: 0, z: -(SNEAKER_IN.l - collar.w) / 2 }, lift: 3 },
  ];
}

/** What the screen reader hears about the scene. */
export function sceneLabel(dims: Dims, lang: "en" | "fr"): string {
  return lang === "fr"
    ? `Carton de ${dimsText(dims, "fr")}, avec une basket et une personne de 1,68 m pour l’échelle`
    : `Box ${dimsText(dims, "en")}, with a sneaker and a 5 ft 6 in person for scale`;
}

// ---------------------------------------------------------------------------
// The 3D scene (three.js): where the pole stands, how the camera frames the
// scene, and what the labels say. Pure like everything above; the scene itself
// (`components/box-designer/box-3d-scene.ts`) only turns these numbers into
// meshes and DOM labels. Units are still inches, +y is up in the 3D scene.
// ---------------------------------------------------------------------------

export type LabelLang = "en" | "fr";

/** The vertical field of view of the 3D camera, in degrees. */
export const FOV_DEG = 18;
/** Room kept around everything (the labels and the pole's cap need it). */
export const FRAME_MARGIN = 1.06;
/** A small box keeps at least this share of the frame's height: the frame tightens (and may cut the person's head) until it does. */
export const BOX_SHARE_MIN = 0.17;
/** A frame within this share of the full scene is not worth cutting the person's head for: it stays full. */
export const NEAR_FULL = 0.9;
/** But never shows less than this share of the full scene: the pole and most of the person stay in view. */
export const MIN_SHOWN = 0.64;
/** The pole's cap and the room the top label needs above the person. */
export const POLE_CAP_IN = 9;

export type SceneLayout = Layout & {
  /** The measuring pole, standing beside the person on the side away from the box. */
  pole: Spot;
  /** The way the person faces: toward the box, degrees about the vertical axis (0 = facing +z). */
  personYaw: number;
};

/** Where everything stands in the 3D scene. Once per dimension change. */
export function sceneLayoutOf(dims: Dims): SceneLayout {
  const base = layoutOf(dims);
  const pole: Spot = { x: base.person.x - (PERSON_IN.w / 2 + 7), z: base.person.z };
  const poleReach = Math.hypot(pole.x, pole.z) + 2;
  const dx = -base.person.x;
  const dz = -base.person.z;
  return {
    ...base,
    pole,
    radius: round(Math.max(base.radius, poleReach), 2),
    personYaw: round((Math.atan2(dx, dz) * 180) / Math.PI, 1),
  };
}

/** The pole's ticks: one every foot, from 1 ft up to the last whole foot under the person's height. */
export function poleTicks(heightIn: number = PERSON_IN.h): { inches: number; feet: number }[] {
  const ticks: { inches: number; feet: number }[] = [];
  for (let feet = 1; feet * FOOT_IN < heightIn; feet += 1) ticks.push({ inches: feet * FOOT_IN, feet });
  return ticks;
}

/**
 * Which side of the pole its labels go on, on screen: the side away from the person, so "3 ft" never
 * sits on their body. The person stands beside the pole, so whichever way the scene is spun, one
 * side is clear.
 */
export function sideAwayFrom(poleScreenX: number, personScreenX: number): "left" | "right" {
  return personScreenX >= poleScreenX ? "left" : "right";
}

/** Two labels on the same side collide when their boxes come within `gap` px of each other vertically. */
export function labelsCollide(aY: number, aH: number, bY: number, bH: number, gap = 2): boolean {
  return Math.abs(aY - bY) < (aH + bH) / 2 + gap;
}

type LabelBox = { x: number; y: number; w: number; h: number };

/** Two label boxes (centre x/y, width, height) that overlap or come within `gap` px. */
export function boxesOverlap(a: LabelBox, b: LabelBox, gap = 2): boolean {
  return Math.abs(a.x - b.x) < (a.w + b.w) / 2 + gap && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + gap;
}

/**
 * Seen from above the whole pole shrinks to a point, so the box's height lands on the person's height
 * label: it steps down to sit just under it. Answers the box label's centre y.
 */
export function stepBelow(top: LabelBox, box: LabelBox, gap = 4): number {
  return boxesOverlap(top, box) ? top.y + (top.h + box.h) / 2 + gap : box.y;
}

/** "5 ft 6 in" / "5 pi 6 po"; a whole number of feet drops the inches ("5 ft"). */
export function feetInchesText(inches: number, lang: LabelLang = "en"): string {
  const whole = Math.floor(inches / FOOT_IN);
  const rest = round(inches - whole * FOOT_IN, 1);
  const ft = lang === "fr" ? "pi" : "ft";
  const inch = lang === "fr" ? "po" : "in";
  if (whole === 0) return `${dimText(rest)} ${inch}`;
  return rest === 0 ? `${whole} ${ft}` : `${whole} ${ft} ${dimText(rest)} ${inch}`;
}

/** "1.68 m" / "1,68 m" (the French decimal comma). */
export function metersText(inches: number, lang: LabelLang = "en"): string {
  const text = (Math.round(inches * 2.54) / 100).toFixed(2);
  return `${lang === "fr" ? text.replace(".", ",") : text} m`;
}

/** The label at the top of the pole: "5 ft 6 in · 1.68 m" / "5 pi 6 po · 1,68 m". */
export function personLabel(lang: LabelLang = "en"): string {
  return `${feetInchesText(PERSON_IN.h, lang)} · ${metersText(PERSON_IN.h, lang)}`;
}

/** The box's height at the end of the dashed line: "14 in" / "14 po". */
export function boxHeightLabel(height: number, lang: LabelLang = "en"): string {
  return `${dimText(height)} ${lang === "fr" ? "po" : "in"}`;
}

/** A tick's label: "1 ft" / "1 pi". */
export function tickLabel(feet: number, lang: LabelLang = "en"): string {
  return `${feet} ${lang === "fr" ? "pi" : "ft"}`;
}

export type Frame = {
  /** Inches of height the camera sees at the target's distance. */
  viewHeight: number;
  /** The height the camera looks at. */
  targetY: number;
  /** True when the frame was tightened for a small box and the person's head is above the frame. */
  cropped: boolean;
  /** The box's longest side as a share of the frame's height. */
  boxShare: number;
};

/**
 * How the camera frames the scene (looking down at the default tilt; the tilt
 * the person drags to moves the camera around this target, the zoom stays).
 * Everything fits, sideways too, with room for the labels; a small box tightens
 * the frame until it takes `BOX_SHARE_MIN` of the height (never past `MIN_SHOWN`
 * of the full scene), so a shoebox next to a 5 ft 6 in person is still easy to see.
 */
export function frameOf(layout: Pick<SceneLayout, "radius" | "height" | "box">, aspect: number): Frame {
  const elevation = (-DEFAULT_TILT_DEG * Math.PI) / 180;
  const safeAspect = Number.isFinite(aspect) && aspect > 0.2 ? aspect : 1;
  const tallest = layout.height + POLE_CAP_IN;
  const extent = tallest * Math.cos(elevation) + 2 * layout.radius * Math.sin(elevation);
  const full = extent * FRAME_MARGIN;
  const span = Math.max(layout.box.l, layout.box.w, layout.box.h);
  const tight = Math.max(full * MIN_SHOWN, span / BOX_SHARE_MIN);
  const wanted = tight >= full * NEAR_FULL ? full : tight;
  // Never crop sideways: the spin sweeps a circle of the scene's radius.
  const viewHeight = round(Math.max(wanted, (2 * layout.radius * FRAME_MARGIN) / safeAspect), 2);
  const cropped = viewHeight < full - 0.5;
  const pad = cropped ? viewHeight * 0.05 : (viewHeight - extent) / 2;
  const bottom = -layout.radius * Math.sin(elevation) - pad;
  const targetY = round((bottom + viewHeight / 2) / Math.cos(elevation), 2);
  return { viewHeight, targetY, cropped, boxShare: round(span / viewHeight, 3) };
}

/** How far the camera stands from its target to see `viewHeight` inches of height. */
export function cameraDistance(viewHeight: number, fovDeg: number = FOV_DEG): number {
  return round(viewHeight / 2 / Math.tan((fovDeg * Math.PI) / 360), 2);
}

/**
 * Keeps a label inside the stage: its anchor (x, y in pixels, the label's
 * middle) is pulled in by half its size plus `pad`. `edge` says which side it
 * was pushed off, so a label above the frame can show an arrow.
 */
export function clampLabel(
  anchor: { x: number; y: number },
  size: { w: number; h: number },
  stage: { w: number; h: number },
  pad = 4,
): { x: number; y: number; edge: "top" | "bottom" | null } {
  const minX = size.w / 2 + pad;
  const maxX = Math.max(minX, stage.w - size.w / 2 - pad);
  const minY = size.h / 2 + pad;
  const maxY = Math.max(minY, stage.h - size.h / 2 - pad);
  const x = Math.min(maxX, Math.max(minX, anchor.x));
  const y = Math.min(maxY, Math.max(minY, anchor.y));
  const edge = anchor.y < minY ? "top" : anchor.y > maxY ? "bottom" : null;
  return { x: round(x, 1), y: round(y, 1), edge };
}

/**
 * The standalone page's query (`/box-3d/?l=20&w=16&h=14&lang=en`): inches as
 * typed (a French comma is fine) and the language. Anything missing or invalid
 * falls back to the default box, so a bad link still shows a box.
 */
export function parseBox3dQuery(search: string): { dims: Dims; lang: LabelLang; credit: boolean } {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const dims = readDims({ l: params.get("l"), w: params.get("w"), h: params.get("h") }) ?? { ...DEFAULT_DIMS };
  const lang = String(params.get("lang") ?? "").trim().toLowerCase() === "fr" ? "fr" : "en";
  // The app shows the models' credit under the scene itself (credit=0), where it never covers the labels.
  const credit = params.get("credit") !== "0";
  return { dims, lang, credit };
}

/** What the page's `window.laawolBox3d.setDims` was given (an object or loose text), or null when unusable. */
export function readSetDims(raw: unknown): Dims | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  return readDims({ l: row.l, w: row.w, h: row.h });
}

/** The pole is the person's height, or a little over the box when the box is taller than the person. */
export function poleHeightOf(dims: Dims): number {
  return Math.max(PERSON_IN.h, dims.h + 4);
}

/** The tape stripe's width in inches (the CSS box's `tapeWidthPx`, before the zoom). */
export function tapeWidthIn(dims: Dims): number {
  return round(Math.min(2, dims.w / 3), 2);
}

export const DASH_IN = 1.6;
export const DASH_GAP_IN = 1.2;

/** The dashes of the line at the box's height: where each starts and how long it is, along a line of `lengthIn`. */
export function dashSpans(lengthIn: number): { from: number; length: number }[] {
  const spans: { from: number; length: number }[] = [];
  if (!(lengthIn > 0)) return spans;
  for (let at = 0; at < lengthIn - 0.05; at += DASH_IN + DASH_GAP_IN) {
    spans.push({ from: round(at, 2), length: round(Math.min(DASH_IN, lengthIn - at), 2) });
  }
  return spans;
}

/** The credit the 3D models' licenses ask for, in the page language. */
export function modelCredit(lang: "en" | "fr"): string {
  return lang === "fr"
    ? "Modèles 3D : « Man » par Quaternius (CC0) ; « Sneakers » par Poly by Google (CC BY 3.0)"
    : '3D models: "Man" by Quaternius (CC0); "Sneakers" by Poly by Google (CC BY 3.0)';
}
