import assert from "node:assert/strict";
import test from "node:test";

import { readFleetSettings } from "./fleet.ts";

test("WhatsApp to drivers: off and everyone by default", () => {
  const s = readFleetSettings({ fleet: { settings: {} } });
  assert.equal(s.whatsappEnabled, false);
  assert.deepEqual(s.whatsappOnlyDriverIds, []);
});

test("WhatsApp to drivers: only the chosen drivers, bad entries dropped", () => {
  const s = readFleetSettings({
    fleet: { settings: { whatsapp: { enabled: true, onlyDriverIds: ["d1", "", 7, null, "d2"] } } },
  });
  assert.equal(s.whatsappEnabled, true);
  assert.deepEqual(s.whatsappOnlyDriverIds, ["d1", "d2"]);
  assert.deepEqual(readFleetSettings({ fleet: { settings: { whatsapp: { onlyDriverIds: "d1" } } } }).whatsappOnlyDriverIds, []);
});
