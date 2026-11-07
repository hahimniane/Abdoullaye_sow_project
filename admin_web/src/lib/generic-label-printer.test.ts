import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";
import {
  GENERIC_CHUNK_BYTES,
  GENERIC_OPTIONAL_SERVICES,
  GENERIC_PRINTER_SERVICES,
  GenericLink,
  bytesToHex,
  createNotifyCapture,
  formatPrinterDetails,
  normalizeUuid,
  parsePrinterKind,
  pickNotifyCharacteristic,
  pickWriteCharacteristic,
  readPrinterKind,
  writePrinterKind,
  PRINTER_KIND_KEY,
  type ServiceInfo,
} from "./generic-label-printer.ts";
import { sentText } from "./label-printer-status.ts";
import { PrinterError, buildLabelJob, printLabels, packBitmap, type LabelLink } from "./pm241.ts";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const base = "-0000-1000-8000-00805f9b34fb";
const svc = (uuid: string, ...chars: Array<[string, Record<string, boolean>]>): ServiceInfo => ({
  uuid,
  characteristics: chars.map(([c, properties]) => ({ uuid: c, properties })),
});

test("the printer choice defaults to the PM-241 and survives blocked storage", () => {
  assert.equal(parsePrinterKind("generic"), "generic");
  for (const odd of ["pm241", "", null, undefined, "GENERIC", 3]) assert.equal(parsePrinterKind(odd), "pm241");
  const store = new Map<string, string>();
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  assert.equal(readPrinterKind(storage), "pm241");
  writePrinterKind(storage, "generic");
  assert.equal(store.get(PRINTER_KIND_KEY), "generic");
  assert.equal(readPrinterKind(storage), "generic");
  const blocked = {
    getItem: () => {
      throw new Error("blocked");
    },
    setItem: () => {
      throw new Error("blocked");
    },
  };
  assert.equal(readPrinterKind(blocked), "pm241");
  assert.doesNotThrow(() => writePrinterKind(blocked, "generic"));
  assert.equal(readPrinterKind(null), "pm241");
});

test("uuids are compared in their full lower-case form", () => {
  assert.equal(normalizeUuid("FF02"), `0000ff02${base}`);
  assert.equal(normalizeUuid("0000FF02"), `0000ff02${base}`);
  assert.equal(normalizeUuid("49535343-8841-43F4-A8D4-ECBE34729BB3"), "49535343-8841-43f4-a8d4-ecbe34729bb3");
});

test("requestDevice is asked for every service in the table, and the table has the seven named", () => {
  assert.equal(GENERIC_OPTIONAL_SERVICES.length, GENERIC_PRINTER_SERVICES.length);
  const wanted = ["ff00", "18f0", "49535343-fe7d-4ae5-8fa9-9fafd205e455", "e7810a71-73ae-499d-8c15-faa9aef0c3f2", "ae30", "fee7", "ffe0"];
  for (const uuid of wanted) assert.ok(GENERIC_OPTIONAL_SERVICES.includes(normalizeUuid(uuid)), uuid);
});

test("pick: a known service with its writable characteristic wins, in table order", () => {
  const services = [
    svc("0000ffe0" + base, ["0000ffe1" + base, { writeWithoutResponse: true, notify: true }]),
    svc("49535343-fe7d-4ae5-8fa9-9fafd205e455", ["49535343-8841-43f4-a8d4-ecbe34729bb3", { write: true }]),
  ];
  const choice = pickWriteCharacteristic(services)!;
  assert.equal(choice.serviceUuid, "49535343-fe7d-4ae5-8fa9-9fafd205e455", "the earlier row of the table wins");
  assert.equal(choice.characteristicUuid, "49535343-8841-43f4-a8d4-ecbe34729bb3");
  assert.equal(choice.withoutResponse, false);
  assert.equal(choice.known, true);
});

test("pick: write without response is preferred where the characteristic has both", () => {
  const choice = pickWriteCharacteristic([svc("ff00", ["ff02", { write: true, writeWithoutResponse: true }])])!;
  assert.equal(choice.withoutResponse, true);
  assert.equal(choice.serviceUuid, `0000ff00${base}`);
});

test("pick: a known characteristic that cannot be written is skipped, then any writable one is used", () => {
  const services = [
    svc("1800", ["2a00", { read: true, write: true }]),
    svc("ff00", ["ff02", { read: true }], ["ff09", { writeWithoutResponse: true }]),
  ];
  const choice = pickWriteCharacteristic(services)!;
  assert.equal(choice.characteristicUuid, `0000ff09${base}`);
  assert.equal(choice.known, false);
});

test("pick: standard GAP/GATT/Device Information services are never the print channel; none is null", () => {
  assert.equal(pickWriteCharacteristic([svc("1800", ["2a00", { write: true }]), svc("180a", ["2a29", { write: true }])]), null);
  assert.equal(pickWriteCharacteristic([]), null);
  assert.equal(pickWriteCharacteristic([svc("ff00", ["ff03", { notify: true }])]), null);
});

test("pick: an unknown vendor service's first writable characteristic is the fallback", () => {
  const choice = pickWriteCharacteristic([svc("12345678-0000-1000-8000-00805f9b34fb", ["aaaa", { notify: true }], ["bbbb", { write: true }])])!;
  assert.equal(choice.serviceUuid, "12345678-0000-1000-8000-00805f9b34fb");
  assert.equal(choice.characteristicUuid, `0000bbbb${base}`);
  assert.equal(choice.known, false);
});

test("notify pick: the chosen service's notify characteristic first", () => {
  const services = [
    svc("12345678-0000-1000-8000-00805f9b34fb", ["aaaa", { notify: true }]),
    svc("ff00", ["ff02", { writeWithoutResponse: true }], ["ff03", { notify: true }]),
  ];
  const choice = pickWriteCharacteristic(services);
  assert.equal(pickNotifyCharacteristic(services, choice)?.characteristicUuid, `0000ff03${base}`);
  assert.equal(pickNotifyCharacteristic([svc("ff00", ["ff02", { write: true }])], null), null);
});

// --- the link -----------------------------------------------------------------

function fakeTransport(options: { failAt?: number } = {}) {
  const writes: Uint8Array[] = [];
  return {
    writes,
    transport: {
      async write(packet: Uint8Array) {
        if (options.failAt !== undefined && writes.length === options.failAt) throw new Error("GATT write failed");
        writes.push(packet);
      },
    },
  };
}

test("the link cuts a job into 180-byte writes and the bytes arrive in order", async () => {
  const { writes, transport } = fakeTransport();
  const link = new GenericLink(transport, { pacingMs: 0, labelGapMs: 0 });
  const job = Uint8Array.from({ length: 1000 }, (_, i) => i % 251);
  const progress: number[] = [];
  await link.send(job, (sent) => progress.push(sent));
  assert.equal(GENERIC_CHUNK_BYTES, 180);
  assert.deepEqual(writes.map((w) => w.length), [180, 180, 180, 180, 180, 100]);
  assert.deepEqual(Buffer.concat(writes), Buffer.from(job));
  assert.equal(progress.at(-1), 1000);
});

test("the link paces its writes", async () => {
  const { writes, transport } = fakeTransport();
  const link = new GenericLink(transport, { chunkBytes: 10, pacingMs: 15, labelGapMs: 0 });
  const started = Date.now();
  await link.send(new Uint8Array(40));
  assert.equal(writes.length, 4);
  assert.ok(Date.now() - started >= 40, "four writes with a pause after each");
});

test("a failed write is a write_failed error; a dropped link is disconnected", async () => {
  const failing = fakeTransport({ failAt: 1 });
  const link = new GenericLink(failing.transport, { chunkBytes: 10, pacingMs: 0 });
  await assert.rejects(link.send(new Uint8Array(50)), (e: unknown) => e instanceof PrinterError && e.code === "write_failed" && /GATT write failed/.test(e.message));

  const dropped = new GenericLink(fakeTransport().transport, { chunkBytes: 10, pacingMs: 0 });
  dropped.close();
  assert.equal(dropped.isClosed, true);
  await assert.rejects(dropped.send(new Uint8Array(50)), (e: unknown) => e instanceof PrinterError && e.code === "disconnected");
  await assert.rejects(dropped.waitDone(), (e: unknown) => e instanceof PrinterError && e.code === "disconnected");
});

test("a write that never returns ends in a timeout, and the loop stops writing", async () => {
  let calls = 0;
  const link = new GenericLink({ write: () => (calls++, new Promise<void>(() => {})) }, { sendTimeoutMs: 30, pacingMs: 0 });
  await assert.rejects(link.send(new Uint8Array(500)), (e: unknown) => e instanceof PrinterError && e.code === "no_credit");
  assert.equal(calls, 1);
});

test("the link says it cannot confirm labels, and printLabels sends them all with the TSPL job", async () => {
  const { writes, transport } = fakeTransport();
  const link = new GenericLink(transport, { pacingMs: 0, labelGapMs: 1 });
  assert.equal(link.confirmsLabels, false);
  const white = () => packBitmap(new Uint8Array(16 * 8 * 4).fill(255), 16, 8);
  const printed = await printLabels(link as LabelLink, 2, white);
  assert.equal(printed, 2);
  const job = buildLabelJob(white());
  assert.deepEqual(Buffer.concat(writes), Buffer.concat([Buffer.from(job), Buffer.from(job)]));
  const text = Buffer.from(job).toString("latin1");
  assert.match(text, /^SIZE 100 mm, 150 mm\r\nGAP 3 mm, 0 mm\r\nDENSITY 10\r\nSPEED 4\r\nDIRECTION 0\r\nCLS\r\nBITMAP /);
  assert.ok(text.endsWith("\r\nPRINT 1\r\n"));
});

// --- the details --------------------------------------------------------------

test("bytesToHex is capped and says how many it left out", () => {
  assert.equal(bytesToHex([1, 171, 255]), "01 ab ff");
  assert.equal(bytesToHex([]), "");
  assert.equal(bytesToHex(new Array(10).fill(0), 4), "00 00 00 00 (+6 more)");
});

test("the notify capture keeps only the first 3 s and at most the cap", () => {
  let now = 1000;
  const capture = createNotifyCapture(() => now, 3000, 5);
  capture.push([1, 2, 3]);
  now = 3999;
  capture.push([4, 5, 6, 7]);
  now = 4001;
  capture.push([9]);
  assert.deepEqual(capture.bytes(), [1, 2, 3, 4, 5]);
});

test("the details block names the device, services, properties, choice, browser and first bytes - and nothing else", () => {
  const services = [svc("ff00", ["ff02", { writeWithoutResponse: true }], ["ff03", { notify: true, read: true }])];
  const text = formatPrinterDetails(
    {
      kind: "generic",
      deviceName: "JADENS C10",
      services,
      chosen: pickWriteCharacteristic(services),
      notifyBytes: [1, 7],
      notifyCharacteristic: `0000ff03${base}`,
    },
    "Mozilla/5.0 Chrome/130",
  );
  assert.match(text, /^Laawol label printer details \(beta\)\n/);
  assert.match(text, /Printer type: Other 4x6 Bluetooth printer/);
  assert.match(text, /Device name: JADENS C10/);
  assert.match(text, /Browser: Mozilla\/5\.0 Chrome\/130/);
  assert.match(text, /Chosen write characteristic: 0000ff02-0000-1000-8000-00805f9b34fb in service 0000ff00-0000-1000-8000-00805f9b34fb \(write without response, known table\)/);
  assert.match(text, /Services found: 1\n {2}service 0000ff00-[\s\S]*0000ff02-[^\n]*\[writeWithoutResponse\]\n {4}0000ff03-[^\n]*\[read, notify\]/);
  assert.match(text, /First bytes from the printer \(first 3 s, 0000ff03[^)]*\): 01 07/);
  assert.ok(!/Error:/.test(text));
});

test("the details block still works with nothing found, and carries the error", () => {
  const text = formatPrinterDetails(
    { kind: "generic", deviceName: "", services: [], chosen: null, notifyBytes: [], error: "connect_failed: No writable Bluetooth characteristic was found on this printer." },
    "",
  );
  assert.match(text, /Device name: \(none\)/);
  assert.match(text, /Chosen write characteristic: none/);
  assert.match(text, /Services found: 0/);
  assert.match(text, /nothing received/);
  assert.match(text, /Error: connect_failed: No writable/);
  assert.match(text, /Browser: \(unknown\)/);
  // Long browser/error strings are clipped, not pasted whole.
  const long = formatPrinterDetails({ kind: "generic", deviceName: "x", services: [], chosen: null, notifyBytes: [], error: "e".repeat(1000) }, "u".repeat(1000));
  assert.ok(long.length < 1200);
});

test("sent text reads in both languages and pluralises", () => {
  assert.equal(sentText(1, "en"), "Sent 1 label to the printer. Check that it came out.");
  assert.equal(sentText(3, "en"), "Sent 3 labels to the printer. Check that they came out.");
  assert.equal(sentText(1, "fr"), "1 étiquette envoyée à l’imprimante. Vérifiez qu’elle est sortie.");
  assert.equal(sentText(3, "fr"), "3 étiquettes envoyées à l’imprimante. Vérifiez qu’elles sont sorties.");
});

// --- the UI -------------------------------------------------------------------

const pickerSource = read("../components/business/label-printer-picker.tsx");
const dialogSource = read("../components/business/container-labels-dialog.tsx");
const hookSource = read("../components/business/use-label-printer.ts");
const printerSource = read("./pm241-printer.ts");

test("every static string of the beta printer UI has French and round-trips", () => {
  const strings = [
    "Printer type",
    "Other 4×6 Bluetooth printer (beta)",
    "Beta: this may not work with every printer, and it cannot tell us that a label came out. It needs Chrome on Mac, Windows or Android (not Safari on iPhone).",
    "If a label does not print, copy the printer details and send them to Laawol.",
    "Copy printer details",
    "Printer details copied. Send them to Laawol.",
    "Could not copy automatically. Select the text below and copy it.",
    "Nothing to copy yet. Try printing a label first, then copy the details.",
    "The label did not print. Copy the details below and send them to Laawol so we can support your printer.",
    "Printer details",
  ];
  for (const english of strings) {
    assert.ok(pickerSource.includes(english), `"${english}" is no longer in the picker`);
    const french = translateValue(english, "fr");
    assert.notEqual(french, english, `no French for "${english}"`);
    assert.equal(translateValue(french, "en"), english, `"${english}" does not round-trip`);
  }
});

test("the dialog offers the choice only where Web Bluetooth exists, and keeps the PM-241 sentence for the PM-241", () => {
  assert.match(dialogSource, /printer\.supported \? \(\s*<>\s*<LabelPrinterKindPicker printer=\{printer\} \/>\s*\{printer\.kind === "pm241" \? \(\s*<p[^>]*>Prints straight to the PM-241/);
  assert.match(dialogSource, /<GenericPrinterBeta printer=\{printer\} \/>/);
  assert.match(pickerSource, /checked=\{printer\.kind === "pm241"\}[\s\S]*Phomemo PM-241/);
  // The visible fallback box exists and is selectable; details are data, not dictionary text.
  assert.match(pickerSource, /<textarea[\s\S]*readOnly[\s\S]*data-no-translate/);
});

test("the choice is remembered and the PM-241 recipe is untouched by the generic path", () => {
  assert.match(printerSource, /writePrinterKind\(localStore\(\), kind\)/);
  assert.match(printerSource, /if \(kind === "generic"\) \{/);
  // The PM-241 identifiers are still the ones the recipe printed with.
  assert.match(printerSource, /filters: PM241_NAME_PREFIXES\.map\(\(namePrefix\) => \(\{ namePrefix \}\)\)/);
  assert.match(printerSource, /optionalServices: \[PM241_SERVICE_SHORT\]/);
  // A failed beta print offers the details at once, and the clipboard is wrapped.
  assert.match(hookSource, /noteGenericPrintFailure\(error\);\s+setCopy\("idle"\);\s+setDetails\(genericPrinterDetailsText\(\)\)/);
  assert.match(hookSource, /try \{\s+void navigator\.clipboard\.writeText\(block\)[\s\S]*\} catch \{\s+setCopy\("manual"\)/);
});
