import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import {
  businessParkingEntryPayload,
  businessParkingUpdateChanges,
  emptyBusinessParkingEntryDraft,
  validateBusinessParkingEntryDraft,
  type BusinessParkingEntryDraft,
} from "./business-parking-entry.ts";
import { translateValue } from "./french-dom.ts";
import { parkingCustomerKey } from "./parking-month-statement.ts";
import { parkingTeamLabel, teamMemberOptions } from "./parking-team.ts";

const panelSource = readFileSync(new URL("../components/business/operations-panels.tsx", import.meta.url), "utf8");
const fieldSource = readFileSync(new URL("../components/business/whose-car-field.tsx", import.meta.url), "utf8");
const monthEndSource = readFileSync(new URL("../components/business/parking-month-end.tsx", import.meta.url), "utf8");

const draft: BusinessParkingEntryDraft = {
  ...emptyBusinessParkingEntryDraft,
  carMake: "Toyota",
  carModel: "Camry",
  carYear: "2019",
  startDate: "2026-08-10",
};

test("the picker offers the owner and every staff member, names only", () => {
  const options = teamMemberOptions(
    [
      { id: "s2", role: "staff", fullName: "Musa Kante" },
      { id: "o1", role: "businessOwner", name: "Aminata Sow" },
      { id: "s1", role: "staff", email: "bah@example.com" },
      { id: "c1", role: "customer", fullName: "Not Team" },
    ],
    { ownerUid: "o1" },
  );
  assert.deepEqual(options.map((o) => o.name), ["Aminata Sow", "bah@example.com", "Musa Kante"]);
  assert.ok(!options.some((o) => o.id === "c1"));
});

test("the owner is offered even when their users row is not in the staff list", () => {
  const options = teamMemberOptions([{ id: "s1", role: "staff", fullName: "Musa" }], { ownerUid: "o1", ownerName: "Aminata" });
  assert.deepEqual(options.map((o) => o.id).sort(), ["o1", "s1"]);
});

test("a tied car is labelled Team, or Former team member once the person has left", () => {
  const team = new Set(["s1"]);
  assert.equal(parkingTeamLabel("", team), "");
  assert.equal(parkingTeamLabel(undefined, team), "");
  assert.equal(parkingTeamLabel("s1", team), "Team car");
  assert.equal(parkingTeamLabel("gone", team), "Former team member");
  // Not loaded yet: never wrongly "Former".
  assert.equal(parkingTeamLabel("s1", new Set()), "Team car");
});

test("a team member's car needs no customer name or phone; a customer's still does", () => {
  assert.deepEqual(validateBusinessParkingEntryDraft({ ...draft, forStaffId: "s1" }, "biz-1"), []);
  const errors = validateBusinessParkingEntryDraft(draft, "biz-1");
  assert.ok(errors.includes("customer_name_required"));
  assert.ok(errors.includes("customer_phone_required"));
  // Untying ("") on an edit needs the customer back.
  const untied = validateBusinessParkingEntryDraft({ ...draft, forStaffId: "" }, "biz-1");
  assert.ok(untied.includes("customer_name_required"));
});

test("the add payload sends forStaffId for a team car, and nothing for a customer's", () => {
  const team = businessParkingEntryPayload({ ...draft, forStaffId: "s1" }, "biz-1") as Record<string, unknown>;
  assert.equal(team.forStaffId, "s1");
  assert.ok(!("customerName" in team) && !("customerPhone" in team));
  const customer = businessParkingEntryPayload(
    { ...draft, customerName: "Aissatou", customerPhone: "+1 917 555 0102", forStaffId: "" },
    "biz-1",
  ) as Record<string, unknown>;
  assert.ok(!("forStaffId" in customer));
  assert.equal(customer.customerName, "Aissatou");
});

test("the edit changes tie with a uid, untie with \"\", and leave the tie alone when absent", () => {
  const typed = { ...draft, customerName: "Aissatou", customerPhone: "+1 917 555 0102" };
  assert.equal((businessParkingUpdateChanges({ ...typed, forStaffId: "s1" }) as Record<string, unknown>).forStaffId, "s1");
  const untied = businessParkingUpdateChanges({ ...typed, forStaffId: "" }) as Record<string, unknown>;
  assert.equal(untied.forStaffId, "");
  assert.equal(untied.customerName, "Aissatou");
  assert.ok(!("forStaffId" in businessParkingUpdateChanges(typed)));
});

test("the add form sends forStaffId and the edit form sends changes.forStaffId", () => {
  const submit = panelSource.slice(panelSource.indexOf("async function submitEntry("), panelSource.indexOf("async function openParkingDocument("));
  assert.match(submit, /businessParkingEntryPayload\(/);
  assert.match(submit, /forStaffId: entryWhose === "team" \? entryDraft\.forStaffId : ""/);
  assert.match(submit, /entryWhose === "team" && !entryDraft\.forStaffId/);
  const save = panelSource.slice(panelSource.indexOf("async function saveParking("), panelSource.indexOf("async function updateParkingStatus("));
  assert.match(save, /changes: businessParkingUpdateChanges\(entry\)/);
  const asEntry = panelSource.slice(panelSource.indexOf("function editDraftAsEntry("), panelSource.indexOf("async function saveParking("));
  assert.match(asEntry, /forStaffId: draft\.whose === "team" \? draft\.forStaffId : ""/);
  // Prefilled from the car.
  assert.match(panelSource, /forStaffId: text\(row\.forStaffId, ""\)/);
  // Both forms hide the customer fields for a team car and share one control.
  assert.match(panelSource, /\{entryWhose === "other" && \(/);
  assert.match(panelSource, /\{draft\.whose === "other" && \(/);
  assert.equal((panelSource.match(/<WhoseCarField/g) ?? []).length, 2);
});

test("team members are no longer mixed into the parking customer suggestions", () => {
  assert.doesNotMatch(panelSource, /lotCustomerFromStaffRow/);
  assert.match(panelSource, /teamMemberOptions\(parkingStaff\.rows, business\)/);
});

test("the list rows, card and Month end carry the Team labels", () => {
  assert.equal((panelSource.match(/<TeamTag label=\{parkingTeamLabel\(row\.forStaffId, teamIds\)\}/g) ?? []).length, 2);
  assert.match(monthEndSource, /isTeamCard\(row\) && <TeamTag label="Team member" \/>/, "the table row");
  assert.match(monthEndSource, /isTeamCard\(customer\) && <TeamTag label="Team member" \/>/, "the bill");
  assert.match(readFileSync(new URL("./parking-month-table.ts", import.meta.url), "utf8"), /return Boolean\(card\.forStaffId \|\| card\.statementStaffId\);/);
});

test("Month end groups a team car under staff:{uid}, apart from a same-number untied car", () => {
  assert.equal(parkingCustomerKey({ customerPhone: "+1 917 555 0102", customerName: "X", forStaffId: "s1" }), "staff:s1");
  assert.equal(parkingCustomerKey({ customerPhone: "+1 917 555 0102", customerName: "X" }), "phone:9175550102");
});

test("every new string has a French translation", () => {
  const strings = [
    "Whose car?",
    "Someone else",
    "Team member",
    "Choose a team member…",
    "Their parking goes on their Staff balances. No WhatsApp is sent.",
    "Team car",
    "Former team member",
    "Choose which team member's car this is.",
  ];
  for (const text of strings) {
    const fr = translateValue(text, "fr");
    assert.notEqual(fr, text, `${text} needs French`);
  }
  // And each of them is actually rendered by the new control / pages.
  for (const text of ["Whose car?", "Someone else", "Team member", "Choose a team member…", "Former team member", "Their parking goes on their Staff balances. No WhatsApp is sent."]) {
    assert.ok(fieldSource.includes(text), `${text} should be in the control`);
  }
  assert.ok(panelSource.includes("Choose which team member's car this is."));
});

test("a team member's own lot jobs join their staff: bill", async () => {
  const { parkingMonthSummary } = await import("./parking-month-statement.ts");
  const s = parkingMonthSummary(
    [{ id: "c", parkingDate: "2026-10-01T12:00:00Z", parkingEndDate: "2026-10-03T12:00:00Z", amountDueCents: 3600, customerName: "Abdoulaye Sow", customerPhone: "+13475628973", forStaffId: "abd", paymentMethod: "direct" }],
    "2026-10",
    new Date("2026-11-02T18:00:00Z"),
    [
      { id: "j", activityDate: "2026-10-15T12:00:00Z", activityTypeLabel: "title", feeCents: 10000, customerName: "abdoulaye sow", customerPhone: "3475628973", forStaffId: "abd" },
      { id: "k", activityDate: "2026-10-15T12:00:00Z", activityTypeLabel: "title", feeCents: 10000, customerName: "abdoulaye sow", customerPhone: "3475628973" },
    ],
  );
  const mine = s.customers.find((c) => c.key === "staff:abd");
  assert.deepEqual(mine?.activities.map((a) => a.id), ["j"]);
  assert.equal(mine?.cars.length, 1);
  assert.deepEqual(s.customers.find((c) => c.key === "phone:3475628973")?.activities.map((a) => a.id), ["k"]);
});

test("month end names who received each payment", async () => {
  const { parkingPaidBy, activityPaidBy } = await import("./parking-month-statement.ts");
  assert.deepEqual(parkingPaidBy({ parkingPayments: [
    { amountCents: 100, receivedByStaffId: "abd" },
    { amountCents: 100, receivedByStaffId: "abd" },
    { amountCents: 100, receivedByStaffId: "yao", reverted: true },
    { amountCents: 100, receivedByStaffId: "business_account" },
  ], receivedByStaffId: "yao" }), ["abd", "business_account"]);
  // Marked paid with no payment line: the car's own "received by".
  assert.deepEqual(parkingPaidBy({ receivedByStaffId: "yao" }), ["yao"]);
  assert.deepEqual(parkingPaidBy({}), []);
  assert.deepEqual(activityPaidBy({ receivedByStaffId: "yao" }), ["yao"]);
  const source = readFileSync(new URL("../components/business/parking-month-end.tsx", import.meta.url), "utf8");
  assert.match(source, /received by \$\{names\.join/);
  assert.match(source, /reçu par \$\{names\.join/);
});
