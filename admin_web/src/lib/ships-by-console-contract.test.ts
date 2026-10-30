import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { CONTAINER_MESSAGES, containerCallableFailure, shipModeMismatch, shipModeMismatchMessage } from "./container-manifest.ts";
import { translateValue } from "./french-dom.ts";
import { assignableLines, assignmentBlockText, assignmentRefusal } from "./waiting-packages.ts";

// "Ships by: Sea · Air" (docs/AIR_PACKAGES.md §7), pinned by reading the
// source the way the other console contracts do: the choice only when the
// business flies, Sea = the form as it was (no proof section), Air = the
// proof section; a line on a container follows the container; the Air badge
// and filter on the Waiting list; the wrong-mode refusal mirrored.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const panel = read("../components/business/containers-panel.tsx");
const waiting = read("../components/business/waiting-packages-panel.tsx");
const assign = read("../components/business/add-waiting-packages-dialog.tsx");
const requests = read("../components/business/package-requests-panel.tsx");
const shipsBy = read("../components/business/ships-by.tsx");

test("the choice is a Sea / Air radio group, offered only when the business ships by air", () => {
  assert.match(shipsBy, /role="radiogroup" aria-label="Ships by"/);
  assert.match(shipsBy, /\(\["sea", "air"\] as const\)\.map/);
  // The flag comes from the business document the panel already holds.
  assert.match(panel, /const shipsByAir = shipsByAirOf\(business\);/);
  assert.match(panel, /shipsByAir=\{shipsByAir\}\s*onFlash=\{setFlash\}/);
  assert.match(waiting, /\{shipsByChoiceShown\(shipsByAir, editingRow\) && \(\s*<ShipsByChoice id="wpk-ships-by" value=\{shipMode\} onChange=\{setShipMode\}/);
  assert.match(requests, /\{shipsByAir && <ShipsByChoice id="pkq-receive-ships-by" value=\{shipMode\} onChange=\{setShipMode\}/);
  // Default sea; an edit opens on the package's own mode.
  assert.match(waiting, /useState<PackageShipMode>\("sea"\)/);
  assert.match(waiting, /setShipMode\(packageShipModeOf\(row\.shipMode\)\);/);
  assert.match(requests, /useState<PackageShipMode>\("sea"\)/);
});

test("Sea is the form as it was: the proof section shows, is checked and is sent only for air", () => {
  assert.match(waiting, /\{proofSectionShown\(shipMode\) && \(\s*<ProofFields\s+id="wpk-proof"/);
  assert.match(waiting, /const proofProblems = proofSectionShown\(shipMode\) \? proofDraftProblems\(proof,/);
  assert.match(waiting, /const proofFields = \{ \.\.\.proofPayloadFor\(shipMode, proof\), shipMode \};/);
  assert.match(requests, /\{proofSectionShown\(shipMode\) && \(\s*<ProofFields\s+id="pkq-receive-proof"/);
  assert.match(requests, /const proofProblems = proofSectionShown\(shipMode\) \? proofDraftProblems\(proof\) : \[\];/);
  // On a container: no choice, the proof section only on a flight, never a shipMode sent.
  assert.match(panel, /\{ownerVisible && selectedAir && \(\s*<ProofFields\s+id="ctn-proof"/);
  assert.match(panel, /const proof = proofPayloadFor\(selected\.shipMode, lineProof\);/);
  assert.doesNotMatch(panel, /<ShipsByChoice/);
});

test("waiting rows and the pick list mark air packages; the list filters Air / Sea when the business flies", () => {
  assert.match(shipsBy, /<Plane size=\{11\} aria-hidden="true" \/> <span>Air<\/span>/);
  assert.match(waiting, /\{packageShipModeOf\(row\.shipMode\) === "air" && <AirPackageBadge \/>\}/);
  assert.match(assign, /\{packageShipModeOf\(line\.shipMode\) === "air" && <AirPackageBadge \/>\}/);
  assert.match(waiting, /\{shipsByAir && \(\s*<div className="service-segments wpk-proof-chips" role="group" aria-label="Filter by how packages ship">/);
});

test("a package going the other way is blocked in the list, both ways, with the server's sentence", () => {
  const sea = { status: "loading", destinationCountryId: "gn" };
  const flight = { ...sea, shipMode: "air" };
  const seaLine = { id: "s", destinationCountryId: "gn" };
  const airLine = { id: "a", destinationCountryId: "gn", shipMode: "air" };
  assert.equal(assignmentRefusal(seaLine, sea), null);
  assert.equal(assignmentRefusal(airLine, flight), null);
  assert.equal(assignmentRefusal(seaLine, flight), "ship_mode_mismatch");
  assert.equal(assignmentRefusal(airLine, sea), "ship_mode_mismatch");
  // The country still comes first.
  assert.equal(assignmentRefusal({ ...airLine, destinationCountryId: "sn" }, sea), "destination_mismatch");
  assert.deepEqual(assignableLines([seaLine, airLine], flight).map((e) => [e.id, e.refusal]), [["s", "ship_mode_mismatch"], ["a", null]]);
  assert.equal(assignmentBlockText(seaLine, flight), CONTAINER_MESSAGES.ship_mode_mismatch);
  assert.equal(assignmentBlockText(airLine, sea), CONTAINER_MESSAGES.ship_mode_mismatch_air);
  // A line on a container moves the way that one goes.
  assert.equal(shipModeMismatch({}, flight, flight), null);
  assert.equal(shipModeMismatch({ shipMode: "air" }, flight, sea), "ship_mode_mismatch");
  assert.match(shipModeMismatchMessage("air"), /marked to go by air; this is a sea container/);
});

test("the server's refusal marks the offending rows and reads in French", () => {
  const failure = containerCallableFailure({
    message: "",
    details: { reason: "ship_mode_mismatch", shipMode: "air", lineIds: ["w1", " w2 "] },
  });
  assert.equal(failure.message, CONTAINER_MESSAGES.ship_mode_mismatch_air);
  assert.deepEqual(failure.offendingLineIds, ["w1", "w2"]);
  assert.equal(containerCallableFailure({ details: { reason: "ship_mode_mismatch", lineIds: [] } }).message,
    CONTAINER_MESSAGES.ship_mode_mismatch);
  for (const english of [
    "Ships by",
    "Sea",
    "Air",
    "No waiting package ships that way.",
    CONTAINER_MESSAGES.ship_mode_mismatch,
    CONTAINER_MESSAGES.ship_mode_mismatch_air,
    CONTAINER_MESSAGES.ship_mode_locked,
    CONTAINER_MESSAGES.ship_mode_invalid,
  ]) {
    const french = translateValue(english, "fr");
    assert.ok(french && french !== english, `${english} has a French translation`);
  }
  assert.equal(translateValue("Ships by", "fr"), "Expédié par");
  for (const attribute of ["Ships by air", "Filter by how packages ship"]) {
    const french = translateValue(attribute, "fr");
    assert.ok(french && french !== attribute, `${attribute} has a French translation`);
  }
});

test("a sea package shows only the delivered tick and never counts as missing proof", () => {
  const ticks = read("../components/business/proof-ticks.tsx");
  const staff = read("../components/package-staff-view.tsx");
  // The photo and sender ticks render only for an air package.
  assert.match(ticks, /\{state\.air && \(\s*<span className=\{`prf-tick\$\{state\.photo/);
  assert.match(ticks, /\{state\.air && \(\s*<span className=\{`prf-tick prf-sender-/);
  assert.match(staff, /ticks\.air \? `\$\{tickLabels\.photo\} · \$\{tickLabels\.sender\} · \$\{tickLabels\.delivered\}` : tickLabels\.delivered/);
  assert.match(staff, /: ticks\.air \? <p className="pkg-staff-muted">No drop-off photo\.<\/p> : null/);
});
