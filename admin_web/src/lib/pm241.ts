/**
 * The Phomemo PM-241-BT 4 x 6 in label printer, spoken to over Bluetooth LE
 * from the browser (Web Bluetooth) with no driver and no print dialog.
 *
 * Everything here is pure - no `navigator`, no DOM, no timers beyond the
 * `setTimeout` the waits use - so `pm241.test.ts` runs it with a fake
 * transport. `pm241-printer.ts` is the thin Web Bluetooth glue around it.
 *
 * The recipe is the one that printed a clean, sharp label on 2026-11-04
 * (reference: ~/laawol-deploy-logs/pm241_print_test.py):
 *
 *   - service ff00; write characteristic ff02 (write without response);
 *     notify characteristic ff03.
 *   - flow control comes back on ff03: `[0x01, n]` = n more packets may be
 *     sent (7 at first, then `[01 01]` per packet); `[0x02, lo, hi]` = the
 *     largest packet (244). One packet per credit, never bigger than
 *     min(that, 244).
 *   - the job is ASCII commands, CRLF after each, then the bitmap as raw
 *     bytes: SIZE, GAP, DENSITY, SPEED, DIRECTION 0, CLS, BITMAP, PRINT 1.
 *     No END. Never DIRECTION 1 - the firmware scrambles the columns.
 *   - the bitmap is 800 x 1180 dots (203 dpi), 1 bit per dot, rows
 *     MSB-first (leftmost dot = bit 7), 0 = BLACK and 1 = white.
 *   - text replies on ff03: "SSSGETPRINTING:DOING" then
 *     "SSSGETPRINTING:DONE" (the label is out); "Cmd error:<token>" is a
 *     rejected command (logged, not fatal by itself).
 *
 * Every wait here ends: with what it waited for, or with a PrinterError
 * (guardrails: a loading state must always resolve).
 */

export const PM241_SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb";
export const PM241_WRITE_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
export const PM241_NOTIFY_UUID = "0000ff03-0000-1000-8000-00805f9b34fb";
/** The short form `requestDevice` takes in `optionalServices`. */
export const PM241_SERVICE_SHORT = 0xff00;
/** How the printer advertises itself ("PM-241-BT", some units "PM241..."). */
export const PM241_NAME_PREFIXES = ["PM-241", "PM241"] as const;

/** The 4 x 6 label's printable area: 100 x 147.5 mm at 8 dots per mm. */
export const PM241_DOTS_PER_MM = 8;
export const PM241_WIDTH_DOTS = 800;
export const PM241_HEIGHT_DOTS = 1180;

/** The printer's own cap on one packet, whatever it announces. */
export const PM241_MAX_PACKET = 244;
/** Until the printer announces its size: small enough for any link. */
export const PM241_DEFAULT_PACKET = 20;

/** Where the bitmap's top-left lands on the label, in dots (from the recipe). */
export const PM241_ORIGIN_X = 6;
export const PM241_ORIGIN_Y = 10;

/** How long a wait for the printer may take before the job fails. */
export const PM241_CREDIT_TIMEOUT_MS = 5000;
export const PM241_DONE_TIMEOUT_MS = 20000;
export const PM241_SETTLE_MS = 1000;

// ---------------------------------------------------------------------------
// The bitmap.
// ---------------------------------------------------------------------------

/** A label in printer dots: `data` holds `widthBytes` x `height` bytes. */
export type LabelBitmap = {
  width: number;
  height: number;
  widthBytes: number;
  /** Row after row, MSB-first; 0 = black, 1 = white; padding bits are white. */
  data: Uint8Array;
};

/** True when a pixel is dark enough to print: anything darker than mid-grey. */
export function pixelIsBlack(r: number, g: number, b: number, a: number, threshold = 128): boolean {
  const alpha = Math.min(255, Math.max(0, a)) / 255;
  // Luminance over white, as the app's renderer does: a transparent pixel is paper.
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) * alpha + 255 * (1 - alpha);
  return luminance < threshold;
}

/**
 * Packs canvas pixels (RGBA, row-major, as `getImageData` returns them) into
 * the printer's 1-bit rows. The text was drawn anti-aliased; this is where it
 * becomes crisp dots: below ~50 % grey is ink.
 */
export function packBitmap(rgba: ArrayLike<number>, width: number, height: number, threshold = 128): LabelBitmap {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new RangeError("A bitmap needs a whole width and height of at least 1 dot.");
  }
  if (rgba.length < width * height * 4) {
    throw new RangeError("The pixel data is shorter than the bitmap it should fill.");
  }
  const widthBytes = Math.ceil(width / 8);
  const data = new Uint8Array(widthBytes * height).fill(0xff);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (pixelIsBlack(rgba[i], rgba[i + 1], rgba[i + 2], rgba[i + 3], threshold)) {
        // Black is a cleared bit; the leftmost dot of a byte is bit 7.
        data[y * widthBytes + (x >> 3)] &= ~(0x80 >> (x & 7));
      }
    }
  }
  return { width, height, widthBytes, data };
}

/** Whether the dot at (x, y) prints black. For tests and previews. */
export function bitmapDotIsBlack(bitmap: LabelBitmap, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= bitmap.width || y >= bitmap.height) return false;
  return (bitmap.data[y * bitmap.widthBytes + (x >> 3)] & (0x80 >> (x & 7))) === 0;
}

// ---------------------------------------------------------------------------
// The job.
// ---------------------------------------------------------------------------

const encoder = new TextEncoder();

function ascii(text: string): Uint8Array {
  return encoder.encode(text);
}

/** The commands before the bitmap, CRLF after each. */
export const PM241_HEADER =
  "SIZE 100 mm, 150 mm\r\nGAP 3 mm, 0 mm\r\nDENSITY 10\r\nSPEED 4\r\nDIRECTION 0\r\nCLS\r\n";

/**
 * One label as the bytes to send: the commands, the bitmap, `PRINT 1`.
 * There is no END (the recipe leaves it out) and the direction is always 0.
 */
export function buildLabelJob(bitmap: LabelBitmap): Uint8Array {
  if (bitmap.data.length !== bitmap.widthBytes * bitmap.height) {
    throw new RangeError("The bitmap does not hold widthBytes x height bytes.");
  }
  if (bitmap.widthBytes > 255 || bitmap.height > 65535) {
    throw new RangeError("The bitmap is too large for the printer.");
  }
  const head = ascii(`${PM241_HEADER}BITMAP ${PM241_ORIGIN_X},${PM241_ORIGIN_Y},${bitmap.widthBytes},${bitmap.height},0,`);
  const tail = ascii("\r\nPRINT 1\r\n");
  const out = new Uint8Array(head.length + bitmap.data.length + tail.length);
  out.set(head, 0);
  out.set(bitmap.data, head.length);
  out.set(tail, head.length + bitmap.data.length);
  return out;
}

// ---------------------------------------------------------------------------
// What the printer says back on ff03.
// ---------------------------------------------------------------------------

export type PrinterReply =
  /** n more packets may be sent. */
  | { kind: "credit"; packets: number }
  /** The largest packet the printer takes. */
  | { kind: "maxPacket"; size: number }
  | { kind: "printing" }
  | { kind: "done" }
  /** A command the printer rejected. */
  | { kind: "cmdError"; token: string }
  | { kind: "text"; text: string }
  | { kind: "unknown" };

/** Reads one ff03 notification. Never throws: anything odd is `unknown`/`text`. */
export function parsePrinterReply(bytes: ArrayLike<number>): PrinterReply {
  if (!bytes || bytes.length === 0) return { kind: "unknown" };
  if (bytes[0] === 0x01 && bytes.length >= 2) return { kind: "credit", packets: bytes[1] };
  if (bytes[0] === 0x02 && bytes.length >= 3) return { kind: "maxPacket", size: bytes[1] | (bytes[2] << 8) };
  let raw = "";
  for (let i = 0; i < bytes.length; i++) raw += String.fromCharCode(bytes[i] & 0x7f);
  const text = raw.replace(/[^\x20-\x7e]+/g, " ").trim();
  if (!text) return { kind: "unknown" };
  const error = /Cmd error:\s*(\S*)/i.exec(text);
  if (error) return { kind: "cmdError", token: error[1] };
  // DONE wins over DOING when one notification carries both.
  if (/SSSGETPRINTING:DONE/i.test(text)) return { kind: "done" };
  if (/SSSGETPRINTING:DOING/i.test(text)) return { kind: "printing" };
  return { kind: "text", text };
}

// ---------------------------------------------------------------------------
// Flow control.
// ---------------------------------------------------------------------------

/** Cuts `data` into packets of at most `size` bytes (size is kept within 1..244). */
export function splitPackets(data: Uint8Array, size: number): Uint8Array[] {
  const step = Math.min(PM241_MAX_PACKET, Math.max(1, Math.floor(size) || 1));
  const packets: Uint8Array[] = [];
  for (let at = 0; at < data.length; at += step) packets.push(data.subarray(at, at + step));
  return packets;
}

/** How many packets may go out now, and how big they may be. */
export class FlowControl {
  credits = 0;
  maxPacket = PM241_DEFAULT_PACKET;
  maxPacketKnown = false;

  /** Applies a reply; true when it was flow control. */
  apply(reply: PrinterReply): boolean {
    if (reply.kind === "credit") {
      this.credits += reply.packets;
      return true;
    }
    if (reply.kind === "maxPacket") {
      if (reply.size > 0) {
        this.maxPacket = reply.size;
        this.maxPacketKnown = true;
      }
      return true;
    }
    return false;
  }

  /** The size the next packet may be: min(announced, 244), at least 1. */
  packetSize(): number {
    return Math.min(PM241_MAX_PACKET, Math.max(1, this.maxPacket));
  }
}

// ---------------------------------------------------------------------------
// The link: sending a job and waiting for it to print.
// ---------------------------------------------------------------------------

export type PrinterErrorCode =
  /** No packet credit arrived in time: the printer stopped answering. */
  | "no_credit"
  /** The job was sent but the printer never said it was done. */
  | "not_confirmed"
  /** The link dropped. */
  | "disconnected"
  /** A write to the printer failed. */
  | "write_failed"
  /** Nobody picked a printer in the browser's chooser. */
  | "cancelled"
  /** The printer could not be reached or does not speak the protocol. */
  | "connect_failed";

export class PrinterError extends Error {
  readonly code: PrinterErrorCode;
  /** What the printer rejected, if it said ("Cmd error:" tokens). */
  readonly rejected: string[];
  /** How many labels of a batch came out before this failure. */
  printed = 0;

  constructor(code: PrinterErrorCode, message: string, rejected: string[] = []) {
    super(message);
    this.name = "PrinterError";
    this.code = code;
    this.rejected = rejected;
  }
}

export interface PrinterTransport {
  /** One packet to ff02, without response. */
  write(packet: Uint8Array): Promise<void>;
}

export type LinkOptions = {
  creditTimeoutMs?: number;
  doneTimeoutMs?: number;
  settleMs?: number;
  /** Sees every reply (for the console log). */
  onReply?: (reply: PrinterReply) => void;
};

/**
 * What `printLabels` needs of a printer link: the PM-241's (`Pm241Link`) and
 * the "other printer" one (`GenericLink` in `generic-label-printer.ts`) both fit.
 */
export interface LabelLink {
  readonly isClosed: boolean;
  /** False when the printer never says a label came out (so "sent", not "printed"). */
  readonly confirmsLabels?: boolean;
  beginJob(): void;
  send(data: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<void>;
  waitDone(): Promise<void>;
  close(error?: PrinterError): void;
}

export class Pm241Link implements LabelLink {
  readonly flow = new FlowControl();
  /** Every "Cmd error:" token since the current job began. */
  cmdErrors: string[] = [];
  private printing = false;
  private done = false;
  private closed: PrinterError | null = null;
  private readonly waiters = new Set<() => void>();
  private readonly creditTimeoutMs: number;
  private readonly doneTimeoutMs: number;
  private readonly settleMs: number;
  private readonly onReply?: (reply: PrinterReply) => void;

  private readonly transport: PrinterTransport;

  constructor(transport: PrinterTransport, options: LinkOptions = {}) {
    this.transport = transport;
    this.creditTimeoutMs = options.creditTimeoutMs ?? PM241_CREDIT_TIMEOUT_MS;
    this.doneTimeoutMs = options.doneTimeoutMs ?? PM241_DONE_TIMEOUT_MS;
    this.settleMs = options.settleMs ?? PM241_SETTLE_MS;
    this.onReply = options.onReply;
  }

  get isClosed(): boolean {
    return this.closed !== null;
  }

  /** Feed every ff03 notification here. */
  handleNotification(bytes: ArrayLike<number>): PrinterReply {
    const reply = parsePrinterReply(bytes);
    if (!this.flow.apply(reply)) {
      if (reply.kind === "printing") this.printing = true;
      else if (reply.kind === "done") this.done = true;
      else if (reply.kind === "cmdError") this.cmdErrors.push(reply.token);
    }
    this.onReply?.(reply);
    this.wake();
    return reply;
  }

  /** The link dropped (or was closed): every wait now ends with `error`. */
  close(error: PrinterError = new PrinterError("disconnected", "The label printer disconnected.")): void {
    if (this.closed) return;
    this.closed = error;
    this.wake();
  }

  private wake(): void {
    for (const waiter of [...this.waiters]) waiter();
  }

  /**
   * Resolves when `ready()` is true, rejects with `timeout()` after `ms` or
   * with the close error if the link drops first. The timer is always cleared.
   */
  private waitUntil(ready: () => boolean, ms: number, timeout: () => PrinterError): Promise<void> {
    if (this.closed) return Promise.reject(this.closed);
    if (ready()) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = () => {
        if (timer !== undefined) clearTimeout(timer);
        this.waiters.delete(check);
      };
      const check = () => {
        if (this.closed) {
          finish();
          reject(this.closed);
        } else if (ready()) {
          finish();
          resolve();
        }
      };
      timer = setTimeout(() => {
        finish();
        reject(timeout());
      }, ms);
      this.waiters.add(check);
    });
  }

  /**
   * After subscribing: wait (briefly) for the printer's opening credits and
   * packet size. Never fails - a silent printer is reported by `send`.
   */
  async settle(): Promise<void> {
    try {
      await this.waitUntil(() => this.flow.credits > 0 && this.flow.maxPacketKnown, this.settleMs, () => new PrinterError("no_credit", "settled"));
    } catch (error) {
      if (this.closed && error === this.closed) throw error;
    }
  }

  /** Starts a fresh job: forgets the last one's DOING/DONE and rejections. */
  beginJob(): void {
    this.printing = false;
    this.done = false;
    this.cmdErrors = [];
  }

  /**
   * Sends `data` one packet per credit. Rejects when the printer stops
   * granting credits for `creditTimeoutMs`, when a write fails, or when the
   * link drops.
   */
  async send(data: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<void> {
    let sent = 0;
    while (sent < data.length) {
      await this.waitUntil(
        () => this.flow.credits > 0,
        this.creditTimeoutMs,
        () => new PrinterError("no_credit", "The label printer stopped answering.", [...this.cmdErrors]),
      );
      const packet = data.subarray(sent, sent + this.flow.packetSize());
      this.flow.credits -= 1;
      try {
        await this.transport.write(packet);
      } catch (error) {
        if (this.closed) throw this.closed;
        throw new PrinterError("write_failed", error instanceof Error ? error.message : "Could not write to the label printer.");
      }
      sent += packet.length;
      onProgress?.(sent, data.length);
    }
  }

  /** Waits for "SSSGETPRINTING:DONE" - the label is out. */
  async waitDone(): Promise<void> {
    await this.waitUntil(
      () => this.done,
      this.doneTimeoutMs,
      () => new PrinterError("not_confirmed", "The label printer did not confirm the label.", [...this.cmdErrors]),
    );
  }

  /** Whether the printer has said it is printing the current job. */
  get isPrinting(): boolean {
    return this.printing && !this.done;
  }
}

// ---------------------------------------------------------------------------
// A batch of labels.
// ---------------------------------------------------------------------------

export type PrintProgress =
  /** Packets of label `index` (1-based) are going out. */
  | { phase: "sending"; index: number; total: number; sent: number; bytes: number }
  /** Label `index` is with the printer; waiting for it to come out. */
  | { phase: "printing"; index: number; total: number }
  /** Label `index` is out. */
  | { phase: "printed"; index: number; total: number };

/**
 * Prints `count` labels one after the other: each is drawn by `render`, sent,
 * and confirmed by the printer before the next goes. Returns how many came
 * out. A failure stops the batch; the PrinterError says how many had printed.
 */
export async function printLabels(
  link: LabelLink,
  count: number,
  render: (index: number) => LabelBitmap,
  onProgress?: (progress: PrintProgress) => void,
): Promise<number> {
  let printed = 0;
  try {
    for (let i = 0; i < count; i++) {
      const job = buildLabelJob(render(i));
      const index = i + 1;
      link.beginJob();
      onProgress?.({ phase: "sending", index, total: count, sent: 0, bytes: job.length });
      await link.send(job, (sent, bytes) => onProgress?.({ phase: "sending", index, total: count, sent, bytes }));
      onProgress?.({ phase: "printing", index, total: count });
      await link.waitDone();
      printed += 1;
      onProgress?.({ phase: "printed", index, total: count });
    }
  } catch (error) {
    if (error instanceof PrinterError) error.printed = printed;
    throw error;
  }
  return printed;
}

/** `promise`, or a PrinterError after `ms` - for steps (connecting) that may never answer. */
export function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout: () => PrinterError): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(onTimeout()), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
