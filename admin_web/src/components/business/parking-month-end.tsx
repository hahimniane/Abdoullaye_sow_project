"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { httpsCallable } from "firebase/functions";
import { ArrowLeft, Banknote, ChevronDown, ChevronLeft, ChevronRight, Copy, FileDown, MessageCircle, RefreshCw, Search, SquarePen, Undo2, X } from "lucide-react";

import { BUSINESS_ACCOUNT_RECEIVER, STAFF_BALANCES_TIMEOUT_MS, businessAccountName } from "@/lib/staff-balances";
import {
  cardOwes,
  cardPaid,
  hasTeamBills,
  staffStatementCashFrom,
  staffStatementCashRequest,
  staffStatements,
  statementCards,
} from "@/lib/staff-statement";
import { ReceivedByOptions } from "@/components/business/received-by-options";
import { TeamTag } from "@/components/business/whose-car-field";
import { auth, functions } from "@/lib/firebase";
import { useParkingBillPayments, useParkingMonthInputs, useStaffExpenseCreditInputs, useStaffMonthSettlements } from "@/lib/business-data";
import { TeamSettlePanel } from "@/components/business/team-settle-panel";
import { settlementRecords, settlementsOf } from "@/lib/team-settle";
import { BUSINESS_PARKING_RECEIVED_VIA_OPTIONS } from "@/lib/business-parking-entry";
import { overlayDismiss } from "@/lib/overlay-dismiss";

import { currentLanguage, formatDateTime, formatDayKey, text } from "@/lib/format";
import { PdfPreview, type PdfPreviewFile } from "@/components/pdf-preview";
import { BusinessOwesSection } from "@/components/business/business-owes-section";
import { InvoiceMessageStatus, ParkingInvoicesPanel, useParkingInvoiceMessages } from "@/components/business/parking-invoices";
import { invoicesOfferedFor } from "@/lib/parking-invoices";
import { Tick } from "@/components/business/parking-whatsapp";
import { parkingLotIdOf, type ParkingLot } from "@/lib/parking-lots";
import {
  emptyMonthTableFilter,
  invoiceTally,
  isTeamCard,
  monthRowCarCount,
  monthRowDueCents,
  monthRowStatus,
  monthTableCounts,
  monthTableNarrowed,
  monthTableRows,
  type MonthRowStatus,
  type MonthTableContext,
  type MonthTableFilter,
  type MonthTableSort,
} from "@/lib/parking-month-table";
import {
  BILL_PAYMENT_MESSAGES,
  BILL_PAYMENT_REFUSAL,
  billPaymentFor,
  billPaymentPlan,
  billPaymentRecordRequest,
  billSettlePlan,
  billSettleRequest,
  billPaymentRefusalText,
  billPaymentsByCustomer,
  billPaymentUndoRequest,
  type BillPaymentRecord,
  type BillPaymentRefusal,
} from "@/lib/parking-bill-payment";
import { dollarsToCents } from "@/lib/staff-expense-console";
import { parkingWhatsAppEnabled, parkingWhatsAppEverEnabled } from "@/lib/parking-whatsapp";
import {
  buildParkingMonthBillPdf,
  buildParkingMonthSummaryPdf,
  parkingMonthFileName,
} from "@/lib/parking-month-pdf";
import {
  monthBillPaymentPlan,
  monthLabel,
  moneyText,
  parkingMonthAsOf,
  parkingMonthCanEstimate,
  parkingMonthCustomerText,
  parkingMonthLastDayLabel,
  parkingPaidViaLabel,
  parkingMonthSummary,
  previousMonthKey,
  shiftMonthKey,
  staffCreditEntries,
  type ParkingMonthCustomer,
  type ParkingMonthStaffCredit,
} from "@/lib/parking-month-statement";
import type { StaffParkingLinks } from "@/lib/staff-expense-credit";
import type { FirestoreRow } from "@/types/admin";

type Row = Record<string, unknown>;

type ParkingMonthEndProps = {
  /** The month's cars and ledger activities (those dated in the month, and
   * older ones still unpaid, go on the same bills) are read here, scoped to
   * the month on screen - never the lot's whole history. */
  businessId: string;
  /** The team, for "Received by" when a whole bill is marked paid. */
  staff?: readonly FirestoreRow[];
  business: Row | null;
  businessName: string;
  initialMonth: string;
  onClose: () => void;
  /** Opens the car's own record, where its payments are recorded. */
  onOpenCar: (row: FirestoreRow) => void;
  /** Owner, platform admin, or staff with the `ledger` permission: may
   * record and void Paid back (docs/STAFF_EXPENSE_CREDIT.md §1.4). */
  canSettleStaff?: boolean;
  /** Owner or platform admin: may send the month's invoices on WhatsApp
   * (docs/PARKING_INVOICES.md). Everyone else does not see the panel. */
  canSendInvoices?: boolean;
  /** The business's parking lots: with two or more, rows show the lot and the
   * list can be narrowed to one (docs/PARKING_LOTS.md). */
  lots?: readonly ParkingLot[];
};

/**
 * Settling the books for a month: every car that was on the lot that month,
 * what it ran up, what came in, and who still owes - each with its own bill
 * to send. Worked out live from the cars; payments are recorded on the car
 * as always, oldest month first, so a bill flips to paid by itself.
 */
export function ParkingMonthEnd({ businessId, staff = [], business, businessName, initialMonth, onClose, onOpenCar, canSettleStaff = false, canSendInvoices = false, lots = [] }: ParkingMonthEndProps) {
  const [monthKey, setMonthKey] = useState(initialMonth || previousMonthKey());
  const inputs = useParkingMonthInputs(businessId, monthKey, Boolean(businessId));
  const rows = inputs.cars;
  const activities = inputs.activities;
  // Which customers (who owes, paid, everyone), the chips, the lot, the
  // search and the order (lib/parking-month-table.ts); the customer whose
  // bill is open on the side; whether the invoice send list is unfolded.
  const [filter, setFilter] = useState<MonthTableFilter>(emptyMonthTableFilter);
  const [selectedKey, setSelectedKey] = useState("");
  const [showInvoices, setShowInvoices] = useState(false);
  const billRef = useRef<HTMLElement | null>(null);
  // "Whole month": the current month counted to its last day, so cars still
  // parked run up to the end of the month. A preview: nothing is saved and
  // nothing can be collected for days that have not happened.
  const [wholeMonth, setWholeMonth] = useState(false);
  // Customers whose already-paid lines are unfolded on their card.
  const [openPaid, setOpenPaid] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState("");
  const [flash, setFlash] = useState<ReactNode>("");
  const [preview, setPreview] = useState<PdfPreviewFile | null>(null);
  // "Mark all paid": which customer, and the same details any payment takes.
  const [settleKey, setSettleKey] = useState("");
  const [settleVia, setSettleVia] = useState("cash");
  const [settleBy, setSettleBy] = useState("");
  const [settleNote, setSettleNote] = useState("");
  const [settleBusy, setSettleBusy] = useState("");
  const [settleError, setSettleError] = useState("");
  const [settleFailed, setSettleFailed] = useState<{ id: string; label: string; reason: string }[]>([]);
  // "Record a payment": part of a customer's bill, paid oldest first
  // (docs/PARKING_BILL_PAYMENTS.md). One amount, one payment, one receipt.
  const [payKey, setPayKey] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payVia, setPayVia] = useState("cash");
  const [payBy, setPayBy] = useState("");
  const [payNote, setPayNote] = useState("");
  const [payBusy, setPayBusy] = useState(false);
  const [payError, setPayError] = useState("");
  // Settle for a lower amount (docs/PARKING_DISCOUNT.md): the same sheet, the
  // rest of the cars' charges taken off as a discount, with a reason.
  const [payMode, setPayMode] = useState<"pay" | "settle">("pay");
  const [settleReason, setSettleReason] = useState("");
  // "Undo": a whole payment at once, after a confirm.
  const [undoTarget, setUndoTarget] = useState<BillPaymentRecord | null>(null);
  const [undoBusy, setUndoBusy] = useState(false);
  const [undoError, setUndoError] = useState("");
  const staffOptions = useMemo(() => staff.map((s) => ({
    id: String(s.id),
    name: text(s.fullName, "") || text(s.name, "") || text(s.email, ""),
  })).filter((s) => s.name), [staff]);
  // Staff expenses come off their parking bill (docs/STAFF_EXPENSE_CREDIT.md):
  // every lot expense and paid-back record, the owner's links on the
  // business, the team's names. Netted only when both reads answered - a
  // team member who cannot read the ledger sees the bills un-netted, with a
  // note, never half-netted.
  const credit = useStaffExpenseCreditInputs(businessId, Boolean(businessId));
  const links = useMemo(
    () => ((business?.staffParkingLinks && typeof business.staffParkingLinks === "object" ? business.staffParkingLinks : {}) as StaffParkingLinks),
    [business],
  );
  const staffNames = useMemo(() => Object.fromEntries(staffOptions.map((s) => [s.id, s.name])), [staffOptions]);
  const staffCredit = useMemo<ParkingMonthStaffCredit | null>(
    () => (credit.available ? { entries: credit.entries, repayments: credit.repayments, lines: credit.lines, links, staffNames } : null),
    [credit.available, credit.entries, credit.repayments, credit.lines, links, staffNames],
  );
  const linkedCustomerNames = useMemo(() => {
    const out: Record<string, string> = {};
    for (const link of Object.values(links)) if (link?.customerKey && link.customerName) out[link.customerKey] = link.customerName;
    return out;
  }, [links]);
  // Invoices: the panel only when the WhatsApp switch is on and this is the
  // month that just ended; each card shows its invoice message's tick for any
  // month the business has sent invoices for.
  const invoicesOffered = canSendInvoices && parkingWhatsAppEnabled(business) && invoicesOfferedFor(monthKey);
  const invoiceMessages = useParkingInvoiceMessages(businessId, monthKey, parkingWhatsAppEverEnabled(business));
  const [openExpenses, setOpenExpenses] = useState<Set<string>>(() => new Set());
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const orgName = text(business?.name, "") || businessName;
  const identity = useMemo(() => ({ ...(business ?? {}), name: orgName }), [business, orgName]);

  const canEstimate = parkingMonthCanEstimate(monthKey);
  const estimating = wholeMonth && canEstimate;
  const lastDay = parkingMonthLastDayLabel(monthKey);
  const summary = useMemo(
    () => parkingMonthSummary(rows, monthKey, parkingMonthAsOf(monthKey, wholeMonth), activities, staffCredit),
    [rows, activities, monthKey, wholeMonth, staffCredit],
  );
  // The month's recorded payments, grouped by customer once per data change
  // (a failed read leaves the rest of the page as it was), and what each
  // customer's bill can take as a payment here - the statement's own figures.
  const billPays = useParkingBillPayments(businessId, monthKey, Boolean(businessId));
  const paymentsByCustomer = useMemo(() => billPaymentsByCustomer(billPays.rows), [billPays.rows]);
  const payableByCustomer = useMemo(
    () => new Map(summary.customers.map((c) => [c.key, billPaymentPlan(c, 1).payableCents])),
    [summary],
  );
  const thisMonth = new Date().toISOString().slice(0, 7);

  // "I paid everything" (docs/TEAM_SETTLE.md): the month's settlements, and
  // who may receive them - the owner and people with Full access.
  const settleRead = useStaffMonthSettlements(businessId, monthKey, Boolean(businessId));
  const settlements = useMemo(() => settlementRecords(settleRead.rows), [settleRead.rows]);
  const myUid = auth.currentUser?.uid ?? "";
  const ownerUid = text(business?.ownerUid, "");
  const settleReceivers = useMemo(() => {
    const out = staff
      .filter((s) => String(s.id) === ownerUid || s.fullAccess === true || s.role === "businessOwner")
      .map((s) => ({ id: String(s.id), name: text(s.fullName, "") || text(s.name, "") || text(s.email, "") }))
      .filter((s) => s.name);
    if (ownerUid && !out.some((s) => s.id === ownerUid)) out.unshift({ id: ownerUid, name: "Owner" });
    return out;
  }, [staff, ownerUid]);
  const isSettleReceiver = canSendInvoices || (myUid !== "" && myUid === ownerUid);

  // A team member's STATEMENT (docs/PARKING_INVOICES.md §6): their card shows
  // exactly what the WhatsApp statement says - parking and jobs, less the
  // expenses not yet credited, plus the cash they hold for the business at
  // the END of the month. The cash comes from the server (it needs every
  // payment and handover); until it arrives, or if it cannot, team members
  // show as before with a note - never half a statement. Loading always
  // resolves: an answer, a refusal or the timeout.
  const needsCash = Boolean(businessId) && credit.available && !inputs.loading && hasTeamBills(summary.customers);
  const [cash, setCash] = useState<{ state: "idle" | "loading" | "ready" | "failed"; held: Record<string, number> }>({ state: "idle", held: {} });
  useEffect(() => {
    if (!needsCash) {
      setCash({ state: "idle", held: {} });
      return undefined;
    }
    let live = true;
    let timer = 0;
    setCash((current) => ({ state: "loading", held: current.held }));
    const timeout = new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new Error("timeout")), STAFF_BALANCES_TIMEOUT_MS);
    });
    Promise.race([httpsCallable(functions, "updateLotExpenseEntry")(staffStatementCashRequest(businessId, monthKey)), timeout])
      .then((response) => {
        if (live) setCash({ state: "ready", held: staffStatementCashFrom((response as { data?: unknown }).data) });
      })
      .catch(() => {
        if (live) setCash({ state: "failed", held: {} });
      })
      .finally(() => window.clearTimeout(timer));
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [needsCash, businessId, monthKey, billPays.rows.length, settlements]);
  const statements = useMemo(() => {
    if (!staffCredit || !needsCash || cash.state !== "ready") return null;
    return staffStatements(summary.customers, {
      monthKey,
      entries: staffCreditEntries(staffCredit, monthKey),
      repayments: staffCredit.repayments,
      lines: staffCredit.lines,
      staffNames,
      held: cash.held,
    });
  }, [staffCredit, needsCash, cash, summary.customers, monthKey, staffNames]);
  const cards = useMemo(
    () => (statements ? statementCards(summary.customers, statements.statements, statements.customerKeys) : summary.customers),
    [statements, summary.customers],
  );
  const cardsOwing = useMemo(() => cards.filter(cardOwes), [cards]);
  const cardsPaid = useMemo(() => cards.filter(cardPaid), [cards]);
  // What each card is owed on: the statement's number for a team member.
  const stillOwedCents = cardsOwing.reduce((sum, c) => sum + (c.statementOwesCents ?? c.dueCents), 0);
  const origByKey = useMemo(() => new Map(summary.customers.map((c) => [c.key, c])), [summary.customers]);
  const rowById = useMemo(() => {
    const map = new Map<string, FirestoreRow>();
    rows.forEach((r) => map.set(String(r.id), r));
    return map;
  }, [rows]);
  // A customer's invoice message, found by the member for a team statement.
  const invoiceLineOf = (c: ParkingMonthCustomer) =>
    invoiceMessages.byCustomer.get(c.key) ?? (c.statementStaffId ? invoiceMessages.byCustomer.get(`staff:${c.statementStaffId}`) : undefined);
  // Each customer's lots, worked out once per data change, not per row.
  const lotIdsByKey = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const c of cards) {
      const ids = new Set<string>();
      for (const b of [...c.cars, ...c.olderCars]) ids.add(parkingLotIdOf(rowById.get(b.id) ?? null, businessId));
      out.set(c.key, [...ids]);
    }
    return out;
  }, [cards, rowById, businessId]);
  const lotNamesOf = (c: ParkingMonthCustomer) =>
    (lotIdsByKey.get(c.key) ?? []).map((id) => lots.find((lot) => lot.id === id)?.name ?? "").filter(Boolean).join(", ");
  const failedKeys = useMemo(() => {
    const out = new Set<string>();
    for (const c of cards) {
      const line = invoiceMessages.byCustomer.get(c.key) ?? (c.statementStaffId ? invoiceMessages.byCustomer.get(`staff:${c.statementStaffId}`) : undefined);
      if (line && (line.state === "failed" || line.state === "stopped")) out.add(c.key);
    }
    return out;
  }, [cards, invoiceMessages.byCustomer]);
  const tableContext = useMemo<MonthTableContext>(() => ({
    lotIdsOf: (c) => lotIdsByKey.get(c.key) ?? [],
    invoiceFailed: (c) => failedKeys.has(c.key),
  }), [lotIdsByKey, failedKeys]);
  const listed = useMemo(() => monthTableRows(cards, filter, tableContext), [cards, filter, tableContext]);
  const counts = useMemo(() => monthTableCounts(cards, filter.view, tableContext), [cards, filter.view, tableContext]);
  const narrowed = monthTableNarrowed(filter);
  const listedDueCents = useMemo(() => listed.reduce((sum, c) => sum + Math.max(0, monthRowDueCents(c)), 0), [listed]);
  // The open bill stays open while a filter or a payment moves its row.
  const selected = selectedKey ? cards.find((c) => c.key === selectedKey) ?? null : null;
  const showTeamCols = cards.some((c) => c.expenseCreditCents > 0 || c.statementOwesCents !== undefined);
  // Counted over the customers on this page, so the bar and the
  // "Invoice not delivered" filter always agree.
  const tally = useMemo(() => invoiceTally(cards.flatMap((c) => {
    const line = invoiceMessages.byCustomer.get(c.key) ?? (c.statementStaffId ? invoiceMessages.byCustomer.get(`staff:${c.statementStaffId}`) : undefined);
    return line ? [line] : [];
  })), [cards, invoiceMessages.byCustomer]);
  const showInvoiceCol = tally.total > 0;
  const showInvoiceBar = tally.total > 0 || invoicesOffered;
  function pick(key: string) {
    setSelectedKey(key);
  }
  // The bill slides in from the right: focus goes to it, Escape closes it
  // (unless a payment, Mark all paid or Undo is open over it).
  const dialogOpen = Boolean(payKey || settleKey || undoTarget || preview);
  useEffect(() => {
    if (selectedKey) billRef.current?.focus({ preventScroll: true });
  }, [selectedKey]);
  useEffect(() => {
    if (!selectedKey || dialogOpen) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSelectedKey("");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedKey, dialogOpen]);

  async function saveSummary() {
    setBusyId("summary");
    setFlash("");
    try {
      // A team member's line is their statement's amount, as on the card.
      const pdfCards = cards.filter((c) => !c.includedInStatementOf).map((c) => (c.statementOwesCents === undefined ? c : { ...c, dueCents: Math.max(0, c.statementOwesCents) }));
      const forPdf = { ...summary, customers: pdfCards, customersOwing: pdfCards.filter(cardOwes), customersPaid: pdfCards.filter(cardPaid), dueCents: stillOwedCents };
      const blob = await buildParkingMonthSummaryPdf({ business: identity, summary: forPdf, language: lang, estimate: estimating, linkedCustomerNames });
      setPreview({ blob, fileName: parkingMonthFileName("summary", monthKey, "", orgName), title: `Month end — ${monthLabel(monthKey, lang)}` });
    } catch {
      setFlash("The PDF could not be made. Try again.");
    } finally {
      setBusyId("");
    }
  }

  async function saveBill(customer: ParkingMonthCustomer) {
    setBusyId(customer.key);
    setFlash("");
    try {
      const blob = await buildParkingMonthBillPdf({ business: identity, customer, language: lang, estimate: estimating });
      setPreview({ blob, fileName: parkingMonthFileName("bill", monthKey, customer.customerName, orgName), title: `${customer.customerName || "Parking bill"} — ${monthLabel(monthKey, lang)}` });
    } catch {
      setFlash("The PDF could not be made. Try again.");
    } finally {
      setBusyId("");
    }
  }

  function openSettle(customer: ParkingMonthCustomer) {
    setSettleKey(customer.key);
    setSettleVia("cash");
    // Whoever is signed in took it, unless they say otherwise.
    const me = auth.currentUser?.uid ?? "";
    setSettleBy(staffOptions.some((s) => s.id === me) ? me : "");
    setSettleNote(`Month end — ${monthLabel(monthKey)}`);
    setSettleError("");
    setSettleFailed([]);
  }

  // Every line through the payment it already takes, one after another, so
  // each lands exactly as a payment recorded by hand would: who received it,
  // how, the note, the history, the reports. A line that fails is named and
  // the rest still go through; trying again sends only the failed ones.
  async function runSettle(customer: ParkingMonthCustomer, only?: Set<string>) {
    if (!settleBy) {
      setSettleError("Say who received the money.");
      return;
    }
    const plan = monthBillPaymentPlan(customer);
    const items = plan.items.filter((x) => !only || only.has(`${x.kind}:${x.id}`));
    const failed: { id: string; label: string; reason: string }[] = [];
    let done = 0;
    let recordedCents = 0;
    setSettleError("");
    for (const item of items) {
      setSettleBusy(`Recording ${done + 1} of ${items.length}…`);
      try {
        if (item.kind === "car") {
          await httpsCallable(functions, "recordBusinessParkingPartialPayment")({
            entryId: item.id, amountCents: item.amountCents, receivedVia: settleVia, receivedByStaffId: settleBy, note: settleNote,
          });
        } else {
          await httpsCallable(functions, "recordLotActivityInstalment")({
            activityId: item.id, amountCents: item.amountCents, receivedVia: settleVia, receivedByStaffId: settleBy, note: settleNote,
          });
        }
        recordedCents += item.amountCents;
      } catch (error) {
        failed.push({ id: `${item.kind}:${item.id}`, label: item.label, reason: (error as { message?: string })?.message || "It did not save." });
      }
      done += 1;
    }
    setSettleBusy("");
    setSettleFailed(failed);
    if (failed.length === 0) {
      setSettleKey("");
      setFlash(`Recorded ${moneyText(recordedCents)} for ${customer.customerName} — ${items.length} item${items.length === 1 ? "" : "s"}, received by ${settleBy === BUSINESS_ACCOUNT_RECEIVER ? businessAccountName() : staffOptions.find((s) => s.id === settleBy)?.name ?? "your team"}.`);
    } else {
      setSettleError(`${items.length - failed.length} of ${items.length} recorded. These did not save:`);
    }
  }

  function receiverName(id: string): string {
    if (id === BUSINESS_ACCOUNT_RECEIVER) return businessAccountName(lang);
    return staffNames[id] ?? "";
  }

  /** " · received by Yao" for who took a line's money; "" when nobody is
   * recorded. A receiver no longer on the team still shows as someone. */
  function receivedByText(ids: readonly string[] | undefined): string {
    const names = (ids ?? []).map((id) => receiverName(id) || (lang === "fr" ? "quelqu'un hors de l'équipe" : "someone not on the team"));
    if (names.length === 0) return "";
    return lang === "fr" ? ` · reçu par ${names.join(", ")}` : ` · received by ${names.join(", ")}`;
  }

  function openPay(customer: ParkingMonthCustomer) {
    setPayKey(customer.key);
    setPayAmount("");
    setPayVia("cash");
    const me = auth.currentUser?.uid ?? "";
    setPayBy(staffOptions.some((s) => s.id === me) ? me : "");
    setPayNote(`Month end — ${monthLabel(monthKey)}`);
    setPayError("");
    setPayMode("pay");
    setSettleReason("");
  }

  // One request: the server splits the amount oldest first, records each part
  // the way a hand-recorded payment lands, and sends one receipt. The preview's
  // payable total rides along, so a bill that moved is refused, not guessed.
  async function runPay(customer: ParkingMonthCustomer) {
    if (payBusy) return;
    if (!payBy && !(payMode === "settle" && dollarsToCents(payAmount) === 0)) {
      setPayError("Say who received the money.");
      return;
    }
    const amountCents = dollarsToCents(payAmount);
    const settling = payMode === "settle";
    if (settling && !settleReason.trim()) {
      setPayError(BILL_PAYMENT_MESSAGES[BILL_PAYMENT_REFUSAL.SETTLE_REASON_REQUIRED]);
      return;
    }
    const plan = settling
      ? billSettlePlan(customer, Number.isFinite(amountCents) ? amountCents : -1)
      : billPaymentPlan(customer, Number.isFinite(amountCents) ? amountCents : 0);
    if (!plan.ok) {
      setPayError(BILL_PAYMENT_MESSAGES[plan.reason as BillPaymentRefusal]);
      return;
    }
    setPayBusy(true);
    setPayError("");
    try {
      const input = {
        businessId, monthKey, customerKey: customer.key, amountCents, receivedVia: payVia,
        receivedByStaffId: payBy, note: payNote, expectedPayableCents: plan.payableCents,
      };
      const result = await httpsCallable(functions, "updateBusinessParkingEntry")(
        settling ? billSettleRequest({ ...input, reason: settleReason }) : billPaymentRecordRequest(input));
      const data = (result.data && typeof result.data === "object" ? result.data : {}) as { leftCents?: number; receipt?: string };
      const left = Number.isFinite(Number(data.leftCents)) ? Number(data.leftCents) : ("leftCents" in plan ? plan.leftCents : 0);
      setPayKey("");
      setFlash(
        <>
          <span>Payment recorded</span> — <b data-no-translate>{customer.customerName || "—"}</b> · <b data-no-translate>{moneyText(amountCents)}</b> · <span>Left on the bill:</span> <b data-no-translate>{moneyText(left)}</b>
          {data.receipt === "sent" && <> · <span>Receipt sent on WhatsApp.</span></>}
          {data.receipt === "failed" && <> · <span>The WhatsApp receipt could not be sent.</span></>}
        </>,
      );
    } catch (failure) {
      setPayError(billPaymentRefusalText(failure));
    } finally {
      setPayBusy(false);
    }
  }

  async function runUndo() {
    if (!undoTarget || undoBusy) return;
    setUndoBusy(true);
    setUndoError("");
    try {
      await httpsCallable(functions, "updateBusinessParkingEntry")(billPaymentUndoRequest(businessId, undoTarget.id));
      setUndoTarget(null);
      setFlash(<span>Payment undone.</span>);
    } catch (failure) {
      setUndoError(billPaymentRefusalText(failure));
    } finally {
      setUndoBusy(false);
    }
  }

  async function copyBill(customer: ParkingMonthCustomer) {
    try {
      const bill = parkingMonthCustomerText(customer, orgName);
      // The bill text mirrors the server's month-end message; an estimate
      // only gets a first line saying so.
      await navigator.clipboard.writeText(estimating
        ? `ESTIMATE — whole month, cars still parked counted to ${lastDay}\n\n${bill}`
        : bill);
      setFlash(`Copied ${customer.customerName}'s bill — paste it into WhatsApp.`);
    } catch {
      setFlash("Copy is blocked here. Use Save as PDF instead.");
    }
  }

  return (
    <div className="pk-month">
      <div className="pk-month-head">
        <button className="ghost-button" type="button" onClick={onClose}><ArrowLeft size={14} /> Parked cars</button>
        <div className="pk-month-picker" role="group" aria-label="Month">
          <button className="lst-icon-btn" type="button" aria-label="Previous month" onClick={() => { setWholeMonth(false); setMonthKey((m) => shiftMonthKey(m, -1)); }}><ChevronLeft size={18} /></button>
          <strong>{monthLabel(monthKey, lang)}</strong>
          <button className="lst-icon-btn" type="button" aria-label="Next month" disabled={monthKey >= thisMonth} onClick={() => { setWholeMonth(false); setMonthKey((m) => shiftMonthKey(m, 1)); }}><ChevronRight size={18} /></button>
        </div>
        <button className="lst-btn ghost" type="button" disabled={busyId !== ""} onClick={() => void saveSummary()}>
          {busyId === "summary" ? <RefreshCw className="spin" size={14} /> : <FileDown size={14} />} View the month as PDF
        </button>
      </div>
      {canEstimate && (
        <div className="pk-month-tools">
          <div className="pk-view" role="group" aria-label="Count up to">
            <button type="button" className={!wholeMonth ? "on" : ""} aria-pressed={!wholeMonth} onClick={() => setWholeMonth(false)}>So far</button>
            <button type="button" className={wholeMonth ? "on" : ""} aria-pressed={wholeMonth} onClick={() => setWholeMonth(true)}>Whole month (estimate)</button>
          </div>
        </div>
      )}
      <p className="panel-lede">
        {estimating
          ? "Estimate for the whole month: cars still parked are counted to the month's last day, at their daily rate. Nothing is saved, and payments are recorded on the real bill."
          : monthKey === thisMonth
          ? "This month so far. Each car's bill is that month's days at its rate; payments recorded on the car pay the oldest month first."
          : "Each car's bill is that month's days at its rate, plus anything still unpaid from before. Payments recorded on the car pay the oldest month first, so a bill turns to paid by itself."}
      </p>
      {flash && (
        <div className="lst-form-error" role="status" style={{ background: "var(--mist)", color: "var(--brand-strong)" }}>
          {flash} <button className="ghost-button" type="button" onClick={() => setFlash("")}>Dismiss</button>
        </div>
      )}

      {inputs.error && <div className="error-box" role="alert">{inputs.error}</div>}
      {!credit.available && !credit.loading && (
        <p className="lst-hint" role="status">Staff expenses are not taken off these bills: your account cannot see the lot's expenses.</p>
      )}
      {needsCash && cash.state === "loading" && (
        <p className="lst-hint" role="status"><RefreshCw className="spin" size={12} aria-hidden="true" /> Checking the cash team members hold…</p>
      )}
      {needsCash && cash.state === "failed" && (
        <p className="lst-hint" role="status">The cash team members hold could not be checked, so their bills show without it.</p>
      )}
      {!billPays.available && !billPays.loading && (
        <p className="lst-hint" role="status">Payments recorded on bills could not be loaded.</p>
      )}
      {inputs.loading && (
        <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
      )}

      <div className="pk-scoreboard" role="group" aria-label="Month totals">
        <div className="pk-stat"><span>Cars on the lot</span><b>{summary.carsOnLot}</b><small>{cardsOwing.length} customers still owe</small></div>
        <div className="pk-stat"><span>Billed</span><b>{moneyText(summary.billedCents)}</b><small>{estimating ? "estimate, whole month" : "for the month"}</small></div>
        <div className="pk-stat"><span>Collected</span><b>{moneyText(summary.collectedCents)}</b><small>toward the month</small></div>
        <div className="pk-stat"><span>Paid in full</span><b>{cardsPaid.length}</b><small>customers this month</small></div>
        {summary.expenseCreditCents > 0 && (
          <div className="pk-stat"><span>Less staff expenses</span><b className="pk-paid">-{moneyText(summary.expenseCreditCents)}</b><small>off staff parking bills</small></div>
        )}
        <div className="pk-stat"><span>Still owed</span><b className={stillOwedCents > 0 ? "owed" : ""}>{moneyText(stillOwedCents)}</b>
          <small>{summary.olderOwedCents > 0 ? `incl. ${moneyText(summary.olderOwedCents)} from before` : "by the customers below"}</small>
        </div>
      </div>

      {showInvoiceBar && (
        <section className={`pk-me-wa-bar${tally.failed > 0 ? " has-failed" : ""}`} aria-label="Invoices on WhatsApp">
          <MessageCircle size={20} aria-hidden="true" />
          <div className="pk-me-wa-text">
            <strong>
              <span>{tally.total > 0 ? "Invoices on WhatsApp" : "Invoices ready to send on WhatsApp"}</span> · <span data-no-translate>{monthLabel(monthKey, lang)}</span>
            </strong>
            {tally.total > 0 ? (
              <small>
                <span>Invoices sent:</span> <b data-no-translate>{tally.total}</b> · <span>Delivered or read:</span> <b data-no-translate>{tally.seen}</b>
                {tally.waiting > 0 && <> · <span>Waiting for WhatsApp:</span> <b data-no-translate>{tally.waiting}</b></>}
                {tally.failed > 0 && <> · <span>Not delivered:</span> <b className="pk-owed" data-no-translate>{tally.failed}</b></>}
              </small>
            ) : (
              <small>If nobody sends them, they go out on their own on the 3rd.</small>
            )}
          </div>
          {tally.failed > 0 && (
            <button className="lst-btn ghost" type="button" onClick={() => { setFilter((f) => ({ ...f, view: "all", notDelivered: true })); }}>
              Show the ones not delivered
            </button>
          )}
          {invoicesOffered && (
            <button className={showInvoices ? "lst-btn ghost" : "lst-btn"} type="button" aria-expanded={showInvoices} onClick={() => setShowInvoices((v) => !v)}>
              {showInvoices ? "Hide the list" : "Review and send"}
            </button>
          )}
        </section>
      )}
      {invoicesOffered && showInvoices && <ParkingInvoicesPanel key={monthKey} businessId={businessId} monthKey={monthKey} staffNames={staffNames} />}

      <div className="pk-me-toolbar">
        <label className="pk-me-search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search customers</span>
          <input
            type="search"
            value={filter.query}
            placeholder="Search name, phone, car or VIN"
            aria-label="Search customers"
            autoComplete="off"
            onChange={(e) => { const query = e.target.value; setFilter((f) => ({ ...f, query })); }}
          />
        </label>
        {lots.length >= 2 && (
          <label className="pk-me-select">
            <span>Which lot</span>
            <select value={filter.lotId} onChange={(e) => { const lotId = e.target.value; setFilter((f) => ({ ...f, lotId })); }}>
              <option value="">All lots</option>
              {lots.map((lot) => <option key={lot.id} value={lot.id} data-no-translate>{lot.name}</option>)}
            </select>
          </label>
        )}
        <label className="pk-me-select">
          <span>Sort by</span>
          <select value={filter.sort} onChange={(e) => { const sort = e.target.value as MonthTableSort; setFilter((f) => ({ ...f, sort })); }}>
            <option value="owed">Most owed first</option>
            <option value="name">Name A–Z</option>
            <option value="cars">Most cars</option>
          </select>
        </label>
      </div>

      <div className="pk-me-chips">
        <div className="pk-view" role="group" aria-label="Which customers">
          <button type="button" className={filter.view === "owing" ? "on" : ""} aria-pressed={filter.view === "owing"} onClick={() => setFilter((f) => ({ ...f, view: "owing" }))}>Who owes (<span data-no-translate>{counts.owing}</span>)</button>
          <button type="button" className={filter.view === "paid" ? "on" : ""} aria-pressed={filter.view === "paid"} onClick={() => setFilter((f) => ({ ...f, view: "paid" }))}>Paid (<span data-no-translate>{counts.paid}</span>)</button>
          <button type="button" className={filter.view === "all" ? "on" : ""} aria-pressed={filter.view === "all"} onClick={() => setFilter((f) => ({ ...f, view: "all" }))}>Everyone (<span data-no-translate>{counts.all}</span>)</button>
        </div>
        {(counts.part > 0 || filter.part) && (
          <button type="button" className={`pk-me-chip${filter.part ? " on" : ""}`} aria-pressed={filter.part} onClick={() => setFilter((f) => ({ ...f, part: !f.part }))}>Part paid <b data-no-translate>{counts.part}</b></button>
        )}
        {(counts.team > 0 || filter.team) && (
          <button type="button" className={`pk-me-chip${filter.team ? " on" : ""}`} aria-pressed={filter.team} onClick={() => setFilter((f) => ({ ...f, team: !f.team }))}>Team members <b data-no-translate>{counts.team}</b></button>
        )}
        {(counts.older > 0 || filter.older) && (
          <button type="button" className={`pk-me-chip${filter.older ? " on" : ""}`} aria-pressed={filter.older} onClick={() => setFilter((f) => ({ ...f, older: !f.older }))}>Owes from before <b data-no-translate>{counts.older}</b></button>
        )}
        {(counts.notDelivered > 0 || filter.notDelivered) && (
          <button type="button" className={`pk-me-chip${filter.notDelivered ? " on" : ""}`} aria-pressed={filter.notDelivered} onClick={() => setFilter((f) => ({ ...f, notDelivered: !f.notDelivered }))}>Invoice not delivered <b data-no-translate>{counts.notDelivered}</b></button>
        )}
        {narrowed && (
          <button className="ghost-button" type="button" onClick={() => setFilter((f) => ({ ...emptyMonthTableFilter, view: f.view, sort: f.sort }))}><X size={14} /> Clear filters</button>
        )}
      </div>

      {listed.length === 0 ? (
        <div className="empty-state">{summary.customers.length === 0 ? "No car was on the lot that month." : narrowed ? "No customer matches. Change the search or the filters." : filter.view === "paid" ? "Nobody has paid for this month yet." : "Nobody owes anything for this month."}</div>
      ) : (
        <div className="pk-me-layout">
          <section className="pk-me-list" aria-label="Customer list">
            <div className="pk-me-scroll">
              <table className="pk-me-table">
                <thead>
                  <tr>
                    <th>Customer</th>
                    <th className="r">Cars</th>
                    <th className="r">This month</th>
                    <th className="r">From before</th>
                    <th className="r">Paid</th>
                    {showTeamCols && <><th className="r">Expenses</th><th className="r">Cash held</th></>}
                    <th className="r">Due</th>
                    <th>Status</th>
                    {showInvoiceCol && <th>WhatsApp</th>}
                  </tr>
                </thead>
                <tbody>
                  {listed.map((row) => {
                    const isSel = selected?.key === row.key;
                    const due = monthRowDueCents(row);
                    const line = invoiceLineOf(row);
                    const acts = row.activities.length + row.olderActivities.length;
                    const cashHeld = row.cashHeldCents ?? 0;
                    const lotNames = lots.length >= 2 ? lotNamesOf(row) : "";
                    return (
                      <tr key={row.key} className={isSel ? "sel" : undefined} onClick={() => pick(row.key)}>
                        <td>
                          <button className="pk-me-name" type="button" aria-current={isSel ? "true" : undefined} onClick={(e) => { e.stopPropagation(); pick(row.key); }}>
                            <span data-no-translate>{row.customerName || row.customerPhone || "—"}</span>
                          </button>
                          <small>
                            {(row.customerPhone || lotNames) && <span data-no-translate>{[row.customerName ? row.customerPhone : "", lotNames].filter(Boolean).join(" · ")}</span>}
                            {isTeamCard(row) && <TeamTag label="Team member" />}
                          </small>
                        </td>
                        <td className="r" data-no-translate>
                          {monthRowCarCount(row)}
                          {acts > 0 && <small><span>Lot activities:</span> {acts}</small>}
                        </td>
                        <td className="r" data-no-translate>{moneyText(row.monthCents)}</td>
                        <td className="r" data-no-translate>{row.priorUnpaidCents > 0 ? moneyText(row.priorUnpaidCents) : <span className="pk-me-dim">—</span>}</td>
                        <td className="r" data-no-translate>{row.monthPaidCents > 0 ? <span className="pk-paid">{moneyText(row.monthPaidCents)}</span> : moneyText(0)}</td>
                        {showTeamCols && (
                          <>
                            <td className="r" data-no-translate>{row.expenseCreditCents > 0 ? `−${moneyText(row.expenseCreditCents)}` : <span className="pk-me-dim">—</span>}</td>
                            <td className="r" data-no-translate>{row.statementOwesCents !== undefined && cashHeld !== 0 ? `${cashHeld > 0 ? "+" : "−"}${moneyText(Math.abs(cashHeld))}` : <span className="pk-me-dim">—</span>}</td>
                          </>
                        )}
                        <td className="r">
                          {row.includedInStatementOf
                            ? <small><span>Included in the statement of</span> <b data-no-translate>{row.includedInStatementOf}</b></small>
                            : due > 0
                            ? <b className="pk-owed" data-no-translate>{moneyText(due)}</b>
                            : due < 0
                            ? <><b className="pk-paid" data-no-translate>{moneyText(-due)}</b><small>The business owes them</small></>
                            : <span data-no-translate>{moneyText(0)}</span>}
                        </td>
                        <td><MonthStatusPill status={monthRowStatus(row)} /></td>
                        {showInvoiceCol && (
                          <td>
                            {line
                              ? <span className={`pk-me-wa state-${line.state}`}><Tick tick={line.tick} /> <span>{line.stateLabel}</span></span>
                              : <span className="pk-me-dim">—</span>}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="pk-me-foot">
              <span>Customers shown:</span> <b data-no-translate>{listed.length}</b>
              {listedDueCents > 0 && <> · <span>Total due on this list:</span> <b className="pk-owed" data-no-translate>{moneyText(listedDueCents)}</b></>}
            </p>
          </section>
        </div>
      )}
      {selected && (
          <aside className="pk-month-customer pk-me-bill pk-me-drawer" ref={billRef} tabIndex={-1} aria-label="Bill for the selected customer">
            {(() => {
              const customer = selected;
              const orig = origByKey.get(customer.key) ?? customer;
              const line = invoiceLineOf(customer);
              const statement = customer.statementOwesCents !== undefined;
              const cashHeldTotal = customer.cashHeldCents ?? 0;
              const canMarkAll = !estimating && orig.dueCents > 0 && monthBillPaymentPlan(orig).items.length > 0;
              const canPay = !estimating && orig.dueCents > 0 && (payableByCustomer.get(customer.key) ?? 0) > 0;
              return (
                <>
                  <header className="pk-me-bill-head">
                    <div>
                      <h3 data-no-translate>{customer.customerName || customer.customerPhone || "—"}</h3>
                      <small data-no-translate>{[customer.customerName ? customer.customerPhone : "", lots.length >= 2 ? lotNamesOf(customer) : ""].filter(Boolean).join(" · ")}</small>
                      <span className="pk-me-tags">
                        <MonthStatusPill status={monthRowStatus(customer)} />
                        {isTeamCard(customer) && <TeamTag label="Team member" />}
                      </span>
                    </div>
                    <button className="lst-icon-btn" type="button" aria-label="Close the bill" onClick={() => setSelectedKey("")}><X size={18} /></button>
                  </header>

                  {customer.includedInStatementOf ? (
                    <p className="lst-hint"><span>Included in the statement of</span> <b data-no-translate>{customer.includedInStatementOf}</b></p>
                  ) : statement ? (
                    <div className="pk-me-totals">
                      <div><span>Parking and jobs</span><b data-no-translate>{moneyText(customer.dueCents)}</b></div>
                      <div><span>Expenses</span><b data-no-translate>{customer.expenseCreditCents > 0 ? `−${moneyText(customer.expenseCreditCents)}` : moneyText(0)}</b></div>
                      <div><span>Cash held</span><b data-no-translate>{`${cashHeldTotal < 0 ? "−" : cashHeldTotal > 0 ? "+" : ""}${moneyText(Math.abs(cashHeldTotal))}`}</b></div>
                      <div className={(customer.statementOwesCents ?? 0) > 0 ? "owed" : "ok"}>
                        <span>{(customer.statementOwesCents ?? 0) < 0 ? "The business owes them" : (customer.statementOwesCents ?? 0) > 0 ? "Owes the business" : "Settled"}</span>
                        <b data-no-translate>{moneyText(Math.abs(customer.statementOwesCents ?? 0))}</b>
                      </div>
                    </div>
                  ) : (
                    <div className="pk-me-totals">
                      <div><span>This month</span><b data-no-translate>{moneyText(customer.monthCents)}</b></div>
                      <div><span>From before</span><b data-no-translate>{moneyText(customer.priorUnpaidCents)}</b></div>
                      <div className="ok">
                        <span>Paid</span><b data-no-translate>{moneyText(customer.monthPaidCents)}</b>
                        {customer.monthPaidCents > 0 && (customer.paidVia.length > 0 || (customer.paidBy ?? []).length > 0) && (
                          <small>
                            {customer.paidVia.length > 0 && <span>{customer.paidVia.map(parkingPaidViaLabel).join(", ")}</span>}
                            {receivedByText(customer.paidBy) && <span data-no-translate>{customer.paidVia.length > 0 ? receivedByText(customer.paidBy) : receivedByText(customer.paidBy).replace(/^ · /, "")}</span>}
                          </small>
                        )}
                      </div>
                      <div className={customer.dueCents > 0 ? "owed" : "ok"}><span>Due now</span><b data-no-translate>{moneyText(customer.dueCents)}</b></div>
                      {customer.expenseCreditCents > 0 && <small className="pk-me-totals-note"><span>Less expenses</span> <span data-no-translate>−{moneyText(customer.expenseCreditCents)}</span></small>}
                    </div>
                  )}

                  {line && <div className="pk-me-bill-wa"><InvoiceMessageStatus line={line} /></div>}

                  <div className="pk-me-bill-actions">
                    {canPay && (
                      <button className="lst-btn pk-me-primary" type="button" disabled={busyId !== "" || payBusy} onClick={() => openPay(customer)}><Banknote size={16} /> Record a payment</button>
                    )}
                    <div className="pk-me-bill-actions-row">
                      {canMarkAll && (
                        <button className="lst-btn ghost" type="button" disabled={busyId !== ""} onClick={() => openSettle(customer)}><Banknote size={14} /> Mark all paid</button>
                      )}
                      <button className="lst-btn ghost" type="button" disabled={busyId !== ""} onClick={() => void saveBill(customer)}>
                        {busyId === customer.key ? <RefreshCw className="spin" size={14} /> : <FileDown size={14} />} View bill
                      </button>
                      <button className="lst-btn ghost" type="button" onClick={() => void copyBill(customer)}><Copy size={14} /> Copy text</button>
                    </div>
                  </div>
              {(() => {
                // What is left to collect leads; lines already paid fold away
                // under one toggle so a paid car never looks like it is owed.
                // The bill itself (PDF, text) still lists everything.
                const carLine = (b: (typeof customer.cars)[number]) => {
                  const car = rowById.get(b.id);
                  return (
                    <li key={b.id} className={b.dueCents > 0 ? "" : "pk-month-paid"}>
                      <span className="pk-month-car">
                        <strong>{b.vehicle || "Car"}</strong>
                        <small>{[b.vinNumber, b.registeredTo ? `registered to ${b.registeredTo}` : "", b.stillParked ? "still parked" : "left"].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className="pk-month-period">{formatDayKey(b.periodFrom)} → {formatDayKey(b.periodTo)}</span>
                      <span className="pk-month-calc">{b.days} day{b.days === 1 ? "" : "s"} × {moneyText(b.dayRateCents)}</span>
                      <span className="pk-month-amount"><strong>{moneyText(b.monthCents)}</strong>{b.monthPaidCents > 0 && <small className="pk-paid">{moneyText(b.monthPaidCents)} paid</small>}{b.monthDiscountCents > 0 && <small className="pk-paid">-{moneyText(b.monthDiscountCents)} discount</small>}{b.dueCents > 0 ? <small>{moneyText(b.dueCents)} due</small> : <small>paid in full</small>}{b.monthPaidCents > 0 && receivedByText(b.paidBy) && <small className="pk-received-by">{receivedByText(b.paidBy).replace(/^ · /, "")}</small>}</span>
                      {car && <button className="ghost-button" type="button" title="Open the car to record a payment" onClick={() => onOpenCar(car)}><SquarePen size={14} /></button>}
                    </li>
                  );
                };
                const actLine = (a: (typeof customer.activities)[number]) => (
                  <li key={`act-${a.id}`} className={`pk-month-activity${a.dueCents > 0 ? "" : " pk-month-paid"}`}>
                    <span className="pk-month-car">
                      <strong>{a.label}{a.vehicle ? ` · ${a.vehicle}` : ""}</strong>
                      <small>{[a.prior ? "unpaid from before" : "activity", a.vinNumber, a.registeredTo ? `registered to ${a.registeredTo}` : ""].filter(Boolean).join(" · ")}</small>
                    </span>
                    <span className="pk-month-period">{formatDayKey(a.date)}</span>
                    <span className="pk-month-calc">{a.prior ? "" : "this month"}</span>
                    <span className="pk-month-amount"><strong>{moneyText(a.prior ? a.dueCents : a.feeCents)}</strong>{a.paidCents > 0 && <small className="pk-paid">{moneyText(a.paidCents)} paid</small>}{a.dueCents > 0 ? <small>{moneyText(a.dueCents)} due</small> : <small>paid in full</small>}{a.paidCents > 0 && receivedByText(a.paidBy) && <small className="pk-received-by">{receivedByText(a.paidBy).replace(/^ · /, "")}</small>}</span>
                    <span aria-hidden="true"></span>
                  </li>
                );
                // A car that left before this month and still owes
                // (docs/PARKING_CARRYOVER.md): the whole stay's dates, listed
                // first - it is the oldest money - then the month's cars.
                const olderCarLine = (b: (typeof customer.olderCars)[number]) => {
                  const car = rowById.get(b.id);
                  return (
                    <li key={`old-${b.id}`} className="pk-month-activity pk-month-carried">
                      <span className="pk-month-car">
                        <strong>{b.vehicle || "Car"}</strong>
                        <small>{["unpaid from before", b.vinNumber, b.registeredTo ? `registered to ${b.registeredTo}` : "", "left"].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className="pk-month-period">{formatDayKey(b.periodFrom)} → {formatDayKey(b.periodTo)}</span>
                      <span className="pk-month-calc">{b.days} day{b.days === 1 ? "" : "s"}</span>
                      <span className="pk-month-amount"><strong>{moneyText(b.dueCents)}</strong><small>{moneyText(b.dueCents)} due</small></span>
                      {car ? <button className="ghost-button" type="button" title="Open the car to record a payment" onClick={() => onOpenCar(car)}><SquarePen size={14} /></button> : <span aria-hidden="true"></span>}
                    </li>
                  );
                };
                const acts = [...customer.activities, ...customer.olderActivities];
                const owingLines = [...customer.olderCars.map(olderCarLine), ...customer.cars.filter((b) => b.dueCents > 0).map(carLine), ...acts.filter((a) => a.dueCents > 0).map(actLine)];
                const paidLines = [...customer.cars.filter((b) => b.dueCents <= 0).map(carLine), ...acts.filter((a) => a.dueCents <= 0).map(actLine)];
                const showPaid = openPaid.has(customer.key);
                // A linked staff member's lot expenses: one line with what
                // came off the bill, this month's purchases folded under it.
                const showExpenses = openExpenses.has(customer.key);
                const expenseRow = customer.expenseCreditCents > 0 && (
                  <li className="pk-month-expense">
                    <span className="pk-month-car">
                      <strong>Less expenses</strong>
                      <small>{customer.expenseLines.length > 0 ? "paid for the lot" : "paid for the lot in earlier months"}</small>
                    </span>
                    <span className="pk-month-period">
                      {customer.expenseLines.length > 0 && (
                        <button className="ghost-button" type="button" aria-expanded={showExpenses} onClick={() => setOpenExpenses((current) => {
                          const next = new Set(current);
                          if (next.has(customer.key)) next.delete(customer.key);
                          else next.add(customer.key);
                          return next;
                        })}>
                          {showExpenses ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {`${customer.expenseLines.length} ${customer.expenseLines.length === 1 ? "expense" : "expenses"} this month`}
                        </button>
                      )}
                    </span>
                    <span className="pk-month-calc">{`${moneyText(customer.dueBeforeExpensesCents)} before expenses`}</span>
                    <span className="pk-month-amount"><strong className="pk-paid">-{moneyText(customer.expenseCreditCents)}</strong></span>
                    <span aria-hidden="true"></span>
                  </li>
                );
                const expenseLines = showExpenses ? customer.expenseLines.map((l) => (
                  <li key={`exp-${l.id}`} className="pk-month-expense-line">
                    <span className="pk-month-car">
                      {l.label ? <strong data-no-translate>{l.label}</strong> : <strong>Expense</strong>}
                      {l.staffName && <small><span>paid by</span> <span data-no-translate>{l.staffName}</span></small>}
                    </span>
                    <span className="pk-month-period">{l.date ? formatDayKey(l.date) : ""}</span>
                    <span className="pk-month-calc"></span>
                    <span className="pk-month-amount"><strong>-{moneyText(l.amountCents)}</strong></span>
                    <span aria-hidden="true"></span>
                  </li>
                )) : null;
                // The earlier months' part of the credit, so the lines add
                // up to "Less expenses".
                const earlierLine = showExpenses && customer.earlierExpenseCents > 0 && (
                  <li key="exp-earlier" className="pk-month-expense-line">
                    <span className="pk-month-car"><strong>Expenses from earlier months</strong></span>
                    <span className="pk-month-period"></span>
                    <span className="pk-month-calc"></span>
                    <span className="pk-month-amount"><strong>-{moneyText(customer.earlierExpenseCents)}</strong></span>
                    <span aria-hidden="true"></span>
                  </li>
                );
                // A team member's statement: the month's cash they have
                // not handed over (held at its end, less what they handed
                // over since), then what they owe.
                const cashHeld = customer.cashHeldCents ?? 0;
                const cashRow = customer.statementOwesCents !== undefined && cashHeld !== 0 && (
                  <li key="cash-held" className="pk-month-expense">
                    <span className="pk-month-car">
                      <strong>Cash held for the business</strong>
                      <small>money they took in for the business by the end of the month and have not handed over since</small>
                    </span>
                    <span className="pk-month-period"></span>
                    <span className="pk-month-calc"></span>
                    <span className="pk-month-amount"><strong className={cashHeld > 0 ? "pk-owed" : "pk-paid"}>{cashHeld > 0 ? "+" : "-"}{moneyText(Math.abs(cashHeld))}</strong></span>
                    <span aria-hidden="true"></span>
                  </li>
                );
                const payments = paymentsByCustomer.get(customer.key) ?? [];
                const paymentsList = payments.length > 0 && (
                  <section className="pk-bill-payments" aria-label="Payments on this bill">
                    <h4>Payments on this bill</h4>
                    <ul>
                      {payments.map((p) => {
                        const by = receiverName(p.receivedByStaffId);
                        return (
                          <li key={p.id} className={p.status === "undone" ? "pk-bill-payment pk-bill-payment-undone" : "pk-bill-payment"}>
                            <span className="pk-bill-payment-main">
                              <strong>{moneyText(p.amountCents)}</strong>
                              <small>
                                {p.status === "undone" && <><span>Undone</span>{p.undoneAtMs > 0 && <> · <span data-no-translate>{formatDateTime(p.undoneAtMs)}</span></>} · </>}
                                <span>{parkingPaidViaLabel(p.receivedVia)}</span> · <span data-no-translate>{p.atMs > 0 ? formatDateTime(p.atMs) : "—"}</span>
                                {by && <> · <span>received by</span> <span data-no-translate>{by}</span></>}
                              </small>
                              <small><span>Covered:</span> <span data-no-translate>{billPaymentFor(p.parts, lang)}</span></small>
                              {p.discountCents > 0 && <small><span>Settled for less · discount</span> <b data-no-translate>-{moneyText(p.discountCents)}</b></small>}
                            </span>
                            {p.status === "recorded" && !p.settlementId && (
                              <button className="ghost-button" type="button" disabled={undoBusy} onClick={() => { setUndoTarget(p); setUndoError(""); }}><Undo2 size={14} /> Undo payment</button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
                return (
                  <>
                  <ul>
                    {owingLines}
                    {expenseRow}
                    {expenseLines}
                    {earlierLine}
                    {cashRow}
                    {paidLines.length > 0 && (
                      <li className="pk-month-paid-toggle">
                        <button className="ghost-button" type="button" aria-expanded={showPaid} onClick={() => setOpenPaid((current) => {
                          const next = new Set(current);
                          if (next.has(customer.key)) next.delete(customer.key);
                          else next.add(customer.key);
                          return next;
                        })}>
                          {showPaid ? <ChevronDown size={14} /> : <ChevronRight size={14} />} {paidLines.length} already paid
                        </button>
                      </li>
                    )}
                    {showPaid && paidLines}
                  </ul>
                  {paymentsList}
                  {customer.statementStaffId && customer.statementOwesCents !== undefined && (
                    <TeamSettlePanel
                      businessId={businessId}
                      monthKey={monthKey}
                      staffId={customer.statementStaffId}
                      staffName={customer.customerName}
                      owesCents={customer.statementOwesCents}
                      parkingJobsCents={customer.dueCents}
                      expenseCents={customer.expenseCreditCents}
                      cashHeldCents={customer.cashHeldCents ?? 0}
                      settlements={settlementsOf(settlements, customer.statementStaffId)}
                      receivers={settleReceivers}
                      names={staffNames}
                      myUid={myUid}
                      isReceiver={isSettleReceiver}
                      estimating={estimating}
                      onFlash={setFlash}
                    />
                  )}
                  </>
                );
              })()}
                </>
              );
            })()}
          </aside>
      )}
      {credit.available && (
        <BusinessOwesSection
          businessId={businessId}
          monthKey={monthKey}
          summary={summary}
          links={links}
          repayments={credit.repayments}
          staffOptions={staffOptions}
          canSettle={canSettleStaff}
          estimating={estimating}
          onFlash={setFlash}
        />
      )}
      {(() => {
        const customer = summary.customers.find((c) => c.key === settleKey);
        if (!customer) return null;
        const plan = monthBillPaymentPlan(customer);
        const retry = settleFailed.length > 0 ? new Set(settleFailed.map((f) => f.id)) : undefined;
        return (
          <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!settleBusy) setSettleKey(""); })}>
            <div className="lst-modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
              <header className="lst-modal-head">
                <div><h3>Mark all paid</h3><p>{customer.customerName} · {monthLabel(monthKey, lang)}</p></div>
                <button className="lst-icon-btn" type="button" disabled={Boolean(settleBusy)} onClick={() => setSettleKey("")} aria-label="Close"><X size={18} /></button>
              </header>
              <div className="lst-modal-body">
                {settleError && (
                  <div className="lst-form-error" role="alert">
                    {settleError}
                    {settleFailed.length > 0 && <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>{settleFailed.map((f) => (<li key={f.id}>{f.label} — {f.reason}</li>))}</ul>}
                  </div>
                )}
                <p className="lst-hint" style={{ marginTop: 0 }}>Each line is recorded the same way a payment is recorded by hand, so it shows on the car or the activity, in its history, and in your reports.</p>
                <ul className="pk-settle-list">
                  {plan.items.map((x) => (
                    <li key={`${x.kind}:${x.id}`} className={retry && !retry.has(`${x.kind}:${x.id}`) ? "pk-settle-done" : ""}>
                      <span>{x.kind === "car" ? "Parking" : "Activity"} · {x.label}</span><strong>{moneyText(x.amountCents)}</strong>
                    </li>
                  ))}
                  {plan.skipped.map((x) => (
                    <li key={`skip:${x.id}`} className="pk-settle-skip"><span>Parking · {x.label} — {x.reason === "payment_link" ? "paid by card link, not included" : "booked online, not included"}</span><strong>{moneyText(x.amountCents)}</strong></li>
                  ))}
                  {customer.expenseCreditCents > 0 && (
                    <li className="pk-settle-skip"><span>Less expenses — covered by the staff member's lot expenses, not recorded</span><strong>-{moneyText(customer.expenseCreditCents)}</strong></li>
                  )}
                  <li className="pk-settle-total"><span>Total to record</span><strong>{moneyText(plan.totalCents)}</strong></li>
                </ul>
                <div className="lst-form-grid">
                  <label className="lst-field"><span>How it was paid</span>
                    <select value={settleVia} onChange={(e) => setSettleVia(e.target.value)}>
                      {BUSINESS_PARKING_RECEIVED_VIA_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                    </select>
                  </label>
                  <label className="lst-field"><span>Received by</span>
                    <select value={settleBy} onChange={(e) => setSettleBy(e.target.value)} aria-label="Received by">
                      <ReceivedByOptions staffOptions={staffOptions} placeholder="Who took the money?" />
                    </select>
                  </label>
                  <label className="lst-field wide"><span>Note</span><input value={settleNote} onChange={(e) => setSettleNote(e.target.value)} /></label>
                </div>
              </div>
              <footer className="lst-modal-foot">
                {settleBusy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> {settleBusy}</span>}
                <button className="lst-btn ghost" type="button" disabled={Boolean(settleBusy)} onClick={() => setSettleKey("")}>Cancel</button>
                <button className="lst-add" type="button" disabled={Boolean(settleBusy) || !settleBy} onClick={() => void runSettle(customer, retry)}>
                  <Banknote size={16} /> {retry ? `Try the ${settleFailed.length} again` : <><span>Record payment</span> · <span data-no-translate>{moneyText(plan.totalCents)}</span></>}
                </button>
              </footer>
            </div>
          </div>
        );
      })()}
      {(() => {
        const customer = summary.customers.find((c) => c.key === payKey);
        if (!customer) return null;
        const typed = payAmount.trim() !== "";
        const amountCents = dollarsToCents(payAmount);
        const settling = payMode === "settle";
        const plan = billPaymentPlan(customer, Number.isFinite(amountCents) ? amountCents : 0);
        const settlePlan = billSettlePlan(customer, Number.isFinite(amountCents) ? amountCents : -1);
        return (
          <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!payBusy) setPayKey(""); })}>
            <div className="lst-modal" style={{ maxWidth: 600 }} onClick={(e) => e.stopPropagation()}>
              <header className="lst-modal-head">
                <div><h3>{settling ? "Settle for a lower amount" : "Record a payment"}</h3><p><span data-no-translate>{customer.customerName || "—"}</span> · {monthLabel(monthKey, lang)}</p></div>
                <button className="lst-icon-btn" type="button" disabled={payBusy} onClick={() => setPayKey("")} aria-label="Close"><X size={18} /></button>
              </header>
              <div className="lst-modal-body">
                {payError && <div className="lst-form-error" role="alert">{payError}</div>}
                <div className="pk-mode-switch" role="group" aria-label="Payment kind">
                  <button type="button" className={settling ? "lst-btn ghost" : "lst-btn"} aria-pressed={!settling} disabled={payBusy} onClick={() => { setPayMode("pay"); setPayError(""); }}>Full or part payment</button>
                  <button type="button" className={settling ? "lst-btn" : "lst-btn ghost"} aria-pressed={settling} disabled={payBusy} onClick={() => { setPayMode("settle"); setPayError(""); }}>Settle for a lower amount</button>
                </div>
                {settling ? (
                  <p className="lst-hint" style={{ marginTop: 0 }}>
                    <span>The bill is</span> <b data-no-translate>{moneyText(settlePlan.payableCents)}</b>. <span>Type what the customer pays now: the rest is recorded as a discount and the bill closes at $0.</span>
                  </p>
                ) : <p className="lst-hint" style={{ marginTop: 0 }}>
                  <span>It pays the oldest charges first, and is kept as one payment you can undo.</span> <span>Most you can record:</span> <b data-no-translate>{moneyText(plan.payableCents)}</b>
                </p>}
                <div className="lst-form-grid">
                  <label className="lst-field"><span>Amount received ($)</span>
                    <input value={payAmount} inputMode="decimal" autoComplete="off" placeholder="0.00" aria-label="Amount received" disabled={payBusy} onChange={(e) => { setPayAmount(e.target.value); setPayError(""); }} />
                  </label>
                  <label className="lst-field"><span>How it was paid</span>
                    <select value={payVia} disabled={payBusy} onChange={(e) => setPayVia(e.target.value)}>
                      {BUSINESS_PARKING_RECEIVED_VIA_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                    </select>
                  </label>
                  <label className="lst-field"><span>Received by</span>
                    <select value={payBy} disabled={payBusy} onChange={(e) => setPayBy(e.target.value)} aria-label="Received by">
                      <ReceivedByOptions staffOptions={staffOptions} placeholder="Who took the money?" />
                    </select>
                  </label>
                  {settling && (
                    <label className="lst-field wide"><span>Why (required)</span>
                      <input value={settleReason} maxLength={300} disabled={payBusy} placeholder="e.g. Agreed with the owner, long stay" aria-label="Why the discount was agreed" onChange={(e) => { setSettleReason(e.target.value); setPayError(""); }} />
                    </label>
                  )}
                  <label className="lst-field wide"><span>Note</span><input value={payNote} disabled={payBusy} onChange={(e) => setPayNote(e.target.value)} /></label>
                </div>
                <div aria-live="polite">
                  {!typed ? (
                    <p className="lst-hint">Type the amount received to see what it pays off.</p>
                  ) : settling ? (
                    settlePlan.ok ? (
                      <ul className="pk-settle-list">
                        {settlePlan.parts.map((x) => (
                          <li key={`${x.kind}:${x.id}`}>
                            <span><span>Paid</span> · <span data-no-translate>{x.label}</span></span><strong>{moneyText(x.amountCents)}</strong>
                          </li>
                        ))}
                        {settlePlan.discountParts.map((d) => (
                          <li key={`discount:${d.id}`}>
                            <span><span>Discount</span> · <span data-no-translate>{d.label}</span></span><strong>-{moneyText(d.amountCents)}</strong>
                          </li>
                        ))}
                        <li className="pk-settle-total"><span>Left on the bill:</span><strong>{moneyText(0)}</strong></li>
                      </ul>
                    ) : (
                      <div className="lst-form-error" role="alert">{BILL_PAYMENT_MESSAGES[settlePlan.reason as BillPaymentRefusal]}</div>
                    )
                  ) : plan.ok ? (
                    <>
                      <p className="lst-hint" style={{ marginBottom: 0 }}>Pays off:</p>
                      <ul className="pk-settle-list">
                        {plan.parts.map((x) => (
                          <li key={`${x.kind}:${x.id}`}>
                            <span><span data-no-translate>{x.label}</span>{x.full && <> · <span>paid in full</span></>}</span><strong>{moneyText(x.amountCents)}</strong>
                          </li>
                        ))}
                        <li className="pk-settle-total"><span>Left on the bill:</span><strong>{moneyText(plan.leftCents)}</strong></li>
                      </ul>
                    </>
                  ) : (
                    <div className="lst-form-error" role="alert">
                      {plan.reason === BILL_PAYMENT_REFUSAL.MORE_THAN_OWED
                        ? <><span>That is more than this bill owes</span> (<span data-no-translate>{moneyText(plan.payableCents)}</span>). <span>Record what is owed and give the rest back.</span></>
                        : BILL_PAYMENT_MESSAGES[plan.reason as BillPaymentRefusal]}
                    </div>
                  )}
                </div>
              </div>
              <footer className="lst-modal-foot">
                {payBusy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> Saving…</span>}
                <button className="lst-btn ghost" type="button" disabled={payBusy} onClick={() => setPayKey("")}>Cancel</button>
                <button className="lst-add" type="button"
                  disabled={payBusy || (settling ? (!settlePlan.ok || (amountCents > 0 && !payBy) || !settleReason.trim()) : (!payBy || !plan.ok))}
                  onClick={() => void runPay(customer)}>
                  <Banknote size={16} /> {settling ? "Settle" : "Record payment"}
                </button>
              </footer>
            </div>
          </div>
        );
      })()}
      {undoTarget && (
        <div className="lst-modal-overlay" role="dialog" aria-modal="true" {...overlayDismiss(() => { if (!undoBusy) setUndoTarget(null); })}>
          <div className="lst-modal" style={{ maxWidth: 460 }} onClick={(e) => e.stopPropagation()}>
            <header className="lst-modal-head">
              <div><h3>Undo this payment?</h3><p><b data-no-translate>{moneyText(undoTarget.amountCents)}</b>{receiverName(undoTarget.receivedByStaffId) && <> · <span data-no-translate>{receiverName(undoTarget.receivedByStaffId)}</span></>}</p></div>
              <button className="lst-icon-btn" type="button" disabled={undoBusy} onClick={() => setUndoTarget(null)} aria-label="Close"><X size={18} /></button>
            </header>
            <div className="lst-modal-body">
              {undoError && <div className="lst-form-error" role="alert">{undoError}</div>}
              <p className="lst-hint" style={{ marginTop: 0 }}>It comes off every car and job it paid.</p>
            </div>
            <footer className="lst-modal-foot">
              {undoBusy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> Saving…</span>}
              <button className="lst-btn ghost" type="button" disabled={undoBusy} onClick={() => setUndoTarget(null)}>Cancel</button>
              <button className="lst-btn danger" type="button" disabled={undoBusy} onClick={() => void runUndo()}><Undo2 size={14} /> Undo payment</button>
            </footer>
          </div>
        </div>
      )}
      {preview && <PdfPreview {...preview} onClose={() => setPreview(null)} />}
    </div>
  );
}

const STATUS_PILL: Record<MonthRowStatus, { label: string; tone: string }> = {
  not_paid: { label: "Not paid", tone: "owed" },
  part_paid: { label: "Part paid", tone: "part" },
  paid: { label: "Paid", tone: "ok" },
  team_owes: { label: "Not paid", tone: "owed" },
  team_owed: { label: "Owed to them", tone: "ok" },
  team_settled: { label: "Settled", tone: "ok" },
  included: { label: "Included in the statement of", tone: "quiet" },
};

/** A customer's status in the Month end table and on their bill. */
function MonthStatusPill({ status }: { status: MonthRowStatus }) {
  const pill = STATUS_PILL[status];
  if (status === "included") return null;
  return <span className={`pk-me-pill ${pill.tone}`}>{pill.label}</span>;
}
