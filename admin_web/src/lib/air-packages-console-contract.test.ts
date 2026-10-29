import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { translateValue } from "./french-dom.ts";

// The console wiring of air shipments and package proof (docs/AIR_PACKAGES.md
// §5), pinned by reading the source the way the other console contracts do:
// the Sea / Air choice, the customs list, the proof fields on every line
// form, the ticks on every list, and the loading warning's acknowledgement.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const panel = read("../components/business/containers-panel.tsx");
const waiting = read("../components/business/waiting-packages-panel.tsx");
const assign = read("../components/business/add-waiting-packages-dialog.tsx");
const requests = read("../components/business/package-requests-panel.tsx");
const staff = read("../components/package-staff-view.tsx");
const fields = read("../components/business/proof-fields.tsx");
const ticks = read("../components/business/proof-ticks.tsx");

test("the container form offers Sea / Air; air asks for the waybill and airline and hides the number and shipping line", () => {
  assert.match(panel, /role="radiogroup" aria-label="How it travels"/);
  assert.match(panel, /\(\["sea", "air"\] as ShipMode\[\]\)\.map/);
  assert.match(panel, /draftAir \? \(\s*<>\s*<label className="lst-field"><span>Air waybill<\/span>/);
  assert.match(panel, /<label className="lst-field"><span>Airline<\/span>/);
  assert.match(panel, /\{!draftAir && \(\s*<label className="lst-field wide"><span>Shipping line<\/span>/);
  // After departure only the note changes on a flight (no shipping line to choose later).
  assert.match(panel, /const changes = wasOpen \? payload : air \? \{ notes: payload\.notes \} : \{ notes: payload\.notes, carrierScac: payload\.carrierScac \};/);
  // The detail says Air waybill / Airline instead of the number and the line.
  assert.match(panel, /selectedAir \? \(\s*<div><span>Air waybill<\/span>/);
  assert.match(panel, /selectedAir \? \(\s*<div><span>Airline<\/span>/);
  assert.match(panel, /selectedAir \? "This shipment has no lines\." : "This container has no lines\."/);
});

test("Customs list opens the container document with view \"customs\", next to the labels", () => {
  assert.match(panel, /httpsCallable\(functions, "getContainerDocumentUrl"\)\(\{ businessId, containerId: String\(row\.id\), view: "customs" \}\)/);
  const detail = panel.match(/<div className="ctn-detail-actions">([\s\S]*?)\n {14}<\/div>/);
  assert.ok(detail, "detail actions not found");
  const labelsAt = detail[1].indexOf("onClick={() => openLabels(selectedId)}");
  const customsAt = detail[1].indexOf("openCustomsList(selected)");
  assert.ok(labelsAt >= 0 && customsAt > labelsAt, "Customs list follows Print labels");
  // The tab opens on the click and busy resolves on every path, like the loading list.
  assert.match(panel, /async function openCustomsList\(row: FirestoreRow\) \{\s*setDocumentLink\(""\);\s*const tab = openPendingTab\(window\);/);
  assert.match(panel, /throw new Error\("The customs list is not ready yet\. Try again in a moment\."\);\s*if \(!sendPendingTab\(tab, url\)\) setDocumentLink\(url\);\s*\}, \(\) => closePendingTab\(tab\)\);/);
});

test("every line form carries the proof fields and sends them to its callable", () => {
  // The container line: inside `line`, for add and for edit.
  assert.match(panel, /const line = \{ \.\.\.containerLinePayload\(lineDraft\), \.\.\.proof \};/);
  assert.match(panel, /httpsCallable\(functions, "updateContainerLine"\)\(\{ \.\.\.request, line: \{ \.\.\.request\.line, \.\.\.proof \} \}\)/);
  assert.equal((panel.match(/<ProofFields\s/g) ?? []).length, 1);
  // The waiting package: top level on add, inside `line` on edit.
  assert.match(waiting, /httpsCallable\(functions, "addWaitingPackage"\)\(\{ \.\.\.addWaitingPackagePayload\(businessId, draft\), \.\.\.proofFields \}\)/);
  assert.match(waiting, /httpsCallable\(functions, "updateContainerLine"\)\(\{ \.\.\.request, line: \{ \.\.\.request\.line, \.\.\.proofFields \} \}\)/);
  assert.equal((waiting.match(/<ProofFields\s/g) ?? []).length, 1);
  // The received request: top level, never required (its source is the request).
  assert.match(requests, /\.\.\.\(payment \? \{ payment \} : \{\}\),\s*\.\.\.proofPayload\(proof\),\s*\}\);/);
  assert.equal((requests.match(/<ProofFields\s/g) ?? []).length, 1);
  assert.doesNotMatch(requests.slice(requests.indexOf("function ReceiveDialog")), /photosRequired/);
  // The business switch decides the counter's requirement, from the business document.
  assert.match(panel, /const proofSettings = useMemo\(\(\) => proofSettingsOf\(business\), \[business\]\);/);
  assert.match(panel, /photosRequired=\{proofSettings\.photosRequired && text\(editingLineRow\?\.source, "counter"\) === "counter"\}/);
  assert.match(waiting, /photosRequired=\{proofSettings\.photosRequired && text\(editingRow\?\.source, "counter"\) === "counter"\}/);
  assert.match(panel, /proofSettings=\{proofSettings\}/);
  // The camera on a phone, a file picker on a desktop; several at once.
  assert.match(fields, /<input\s+accept="image\/\*"\s+aria-label="Add photo"\s+capture="environment"\s+className="sr-only"\s+multiple/);
  // Uploads go through the shared helper, one photo at a time, with a per-photo state.
  assert.match(fields, /await uploadPackagePhoto\(businessId, chosen\[i\]\)/);
  assert.match(fields, /status: "uploading" as const/);
});

test("the three ticks sit on waiting rows, container lines and the staff view; Missing proof filters the waiting list", () => {
  assert.match(waiting, /<LineUpdateFailures line=\{row\} \/>\s*<ProofTicks line=\{row\} \/>\s*<SenderProblemBanner line=\{row\} compact \/>/);
  assert.match(panel, /<LineWhatsApp line=\{row\} \/>\s*<ProofTicks line=\{row\} \/>\s*<SenderProblemBanner line=\{row\} compact \/>/);
  assert.match(staff, /<ProofTicks line=\{line\} ticks=\{ticks\} \/>/);
  assert.match(staff, /<SenderProblemBanner line=\{line\} \/>/);
  assert.match(staff, /<ProofPhotoThumbs paths=\{photoPaths\} \/>/);
  // Computed once per row set, never per row render.
  assert.match(waiting, /const missingCount = useMemo\(\(\) => sorted\.filter\(\(row\) => lineMissingProof\(row, proofSettings\)\)\.length, \[sorted, proofSettings\]\);/);
  assert.match(waiting, /\["missing", "Missing proof", missingCount\]/);
  // The ticks' words are computed, so the group opts out of the French pass.
  assert.match(ticks, /<span className="prf-ticks" data-no-translate/);
  // The problem flag's link reuses the Support routing.
  assert.match(ticks, /<MessageCustomerButton row=\{line\} label="Open conversation" \/>/);
});

test("loading a package whose sender reported a problem asks once, then resends acknowledging", () => {
  for (const source of [panel, assign]) {
    assert.match(source, /withProblemAcknowledgement\(\s*\(acknowledgeProblems\) => httpsCallable\(functions, "assignContainerLines"\)\(acknowledgeProblems \? \{ \.\.\.request, acknowledgeProblems: true \} : request\),/);
    assert.match(source, /confirmImportantAction\(loadAnywayText\(codes, "en"\), loadAnywayText\(codes, "fr"\)\)/);
  }
});

test("a flight reads as a Shipment on the staff view and its container panel rows", () => {
  assert.match(staff, /<h3>\{air \? "Shipment" : "Container"\}<\/h3>/);
  assert.match(staff, /<span>\{air \? "Departed" : "Sailed"\}<\/span>/);
  assert.match(panel, /\{air && <small className="prf-air"><Plane size=\{11\} aria-hidden="true" \/> <span>By air<\/span><\/small>\}/);
});

test("every air and proof string has French", () => {
  const strings = [
    "Shipment", "New shipment", "Edit shipment", "Start shipment", "Shipment started.", "Shipment updated.", "Shipment deleted.",
    "This shipment has no lines.", "How it travels", "Sea", "Air", "Air waybill", "Airline", "By air", "Departed",
    "Give it a working name now; the air waybill can come later.",
    "Name, waybill, airline, reference and destination stay editable until it departs.",
    "Optional once there is an air waybill or booking number.",
    "Letters, digits and dashes, 6 to 20 of them, from the airline's waybill.",
    "An air waybill is 6 to 20 letters, digits or dashes, like 176-12345678.",
    "Customs list", "The customs list is not ready yet. Try again in a moment.",
    "At least one photo of the package is required.", "Optional. Up to 5 photos of the package as dropped off.",
    "Add photo", "Photo of the package", "Not uploaded", "Remove photo", "What's inside",
    "Optional. The sender confirms this list and customs read it.", "Item", "Qty", "Serial / IMEI", "Remove item", "Add item",
    "Weight (lb)", "Declared value ($)", "Whole dollars. Never printed on the label.",
    "That file is not a photo.", "That photo could not be read.", "That photo is too large.", "Sign in again to add photos.",
    "Wait for the photos to finish uploading.", "Add at least one photo of the package.",
    "Check the item list: a name up to 60 characters, a quantity from 1 to 99, and an optional serial number.",
    "Enter a weight between 0.1 and 2000 lb.", "Enter a declared value of $0 or more.",
    "One of the photos could not be used. Add it again.",
    "Proof", "Missing proof", "All", "Every waiting package has its proof.", "Sender reported a problem", "Open conversation",
    "The sender tapped Something's wrong on the confirmation message. Loading this package warns but never blocks.",
    "No drop-off photo.", "Not listed", "Weight", "Not weighed", "Declared value", "Not declared", "Not given",
    "Flight Friday 7 Nov", "e.g. 176-12345678", "e.g. iPhone 13",
  ];
  for (const english of strings) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});
