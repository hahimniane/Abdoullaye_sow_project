import assert from "node:assert/strict";
import test from "node:test";

import {
  drawPackageLabel,
  fitTextToWidth,
  labelFont,
  packageQrMatrix,
  packageQrPlacement,
  renderPackageLabelBitmap,
  shrinkToFit,
  type CanvasFactory,
  type LabelContext,
} from "./package-label-canvas.ts";
import { bitmapDotIsBlack, buildLabelJob, PM241_HEIGHT_DOTS, PM241_WIDTH_DOTS } from "./pm241.ts";
import { layoutPackageLabel, layoutPart, type PackageLabel } from "./package-labels.ts";

function label(over: Partial<PackageLabel> = {}): PackageLabel {
  return {
    code: "CL-K7M4P2",
    link: "https://customer.laawoldigital.com/t/CL-K7M4P2",
    what: "Medium box",
    vin: "",
    packageNumber: 1,
    packageCount: 3,
    receiver: "Fatou Diallo",
    receiverPhone: "+224 620 12 34 56",
    sender: "Mamadou Bah",
    senderPhone: "+1 347 555 0100",
    destination: "Guinea",
    size: "24 × 18 × 18 in",
    place: "Guinea · 24 × 18 × 18 in",
    ...over,
  };
}

/** A canvas that only knows rectangles and records the text it was asked to draw. */
function fakeCanvas(width: number, height: number, charWidth = 0.6) {
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const texts: { text: string; x: number; y: number; font: string }[] = [];
  const ctx: LabelContext = {
    fillStyle: "#000",
    font: "10px sans-serif",
    textAlign: "left",
    textBaseline: "alphabetic",
    fillRect(x, y, w, h) {
      const ink = this.fillStyle === "#fff" ? 255 : 0;
      for (let row = Math.max(0, y); row < Math.min(height, y + h); row++) {
        for (let col = Math.max(0, x); col < Math.min(width, x + w); col++) {
          const i = (row * width + col) * 4;
          pixels[i] = pixels[i + 1] = pixels[i + 2] = ink;
          pixels[i + 3] = 255;
        }
      }
    },
    fillText(text, x, y) {
      texts.push({ text, x, y, font: this.font });
    },
    measureText(text) {
      const px = Number(/([\d.]+)px/.exec(this.font)?.[1] ?? 10);
      return { width: Array.from(text).length * px * charWidth };
    },
  };
  return { ctx, pixels, texts };
}

// --- QR --------------------------------------------------------------------

test("the QR of a tracking link is error-correction H with the standard finder patterns", () => {
  const qr = packageQrMatrix("https://customer.laawoldigital.com/t/CL-K7M4P2");
  assert.ok((qr.size - 17) % 4 === 0 && qr.size >= 21, `a real QR size, got ${qr.size}`);
  // The three finder patterns: a dark 7 x 7 ring around a dark 3 x 3 centre.
  for (const [r0, c0] of [[0, 0], [0, qr.size - 7], [qr.size - 7, 0]]) {
    for (let i = 0; i < 7; i++) {
      assert.equal(qr.dark(r0, c0 + i), true);
      assert.equal(qr.dark(r0 + 6, c0 + i), true);
      assert.equal(qr.dark(r0 + i, c0), true);
      assert.equal(qr.dark(r0 + i, c0 + 6), true);
    }
    assert.equal(qr.dark(r0 + 1, c0 + 1), false);
    assert.equal(qr.dark(r0 + 3, c0 + 3), true);
  }
  // H holds fewer bytes than L: the same link needs a bigger symbol at H.
  assert.ok(qr.size >= 33, "a 46-character link at error correction H is version 6 or more");
});

test("the QR sits at whole dots per module, centred, with its quiet zone", () => {
  const layout = layoutPackageLabel(label());
  const qr = packageQrMatrix(layout.link);
  const at = packageQrPlacement(layout, qr.size);
  assert.ok(Number.isInteger(at.module) && at.module >= 2);
  const side = Math.floor(layout.qrSide * 8);
  const n = qr.size + 4;
  assert.equal(at.module, Math.floor(side / n));
  const drawn = qr.size * at.module;
  assert.ok(drawn <= side, "the modules fit their square");
  assert.ok(at.x0 >= Math.floor(layout.qrLeft * 8) + 2 * at.module - at.module, "a quiet zone on the left");
  assert.ok(at.x0 + drawn <= PM241_WIDTH_DOTS && at.y0 + drawn <= PM241_HEIGHT_DOTS);
  // Centred on the label.
  assert.ok(Math.abs(at.x0 + drawn / 2 - PM241_WIDTH_DOTS / 2) <= 2, "centred across the label (to within the dot lost to rounding)");
});

// --- text fitting ----------------------------------------------------------

test("fitTextToWidth keeps what fits and cuts the rest with an ellipsis", () => {
  const measure = (s: string) => Array.from(s).length * 10;
  assert.equal(fitTextToWidth("Fatou", measure, 100), "Fatou");
  assert.equal(fitTextToWidth("Mamadou Alhassane Bah", measure, 100), "Mamadou A…");
  assert.equal(fitTextToWidth("Mamadou Bah", measure, 80), "Mamadou…");
  assert.equal(fitTextToWidth("abcdef", measure, 10), "…");
  assert.equal(fitTextToWidth("abcdef", measure, 0), "…", "never an empty string");
  const cut = fitTextToWidth("x".repeat(500), measure, 300);
  assert.ok(measure(cut) <= 300 && cut.endsWith("…"));
  assert.equal(fitTextToWidth("😀😀😀😀😀", measure, 30), "😀😀…");
});

test("shrinkToFit scales only what is too wide", () => {
  assert.equal(shrinkToFit(80, 100), 1);
  assert.equal(shrinkToFit(200, 100), 0.5);
  assert.equal(shrinkToFit(0, 100), 1);
});

test("fonts: bold sans, regular sans, bold monospace, with fallbacks for any script", () => {
  assert.match(labelFont({ bold: true, mono: false }, 40), /^700 40\.00px .*sans-serif$/);
  assert.match(labelFont({ bold: false, mono: false }, 30), /^400 30\.00px /);
  assert.match(labelFont({ bold: true, mono: true }, 96), /^700 96\.00px .*monospace$/);
});

// --- drawing ---------------------------------------------------------------

test("drawPackageLabel paints white paper, the QR in whole dots, the footer rule and every line", () => {
  const layout = layoutPackageLabel(label(), { businessName: "Nensona", businessPhone: "+1 555 0100", reference: "NEN-12" });
  const qr = packageQrMatrix(layout.link);
  const { ctx, pixels, texts } = fakeCanvas(800, 1180);
  drawPackageLabel(ctx, layout, qr, 800, 1180);

  const black = (x: number, y: number) => pixels[(y * 800 + x) * 4] === 0;
  const at = packageQrPlacement(layout, qr.size);
  // The top-left finder's corner module is black, its inner ring white.
  assert.equal(black(at.x0, at.y0), true);
  assert.equal(black(at.x0 + 1 * at.module + 1, at.y0 + 1 * at.module + 1), false);
  assert.equal(black(at.x0 + 3 * at.module + 1, at.y0 + 3 * at.module + 1), true);
  // Quiet zone: white all round the symbol.
  assert.equal(black(at.x0 - 1, at.y0), false);
  assert.equal(black(at.x0, at.y0 - 1), false);
  // The rule above the footer spans the inner width.
  const ruleY = Math.round(layout.ruleTop! * 8);
  assert.equal(black(Math.round(layout.margin * 8) + 5, ruleY), true);
  assert.equal(black(5, ruleY), false, "not into the margin");
  // The paper is white elsewhere.
  assert.equal(black(2, 2), false);

  const drawn = texts.map((t) => t.text);
  assert.ok(drawn.includes("CL-K7M4P2 · 1 of 3"));
  assert.ok(drawn.includes("TO / POUR") && drawn.includes("FROM / DE"));
  assert.ok(drawn.includes("Fatou Diallo") && drawn.includes("+224 620 12 34 56"));
  assert.ok(drawn.includes("Mamadou Bah") && drawn.includes("+1 347 555 0100"));
  assert.ok(drawn.includes("Guinea · 24 × 18 × 18 in"));
  assert.ok(drawn.includes("Nensona · +1 555 0100") && drawn.includes("NEN-12"));
});

test("drawPackageLabel cuts a long name but shrinks, never cuts, the code and phones", () => {
  const long = label({
    receiver: "Mamadou Alhassane Oumar Abdoulaye Ibrahima Diallo Bah Sow Barry",
    receiverPhone: "+224 620 12 34 56 78 90 12 34 56",
    packageCount: 1,
  });
  const layout = layoutPackageLabel(long);
  // A wide face (0.75 em per letter) so the layout's own estimate is too small.
  const { ctx, texts } = fakeCanvas(800, 1180, 0.75);
  drawPackageLabel(ctx, layout, packageQrMatrix(layout.link), 800, 1180);
  const receiver = texts.find((t) => t.text.startsWith("Mamadou"))!;
  assert.ok(receiver.text.endsWith("…"), "the name is cut");
  const phone = texts.find((t) => t.text.startsWith("+224"))!;
  assert.equal(phone.text, "+224 620 12 34 56 78 90 12 34 56", "the phone is whole");
  const px = (font: string) => Number(/([\d.]+)px/.exec(font)![1]);
  const innerW = (layout.size.widthMm - 2 * layout.margin) * 8;
  assert.ok(phone.text.length * px(phone.font) * 0.75 <= innerW + 0.5, "shrunk to fit the line");
  const code = texts.find((t) => t.text === "CL-K7M4P2")!;
  assert.ok(code.text.length * px(code.font) * 0.75 <= innerW + 0.5);
});

test("text is centred in its box, and the footer's business sits on the left, the container on the right", () => {
  const layout = layoutPackageLabel(label(), { businessName: "Nensona", reference: "NEN-12" });
  const { ctx, texts } = fakeCanvas(800, 1180);
  drawPackageLabel(ctx, layout, packageQrMatrix(layout.link), 800, 1180);
  const code = layoutPart(layout, "code")!;
  const drawnCode = texts.find((t) => t.text.startsWith("CL-K7M4P2"))!;
  const px = Number(/([\d.]+)px/.exec(drawnCode.font)![1]);
  const width = drawnCode.text.length * px * 0.6;
  assert.ok(Math.abs(drawnCode.x + width / 2 - (code.left + code.width / 2) * 8) < 1, "centred");
  const footer = texts.find((t) => t.text === "Nensona")!;
  assert.equal(footer.x, layoutPart(layout, "footer")!.left * 8);
  const ref = texts.find((t) => t.text === "NEN-12")!;
  assert.ok(ref.x > footer.x + 100, "the container ref is on the right");
});

// --- the bitmap ------------------------------------------------------------

test("renderPackageLabelBitmap: an 800 x 1180 1-bit bitmap the printer takes as a job", () => {
  const made: [number, number][] = [];
  const factory: CanvasFactory = (w, h) => {
    made.push([w, h]);
    const canvas = fakeCanvas(w, h);
    return { ctx: canvas.ctx, readPixels: () => canvas.pixels };
  };
  const bitmap = renderPackageLabelBitmap(label(), { businessName: "Nensona", businessPhone: "", reference: "NEN-12" }, factory);
  assert.deepEqual(made, [[800, 1180]]);
  assert.equal(bitmap.widthBytes, 100);
  assert.equal(bitmap.height, 1180);
  assert.equal(bitmap.data.length, 118000);
  // Black dots exist (the QR) and the margin is white.
  assert.equal(bitmapDotIsBlack(bitmap, 0, 0), false);
  const layout = layoutPackageLabel(label(), { businessName: "Nensona", reference: "NEN-12" });
  const at = packageQrPlacement(layout, packageQrMatrix(layout.link).size);
  assert.equal(bitmapDotIsBlack(bitmap, at.x0, at.y0), true);
  const inkBytes = bitmap.data.filter((b) => b !== 0xff).length;
  assert.ok(inkBytes > 500, "the QR and rule leave real ink");
  // And it becomes a printable job: header, 118000 bitmap bytes, PRINT 1.
  const job = buildLabelJob(bitmap);
  assert.ok(job.length > 118000);
});
