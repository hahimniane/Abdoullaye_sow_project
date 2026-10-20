import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";

// The release 1.0.19 click-through found the People panel half in English in
// French mode ("Non team members yet"). Every fixed phrase it shows reads in
// French, and the business name and count stay untouched.
test("the People panel reads in French", () => {
  const french: Record<string, string> = {
    "Invite staff": "Inviter du personnel",
    "No team members yet": "Aucun membre de l’équipe pour l’instant",
    "Invite staff and choose what each person can manage.":
      "Invitez du personnel et choisissez ce que chaque personne peut gérer.",
    "Permissions — what this staff member can manage":
      "Permissions : ce que ce membre du personnel peut gérer",
    "Owners and staff linked to ": "Propriétaires et personnel liés à ",
    " team members": " membres de l’équipe",
    " team member": " membre de l’équipe",
  };
  for (const [english, expected] of Object.entries(french)) {
    assert.equal(translateValue(english, "fr"), expected, english);
  }
  const panel = readFileSync(new URL("../components/business/profile-support-people.tsx", import.meta.url), "utf8");
  assert.match(panel, /linked to <span data-no-translate>\{businessName\}<\/span>/);
});
