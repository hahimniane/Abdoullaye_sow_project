/**
 * "Other" 4 x 6 in Bluetooth LE label printers (BETA), the ones with no public
 * protocol document - first target: the JADENS C10. The Phomemo PM-241 has its
 * own exact recipe in `pm241.ts`; this is the guess that covers most of the
 * rest: a "transparent UART" BLE service with one writable characteristic that
 * takes the same TSPL job the PM-241 takes (`buildLabelJob`), cut into small
 * writes, with no credit protocol and no "done" reply.
 *
 * Everything here is pure - no `navigator`, no DOM - so
 * `generic-label-printer.test.ts` runs it on fake service lists and a fake
 * transport. `generic-printer.ts` is the Web Bluetooth glue around it.
 *
 * Every wait ends: with what it waited for, or with a PrinterError.
 */

import { PrinterError, splitPackets, withTimeout, type LabelLink, type PrinterTransport } from "./pm241.ts";

// ---------------------------------------------------------------------------
// Which printer the person says they have.
// ---------------------------------------------------------------------------

export type PrinterKind = "pm241" | "generic";

export const DEFAULT_PRINTER_KIND: PrinterKind = "pm241";
export const PRINTER_KIND_KEY = "laawol.labelPrinterKind";
/** The id of the last "other" printer chosen, so a reload finds it again. */
export const GENERIC_DEVICE_KEY = "laawol.labelPrinterGenericDevice";

export type ChoiceStorage = Pick<Storage, "getItem" | "setItem">;

/** Anything that is not exactly "generic" is the PM-241, the safe default. */
export function parsePrinterKind(raw: unknown): PrinterKind {
  return raw === "generic" ? "generic" : DEFAULT_PRINTER_KIND;
}

/** The remembered choice; a missing or blocked storage means the default. */
export function readPrinterKind(storage: ChoiceStorage | null | undefined): PrinterKind {
  try {
    return parsePrinterKind(storage?.getItem(PRINTER_KIND_KEY));
  } catch {
    return DEFAULT_PRINTER_KIND;
  }
}

/** Remembers the choice; a private window or full storage just forgets it. */
export function writePrinterKind(storage: ChoiceStorage | null | undefined, kind: PrinterKind): void {
  try {
    storage?.setItem(PRINTER_KIND_KEY, parsePrinterKind(kind));
  } catch {
    // Remembering is a convenience; printing must not depend on it.
  }
}

// ---------------------------------------------------------------------------
// The "transparent UART" services, and the one write characteristic of each.
// ---------------------------------------------------------------------------

const BASE_SUFFIX = "-0000-1000-8000-00805f9b34fb";

/** `ff02`, `0000ff02` or a full UUID, as the lower-case 128-bit form Web Bluetooth uses. */
export function normalizeUuid(uuid: string): string {
  const lower = uuid.trim().toLowerCase();
  if (/^[0-9a-f]{4}$/.test(lower)) return `0000${lower}${BASE_SUFFIX}`;
  if (/^[0-9a-f]{8}$/.test(lower)) return `${lower}${BASE_SUFFIX}`;
  return lower;
}

export function sameUuid(a: string, b: string): boolean {
  return normalizeUuid(a) === normalizeUuid(b);
}

/** A service and the characteristic that takes the print job, in the order we prefer them. */
export type GenericServiceEntry = { service: string; write: string };

export const GENERIC_PRINTER_SERVICES: readonly GenericServiceEntry[] = [
  { service: "0000ff00-0000-1000-8000-00805f9b34fb", write: "0000ff02-0000-1000-8000-00805f9b34fb" },
  { service: "000018f0-0000-1000-8000-00805f9b34fb", write: "00002af1-0000-1000-8000-00805f9b34fb" },
  { service: "49535343-fe7d-4ae5-8fa9-9fafd205e455", write: "49535343-8841-43f4-a8d4-ecbe34729bb3" },
  { service: "e7810a71-73ae-499d-8c15-faa9aef0c3f2", write: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f" },
  { service: "0000ae30-0000-1000-8000-00805f9b34fb", write: "0000ae01-0000-1000-8000-00805f9b34fb" },
  { service: "0000fee7-0000-1000-8000-00805f9b34fb", write: "0000fec7-0000-1000-8000-00805f9b34fb" },
  { service: "0000ffe0-0000-1000-8000-00805f9b34fb", write: "0000ffe1-0000-1000-8000-00805f9b34fb" },
  { service: "0000fff0-0000-1000-8000-00805f9b34fb", write: "0000fff2-0000-1000-8000-00805f9b34fb" },
];

/**
 * What `requestDevice` is given as `optionalServices`: Web Bluetooth only
 * exposes the services named here, so this is every service in the table.
 */
export const GENERIC_OPTIONAL_SERVICES: readonly string[] = GENERIC_PRINTER_SERVICES.map((entry) => entry.service);

/** Services that are never a print channel (Generic Access, Generic Attribute, Device Information). */
const IGNORED_SERVICES = ["1800", "1801", "180a"].map(normalizeUuid);

export type CharacteristicProperties = {
  read?: boolean;
  write?: boolean;
  writeWithoutResponse?: boolean;
  notify?: boolean;
  indicate?: boolean;
};
export type CharacteristicInfo = { uuid: string; properties: CharacteristicProperties };
export type ServiceInfo = { uuid: string; characteristics: CharacteristicInfo[] };

export type WriteChoice = {
  serviceUuid: string;
  characteristicUuid: string;
  /** True when the characteristic takes writes without a response (faster; preferred). */
  withoutResponse: boolean;
  /** True when the pair is in the known table; false when it was the first writable one found. */
  known: boolean;
};

function canWrite(c: CharacteristicInfo): boolean {
  return Boolean(c.properties.write || c.properties.writeWithoutResponse);
}

function toChoice(service: ServiceInfo, c: CharacteristicInfo, known: boolean): WriteChoice {
  return {
    serviceUuid: normalizeUuid(service.uuid),
    characteristicUuid: normalizeUuid(c.uuid),
    withoutResponse: Boolean(c.properties.writeWithoutResponse),
    known,
  };
}

/**
 * Where to send the job: the first known service that has its writable
 * characteristic, else the first writable characteristic of any service
 * (not the standard GAP/GATT/Device Information ones). Null when there is none.
 */
export function pickWriteCharacteristic(services: readonly ServiceInfo[]): WriteChoice | null {
  for (const entry of GENERIC_PRINTER_SERVICES) {
    const service = services.find((s) => sameUuid(s.uuid, entry.service));
    const found = service?.characteristics.find((c) => sameUuid(c.uuid, entry.write) && canWrite(c));
    if (service && found) return toChoice(service, found, true);
  }
  for (const service of services) {
    if (IGNORED_SERVICES.includes(normalizeUuid(service.uuid))) continue;
    const found = service.characteristics.find(canWrite);
    if (found) return toChoice(service, found, false);
  }
  return null;
}

/** A characteristic worth listening to for the details (notify or indicate): the chosen service's first, else any. */
export function pickNotifyCharacteristic(
  services: readonly ServiceInfo[],
  choice: WriteChoice | null,
): { serviceUuid: string; characteristicUuid: string } | null {
  const listens = (c: CharacteristicInfo) => Boolean(c.properties.notify || c.properties.indicate);
  const ordered = [...services].sort((a, b) => Number(choice ? sameUuid(b.uuid, choice.serviceUuid) : 0) - Number(choice ? sameUuid(a.uuid, choice.serviceUuid) : 0));
  for (const service of ordered) {
    if (IGNORED_SERVICES.includes(normalizeUuid(service.uuid))) continue;
    const found = service.characteristics.find(listens);
    if (found) return { serviceUuid: normalizeUuid(service.uuid), characteristicUuid: normalizeUuid(found.uuid) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The link: small writes, a short pause between them, one overall timeout.
// ---------------------------------------------------------------------------

/** Bytes per write: under every common BLE MTU after the header. */
export const GENERIC_CHUNK_BYTES = 180;
/** Pause between writes, so a printer without flow control does not drop bytes. */
export const GENERIC_PACING_MS = 20;
/** A whole label (about 118 KB) must be out within this, or the job fails. */
export const GENERIC_SEND_TIMEOUT_MS = 120000;
/** With no "done" reply to wait for, the pause after each label before the next goes. */
export const GENERIC_LABEL_GAP_MS = 2500;

export type GenericLinkOptions = {
  chunkBytes?: number;
  pacingMs?: number;
  sendTimeoutMs?: number;
  labelGapMs?: number;
};

function pause(ms: number): Promise<void> {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

export class GenericLink implements LabelLink {
  /** This printer never says a label came out: the dialog says "sent", not "printed". */
  readonly confirmsLabels = false;
  private closed: PrinterError | null = null;
  private readonly transport: PrinterTransport;
  private readonly chunkBytes: number;
  private readonly pacingMs: number;
  private readonly sendTimeoutMs: number;
  private readonly labelGapMs: number;

  constructor(transport: PrinterTransport, options: GenericLinkOptions = {}) {
    this.transport = transport;
    this.chunkBytes = options.chunkBytes ?? GENERIC_CHUNK_BYTES;
    this.pacingMs = options.pacingMs ?? GENERIC_PACING_MS;
    this.sendTimeoutMs = options.sendTimeoutMs ?? GENERIC_SEND_TIMEOUT_MS;
    this.labelGapMs = options.labelGapMs ?? GENERIC_LABEL_GAP_MS;
  }

  get isClosed(): boolean {
    return this.closed !== null;
  }

  close(error: PrinterError = new PrinterError("disconnected", "The label printer disconnected.")): void {
    if (!this.closed) this.closed = error;
  }

  beginJob(): void {
    // Nothing to forget: there are no replies to reset.
  }

  /** Writes `data` in chunks. Rejects on a failed write, a dropped link or the overall timeout. */
  async send(data: Uint8Array, onProgress?: (sent: number, total: number) => void): Promise<void> {
    let stopped = false;
    const run = async () => {
      let sent = 0;
      for (const packet of splitPackets(data, this.chunkBytes)) {
        if (stopped) return;
        if (this.closed) throw this.closed;
        try {
          // Copy: the packet is a view into the whole job.
          await this.transport.write(packet.slice());
        } catch (error) {
          if (this.closed) throw this.closed;
          throw new PrinterError("write_failed", error instanceof Error ? error.message : "Could not write to the label printer.");
        }
        sent += packet.length;
        onProgress?.(sent, data.length);
        await pause(this.pacingMs);
      }
    };
    try {
      await withTimeout(run(), this.sendTimeoutMs, () => new PrinterError("no_credit", "The label printer stopped answering."));
    } finally {
      stopped = true;
    }
  }

  /** There is no confirmation to wait for: give the printer a moment to finish the label. */
  async waitDone(): Promise<void> {
    if (this.closed) throw this.closed;
    await pause(this.labelGapMs);
    if (this.closed) throw this.closed;
  }
}

// ---------------------------------------------------------------------------
// The details to send us when a label does not print.
// ---------------------------------------------------------------------------

const DETAILS_NOTIFY_WINDOW_MS = 3000;
const DETAILS_NOTIFY_CAP_BYTES = 64;

/** `0a 1b 2c`, at most `cap` bytes, with "(+N more)" when cut. */
export function bytesToHex(bytes: ArrayLike<number>, cap = DETAILS_NOTIFY_CAP_BYTES): string {
  const shown = Math.min(bytes.length, Math.max(0, cap));
  const parts: string[] = [];
  for (let i = 0; i < shown; i++) parts.push((bytes[i] & 0xff).toString(16).padStart(2, "0"));
  const more = bytes.length - shown;
  return parts.join(" ") + (more > 0 ? ` (+${more} more)` : "");
}

/**
 * Keeps the first bytes the printer sends on a notify characteristic, only
 * during the first 3 s after listening began, never more than `capBytes`.
 */
export function createNotifyCapture(now: () => number = Date.now, windowMs = DETAILS_NOTIFY_WINDOW_MS, capBytes = DETAILS_NOTIFY_CAP_BYTES) {
  const startedAt = now();
  const kept: number[] = [];
  return {
    push(bytes: ArrayLike<number>): void {
      if (now() - startedAt > windowMs) return;
      for (let i = 0; i < bytes.length && kept.length < capBytes; i++) kept.push(bytes[i] & 0xff);
    },
    bytes(): number[] {
      return [...kept];
    },
  };
}

export type PrinterDetails = {
  kind: PrinterKind;
  deviceName: string;
  services: ServiceInfo[];
  chosen: WriteChoice | null;
  /** The first bytes the printer sent in its first 3 s, or empty. */
  notifyBytes: number[];
  /** Which characteristic was listened to, when one was. */
  notifyCharacteristic?: string;
  /** What went wrong, if something did. */
  error?: string;
};

function clip(text: string, max: number): string {
  const one = text.replace(/\s+/g, " ").trim();
  return one.length > max ? `${one.slice(0, max)}...` : one;
}

function propertyNames(p: CharacteristicProperties): string {
  const names = (["read", "write", "writeWithoutResponse", "notify", "indicate"] as const).filter((name) => p[name]);
  return names.length ? names.join(", ") : "none";
}

/**
 * The plain-text block a person copies and sends to Laawol: the device name,
 * every service and characteristic with its properties, the one chosen, the
 * browser and the printer's first words. No customer data, ever.
 */
export function formatPrinterDetails(details: PrinterDetails, userAgent: string): string {
  const lines: string[] = [];
  lines.push("Laawol label printer details (beta)");
  lines.push(`Printer type: ${details.kind === "generic" ? "Other 4x6 Bluetooth printer" : "Phomemo PM-241"}`);
  lines.push(`Device name: ${clip(details.deviceName, 80) || "(none)"}`);
  lines.push(`Browser: ${clip(userAgent, 300) || "(unknown)"}`);
  if (details.chosen) {
    lines.push(
      `Chosen write characteristic: ${details.chosen.characteristicUuid} in service ${details.chosen.serviceUuid} ` +
        `(${details.chosen.withoutResponse ? "write without response" : "write with response"}, ${details.chosen.known ? "known table" : "first writable found"})`,
    );
  } else {
    lines.push("Chosen write characteristic: none");
  }
  lines.push(`Services found: ${details.services.length}`);
  for (const service of details.services) {
    lines.push(`  service ${normalizeUuid(service.uuid)}`);
    if (service.characteristics.length === 0) lines.push("    (no characteristics)");
    for (const c of service.characteristics) lines.push(`    ${normalizeUuid(c.uuid)}  [${propertyNames(c.properties)}]`);
  }
  const heard = details.notifyBytes.length ? bytesToHex(details.notifyBytes) : "nothing received";
  lines.push(`First bytes from the printer (first 3 s${details.notifyCharacteristic ? `, ${details.notifyCharacteristic}` : ""}): ${heard}`);
  if (details.error) lines.push(`Error: ${clip(details.error, 300)}`);
  return lines.join("\n");
}
