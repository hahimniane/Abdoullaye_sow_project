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
export const TILT_MIN_DEG = -72;
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
