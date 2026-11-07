/**
 * The browser half of the BETA "other 4 x 6 Bluetooth printer" path: Web
 * Bluetooth wrapped around the pure `GenericLink` and picking rules in
 * `generic-label-printer.ts`. Called by `connectLabelPrinter` in
 * `pm241-printer.ts` when the person chose "Other 4x6 Bluetooth printer".
 *
 * The chooser lists every nearby BLE device (`acceptAllDevices`) and the
 * likely print services are named in `optionalServices` - Web Bluetooth
 * exposes nothing else. After connecting it reads every service and
 * characteristic, picks the write characteristic by the table, and keeps a
 * snapshot (`genericPrinterDetailsText`) for the "Copy printer details" button.
 *
 * Not unit-tested - it needs a real adapter and printer; the rules it drives
 * are (`generic-label-printer.test.ts`).
 */

import {
  GENERIC_DEVICE_KEY,
  GENERIC_OPTIONAL_SERVICES,
  GenericLink,
  createNotifyCapture,
  formatPrinterDetails,
  normalizeUuid,
  pickNotifyCharacteristic,
  pickWriteCharacteristic,
  type CharacteristicInfo,
  type PrinterDetails,
  type ServiceInfo,
  type WriteChoice,
} from "./generic-label-printer.ts";
import { PrinterError, withTimeout } from "./pm241.ts";
import type { BtApi, BtCharacteristic, BtDevice, BtService } from "./pm241-printer.ts";

const CONNECT_TIMEOUT_MS = 10000;
const DISCOVER_TIMEOUT_MS = 15000;

/** What the details button will copy: the latest connection attempt of this tab. */
let snapshot: PrinterDetails | null = null;

function remember(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function rememberedId(): string {
  try {
    return remember()?.getItem(GENERIC_DEVICE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberId(id: string): void {
  try {
    remember()?.setItem(GENERIC_DEVICE_KEY, id);
  } catch {
    // Remembering is a convenience.
  }
}

/** True once a generic connection has been tried: there is something to copy. */
export function genericPrinterHasDetails(): boolean {
  return snapshot !== null;
}

/** The details block for the last "other printer" attempt, or "" before any. No customer data. */
export function genericPrinterDetailsText(): string {
  if (!snapshot) return "";
  const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
  return formatPrinterDetails(snapshot, userAgent);
}

async function pickDevice(api: BtApi, remembered: BtDevice | null): Promise<BtDevice> {
  if (remembered) return remembered;
  // A printer chosen on an earlier visit: found again without the chooser.
  const id = rememberedId();
  if (id && typeof api.getDevices === "function") {
    try {
      const known = (await api.getDevices()).find((d) => d.id === id);
      if (known) return known;
    } catch {
      // Not allowed here; the chooser below still works.
    }
  }
  try {
    const device = await api.requestDevice({
      acceptAllDevices: true,
      optionalServices: [...GENERIC_OPTIONAL_SERVICES],
    });
    rememberId(device.id);
    return device;
  } catch (error) {
    const name = error && typeof error === "object" ? (error as { name?: string }).name : "";
    // Closing the chooser is a choice, not a failure.
    if (name === "NotFoundError") throw new PrinterError("cancelled", "No label printer was chosen.");
    throw new PrinterError("connect_failed", error instanceof Error ? error.message : "Could not open the Bluetooth chooser.");
  }
}

function infoOf(c: BtCharacteristic): CharacteristicInfo {
  const p = c.properties ?? {};
  return {
    uuid: c.uuid ?? "",
    properties: { read: p.read, write: p.write, writeWithoutResponse: p.writeWithoutResponse, notify: p.notify, indicate: p.indicate },
  };
}

type Discovered = { info: ServiceInfo[]; live: Map<string, BtCharacteristic> };

async function discover(services: BtService[]): Promise<Discovered> {
  const info: ServiceInfo[] = [];
  const live = new Map<string, BtCharacteristic>();
  for (const service of services) {
    const uuid = normalizeUuid(service.uuid ?? "");
    let characteristics: BtCharacteristic[] = [];
    try {
      characteristics = (await service.getCharacteristics?.()) ?? [];
    } catch {
      // A service we may not read: listed with no characteristics.
    }
    info.push({ uuid, characteristics: characteristics.map(infoOf) });
    for (const c of characteristics) live.set(`${uuid}/${normalizeUuid(c.uuid ?? "")}`, c);
  }
  return { info, live };
}

/** Starts listening on one notify characteristic, only to record its first bytes. Never throws. */
function listen(live: Discovered["live"], at: { serviceUuid: string; characteristicUuid: string } | null, details: PrinterDetails): void {
  const target = at ? live.get(`${at.serviceUuid}/${at.characteristicUuid}`) : undefined;
  if (!at || !target) return;
  details.notifyCharacteristic = at.characteristicUuid;
  const capture = createNotifyCapture();
  try {
    target.addEventListener("characteristicvaluechanged", (event) => {
      const value = (event.target as unknown as BtCharacteristic).value;
      if (!value) return;
      capture.push(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
      details.notifyBytes = capture.bytes();
    });
    void Promise.resolve(target.startNotifications()).catch(() => {});
  } catch {
    // Listening is only for the details.
  }
}

function writerFor(characteristic: BtCharacteristic, choice: WriteChoice): (packet: Uint8Array) => Promise<void> {
  return async (job) => {
    const packet = job.slice();
    if (choice.withoutResponse && typeof characteristic.writeValueWithoutResponse === "function") {
      await characteristic.writeValueWithoutResponse(packet);
    } else if (typeof characteristic.writeValue === "function") {
      await characteristic.writeValue(packet);
    } else if (typeof characteristic.writeValueWithoutResponse === "function") {
      await characteristic.writeValueWithoutResponse(packet);
    } else {
      throw new Error("This printer cannot be written to.");
    }
  };
}

/**
 * Connects to an "other" printer (the remembered one, else the chooser) and
 * returns a link that sends TSPL jobs to its write characteristic. Call it
 * inside the click: the chooser needs the user gesture. Rejects with a
 * PrinterError (code "cancelled" for a closed chooser); the details snapshot
 * is kept either way.
 */
export async function connectGenericPrinter(
  api: BtApi,
  remembered: BtDevice | null,
  onDisconnect: (device: BtDevice) => void,
): Promise<{ device: BtDevice; link: GenericLink }> {
  const details: PrinterDetails = { kind: "generic", deviceName: "", services: [], chosen: null, notifyBytes: [] };
  snapshot = details;
  let device: BtDevice | null = null;
  try {
    device = await pickDevice(api, remembered);
    details.deviceName = device.name ?? "";
    const gatt = device.gatt;
    if (!gatt) throw new PrinterError("connect_failed", "This printer cannot be reached over Bluetooth.");
    const server = await withTimeout(gatt.connect(), CONNECT_TIMEOUT_MS, () => new PrinterError("connect_failed", "The label printer did not answer. Is it switched on and close by?"));
    if (typeof server.getPrimaryServices !== "function") throw new PrinterError("connect_failed", "This browser cannot list the printer's Bluetooth services.");
    const services = await withTimeout(server.getPrimaryServices(), DISCOVER_TIMEOUT_MS, () => new PrinterError("connect_failed", "The printer did not list its services."));
    const found = await withTimeout(discover(services), DISCOVER_TIMEOUT_MS, () => new PrinterError("connect_failed", "The printer did not list its services."));
    details.services = found.info;
    const choice = pickWriteCharacteristic(found.info);
    details.chosen = choice;
    if (!choice) throw new PrinterError("connect_failed", "No writable Bluetooth characteristic was found on this printer.");
    const characteristic = found.live.get(`${choice.serviceUuid}/${choice.characteristicUuid}`);
    if (!characteristic) throw new PrinterError("connect_failed", "The printer's write characteristic is not available.");

    const link = new GenericLink({ write: writerFor(characteristic, choice) });
    listen(found.live, pickNotifyCharacteristic(found.info, choice), details);
    const opened = device;
    opened.addEventListener("gattserverdisconnected", () => {
      link.close();
      onDisconnect(opened);
    });
    return { device: opened, link };
  } catch (error) {
    const failure = error instanceof PrinterError ? error : new PrinterError("connect_failed", error instanceof Error ? error.message : "Could not connect to the label printer.");
    if (failure.code !== "cancelled") details.error = `${failure.code}: ${failure.message}`;
    try {
      device?.gatt?.disconnect();
    } catch {
      // Already gone.
    }
    throw failure;
  }
}

/** Notes a failure after connecting (a write that failed) in the snapshot, so the details carry it. */
export function noteGenericPrintFailure(error: unknown): void {
  if (!snapshot) return;
  const code = error instanceof PrinterError ? error.code : "error";
  const message = error instanceof Error ? error.message : String(error);
  snapshot.error = `${code}: ${message}`;
}
