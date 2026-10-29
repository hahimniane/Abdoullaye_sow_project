import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  businessParkingBalance,
  businessParkingCollectedByMonth,
  businessParkingOverdue,
  businessParkingPaymentTone,
  businessParkingTotals,
  canMarkBusinessParkingPaid,
  canResendBusinessParkingLink,
  canVoidBusinessParking,
  isBusinessParkingVoided,
  parkingRowKind,
} from "./business-parking-entry.ts";
import { summarizeBusinessEarnings } from "./business-earnings.ts";
import { businessOverviewSummary } from "./business-overview.ts";
import { parkedCarsInLot } from "./container-manifest.ts";
import { translateValue } from "./french-dom.ts";
import {
  fixedLineAppliesTo,
  lotExpenseByLine,
  lotLineEndMonth,
  lotLineStopSentence,
  lotLineStoppedFor,
  lotLineStoppedLabel,
  lotLinesInOrder,
  lotMonthExpenseCents,
} from "./lot-ledger.ts";
import { translateAuditSummary } from "./audit-summaries.ts";
import { parkingMonthStatement } from "./parking-month-statement.ts";
import { findVehicleRecordByVin } from "./vin-lookup.ts";
import { isVoidedRecord, voidedLast, voidedNoteParts } from "./voided-record.ts";
import type { FirestoreRow } from "@/types/admin";

// Voiding a parked car and a whole expense line (owner request: Keren Auto
// Sales, 2026-10-29). A voided record is never deleted: it stays on the list
// struck through, with who voided it and why, and drops out of every total,
// bill, space count and prefill. These pin the rules and the console wiring.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const panels = read("../components/business/operations-panels.tsx");
const modal = read("../components/business/void-record.tsx");

const at = (iso: string) => {
  const date = new Date(iso);
  return { toDate: () => date, toMillis: () => date.getTime() };
};
const NOW = new Date("2026-10-05T15:00:00Z");

const liveCar = {
  id: "live", source: "business", status: "reserved", paymentMethod: "direct",
  paymentStatus: "awaiting_direct_payment", dailyRate: 10, parkingDate: at("2026-09-20"),
  amountPaidCents: 5000, parkingPayments: [{ amountCents: 5000, at: at("2026-10-02") }],
};
const voidedCar = {
  ...liveCar, id: "void", voided: true, voidReason: "entered twice",
  voidedByStaffId: "staff-1", voidedAt: at("2026-10-04"),
};

test("a voided car counts in no parking total, owes nothing and is no longer chased", () => {
  assert.equal(isBusinessParkingVoided(voidedCar), true);
  assert.equal(isBusinessParkingVoided(liveCar), false);
  assert.deepEqual(
    businessParkingTotals([liveCar, voidedCar], 40, NOW),
    businessParkingTotals([liveCar], 40, NOW),
  );
  const ended = { ...voidedCar, parkingEndDate: at("2026-09-25"), amountPaidCents: 0 };
  assert.deepEqual(businessParkingOverdue([ended], NOW), { count: 0, amount: 0 });
  assert.equal(businessParkingBalance(ended, NOW), 0);
  assert.deepEqual(
    businessParkingCollectedByMonth([voidedCar], ["2026-10"], NOW),
    [0],
  );
  assert.equal(businessParkingPaymentTone(voidedCar), "none");
  assert.equal(canMarkBusinessParkingPaid(voidedCar), false);
  assert.equal(canResendBusinessParkingLink({ ...voidedCar, paymentMethod: "payment_link" }), false);
  assert.equal(canVoidBusinessParking(voidedCar), false);
  assert.equal(canVoidBusinessParking(liveCar), true);
  assert.equal(parkingRowKind(voidedCar, NOW), "voided");
});

test("a voided car is on no month-end bill, no earnings, no overview and no container pick", () => {
  assert.notEqual(parkingMonthStatement(liveCar, "2026-09", NOW), null);
  assert.equal(parkingMonthStatement(voidedCar, "2026-09", NOW), null);
  const paidVoid = { ...voidedCar, totalCostCents: 9000, paymentStatus: "paid" } as unknown as FirestoreRow;
  assert.equal(summarizeBusinessEarnings({ purchases: [], shipments: [], freightShipments: [], transports: [], parkedCars: [paidVoid] }).totals.grossReceived, 0);
  assert.equal(businessOverviewSummary({ parkedCars: [paidVoid] }).metrics.parkedCars, 0);
  assert.deepEqual(parkedCarsInLot([liveCar, voidedCar], NOW).map((row) => row.id), ["live"]);
  const vin = { vinNumber: "1HGCM82633A004352" };
  assert.equal(findVehicleRecordByVin([{ ...vin, voided: true, id: "a" }], vin.vinNumber), undefined);
  assert.equal(findVehicleRecordByVin([{ ...vin, voided: true, id: "a" }, { ...vin, id: "b" }], vin.vinNumber)?.id, "b");
});

test("a voided expense line fills in no month and splits into no breakdown", () => {
  const line = { id: "test", kind: "fixed", recurringCents: 2000, label: "test $20/mo", createdAt: at("2026-01-03") };
  const voidedLine = { ...line, voided: true, active: false };
  assert.equal(fixedLineAppliesTo(line, "2026-09", "2026-10"), true);
  assert.equal(fixedLineAppliesTo({ ...line, voided: true }, "2026-09", "2026-10"), false);
  assert.equal(lotMonthExpenseCents([line], [], "2026-09", "2026-10"), 2000);
  assert.equal(lotMonthExpenseCents([voidedLine], [], "2026-09", "2026-10"), 0);
  assert.deepEqual(lotExpenseByLine([voidedLine], [], ["2026-08", "2026-09"], "2026-10"), []);
});

test("voided records sink to the end and carry who, why and when", () => {
  const rows = [{ id: "a", voided: true }, { id: "b" }, { id: "c", voided: true }, { id: "d" }];
  assert.deepEqual(voidedLast(rows).map((r) => r.id), ["b", "d", "a", "c"]);
  const untouched = [{ id: "b" }];
  assert.equal(voidedLast(untouched), untouched);
  assert.equal(isVoidedRecord(null), false);
  assert.deepEqual(voidedNoteParts(voidedCar), {
    reason: "entered twice", byStaffId: "staff-1", at: voidedCar.voidedAt,
  });
});

test("the parked car Void action calls updateBusinessParkingEntry with action void", () => {
  assert.match(panels, /httpsCallable\(functions, "updateBusinessParkingEntry"\)\(\{\s*entryId: voidCar\.id,\s*action: "void",\s*reason: voidCarReason\.trim\(\)\.slice\(0, 300\),\s*\}\)/);
  assert.match(panels, /title="Void this car"/);
  assert.match(panels, /body="Void this car — it stays on the record \(struck through\) and drops out of the totals; it is never deleted\. Other staff see who voided it and why\."/);
  assert.match(panels, /confirmLabel="Void car"/);
  // Offered only on a car not already voided; voided rows hide edit, print and the link.
  assert.match(panels, /\{canVoidBusinessParking\(row\) && \(\s*<button type="button" className="pk-act" title="Void this car"/);
  assert.match(panels, /\{!voided && \(\s*<button type="button" className="pk-act" title="Edit this record"/);
  assert.match(panels, /\{!voided && linkUrl && tone !== "paid" && \(/);
  assert.match(panels, /\{!voided && <ParkingBillingActions row=\{row\} staff=\{parkingStaff\.rows\} \/>\}/);
  assert.match(panels, /\{voided \? null : businessParkingPaymentTone\(row\) === "paid" \? \(/);
  // Struck through with the note, and at the end of the list.
  assert.match(panels, /<b>\{voided \? <s>\{vehicle\}<\/s> : vehicle\}/);
  assert.match(panels, /\{voided && <VoidedNote row=\{row\} nameFor=\{nameForStaff\} \/>\}/);
  assert.match(panels, /return voidedLast\(inRange\.filter\(\(row\) => businessParkingMatchesFacets\(row, facets\)\)\);/);
  assert.match(panels, /\["voided", "Voided"\],/);
  // The refusal is said inside the modal, not behind it.
  assert.match(panels, /setVoidCarError\(error instanceof Error \? error\.message : "The car could not be voided\."\);/);
});

test("the expense line Void action calls voidLotExpenseEntry with lineId", () => {
  assert.match(panels, /voidTarget\.type === "line"\s*\? \{ lineId: voidTarget\.id, reason \}/);
  assert.match(panels, /\{!lineVoided && <button className="ghost-button" type="button" onClick=\{\(\) => voidLine\(l\)\} title="Void this line"><Ban size=\{14\} \/><\/button>\}/);
  assert.match(panels, /title=\{voidTarget\.type === "line" \? "Void this line" : "Void this entry"\}/);
  assert.match(panels, /"Void this line — it stays on the record \(struck through\) and drops out of every month's totals\. It is never deleted\."/);
  // A refusal ("Void this line's purchases first.") shows in the modal.
  assert.match(panels, /closeModal\(\);\s*\}, setDraftError\);/);
  assert.match(panels, /error=\{draftError\}/);
  // A voided line: struck, at the end, no edit and no new purchase.
  assert.match(panels, /\{!lineVoided && <button className="ghost-button" type="button" onClick=\{\(\) => openEditLine\(l\)\}/);
  assert.match(panels, /\{lineVoided && <VoidedNote row=\{l\} nameFor=\{staffName\} \/>\}/);
});

test("one shared modal: optional reason, busy state, user data untranslated", () => {
  assert.match(modal, /<span>Reason \(optional\)<\/span><input value=\{reason\} maxLength=\{300\}/);
  assert.match(modal, /aria-busy=\{busy\}/);
  assert.match(modal, /<p className="panel-lede" data-no-translate>\{label\}<\/p>/);
  assert.match(modal, /<span data-no-translate>\{parts\.reason\}<\/span>/);
  assert.match(modal, /<span data-no-translate>\{by\}<\/span>/);
  assert.match(modal, /formatDate\(parts\.at\)/);
});

test("every new void string reads in French", () => {
  const cases: [string, string][] = [
    ["Void this car", "Invalider cette voiture"],
    ["Void this car — it stays on the record (struck through) and drops out of the totals; it is never deleted. Other staff see who voided it and why.",
      "Invalider cette voiture — elle reste dans le registre (barrée) et sort des totaux ; elle n’est jamais supprimée. Les autres membres voient qui l’a invalidée et pourquoi."],
    ["Void car", "Invalider la voiture"],
    ["Car voided.", "Voiture invalidée."],
    ["The car could not be voided.", "La voiture n’a pas pu être invalidée."],
    ["This car was voided and can no longer be changed.", "Cette voiture a été invalidée et ne peut plus être modifiée."],
    ["Void this line", "Invalider cette ligne"],
    ["Void this line — it stays on the record (struck through) and drops out of every month's totals. It is never deleted.",
      "Invalider cette ligne — elle reste dans le registre (barrée) et sort des totaux de chaque mois. Elle n’est jamais supprimée."],
    ["Void line", "Invalider la ligne"],
    ["Void this line's purchases first.", "Invalidez d’abord les achats de cette ligne."],
    ["Already voided.", "Déjà invalidé."],
    ["Voided", "Invalidé"],
    ["e.g. entered twice, wrong amount", "ex. saisi deux fois, mauvais montant"],
  ];
  for (const [english, french] of cases) {
    assert.equal(translateValue(english, "fr"), french, english);
  }
});

// "Stop after this month" (owner request 2026-10-29): `endMonth` is the last
// month a line counts; every month up to it stays exactly as it was.

test("a stopped fixed line counts through its last month and nothing after", () => {
  const rent = { id: "rent", kind: "fixed", recurringCents: 2000, label: "test $20/mo", createdAt: at("2026-01-03"), endMonth: "2026-09" };
  assert.equal(lotLineEndMonth(rent), "2026-09");
  assert.equal(lotLineEndMonth({ endMonth: "" }), "");
  assert.equal(lotLineEndMonth({ endMonth: "soon" }), "");
  // Before, at and after the last month.
  assert.equal(lotMonthExpenseCents([rent], [], "2026-08", "2026-12"), 2000);
  assert.equal(lotMonthExpenseCents([rent], [], "2026-09", "2026-12"), 2000);
  assert.equal(lotMonthExpenseCents([rent], [], "2026-10", "2026-12"), 0);
  assert.equal(fixedLineAppliesTo(rent, "2026-10", "2026-12"), false);
  assert.equal(fixedLineAppliesTo({ ...rent, endMonth: "" }, "2026-10", "2026-12"), true);
  assert.deepEqual(
    lotExpenseByLine([rent], [], ["2026-08", "2026-09", "2026-10", "2026-11"], "2026-12"),
    [{ lineId: "rent", label: "test $20/mo", cents: 4000 }],
  );
  assert.equal(lotLineStoppedFor(rent, "2026-09"), false);
  assert.equal(lotLineStoppedFor(rent, "2026-10"), true);
});

test("after its last month a line sits with the voided ones, and the metered wait hint stops", () => {
  const live = { id: "live", kind: "metered" };
  const stopped = { id: "stopped", kind: "metered", endMonth: "2026-09" };
  const voided = { id: "voided", kind: "fixed", voided: true };
  assert.deepEqual(lotLinesInOrder([voided, stopped, live], "2026-10").map((l) => l.id), ["live", "stopped", "voided"]);
  assert.deepEqual(lotLinesInOrder([voided, stopped, live], "2026-09").map((l) => l.id), ["stopped", "live", "voided"]);
  assert.match(panels, /const missing = metered && monthEntries\.length === 0 && !stoppedHere;/);
  assert.match(panels, /\{metered && !lineVoided && !stoppedHere && \(/);
});

test("Stop after this month and Resume call upsertLotExpenseLine with action setEndMonth", () => {
  assert.match(panels, /httpsCallable\(functions, "upsertLotExpenseLine"\)\(\{\s*businessId,\s*lineId: String\(line\.id \?\? ""\),\s*action: "setEndMonth",\s*endMonth,\s*\}\)/);
  assert.match(panels, /await setLineEndMonth\(stopLine, month\);/);
  assert.match(panels, /await setLineEndMonth\(line, ""\);/);
  assert.match(panels, /title="Stop after this month"><CirclePause size=\{14\} \/><\/button>\}/);
  assert.match(panels, /aria-busy=\{resumeLineId === lineId\} onClick=\{\(\) => void resumeLine\(l\)\} title="Resume this line"/);
  assert.match(panels, /title="Stop this line"\s*body=\{lotLineStopSentence\(month, currentLanguage\(\) === "fr" \? "fr" : "en"\)\}/);
  assert.match(panels, /setStopLineError\(error instanceof Error \? error\.message : "The line could not be stopped\."\);/);
  assert.match(panels, /data-no-translate>\{lotLineStoppedLabel\(lineEndMonth,/);
  assert.match(panels, /\{lotLinesInOrder\(expenseLines\.rows, month\)\.map\(\(line\) => \{/);
  // The edit form never sends endMonth, so a full edit keeps it.
  assert.ok(!/recurringCents: lineDraft\.kind === "fixed"[^}]*endMonth/.test(panels));
});

test("the stop sentences read in both languages", () => {
  assert.equal(lotLineStoppedLabel("2026-10", "en"), "Stopped after Oct 2026");
  assert.equal(lotLineStoppedLabel("2026-10", "fr"), "Arrêtée après oct. 2026");
  assert.equal(lotLineStopSentence("2026-10", "en"), "This line stops after October 2026. Earlier months stay as they are.");
  assert.equal(lotLineStopSentence("2026-10", "fr"), "Cette ligne s’arrête après octobre 2026. Les mois précédents restent tels quels.");
  assert.equal(translateAuditSummary("Stopped after October 2026", () => undefined), "Arrêtée après octobre 2026");
  assert.equal(translateAuditSummary("Resumed", () => undefined), "Reprise");
  const cases: [string, string][] = [
    ["Stop this line", "Arrêter cette ligne"],
    ["Stop after this month", "Arrêter après ce mois"],
    ["Resume", "Remettre en route"],
    ["Line stopped.", "Ligne arrêtée."],
    ["Line resumed.", "Ligne reprise."],
    ["The line could not be stopped.", "La ligne n’a pas pu être arrêtée."],
    ["Pick a valid month.", "Choisissez un mois valide."],
    ["This line has purchases after that month.", "Cette ligne a des achats après ce mois."],
  ];
  for (const [english, french] of cases) {
    assert.equal(translateValue(english, "fr"), french, english);
  }
});
