import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {describe, it} from "node:test";

import {translateValue} from "./french-dom.ts";
import {
  sharedBarrelPoolErrorMessage,
  sharedBarrelDeadlineIso,
  type SharedBarrelPoolDraft,
  validateSharedBarrelPoolDraft,
} from "./shared-barrel-pool.ts";

const businessSource = readFileSync(
  "src/components/business/operations-panels.tsx",
  "utf8",
);

function validDraft(
  overrides: Partial<SharedBarrelPoolDraft> = {},
): SharedBarrelPoolDraft {
  return {
    origin: "dropOff",
    destinationCountryId: "gn",
    totalShares: "4",
    reservedShares: "2",
    maxJoiners: "2",
    approvalMode: "auto",
    shipMode: "air",
    joinDeadline: "2030-07-17",
    senderName: "Sender",
    senderAddress: "",
    receiverName: "Receiver",
    receiverPhone: "+224777777777",
    contentsDescription: "Clothes and household goods",
    attestedWeightKg: "20",
    contentsAttested: true,
    prohibitedItemsAcknowledged: true,
    sharedLiabilityAccepted: true,
    ...overrides,
  };
}

describe("shared barrel pool transaction form", () => {
  it("accepts complete drop-off and business-held drafts", () => {
    assert.equal(
      validateSharedBarrelPoolDraft("business-1", validDraft(), 0),
      null,
    );
    assert.equal(
      validateSharedBarrelPoolDraft(
        "business-1",
        validDraft({
          origin: "businessHeld",
          reservedShares: "0",
          senderName: "",
          receiverName: "",
          receiverPhone: "",
          contentsDescription: "",
          attestedWeightKg: "",
          contentsAttested: false,
          prohibitedItemsAcknowledged: false,
          sharedLiabilityAccepted: false,
        }),
        0,
      ),
      null,
    );
  });

  it("identifies the missing contents field from the reported failure", () => {
    assert.deepEqual(
      validateSharedBarrelPoolDraft(
        "business-1",
        validDraft({contentsDescription: ""}),
        0,
      ),
      {
        field: "contentsDescription",
        message: "Contents note is required for drop-off pools.",
      },
    );
  });

  it("validates share limits, weight, attestations, and deadlines", () => {
    assert.equal(
      validateSharedBarrelPoolDraft(
        "business-1",
        validDraft({
          origin: "businessHeld",
          reservedShares: "1",
        }),
        0,
      )?.field,
      "reservedShares",
    );
    assert.equal(
      validateSharedBarrelPoolDraft(
        "business-1",
        validDraft({maxJoiners: "3"}),
        0,
      )?.field,
      "maxJoiners",
    );
    assert.equal(
      validateSharedBarrelPoolDraft(
        "business-1",
        validDraft({reservedShares: "4"}),
        0,
      )?.field,
      "reservedShares",
    );
    assert.equal(
      validateSharedBarrelPoolDraft(
        "business-1",
        validDraft({attestedWeightKg: "41"}),
        0,
      )?.field,
      "attestedWeightKg",
    );
    assert.equal(
      validateSharedBarrelPoolDraft(
        "business-1",
        validDraft({contentsAttested: false}),
        0,
      )?.field,
      "contentsAttested",
    );
    assert.equal(
      validateSharedBarrelPoolDraft(
        "business-1",
        validDraft({joinDeadline: "2026-07-15"}),
        Date.parse("2026-07-16T00:00:00.000Z"),
      )?.field,
      "joinDeadline",
    );
  });

  it("treats a date-only deadline as the end of the selected day", () => {
    assert.equal(
      sharedBarrelDeadlineIso("2026-07-17"),
      "2026-07-17T23:59:59.999Z",
    );
  });

  it("keeps transaction errors and progress visible inside the modal", () => {
    assert.match(businessSource, /className="lst-form-error"/);
    assert.match(businessSource, /role="alert"/);
    assert.match(businessSource, /aria-live="assertive"/);
    assert.match(businessSource, /data-pool-field="contentsDescription"/);
    assert.match(businessSource, /Opening pool\.\.\./);
    assert.match(businessSource, /validateSharedBarrelPoolDraft/);
  });

  it("keeps every business transaction modal open and readable on failure", () => {
    const inModalErrors =
      businessSource.match(
        /message && <div className="lst-form-error" role="alert">/g,
      ) ?? [];
    assert.ok(
      inModalErrors.length >= 6,
      "destination, listing, adjustment, rollover, transport, and parking modals need visible errors",
    );
    assert.match(businessSource, /if \(!busy\) closeForm\(\)/);
    assert.match(businessSource, /disabled=\{busy\} aria-busy=\{busy\}/);
    assert.match(
      businessSource,
      /function submitPoolAdjustment\(\)[\s\S]*Inspection note is required\.[\s\S]*confirmImportantAction/,
    );
    assert.match(
      businessSource,
      /function submitPoolRollover\(\)[\s\S]*Choose a future matching deadline\.[\s\S]*confirmImportantAction/,
    );
  });

  it("turns callable failures into actionable operator messages", () => {
    assert.equal(
      sharedBarrelPoolErrorMessage({code: "functions/permission-denied"}),
      "You do not have permission to open shared barrel pools for this business.",
    );
    assert.equal(
      sharedBarrelPoolErrorMessage({code: "functions/unavailable"}),
      "Could not open the pool. Check your connection and try again.",
    );
    assert.equal(
      sharedBarrelPoolErrorMessage({
        code: "functions/invalid-argument",
        message:
          "Firebase: Contents note is required (functions/invalid-argument).",
      }),
      "Contents note is required",
    );
  });

  it("localizes all newly visible transaction feedback", () => {
    assert.equal(
      translateValue("Choose a future join deadline.", "fr"),
      "Choisissez une date limite d’inscription future.",
    );
    assert.equal(
      translateValue("Opening pool...", "fr"),
      "Ouverture du baril...",
    );
    assert.equal(
      translateValue(
        "Business-held pools must start with 0 reserved shares.",
        "fr",
      ),
      "Les barils détenus par l’entreprise doivent commencer avec 0 part réservée.",
    );
    assert.equal(
      translateValue("Max joiners must fit the open shares.", "fr"),
      "Le nombre maximal de participants doit correspondre aux parts ouvertes.",
    );
    assert.equal(
      translateValue(
        "Could not open the pool. Check your connection and try again.",
        "fr",
      ),
      "Impossible d’ouvrir le baril. Vérifiez votre connexion et réessayez.",
    );
    assert.equal(
      translateValue("Choose a future matching deadline.", "fr"),
      "Choisissez une date limite de mise en relation future.",
    );
  });
});
