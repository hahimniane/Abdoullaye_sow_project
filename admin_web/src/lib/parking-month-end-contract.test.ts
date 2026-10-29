import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { businessTargetForNotification } from "./notification-routing.ts";
import { translateValue } from "./french-dom.ts";

// Month end sits inside Parking: a button in the panel's header, the view it
// opens, and the 1st-of-month notification landing on the right month.
const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const panels = read("../components/business/operations-panels.tsx");
const view = read("../components/business/parking-month-end.tsx");
const consoleSource = read("../components/business-console.tsx");

test("the parking panel has a Month end button that opens the month's bills", () => {
  assert.match(panels, /<CalendarCheck size=\{16\} \/> Month end<\/button>/);
  // The view reads its own month (useParkingMonthInputs), never the history.
  assert.match(panels, /<ParkingMonthEnd\s+businessId=\{businessId\}/);
  assert.match(view, /useParkingMonthInputs\(businessId, monthKey,/);
  assert.match(panels, /onOpenCar=\{\(row\) => editParking\(row\)\}/, "payments are recorded on the car, as always");
  assert.match(consoleSource, /<ParkingPanel[\s\S]*?focusView=\{notificationFocusView\}[\s\S]*?\/>/);
});

test("the notification on the 1st opens that month", () => {
  assert.deepEqual(
    businessTargetForNotification({ type: "parking_month_end", monthKey: "2026-09" }),
    { tab: "parking", panelView: "month_end:2026-09" },
  );
});

test("the view is worked out from the cars and activities, and records only through existing payments", () => {
  // It never writes the database itself. "Mark all paid" records through the
  // two payments a line already takes - and only those - so each lands
  // exactly as a hand-recorded payment would (received by, history, reports).
  assert.doesNotMatch(view, /setDoc\(|updateDoc\(|addDoc\(|deleteDoc\(/);
  const callables = [...view.matchAll(/httpsCallable\(functions, "(\w+)"\)/g)].map((m) => m[1]).sort();
  assert.deepEqual([...new Set(callables)], ["recordBusinessParkingPartialPayment", "recordLotActivityInstalment"]);
  assert.match(view, /receivedByStaffId: settleBy/, "who received the money is always sent");
  assert.match(view, /if \(!settleBy\) \{/, "and required before anything is recorded");
  // Cars and the ledger's activities, both read, never written.
  // Counted up to now, or - the whole-month estimate - the month's last day.
  // Staff expenses come off their parking bill (docs/STAFF_EXPENSE_CREDIT.md).
  assert.match(view, /parkingMonthSummary\(rows, monthKey, parkingMonthAsOf\(monthKey, wholeMonth\), activities, staffCredit\)/);
});

test("staff expenses: read whole, netted only when both reads answered, never half-netted", () => {
  assert.match(view, /const credit = useStaffExpenseCreditInputs\(businessId, Boolean\(businessId\)\);/);
  assert.match(view, /credit\.available \? \{ entries: credit\.entries, repayments: credit\.repayments, links, staffNames \} : null/);
  assert.match(view, /business\.staffParkingLinks/, "the owner's links come from the business already loaded");
  assert.match(view, /!credit\.available && !credit\.loading && \(/, "a team member who cannot read the ledger gets a note");
  const data = read("./business-data.ts");
  assert.match(data, /useBusinessCollection\("lotExpenseEntries", businessId, enabled, complete\)/);
  assert.match(data, /useBusinessCollection\("staffExpenseRepayments", businessId, enabled, complete\)/);
  assert.match(data, /available: enabled && !entries\.error && !repayments\.error/);
});

test("the customer card shows what came off; Business owes follows the list", () => {
  assert.match(view, /customer\.expenseCreditCents > 0 && <small className="pk-month-paid-via">Less expenses -\{moneyText\(customer\.expenseCreditCents\)\}<\/small>/);
  assert.match(view, /<li className="pk-month-expense">/);
  assert.match(view, /customer\.expenseLines\.map\(\(l\) =>/);
  assert.match(view, /\{l\.note \? <strong data-no-translate>\{l\.note\}<\/strong> : <strong>Expense<\/strong>\}/, "a note is typed, not copy");
  const list = view.indexOf('<div className="pk-month-list">');
  const owes = view.indexOf("<BusinessOwesSection");
  assert.ok(list > 0 && owes > list, "Business owes comes after the customer list");
  assert.match(view, /canSettle=\{canSettleStaff\}/);
  assert.match(panels, /canSettleStaff=\{canManageLedger\}/);
  assert.match(consoleSource, /canManageLedger=\{hasBusinessPermission\(profile, "ledger"\)\}/, "owner, admin, or the ledger permission");
  assert.match(view, /buildParkingMonthSummaryPdf\(\{ business: identity, summary, language: lang, estimate: estimating, linkedCustomerNames \}\)/);
});

test("Paid back and Void go through updateLotExpenseEntry's actions, capped at what is owed", () => {
  const owes = read("../components/business/business-owes-section.tsx");
  const callables = [...owes.matchAll(/httpsCallable\(functions, "(\w+)"\)/g)].map((m) => m[1]);
  assert.deepEqual([...new Set(callables)], ["updateLotExpenseEntry"]);
  assert.doesNotMatch(owes, /setDoc\(|updateDoc\(|addDoc\(|deleteDoc\(/);
  assert.match(owes, /staffRepaymentRequest\(businessId, payFor\.staffId, draft\)/);
  assert.match(owes, /action: "void_staff_repayment",/);
  assert.match(owes, /staffRepaymentProblem\(draft, payFor\.owedCents, today\)/, "the client cap");
  assert.match(owes, /amount: \(line\.owedCents \/ 100\)\.toFixed\(2\)/, "prefilled with what is owed");
  assert.match(owes, /givenByStaffId: staffOptions\.some\(\(s\) => s\.id === me\) \? me : ""/, "given by defaults to whoever is signed in");
  assert.match(owes, /\{canSettle && !estimating && \(/, "never from an estimate, never without the permission");
  assert.match(owes, /<h3>Void this paid-back record\?<\/h3>/, "a void is confirmed");
  assert.match(owes, /staffCreditRefusalText\(failure\)/);
});

test("the People page links each person to a parking bill, owner or admin only", () => {
  const people = read("../components/business/profile-support-people.tsx");
  const link = read("../components/business/staff-parking-link.tsx");
  assert.match(consoleSource, /canLinkParking=\{profile\.role === "businessOwner" \|\| profile\.role === "admin"\}/);
  assert.match(people, /httpsCallable\(functions, "updateLotExpenseEntry"\)\(\s*staffParkingLinkRequest\(businessId, row\.id, customer\),\s*\)/);
  assert.match(people, /canLink=\{canLinkParking && Boolean\(onLinkParking\)\}/);
  assert.match(link, /const cars = useParkingLinkCars\(businessId, true\);/, "the cars are read only while the picker is open");
  assert.match(link, /parkingLinkChoices\(staff, customers, search\)/, "suggestions first");
});

test("the whole-month estimate is a preview: only for the current month, nothing collected", () => {
  assert.match(view, /const canEstimate = parkingMonthCanEstimate\(monthKey\)/);
  assert.match(view, /\{canEstimate && \(/, "the switch shows only for the unfinished month");
  assert.match(view, /!estimating && customer\.dueCents > 0/, "no Mark all paid on an estimate");
  assert.match(view, /estimate: estimating/, "the PDFs say Estimate");
  for (const english of ["So far", "Whole month (estimate)", "estimate, whole month"]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});

test("its words read in French", () => {
  for (const english of ["Month end", "View the month as PDF", "Print", "Download", "Share", "Open in a new tab", "Cars on the lot", "Who owes", "Every car", "Nobody owes anything for this month."]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});

test("three views, in order: Who owes · Paid · Everyone, each from the shared statement", () => {
  const owes = view.indexOf("Who owes ({summary.customersOwing.length})");
  const paid = view.indexOf("Paid ({summary.customersPaid.length})");
  const everyone = view.indexOf("Everyone ({summary.customers.length})");
  assert.ok(owes > 0 && paid > owes && everyone > paid, "tabs read Who owes · Paid · Everyone");
  // The list is the statement's own split - no second definition of "paid" here.
  assert.match(view, /view === "paid" \? summary\.customersPaid : summary\.customersOwing/);
  assert.doesNotMatch(view, /dueCents === 0|dueCents <= 0 &&|monthCents > 0 &&/, "paid is decided in parking-month-statement.ts");
  assert.match(view, /"Nobody has paid for this month yet\."/);
  // The same customer card for every view, with what came in and how.
  assert.equal(view.match(/<article className="pk-month-customer"/g)?.length, 1, "one card, not a fork");
  assert.match(view, /customer\.paidVia\.map\(parkingPaidViaLabel\)/);
  assert.match(view, /<span>Paid in full<\/span><b>\{summary\.customersPaid\.length\}<\/b>/);
  assert.match(view, /<strong data-no-translate>\{customer\.customerName/, "a name is not copy");
});

test("the Paid view's words read in French", () => {
  for (const english of ["Paid", "Paid in full", "Nobody has paid for this month yet.", "customers this month", "Online", "Payment link", "Cash payment", "Zelle transfer"]) {
    assert.notEqual(translateValue(english, "fr"), english, `no French for "${english}"`);
  }
});

test("a paid line folds away on the card; only what is left to collect leads", () => {
  assert.match(view, /const owingLines = \[\.\.\.customer\.cars\.filter\(\(b\) => b\.dueCents > 0\)/);
  assert.match(view, /\{showPaid && paidLines\}/);
  assert.match(view, /already paid/);
});

