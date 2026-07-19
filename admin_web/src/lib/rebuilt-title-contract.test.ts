import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { translateValue } from "./french-dom.ts";

const businessSource = readFileSync(
  "src/components/business/operations-panels.tsx",
  "utf8",
);
const adminSource = readFileSync(
  "src/components/admin-console.tsx",
  "utf8",
);

describe("rebuilt-title disclosure contract", () => {
  it("requires an explicit bool and preserves it through business edits", () => {
    assert.match(businessSource, /isRebuiltTitle: boolean \| null/);
    assert.match(businessSource, /isRebuiltTitle: null/);
    assert.match(
      businessSource,
      /typeof row\.isRebuiltTitle === "boolean" \? row\.isRebuiltTitle : null/,
    );
    assert.match(
      businessSource,
      /if \(draft\.isRebuiltTitle === null\)[\s\S]*Select whether this vehicle has a rebuilt title/,
    );
    assert.match(
      businessSource,
      /isRebuiltTitle: draft\.isRebuiltTitle/,
    );
  });

  it("shows legacy records as unknown in business and admin views", () => {
    assert.match(
      businessSource,
      /rebuiltTitle === null \? "Not provided" : rebuiltTitle \? "Yes" : "No"/,
    );
    assert.match(
      adminSource,
      /typeof item\.isRebuiltTitle === "boolean"[\s\S]*: "Not provided"/,
    );
    assert.match(
      adminSource,
      /rebuiltTitle === null \? "Not provided" : rebuiltTitle \? "Yes" : "No"/,
    );
  });

  it("gives admins an explicit unknown review and filter state", () => {
    assert.match(adminSource, /listingRebuiltTitle.*useState\("all"\)/);
    assert.match(adminSource, /<option value="unknown">Rebuilt title: Not provided<\/option>/);
    assert.match(adminSource, /: "unknown"/);
  });

  it("preserves the disclosure in business inventory exports", () => {
    assert.match(
      businessSource,
      /downloadCsv\("listings\.csv"[\s\S]*"isRebuiltTitle"/,
    );
  });

  it("translates every disclosure state and validation message to French", () => {
    const expected = new Map([
      ["Rebuilt title", "Titre reconstruit"],
      ["Rebuilt title?", "Titre reconstruit ?"],
      ["Rebuilt title: Yes", "Titre reconstruit : Oui"],
      ["Rebuilt title: No", "Titre reconstruit : Non"],
      ["Rebuilt title: Not provided", "Titre reconstruit : Non renseigné"],
      ["Not provided", "Non renseigné"],
      [
        "Select whether this vehicle has a rebuilt title.",
        "Indiquez si ce véhicule a un titre reconstruit.",
      ],
      [
        "Required. Buyers will see this disclosure.",
        "Obligatoire. Les acheteurs verront cette information.",
      ],
    ]);

    for (const [english, french] of expected) {
      assert.equal(translateValue(english, "fr"), french);
    }
  });
});
