import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildM421Job,
  isM421DoneFrame,
  isM421Name,
  M421_FOOTER,
  M421_ROW_BYTES,
  m421Raster,
  M421Link,
} from "./m421.ts";
import { PrinterError, printLabels, type LabelBitmap, type LabelLink, type PrinterTransport } from "./pm241.ts";

// The Phomemo M421 as measured on a real one on 2026-11-14 (see m421.ts).

/** An 800 x `height` label: white, with the dots listed in `black` printed. */
function label(height: number, black: [number, number][] = []): LabelBitmap {
  const widthBytes = 100;
  const data = new Uint8Array(widthBytes * height).fill(0xff);
  for (const [x, y] of black) data[y * widthBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
  return { width: 800, height, widthBytes, data };
}

function count(bytes: Uint8Array, needle: number[]): number {
  let n = 0;
  for (let i = 0; i + needle.length <= bytes.length; i++) {
    if (needle.every((b, j) => bytes[i + j] === b)) n += 1;
  }
  return n;
}

/** A fake M421: a credit per packet, and `1A 0F 0C` once the footer has arrived. */
function connected(options: { answerDone?: boolean; autoCredit?: boolean } = {}) {
  let link!: M421Link;
  const packets: Uint8Array[] = [];
  const tail: number[] = [];
  const transport: PrinterTransport = {
    async write(packet) {
      packets.push(packet.slice());
      tail.push(...packet);
      tail.splice(0, Math.max(0, tail.length - M421_FOOTER.length));
      if (options.autoCredit !== false) queueMicrotask(() => link.handleNotification([0x01, 0x01]));
      if (options.answerDone !== false && M421_FOOTER.every((b, i) => tail[i] === b)) {
        queueMicrotask(() => link.handleNotification([0x1a, 0x0f, 0x0c]));
      }
    },
  };
  link = new M421Link(transport, { creditTimeoutMs: 50, doneTimeoutMs: 50, settleMs: 20, commandGapMs: 0, afterRasterMs: 0 });
  // What the real one says when notifications come on.
  link.handleNotification([0x01, 0x07]);
  link.handleNotification([0x02, 0xb6, 0x00]);
  link.handleNotification([0x1a, 0x3b, 0x04, 0x00, 0x04, 0x00, 0x00]);
  return { link, packets, sent: () => Uint8Array.from(packets.flatMap((p) => [...p])) };
}

test("the M421 is told by its name", () => {
  for (const name of ["M421", "m421", "M421-1234", "M-421"]) assert.equal(isM421Name(name), true, name);
  for (const name of ["PM-241-BT", "Q2A1", "M221", "", undefined]) assert.equal(isM421Name(name), false, String(name));
});

test("the picture goes 48 dots in on 864-dot rows, 1 = black", () => {
  // Centred on 832 dots it printed 4 mm too far left on the real printer.
  const raster = m421Raster(label(2, [[0, 0], [799, 0], [8, 1]]));
  assert.equal(raster.length, M421_ROW_BYTES * 2);
  // Row 0: the label's first dot is head dot 48, its last is head dot 847.
  assert.equal(raster[6], 0x80);
  assert.equal(raster[105], 0x01);
  for (const byte of [0, 5, 106, 107]) assert.equal(raster[byte], 0x00, `row 0 byte ${byte}`);
  // Row 1: dot 8 of the label is the first bit of the 8th byte.
  assert.equal(raster[M421_ROW_BYTES + 7], 0x80);
  // A white label prints nothing.
  assert.equal(m421Raster(label(3)).some((b) => b !== 0), false);
});

test("one label is setup, ONE raster command, the footer", () => {
  const job = buildM421Job(label(1180, [[0, 0]]));
  assert.deepEqual([...job.subarray(0, 19)], [
    0x1b, 0x4e, 0x0d, 0x05, // speed 5
    0x1b, 0x4e, 0x04, 0x0c, // density 6
    0x1f, 0x11, 0x0a, // gap media
    0x1d, 0x76, 0x30, 0x00, 108, 0x00, 0x9c, 0x04, // GS v 0: 108 bytes x 1180 rows
  ]);
  assert.equal(job.length, 19 + 108 * 1180 + 8);
  assert.deepEqual([...job.subarray(job.length - 8)], [...M421_FOOTER]);
  // The printer feeds to the next label after EVERY raster command.
  assert.equal(count(job, [0x1d, 0x76, 0x30, 0x00, 108, 0x00]), 1);
  // No TSPL.
  assert.equal(new TextDecoder().decode(job.subarray(0, 19)).includes("SIZE"), false);
});

test("a bitmap that does not fit is refused", () => {
  assert.throws(() => m421Raster({ width: 824, height: 1, widthBytes: 103, data: new Uint8Array(103) }), RangeError);
  assert.throws(() => m421Raster({ width: 800, height: 2, widthBytes: 100, data: new Uint8Array(100) }), RangeError);
});

test("credits and the printer's own replies are read apart", () => {
  const { link } = connected();
  assert.equal(link.flow.credits, 7);
  assert.equal(link.flow.packetSize(), 182);
  // A binary reply is not a credit and not text; the credit after it counts.
  assert.equal(link.handleNotification([0x1a, 0x04, 0x58]).kind, "unknown");
  link.handleNotification([0x01, 0x01]);
  assert.equal(link.flow.credits, 8);
  // Credits and a done frame in one notification.
  assert.equal(link.handleNotification([0x01, 0x02, 0x1a, 0x0f, 0x0c]).kind, "done");
  assert.equal(link.flow.credits, 10);
  assert.equal(isM421DoneFrame([0x1a, 0x0f, 0x0c]), true);
  assert.equal(isM421DoneFrame([0x1a, 0x04, 0x58]), false);
});

test("printLabels sends the M421 job, paced by credits, and waits for 1A 0F", async () => {
  const { link, packets, sent } = connected();
  const bitmap = label(40, [[3, 3]]);
  const printed = await printLabels(link as LabelLink, 2, () => bitmap);
  assert.equal(printed, 2);
  const job = buildM421Job(bitmap);
  assert.deepEqual([...sent()], [...job, ...job]);
  assert.equal(packets.every((p) => p.length <= 182), true);
  // Each setup command went out by itself, as in the sequence that printed.
  assert.deepEqual(packets.slice(0, 3).map((p) => p.length), [4, 4, 3]);
});

test("no done frame: the label is not confirmed", async () => {
  const { link } = connected({ answerDone: false });
  await assert.rejects(printLabels(link as LabelLink, 1, () => label(8)), (error: unknown) => {
    assert.ok(error instanceof PrinterError);
    assert.equal(error.code, "not_confirmed");
    assert.equal(error.printed, 0);
    return true;
  });
});

test("a printer that stops granting credits is not flooded", async () => {
  const { link, packets } = connected({ autoCredit: false });
  await assert.rejects(printLabels(link as LabelLink, 1, () => label(200)), (error: unknown) => {
    assert.ok(error instanceof PrinterError);
    assert.equal(error.code, "no_credit");
    return true;
  });
  assert.equal(packets.length, 7, "only the 7 packets it granted");
});

test("the page offers the M421 in the chooser and gives it its own link", () => {
  const source = readFileSync(new URL("./pm241-printer.ts", import.meta.url), "utf8");
  assert.match(source, /filters: \[\.\.\.PM241_NAME_PREFIXES, \.\.\.M421_NAME_PREFIXES\]/);
  assert.match(source, /isM421Name\(device\.name\) \? M421Link : Pm241Link/);
  const picker = readFileSync(new URL("../components/business/label-printer-picker.tsx", import.meta.url), "utf8");
  assert.match(picker, /Phomemo PM-241 or M421/);
});
