/**
 * The Phomemo M421 (4 in label maker) from the browser. Same Bluetooth
 * service and flow control as the PM-241 (`pm241.ts`), but not its language:
 * the M421 takes the M-series raster commands, not TSPL.
 *
 * Measured on a real one on 2026-11-14 (firmware 0.2.6, 4 x 6 in fan-fold);
 * the phone app's `m221_protocol.dart` carries the same numbers:
 *
 *   - it advertises as "M421"; service ff00, write ff02, notify ff03.
 *   - flow control on ff03 like the PM-241: `[01, n]` grants n packets,
 *     `[02, lo, hi]` gives the packet size (182). Its own replies are binary
 *     (`1A ..`), in notifications of their own.
 *   - the head is about 896 dots; a row starts at its first dot and the
 *     101.6 mm label's left edge is about 43 dots in. Rows of 864 dots
 *     (108 bytes) x 1180 print whole. The 800-dot picture starts at dot 48.
 *   - ONE raster command is ONE label: the printer feeds to the next gap
 *     after every raster. A label is never sent in bands (bands wasted a
 *     label each).
 *   - after the footer it answers `1A 0F ..`: the label is out.
 *
 * Pure: no `navigator`, no DOM. `pm241-printer.ts` picks this link for a
 * printer whose name says M421.
 */

import { Pm241Link, type LabelBitmap, type PrinterReply } from "./pm241.ts";

/** How the printer advertises itself. */
export const M421_NAME_PREFIXES = ["M421", "M-421"] as const;

/** A row as sent: 864 dots. */
export const M421_ROW_BYTES = 108;
/** Where the picture's left edge goes in the row: dot 48. */
export const M421_PICTURE_X_BYTES = 6;

/** Speed 5 and density 6 (the byte the M-series takes for it), as the app sends. */
export const M421_SPEED = [0x1b, 0x4e, 0x0d, 0x05] as const;
export const M421_DENSITY = [0x1b, 0x4e, 0x04, 0x0c] as const;
/** Media: labels with gaps between them. */
export const M421_GAP_MEDIA = [0x1f, 0x11, 0x0a] as const;
export const M421_FOOTER = [0x1f, 0xf0, 0x05, 0x00, 0x1f, 0xf0, 0x03, 0x00] as const;

/** The pauses the proven sequence leaves: after each setup command, and before the footer. */
export const M421_COMMAND_GAP_MS = 30;
export const M421_AFTER_RASTER_MS = 300;

const SETUP_BYTES = M421_SPEED.length + M421_DENSITY.length + M421_GAP_MEDIA.length;

export function isM421Name(name: string | undefined): boolean {
  const upper = (name ?? "").toUpperCase();
  return M421_NAME_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/**
 * The label as the head takes it: rows of 108 bytes, 1 = BLACK (the PM-241's
 * bitmap is the other way round), the picture 48 dots in.
 */
export function m421Raster(bitmap: LabelBitmap): Uint8Array {
  if (bitmap.data.length !== bitmap.widthBytes * bitmap.height) {
    throw new RangeError("The bitmap does not hold widthBytes x height bytes.");
  }
  if (bitmap.widthBytes + M421_PICTURE_X_BYTES > M421_ROW_BYTES || bitmap.height > 65535) {
    throw new RangeError("The bitmap is too large for the printer.");
  }
  const out = new Uint8Array(M421_ROW_BYTES * bitmap.height);
  for (let y = 0; y < bitmap.height; y++) {
    const from = y * bitmap.widthBytes;
    const to = y * M421_ROW_BYTES + M421_PICTURE_X_BYTES;
    // White padding bits (1) become 0: nothing prints past the picture.
    for (let i = 0; i < bitmap.widthBytes; i++) out[to + i] = ~bitmap.data[from + i] & 0xff;
  }
  return out;
}

/** One label as the bytes to send: setup, ONE raster command with its rows, the footer. */
export function buildM421Job(bitmap: LabelBitmap): Uint8Array {
  const raster = m421Raster(bitmap);
  const header = [0x1d, 0x76, 0x30, 0x00, M421_ROW_BYTES, 0x00, bitmap.height & 0xff, (bitmap.height >> 8) & 0xff];
  const head = [...M421_SPEED, ...M421_DENSITY, ...M421_GAP_MEDIA, ...header];
  const out = new Uint8Array(head.length + raster.length + M421_FOOTER.length);
  out.set(head, 0);
  out.set(raster, head.length);
  out.set(M421_FOOTER, head.length + raster.length);
  return out;
}

/** The "label printed" frame: `1A 0F xx`. */
export function isM421DoneFrame(bytes: ArrayLike<number>, at = 0): boolean {
  return bytes.length >= at + 2 && bytes[at] === 0x1a && bytes[at + 1] === 0x0f;
}

const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** The PM-241's link (credits, waits, timeouts) speaking the M421's language. */
export class M421Link extends Pm241Link {
  private readonly commandGapMs: number;
  private readonly afterRasterMs: number;

  constructor(
    transport: ConstructorParameters<typeof Pm241Link>[0],
    options: ConstructorParameters<typeof Pm241Link>[1] & { commandGapMs?: number; afterRasterMs?: number } = {},
  ) {
    super(transport, options);
    this.commandGapMs = options.commandGapMs ?? M421_COMMAND_GAP_MS;
    this.afterRasterMs = options.afterRasterMs ?? M421_AFTER_RASTER_MS;
  }

  buildJob(bitmap: LabelBitmap): Uint8Array {
    return buildM421Job(bitmap);
  }

  /**
   * Packet credits first (`01 n`, `02 lo hi`, any number of them); what is
   * left is the printer's own binary reply, never text: fed to the PM-241's
   * reader it would not be understood, and `1A 0F` would never end the wait.
   */
  override handleNotification(bytes: ArrayLike<number>): PrinterReply {
    let at = 0;
    let last: PrinterReply = { kind: "unknown" };
    while (at < bytes.length) {
      if (bytes[at] === 0x01 && at + 1 < bytes.length) {
        last = super.handleNotification([0x01, bytes[at + 1]]);
        at += 2;
      } else if (bytes[at] === 0x02 && at + 2 < bytes.length) {
        last = super.handleNotification([0x02, bytes[at + 1], bytes[at + 2]]);
        at += 3;
      } else {
        break;
      }
    }
    if (at < bytes.length && isM421DoneFrame(bytes, at)) {
      this.confirmDone();
      last = { kind: "done" };
    }
    return last;
  }

  /**
   * The job in the order and with the pauses that printed: each setup
   * command, then the raster command with all its rows, a breath, the footer.
   */
  override async send(data: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<void> {
    const total = data.length;
    if (total <= SETUP_BYTES + M421_FOOTER.length) return super.send(data, onProgress);
    const cuts = [0, M421_SPEED.length, M421_SPEED.length + M421_DENSITY.length, SETUP_BYTES, total - M421_FOOTER.length, total];
    for (let part = 0; part + 1 < cuts.length; part++) {
      const from = cuts[part];
      await super.send(data.subarray(from, cuts[part + 1]), (sent) => onProgress?.(from + sent, total));
      if (part < 3) await pause(this.commandGapMs);
      else if (part === 3) await pause(this.afterRasterMs);
    }
  }
}
