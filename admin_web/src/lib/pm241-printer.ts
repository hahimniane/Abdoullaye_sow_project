/**
 * The browser half of printing to the PM-241: Web Bluetooth (Chrome on Mac,
 * Windows and Android) wrapped around the pure `Pm241Link` in `pm241.ts`.
 *
 * One connection is kept for the session: the chosen printer is remembered
 * in this tab, and after a reload `navigator.bluetooth.getDevices()` (where
 * the browser has it) finds it again without the chooser. Web Bluetooth needs
 * a user gesture to open the chooser, so `connectLabelPrinter` must be called
 * from the click that asked to print, before any slow `await`.
 *
 * Not unit-tested - it needs a real Bluetooth adapter and printer; the
 * protocol it drives is (`pm241.test.ts`).
 */

import {
  PM241_NAME_PREFIXES,
  PM241_NOTIFY_UUID,
  PM241_SERVICE_SHORT,
  PM241_SERVICE_UUID,
  PM241_WRITE_UUID,
  Pm241Link,
  PrinterError,
  withTimeout,
  type PrinterReply,
} from "./pm241.ts";

// The slice of Web Bluetooth we use (TypeScript's DOM lib has no types for it).
interface BtCharacteristic {
  value?: DataView | null;
  startNotifications(): Promise<unknown>;
  addEventListener(type: "characteristicvaluechanged", listener: (event: Event) => void): void;
  writeValueWithoutResponse?(value: BufferSource): Promise<void>;
  writeValue?(value: BufferSource): Promise<void>;
}
interface BtService {
  getCharacteristic(uuid: string): Promise<BtCharacteristic>;
}
interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryService(uuid: string): Promise<BtService>;
}
interface BtDevice {
  id: string;
  name?: string;
  gatt?: BtServer;
  addEventListener(type: "gattserverdisconnected", listener: () => void): void;
}
interface BtApi {
  requestDevice(options: unknown): Promise<BtDevice>;
  getDevices?(): Promise<BtDevice[]>;
}

const CONNECT_TIMEOUT_MS = 10000;

function bluetooth(nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator): BtApi | null {
  const api = (nav as (Navigator & { bluetooth?: BtApi }) | undefined)?.bluetooth;
  return api && typeof api.requestDevice === "function" ? api : null;
}

/** True where the browser can talk to a Bluetooth LE printer (Chrome; not Safari, iOS or Firefox). */
export function labelPrinterSupported(nav?: Navigator): boolean {
  return bluetooth(nav) !== null;
}

type Session = { device: BtDevice; link: Pm241Link };

let rememberedDevice: BtDevice | null = null;
let session: Session | null = null;
let connecting: Promise<Pm241Link> | null = null;

function isPm241(name: string | undefined): boolean {
  const upper = (name ?? "").toUpperCase();
  return PM241_NAME_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

/** The printer's name for the screen ("PM-241-BT"), once one is chosen. */
export function labelPrinterName(): string {
  return rememberedDevice?.name ?? "";
}

/** True while a printer is connected and answering. */
export function labelPrinterConnected(): boolean {
  return Boolean(session && !session.link.isClosed && session.device.gatt?.connected);
}

/** Drops the connection (the next print reconnects). The chosen printer stays remembered. */
export function disconnectLabelPrinter(): void {
  const current = session;
  session = null;
  current?.link.close();
  try {
    current?.device.gatt?.disconnect();
  } catch {
    // Already gone.
  }
}

async function pickDevice(api: BtApi): Promise<BtDevice> {
  if (rememberedDevice) return rememberedDevice;
  // A printer chosen before (an earlier visit): found again without the chooser.
  if (typeof api.getDevices === "function") {
    try {
      const known = (await api.getDevices()).find((d) => isPm241(d.name));
      if (known) return (rememberedDevice = known);
    } catch {
      // Not allowed here; the chooser below still works.
    }
  }
  try {
    const device = await api.requestDevice({
      filters: PM241_NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
      optionalServices: [PM241_SERVICE_SHORT],
    });
    return (rememberedDevice = device);
  } catch (error) {
    const name = error && typeof error === "object" ? (error as { name?: string }).name : "";
    // Closing the chooser is a choice, not a failure.
    if (name === "NotFoundError") throw new PrinterError("cancelled", "No label printer was chosen.");
    throw new PrinterError("connect_failed", error instanceof Error ? error.message : "Could not open the Bluetooth chooser.");
  }
}

async function openSession(device: BtDevice): Promise<Session> {
  const gatt = device.gatt;
  if (!gatt) throw new PrinterError("connect_failed", "This printer cannot be reached over Bluetooth.");
  const server = await withTimeout(gatt.connect(), CONNECT_TIMEOUT_MS, () => new PrinterError("connect_failed", "The label printer did not answer. Is it switched on and close by?"));
  const service = await withTimeout(server.getPrimaryService(PM241_SERVICE_UUID), CONNECT_TIMEOUT_MS, () => new PrinterError("connect_failed", "The printer did not answer."));
  const write = await service.getCharacteristic(PM241_WRITE_UUID);
  const notify = await service.getCharacteristic(PM241_NOTIFY_UUID);

  const link = new Pm241Link(
    {
      async write(packet) {
        // Copy: the packet is a view into the whole job.
        const bytes = packet.slice();
        if (typeof write.writeValueWithoutResponse === "function") await write.writeValueWithoutResponse(bytes);
        else await write.writeValue?.(bytes);
      },
    },
    {
      onReply: (reply: PrinterReply) => {
        // A rejected command is worth a line in the console, not an error box.
        if (reply.kind === "cmdError") console.warn("Label printer rejected a command:", reply.token);
      },
    },
  );
  notify.addEventListener("characteristicvaluechanged", (event) => {
    const value = (event.target as unknown as BtCharacteristic).value;
    if (value) link.handleNotification(new Uint8Array(value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength)));
  });
  device.addEventListener("gattserverdisconnected", () => {
    link.close();
    if (session?.link === link) session = null;
  });
  await withTimeout(Promise.resolve(notify.startNotifications()), CONNECT_TIMEOUT_MS, () => new PrinterError("connect_failed", "The printer did not answer."));
  await link.settle();
  return { device, link };
}

/**
 * The connected printer's link: the one already open, or a new connection
 * (asking the browser's chooser if no printer is remembered). Call it first
 * thing in the click handler - the chooser needs the click's user gesture.
 * Rejects with a PrinterError; a closed chooser is code "cancelled".
 */
export function connectLabelPrinter(): Promise<Pm241Link> {
  const api = bluetooth();
  if (!api) return Promise.reject(new PrinterError("connect_failed", "This browser cannot print to the label printer."));
  if (session && !session.link.isClosed && session.device.gatt?.connected) return Promise.resolve(session.link);
  // A second tap while connecting joins the first attempt.
  if (connecting) return connecting;
  connecting = (async () => {
    try {
      const device = await pickDevice(api);
      try {
        session = await openSession(device);
      } catch (error) {
        // A remembered printer that will not connect: let the next try ask again.
        rememberedDevice = null;
        session = null;
        try {
          device.gatt?.disconnect();
        } catch {
          // Already gone.
        }
        if (error instanceof PrinterError) throw error;
        throw new PrinterError("connect_failed", error instanceof Error ? error.message : "Could not connect to the label printer.");
      }
      return session.link;
    } finally {
      connecting = null;
    }
  })();
  return connecting;
}
