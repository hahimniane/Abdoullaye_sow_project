import assert from "node:assert/strict";
import test from "node:test";

import {
  bitmapDotIsBlack,
  buildLabelJob,
  FlowControl,
  packBitmap,
  parsePrinterReply,
  Pm241Link,
  PM241_HEADER,
  PM241_MAX_PACKET,
  PrinterError,
  printLabels,
  splitPackets,
  withTimeout,
  type LabelBitmap,
  type PrinterTransport,
  type PrintProgress,
} from "./pm241.ts";

const BLACK = [0, 0, 0, 255];
const WHITE = [255, 255, 255, 255];

function rgba(pixels: number[][]): Uint8ClampedArray {
  return Uint8ClampedArray.from(pixels.flat());
}

function ascii(text: string): number[] {
  return [...new TextEncoder().encode(text)];
}

/** A fake printer: records packets, hands out credit like the real one. */
function fakePrinter(link: () => Pm241Link, options: { autoCredit?: boolean; failAt?: number } = {}) {
  const packets: Uint8Array[] = [];
  const transport: PrinterTransport = {
    async write(packet) {
      if (options.failAt !== undefined && packets.length === options.failAt) throw new Error("GATT busy");
      packets.push(packet.slice());
      // The real printer answers every packet with [01 01].
      if (options.autoCredit !== false) queueMicrotask(() => link().handleNotification([0x01, 0x01]));
    },
  };
  return { transport, packets };
}

function connected(options: { autoCredit?: boolean; failAt?: number; timeouts?: { credit?: number; done?: number; settle?: number } } = {}) {
  let link!: Pm241Link;
  const printer = fakePrinter(() => link, options);
  link = new Pm241Link(printer.transport, {
    creditTimeoutMs: options.timeouts?.credit ?? 50,
    doneTimeoutMs: options.timeouts?.done ?? 50,
    settleMs: options.timeouts?.settle ?? 20,
  });
  return { link, ...printer };
}

// --- the bitmap ------------------------------------------------------------

test("packBitmap: 1 = white, 0 = black, the leftmost dot is bit 7", () => {
  // Row 0: black white white white white white white white  -> 0111 1111
  // Row 1: white white white white white white white black  -> 1111 1110
  const row0 = [BLACK, ...Array(7).fill(WHITE)];
  const row1 = [...Array(7).fill(WHITE), BLACK];
  const bitmap = packBitmap(rgba([...row0, ...row1]), 8, 2);
  assert.equal(bitmap.widthBytes, 1);
  assert.deepEqual([...bitmap.data], [0b01111111, 0b11111110]);
});

test("packBitmap: an all-white label is all ones, an all-black one all zeros", () => {
  const white = packBitmap(rgba(Array(16).fill(WHITE)), 8, 2);
  assert.deepEqual([...white.data], [0xff, 0xff]);
  const black = packBitmap(rgba(Array(16).fill(BLACK)), 8, 2);
  assert.deepEqual([...black.data], [0x00, 0x00]);
});

test("packBitmap: a width that is not a multiple of 8 pads with white", () => {
  // 3 dots wide, all black: bits 7..5 are 0, the 5 padding bits stay 1.
  const bitmap = packBitmap(rgba(Array(3).fill(BLACK)), 3, 1);
  assert.equal(bitmap.widthBytes, 1);
  assert.equal(bitmap.data[0], 0b00011111);
});

test("packBitmap: 800 dots wide is 100 bytes a row and 1180 rows", () => {
  const bitmap = packBitmap(new Uint8ClampedArray(800 * 1180 * 4).fill(255), 800, 1180);
  assert.equal(bitmap.widthBytes, 100);
  assert.equal(bitmap.height, 1180);
  assert.equal(bitmap.data.length, 118000);
});

test("packBitmap: grey is thresholded at mid-grey, transparent is paper", () => {
  const dark = [100, 100, 100, 255];
  const light = [160, 160, 160, 255];
  const clear = [0, 0, 0, 0];
  const bitmap = packBitmap(rgba([dark, light, clear, WHITE, WHITE, WHITE, WHITE, WHITE]), 8, 1);
  assert.equal(bitmapDotIsBlack(bitmap, 0, 0), true);
  assert.equal(bitmapDotIsBlack(bitmap, 1, 0), false);
  assert.equal(bitmapDotIsBlack(bitmap, 2, 0), false);
});

test("packBitmap refuses a size that does not match its pixels", () => {
  assert.throws(() => packBitmap(new Uint8ClampedArray(4), 2, 2), RangeError);
  assert.throws(() => packBitmap(new Uint8ClampedArray(4), 0, 1), RangeError);
});

// --- the job ---------------------------------------------------------------

test("buildLabelJob: exact bytes for a tiny bitmap", () => {
  const bitmap: LabelBitmap = { width: 8, height: 2, widthBytes: 1, data: Uint8Array.from([0b01111111, 0b11111110]) };
  const job = buildLabelJob(bitmap);
  const expected = [
    ...ascii("SIZE 100 mm, 150 mm\r\n"),
    ...ascii("GAP 3 mm, 0 mm\r\n"),
    ...ascii("DENSITY 10\r\n"),
    ...ascii("SPEED 4\r\n"),
    ...ascii("DIRECTION 0\r\n"),
    ...ascii("CLS\r\n"),
    ...ascii("BITMAP 6,10,1,2,0,"),
    0b01111111,
    0b11111110,
    ...ascii("\r\nPRINT 1\r\n"),
  ];
  assert.deepEqual([...job], expected);
});

test("buildLabelJob: never END, never DIRECTION 1, DIRECTION 0 before the bitmap", () => {
  const bitmap = packBitmap(new Uint8ClampedArray(800 * 1180 * 4).fill(255), 800, 1180);
  const job = buildLabelJob(bitmap);
  const head = new TextDecoder().decode(job.subarray(0, 200));
  assert.ok(head.startsWith(PM241_HEADER));
  assert.match(head, /DIRECTION 0\r\n/);
  assert.doesNotMatch(head, /DIRECTION 1/);
  const tail = new TextDecoder().decode(job.subarray(job.length - 20));
  assert.equal(tail.endsWith("\r\nPRINT 1\r\n"), true);
  assert.doesNotMatch(tail, /END/);
  assert.match(head, /BITMAP 6,10,100,1180,0,/);
  // header + bitmap + trailer, nothing else.
  const bitmapCommand = "BITMAP 6,10,100,1180,0,";
  assert.equal(job.length, PM241_HEADER.length + bitmapCommand.length + 118000 + "\r\nPRINT 1\r\n".length);
});

test("buildLabelJob refuses a bitmap whose bytes do not add up", () => {
  assert.throws(() => buildLabelJob({ width: 8, height: 2, widthBytes: 1, data: new Uint8Array(1) }), RangeError);
});

// --- replies ---------------------------------------------------------------

test("parsePrinterReply: credits, packet size and the text replies", () => {
  assert.deepEqual(parsePrinterReply([0x01, 0x07]), { kind: "credit", packets: 7 });
  assert.deepEqual(parsePrinterReply([0x01, 0x01]), { kind: "credit", packets: 1 });
  assert.deepEqual(parsePrinterReply([0x02, 0xf4, 0x00]), { kind: "maxPacket", size: 244 });
  assert.deepEqual(parsePrinterReply([0x02, 0x00, 0x01]), { kind: "maxPacket", size: 256 });
  assert.deepEqual(parsePrinterReply(ascii("SSSGETPRINTING:DOING")), { kind: "printing" });
  assert.deepEqual(parsePrinterReply(ascii("SSSGETPRINTING:DONE")), { kind: "done" });
  assert.deepEqual(parsePrinterReply(ascii("SSSGETPRINTING:DONE\r\n")), { kind: "done" });
  assert.deepEqual(parsePrinterReply(ascii("Cmd error:BITMAP")), { kind: "cmdError", token: "BITMAP" });
  assert.deepEqual(parsePrinterReply(ascii("hello")), { kind: "text", text: "hello" });
});

test("parsePrinterReply: empty and truncated notifications never throw", () => {
  assert.deepEqual(parsePrinterReply([]), { kind: "unknown" });
  assert.equal(parsePrinterReply([0x01]).kind, "unknown");
  assert.equal(parsePrinterReply([0x02, 0x10]).kind, "unknown");
});

// --- packets and credits ---------------------------------------------------

test("splitPackets: whole packets and a short last one, capped at 244", () => {
  const data = Uint8Array.from({ length: 10 }, (_, i) => i);
  assert.deepEqual(splitPackets(data, 4).map((p) => [...p]), [[0, 1, 2, 3], [4, 5, 6, 7], [8, 9]]);
  assert.equal(splitPackets(new Uint8Array(1000), 5000)[0].length, PM241_MAX_PACKET);
  assert.equal(splitPackets(new Uint8Array(1000), 5000).length, Math.ceil(1000 / PM241_MAX_PACKET));
  assert.equal(splitPackets(new Uint8Array(0), 20).length, 0);
  assert.equal(splitPackets(new Uint8Array(3), 0).length, 3, "a size below 1 still moves");
});

test("FlowControl: credits add up, the packet size is min(announced, 244)", () => {
  const flow = new FlowControl();
  assert.equal(flow.credits, 0);
  assert.equal(flow.packetSize(), 20);
  assert.equal(flow.apply({ kind: "credit", packets: 7 }), true);
  assert.equal(flow.apply({ kind: "credit", packets: 1 }), true);
  assert.equal(flow.credits, 8);
  flow.apply({ kind: "maxPacket", size: 244 });
  assert.equal(flow.packetSize(), 244);
  flow.apply({ kind: "maxPacket", size: 512 });
  assert.equal(flow.packetSize(), 244, "never past 244");
  assert.equal(flow.apply({ kind: "done" }), false);
});

test("Pm241Link.send: one packet per credit, in order, none lost", async () => {
  const { link, packets } = connected();
  link.handleNotification([0x02, 0x0a, 0x00]); // packets of 10
  link.handleNotification([0x01, 0x03]); // three credits to start, then one per packet
  const data = Uint8Array.from({ length: 95 }, (_, i) => i);
  await link.send(data);
  assert.equal(packets.length, 10);
  assert.ok(packets.slice(0, 9).every((p) => p.length === 10));
  assert.equal(packets[9].length, 5);
  assert.deepEqual([...packets.flatMap((p) => [...p])], [...data]);
});

test("Pm241Link.send: waits for credit instead of running ahead", async () => {
  const { link, packets } = connected({ autoCredit: false, timeouts: { credit: 500 } });
  link.handleNotification([0x02, 0x04, 0x00]); // 4-byte packets
  link.handleNotification([0x01, 0x02]); // only two packets' worth of credit
  const done = link.send(new Uint8Array(20));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(packets.length, 2, "stops when the credit runs out");
  link.handleNotification([0x01, 0x03]);
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(packets.length, 5, "sends exactly as many as the new credit allows");
  link.handleNotification([0x01, 0x05]);
  await done;
  assert.equal(packets.length, 5);
});

test("Pm241Link.send: no credit in time fails cleanly, never hangs", async () => {
  const { link, packets } = connected({ autoCredit: false, timeouts: { credit: 30 } });
  link.handleNotification([0x01, 0x01]);
  await assert.rejects(link.send(new Uint8Array(100)), (error: unknown) => error instanceof PrinterError && error.code === "no_credit");
  assert.equal(packets.length, 1);
});

test("Pm241Link.send: a failed write is a PrinterError", async () => {
  const { link } = connected({ failAt: 0 });
  link.handleNotification([0x01, 0x07]);
  await assert.rejects(link.send(new Uint8Array(100)), (error: unknown) => error instanceof PrinterError && error.code === "write_failed");
});

test("Pm241Link: a dropped link ends every wait", async () => {
  const { link } = connected({ autoCredit: false, timeouts: { credit: 5000, done: 5000 } });
  const sending = link.send(new Uint8Array(10));
  const waiting = link.waitDone();
  link.close();
  await assert.rejects(sending, (error: unknown) => error instanceof PrinterError && error.code === "disconnected");
  await assert.rejects(waiting, (error: unknown) => error instanceof PrinterError && error.code === "disconnected");
  await assert.rejects(link.send(new Uint8Array(1)), (error: unknown) => error instanceof PrinterError && error.code === "disconnected");
});

test("Pm241Link.waitDone: DOING then DONE resolves; silence fails with not_confirmed", async () => {
  const { link } = connected({ timeouts: { done: 40 } });
  link.beginJob();
  const done = link.waitDone();
  link.handleNotification(ascii("SSSGETPRINTING:DOING"));
  assert.equal(link.isPrinting, true);
  link.handleNotification(ascii("SSSGETPRINTING:DONE"));
  await done;
  assert.equal(link.isPrinting, false);

  link.beginJob();
  link.handleNotification(ascii("Cmd error:BITMAP"));
  await assert.rejects(link.waitDone(), (error: unknown) => {
    return error instanceof PrinterError && error.code === "not_confirmed" && error.rejected.join() === "BITMAP";
  });
});

test("Pm241Link: the last job's DONE does not confirm the next one", async () => {
  const { link } = connected({ timeouts: { done: 30 } });
  link.beginJob();
  link.handleNotification(ascii("SSSGETPRINTING:DONE"));
  await link.waitDone();
  link.beginJob();
  await assert.rejects(link.waitDone(), (error: unknown) => error instanceof PrinterError && error.code === "not_confirmed");
});

test("Pm241Link.settle: returns once credit and packet size arrive, and never fails on silence", async () => {
  const quiet = connected({ timeouts: { settle: 20 } });
  await quiet.link.settle();
  const lively = connected({ timeouts: { settle: 2000 } });
  const settled = lively.link.settle();
  lively.link.handleNotification([0x01, 0x07]);
  lively.link.handleNotification([0x02, 0xf4, 0x00]);
  await settled;
  assert.equal(lively.link.flow.credits, 7);
  assert.equal(lively.link.flow.packetSize(), 244);
});

// --- a whole batch ---------------------------------------------------------

function whiteLabel(): LabelBitmap {
  return packBitmap(new Uint8ClampedArray(8 * 4 * 4).fill(255), 8, 4);
}

test("printLabels: each label is sent whole and confirmed before the next", async () => {
  const { link, packets } = connected({ timeouts: { done: 500 } });
  link.handleNotification([0x02, 0xf4, 0x00]);
  link.handleNotification([0x01, 0x07]);
  const seen: string[] = [];
  const progress: PrintProgress[] = [];
  // The printer finishes a label a moment after its last packet.
  const original = link.send.bind(link);
  link.send = async (data, onProgress) => {
    await original(data, onProgress);
    seen.push(`sent ${packets.length}`);
    setTimeout(() => {
      link.handleNotification(ascii("SSSGETPRINTING:DOING"));
      link.handleNotification(ascii("SSSGETPRINTING:DONE"));
    }, 5);
  };
  const printed = await printLabels(link, 3, () => whiteLabel(), (p) => progress.push(p));
  assert.equal(printed, 3);
  assert.equal(packets.length, 3, "one packet per tiny label");
  assert.deepEqual(progress.filter((p) => p.phase === "printed").map((p) => p.index), [1, 2, 3]);
  assert.equal(progress[0].phase, "sending");
  assert.deepEqual(seen, ["sent 1", "sent 2", "sent 3"]);
});

test("printLabels: a failure stops the batch and says how many had printed", async () => {
  const { link } = connected({ timeouts: { done: 20 } });
  link.handleNotification([0x02, 0xf4, 0x00]);
  link.handleNotification([0x01, 0x07]);
  const original = link.send.bind(link);
  let jobs = 0;
  link.send = async (data, onProgress) => {
    await original(data, onProgress);
    jobs += 1;
    // Only the first label is confirmed.
    if (jobs === 1) setTimeout(() => link.handleNotification(ascii("SSSGETPRINTING:DONE")), 2);
  };
  await assert.rejects(printLabels(link, 3, () => whiteLabel()), (error: unknown) => {
    return error instanceof PrinterError && error.code === "not_confirmed" && error.printed === 1;
  });
  assert.equal(jobs, 2, "the third label was never sent");
});

test("withTimeout: resolves with the value, rejects on silence, and leaves no timer behind", async () => {
  assert.equal(await withTimeout(Promise.resolve(7), 1000, () => new PrinterError("connect_failed", "slow")), 7);
  await assert.rejects(withTimeout(new Promise(() => {}), 20, () => new PrinterError("connect_failed", "slow")), /slow/);
  await assert.rejects(withTimeout(Promise.reject(new Error("boom")), 1000, () => new PrinterError("connect_failed", "slow")), /boom/);
});
