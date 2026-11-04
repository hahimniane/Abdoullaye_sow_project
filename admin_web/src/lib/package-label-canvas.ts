/**
 * Draws a package label (`package-labels.ts` layout) on a canvas at the
 * PM-241's 800 x 1180 dots, then thresholds it to the 1-bit bitmap the
 * printer takes (`pm241.ts` `packBitmap`).
 *
 * Mirrors the app's `package_label_bitmap.dart`: the text is drawn with the
 * computer's own fonts (any script a name is written in), the QR is drawn
 * straight into dots at a whole number of dots per module so it prints crisp,
 * and a name too long for its line is cut with "..." while the code and the
 * phones are shrunk instead, never cut.
 *
 * The drawing code only needs a small slice of the canvas API (`LabelContext`),
 * so `package-label-canvas.test.ts` runs it against a recording fake; the
 * pure parts (QR placement, text fitting) are tested directly.
 */

import qrcode from "qrcode-generator";

import { packBitmap, PM241_DOTS_PER_MM, type LabelBitmap } from "./pm241.ts";
import {
  layoutPackageLabel,
  PACKAGE_LABEL_QUIET_MODULES,
  PACKAGE_LABEL_RULE_MM,
  type PackageLabel,
  type PackageLabelLayout,
  type PackageLabelSet,
  type PackageLabelText,
} from "./package-labels.ts";

/** The slice of `CanvasRenderingContext2D` the label needs. */
export interface LabelContext {
  fillStyle: string | CanvasGradient | CanvasPattern;
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  measureText(text: string): { width: number };
}

export type QrMatrix = { size: number; dark: (row: number, col: number) => boolean };

/** The QR of `link`: error correction H, the smallest version that holds it. */
export function packageQrMatrix(link: string): QrMatrix {
  const code = qrcode(0, "H");
  code.addData(link, "Byte");
  code.make();
  return { size: code.getModuleCount(), dark: (row, col) => code.isDark(row, col) };
}

const dots = (mm: number) => mm * PM241_DOTS_PER_MM;

/**
 * Where the QR's modules land in dots: a whole number of dots per module,
 * centred in the layout's square with its quiet zone (the app's
 * `packageQrPlacement`, so both print the same QR).
 */
export function packageQrPlacement(layout: PackageLabelLayout, qrSize: number): { x0: number; y0: number; module: number } {
  const side = Math.floor(dots(layout.qrSide));
  const n = qrSize + 2 * PACKAGE_LABEL_QUIET_MODULES;
  const module = Math.max(2, Math.floor(side / n));
  const drawn = qrSize * module;
  const left = Math.floor(dots(layout.qrLeft));
  const top = Math.floor(dots(layout.qrTop));
  return { x0: left + Math.floor((side - drawn) / 2), y0: top + Math.floor((side - drawn) / 2), module };
}

/**
 * `text` as long as fits in `maxWidth` (as `measure` reports), cut with "…"
 * when it does not. Unchanged text is returned as is.
 */
export function fitTextToWidth(text: string, measure: (text: string) => number, maxWidth: number): string {
  if (measure(text) <= maxWidth) return text;
  const runes = Array.from(text);
  let low = 0;
  let high = runes.length - 1;
  // The longest prefix whose "…" version fits (monotone: more letters, wider).
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (measure(`${runes.slice(0, mid).join("").trimEnd()}…`) <= maxWidth) low = mid;
    else high = mid - 1;
  }
  return `${runes.slice(0, low).join("").trimEnd()}…`;
}

/** How much to shrink something `natural` wide to fit `box` (1 when it fits). */
export function shrinkToFit(natural: number, box: number): number {
  return natural > box && natural > 0 ? Math.max(0, box / natural) : 1;
}

const SANS = '"Helvetica Neue", Helvetica, Arial, "Segoe UI", Roboto, sans-serif';
const MONO = 'Menlo, Consolas, "Liberation Mono", "Courier New", monospace';

/** The CSS font for a text at `px` (the em size in dots). */
export function labelFont(t: Pick<PackageLabelText, "bold" | "mono">, px: number): string {
  return `${t.bold ? 700 : 400} ${px.toFixed(2)}px ${t.mono ? MONO : SANS}`;
}

/** Draws one text line into its box. */
function drawText(ctx: LabelContext, t: PackageLabelText): void {
  if (t.fontMm <= 0 || !t.text) return;
  const boxLeft = dots(t.left);
  const boxW = dots(t.width);
  const boxH = dots(t.height);
  let px = dots(t.fontMm);
  const measure = (text: string) => {
    ctx.font = labelFont(t, px);
    return ctx.measureText(text).width;
  };
  // A name too long for the label is cut; the code and the phones are shrunk
  // instead (below), never cut.
  const text = t.whole ? t.text : fitTextToWidth(t.text, measure, boxW);
  const scale = shrinkToFit(measure(text), boxW);
  if (scale < 1) px *= scale;
  ctx.font = labelFont(t, px);
  const width = Math.min(ctx.measureText(text).width, boxW);
  const x = t.align === "left" ? boxLeft : t.align === "right" ? boxLeft + boxW - width : boxLeft + (boxW - width) / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#000";
  ctx.fillText(text, x, dots(t.top) + boxH / 2);
}

/**
 * Paints the whole label: white paper, the QR in whole dots, the rule above
 * the footer, then every line of text. `width` x `height` are the canvas in
 * dots.
 */
export function drawPackageLabel(ctx: LabelContext, layout: PackageLabelLayout, qr: QrMatrix | null, width: number, height: number): void {
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = "#000";

  if (qr && layout.qrSide > 0) {
    const at = packageQrPlacement(layout, qr.size);
    for (let r = 0; r < qr.size; r++) {
      let c = 0;
      while (c < qr.size) {
        if (!qr.dark(r, c)) {
          c++;
          continue;
        }
        let end = c;
        while (end < qr.size && qr.dark(r, end)) end++;
        // Whole-dot rectangles: no anti-aliased edges to threshold.
        ctx.fillRect(at.x0 + c * at.module, at.y0 + r * at.module, (end - c) * at.module, at.module);
        c = end;
      }
    }
  }

  if (layout.ruleTop !== null) {
    ctx.fillRect(
      Math.round(dots(layout.margin)),
      Math.round(dots(layout.ruleTop)),
      Math.round(dots(layout.size.widthMm - 2 * layout.margin)),
      Math.max(2, Math.round(dots(PACKAGE_LABEL_RULE_MM))),
    );
  }

  for (const t of layout.texts) drawText(ctx, t);
}

/** A canvas the label is drawn on and read back from. */
export type LabelCanvas = { ctx: LabelContext; readPixels: () => ArrayLike<number> };
export type CanvasFactory = (width: number, height: number) => LabelCanvas;

/** An offscreen browser canvas. Throws where there is no canvas to draw on. */
export const browserCanvas: CanvasFactory = (width, height) => {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("This browser cannot draw the label.");
  return { ctx, readPixels: () => ctx.getImageData(0, 0, width, height).data };
};

/** One label as the printer's 1-bit bitmap. */
export function renderPackageLabelBitmap(
  label: PackageLabel,
  set: Pick<PackageLabelSet, "businessName" | "businessPhone" | "reference">,
  createCanvas: CanvasFactory = browserCanvas,
): LabelBitmap {
  const layout = layoutPackageLabel(label, { businessName: set.businessName, businessPhone: set.businessPhone, reference: set.reference });
  const width = Math.round(dots(layout.size.widthMm));
  const height = Math.round(dots(layout.size.heightMm));
  const canvas = createCanvas(width, height);
  drawPackageLabel(canvas.ctx, layout, packageQrMatrix(layout.link), width, height);
  return packBitmap(canvas.readPixels(), width, height);
}
