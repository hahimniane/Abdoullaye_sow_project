import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  lotDuplicateGroupsFrom,
  lotDuplicateNotice,
  lotRepeatQuestion,
  lotVinJobRefusal,
  lotVinTail,
} from "./lot-vin-duplicates.ts";

const fmt = (value: unknown) => `<${String(value).slice(0, 10)}>`;

test("reads the server's duplicate groups, dropping anything malformed", () => {
  const groups = lotDuplicateGroupsFrom({
    duplicates: [
      {
        key: "VIN1|dispatch",
        vinKey: "VIN1",
        jobKey: "dispatch",
        jobLabel: "Dispatch",
        sameCustomer: true,
        activities: [
          { id: "a", trackingCode: "LA-A", activityDate: 1760000000000, feeCents: 5000, customerName: "Alimou" },
          { id: "b", trackingCode: "LA-B", activityDate: null, feeCents: "2500" },
        ],
      },
      { vinKey: "VIN2", jobKey: "x", activities: [{ id: "only-one" }] },
      "nonsense",
    ],
  });
  assert.equal(groups.length, 1);
  assert.equal(groups[0].sameCustomer, true);
  assert.deepEqual(groups[0].activities.map((m) => [m.id, m.activityDate, m.feeCents]), [
    ["a", 1760000000000, 5000],
    ["b", null, 2500],
  ]);
  assert.deepEqual(lotDuplicateGroupsFrom(null), []);
  assert.deepEqual(lotDuplicateGroupsFrom({ duplicates: "no" }), []);
});

test("recognises the rule's two refusals by reason, nothing else", () => {
  const duplicate = lotVinJobRefusal({
    code: "functions/already-exists",
    details: {
      reason: "vin_job_duplicate",
      existingActivityId: "a1",
      existingTrackingCode: "LA-A1",
      existingActivityDate: "2026-10-01T12:00:00.000Z",
      existingCustomerName: "Alimou",
    },
  });
  assert.deepEqual(duplicate, {
    kind: "duplicate",
    existing: { activityId: "a1", trackingCode: "LA-A1", activityDate: "2026-10-01T12:00:00.000Z", customerName: "Alimou" },
  });
  const repeat = lotVinJobRefusal({
    details: { reason: "vin_job_repeat_confirm", existing: [{ activityId: "a1", trackingCode: "LA-A1", activityDate: "", customerName: "Fatou" }] },
  });
  assert.equal(repeat?.kind, "repeat");
  assert.equal(repeat?.kind === "repeat" && repeat.existing[0].customerName, "Fatou");
  assert.equal(lotVinJobRefusal(new Error("boom")), null);
  assert.equal(lotVinJobRefusal({ details: { reason: "paid_amount_locked" } }), null);
  assert.equal(lotVinJobRefusal(undefined), null);
});

test("words the duplicate notice in both languages", () => {
  const found = { activityId: "a1", trackingCode: "LA-A1", activityDate: "2026-10-01T12:00:00Z", customerName: "Alimou" };
  assert.equal(
    lotDuplicateNotice("Dispatch", found, fmt, "en"),
    "This car already has a Dispatch for this customer: LA-A1 (<2026-10-01>)",
  );
  assert.equal(
    lotDuplicateNotice("Auction purchase", found, fmt, "en"),
    "This car already has an Auction purchase for this customer: LA-A1 (<2026-10-01>)",
  );
  assert.equal(
    lotDuplicateNotice("Dispatch", found, fmt, "fr"),
    "Cette voiture a déjà « Dispatch » pour ce client : LA-A1 (<2026-10-01>)",
  );
});

test("asks before a repeat for another customer, in both languages", () => {
  const q = lotRepeatQuestion(
    "Dispatch",
    [{ activityId: "a1", trackingCode: "LA-A1", activityDate: "2026-10-01T12:00:00Z", customerName: "Fatou Camara" }],
    fmt,
  );
  assert.equal(q.en, "This car already had a Dispatch on <2026-10-01> for Fatou Camara (LA-A1). Record another for this customer?");
  assert.equal(q.fr, "Cette voiture a déjà eu « Dispatch » le <2026-10-01> pour Fatou Camara (LA-A1). En enregistrer un autre pour ce client ?");
});

test("shows a VIN by its last 8", () => {
  assert.equal(lotVinTail("1hgcm82633a 004352"), "…3A004352");
  assert.equal(lotVinTail(""), "");
});

test("the lot ledger wires the rule: list, void, confirm, open", () => {
  const panel = readFileSync("src/components/business/operations-panels.tsx", "utf8");
  // The list comes from the server over every activity, not a loaded page.
  assert.match(panel, /"getLotLedgerTotals",\s*enabled \? \{ businessId, action: "vinDuplicates" \}/);
  assert.match(panel, /Possible duplicates/);
  assert.match(panel, /Different customers — may be a resale; void only if entered by mistake/);
  // Refusals are read by reason; a repeat is resent with confirmRepeat.
  assert.match(panel, /lotVinJobRefusal\(/);
  assert.match(panel, /confirmRepeat: true/);
  assert.match(panel, /Open it/);
  // The list's Void reuses the panel's own void confirm.
  assert.match(panel, /function voidDuplicate\(/);
});
