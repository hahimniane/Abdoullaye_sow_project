"use client";

import { useMemo, useState } from "react";
import { httpsCallable } from "firebase/functions";
import { ArrowLeft, Banknote, ChevronDown, ChevronLeft, ChevronRight, Copy, FileDown, RefreshCw, SquarePen, X } from "lucide-react";

import { auth, functions } from "@/lib/firebase";
import { useParkingMonthInputs } from "@/lib/business-data";
import { BUSINESS_PARKING_RECEIVED_VIA_OPTIONS } from "@/lib/business-parking-entry";
import { overlayDismiss } from "@/lib/overlay-dismiss";

import { currentLanguage, formatDayKey, text } from "@/lib/format";
import { PdfPreview, type PdfPreviewFile } from "@/components/pdf-preview";
import {
  buildParkingMonthBillPdf,
  buildParkingMonthSummaryPdf,
  parkingMonthFileName,
} from "@/lib/parking-month-pdf";
import {
  monthBillPaymentPlan,
  monthLabel,
  moneyText,
  parkingMonthCustomerText,
  parkingMonthSummary,
  previousMonthKey,
  shiftMonthKey,
  type ParkingMonthCustomer,
} from "@/lib/parking-month-statement";
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
};

/**
 * Settling the books for a month: every car that was on the lot that month,
 * what it ran up, what came in, and who still owes - each with its own bill
 * to send. Worked out live from the cars; payments are recorded on the car
 * as always, oldest month first, so a bill flips to paid by itself.
 */
export function ParkingMonthEnd({ businessId, staff = [], business, businessName, initialMonth, onClose, onOpenCar }: ParkingMonthEndProps) {
  const [monthKey, setMonthKey] = useState(initialMonth || previousMonthKey());
  const inputs = useParkingMonthInputs(businessId, monthKey, Boolean(businessId));
  const rows = inputs.cars;
  const activities = inputs.activities;
  const [showAll, setShowAll] = useState(false);
  // Customers whose already-paid lines are unfolded on their card.
  const [openPaid, setOpenPaid] = useState<Set<string>>(() => new Set());
  const [busyId, setBusyId] = useState("");
  const [flash, setFlash] = useState("");
  const [preview, setPreview] = useState<PdfPreviewFile | null>(null);
  // "Mark all paid": which customer, and the same details any payment takes.
  const [settleKey, setSettleKey] = useState("");
  const [settleVia, setSettleVia] = useState("cash");
  const [settleBy, setSettleBy] = useState("");
  const [settleNote, setSettleNote] = useState("");
  const [settleBusy, setSettleBusy] = useState("");
  const [settleError, setSettleError] = useState("");
  const [settleFailed, setSettleFailed] = useState<{ id: string; label: string; reason: string }[]>([]);
  const staffOptions = useMemo(() => staff.map((s) => ({
    id: String(s.id),
    name: text(s.fullName, "") || text(s.name, "") || text(s.email, ""),
  })).filter((s) => s.name), [staff]);
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const orgName = text(business?.name, "") || businessName;
  const identity = useMemo(() => ({ ...(business ?? {}), name: orgName }), [business, orgName]);

  const summary = useMemo(() => parkingMonthSummary(rows, monthKey, new Date(), activities), [rows, activities, monthKey]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  // One row per customer (grouped by phone), their cars underneath.
  const listed = showAll ? summary.customers : summary.customersOwing;
  const rowById = useMemo(() => {
    const map = new Map<string, FirestoreRow>();
    rows.forEach((r) => map.set(String(r.id), r));
    return map;
  }, [rows]);

  async function saveSummary() {
    setBusyId("summary");
    setFlash("");
    try {
      const blob = await buildParkingMonthSummaryPdf({ business: identity, summary, language: lang });
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
      const blob = await buildParkingMonthBillPdf({ business: identity, customer, language: lang });
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
      setFlash(`Recorded ${moneyText(recordedCents)} for ${customer.customerName} — ${items.length} item${items.length === 1 ? "" : "s"}, received by ${staffOptions.find((s) => s.id === settleBy)?.name ?? "your team"}.`);
    } else {
      setSettleError(`${items.length - failed.length} of ${items.length} recorded. These did not save:`);
    }
  }

  async function copyBill(customer: ParkingMonthCustomer) {
    try {
      await navigator.clipboard.writeText(parkingMonthCustomerText(customer, orgName));
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
          <button className="lst-icon-btn" type="button" aria-label="Previous month" onClick={() => setMonthKey((m) => shiftMonthKey(m, -1))}><ChevronLeft size={18} /></button>
          <strong>{monthLabel(monthKey, lang)}</strong>
          <button className="lst-icon-btn" type="button" aria-label="Next month" disabled={monthKey >= thisMonth} onClick={() => setMonthKey((m) => shiftMonthKey(m, 1))}><ChevronRight size={18} /></button>
        </div>
        <button className="lst-btn ghost" type="button" disabled={busyId !== ""} onClick={() => void saveSummary()}>
          {busyId === "summary" ? <RefreshCw className="spin" size={14} /> : <FileDown size={14} />} View the month as PDF
        </button>
      </div>
      <p className="panel-lede">
        {monthKey === thisMonth
          ? "This month so far. Each car's bill is that month's days at its rate; payments recorded on the car pay the oldest month first."
          : "Each car's bill is that month's days at its rate, plus anything still unpaid from before. Payments recorded on the car pay the oldest month first, so a bill turns to paid by itself."}
      </p>
      {flash && (
        <div className="lst-form-error" role="status" style={{ background: "var(--mist)", color: "var(--brand-strong)" }}>
          {flash} <button className="ghost-button" type="button" onClick={() => setFlash("")}>Dismiss</button>
        </div>
      )}

      {inputs.error && <div className="error-box" role="alert">{inputs.error}</div>}
      {inputs.loading && (
        <div className="empty-state"><RefreshCw className="spin" size={16} /> Loading…</div>
      )}

      <div className="pk-scoreboard" role="group" aria-label="Month totals">
        <div className="pk-stat"><span>Cars on the lot</span><b>{summary.carsOnLot}</b><small>{summary.customersOwing.length} customers still owe</small></div>
        <div className="pk-stat"><span>Billed</span><b>{moneyText(summary.billedCents)}</b><small>for the month</small></div>
        <div className="pk-stat"><span>Collected</span><b>{moneyText(summary.collectedCents)}</b><small>toward the month</small></div>
        <div className="pk-stat"><span>Still owed</span><b className={summary.dueCents > 0 ? "owed" : ""}>{moneyText(summary.dueCents)}</b>
          <small>{summary.olderOwedCents > 0 ? `incl. ${moneyText(summary.olderOwedCents)} from before` : "by the customers below"}</small>
        </div>
      </div>

      <div className="pk-month-tools">
        <div className="pk-view" role="group" aria-label="Which customers">
          <button type="button" className={!showAll ? "on" : ""} aria-pressed={!showAll} onClick={() => setShowAll(false)}>Who owes ({summary.customersOwing.length})</button>
          <button type="button" className={showAll ? "on" : ""} aria-pressed={showAll} onClick={() => setShowAll(true)}>Everyone ({summary.customers.length})</button>
        </div>
      </div>

      {listed.length === 0 ? (
        <div className="empty-state">{summary.carsOnLot === 0 ? "No car was on the lot that month." : "Nobody owes anything for this month."}</div>
      ) : (
        <div className="pk-month-list">
          {listed.map((customer) => (
            <article className="pk-month-customer" key={customer.key}>
              <header>
                <div>
                  <strong>{customer.customerName || "—"}</strong>
                  <small>{[customer.customerPhone, customer.cars.length ? `${customer.cars.length} car${customer.cars.length === 1 ? "" : "s"}` : "", customer.activities.length + customer.olderActivities.length ? `${customer.activities.length + customer.olderActivities.length} activit${customer.activities.length + customer.olderActivities.length === 1 ? "y" : "ies"}` : ""].filter(Boolean).join(" · ")}</small>
                </div>
                <div className="pk-month-due">
                  {customer.dueCents > 0
                    ? <><strong className="pk-owed">{moneyText(customer.dueCents)}</strong><small>{customer.monthPaidCents > 0 ? `${moneyText(customer.monthPaidCents)} paid · ` : ""}{moneyText(customer.monthCents)} this month{customer.priorUnpaidCents > 0 ? ` + ${moneyText(customer.priorUnpaidCents)} from before` : ""}</small></>
                    : <span className="lst-badge ok">Paid</span>}
                </div>
                <div className="pk-month-actions">
                  <button className="lst-btn ghost" type="button" disabled={busyId !== ""} onClick={() => void saveBill(customer)}>
                    {busyId === customer.key ? <RefreshCw className="spin" size={14} /> : <FileDown size={14} />} View bill
                  </button>
                  <button className="lst-btn ghost" type="button" onClick={() => void copyBill(customer)}><Copy size={14} /> Copy text</button>
                  {customer.dueCents > 0 && monthBillPaymentPlan(customer).items.length > 0 && (
                    <button className="lst-btn" type="button" disabled={busyId !== ""} onClick={() => openSettle(customer)}><Banknote size={14} /> Mark all paid</button>
                  )}
                </div>
              </header>
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
                      <span className="pk-month-amount"><strong>{moneyText(b.monthCents)}</strong>{b.monthPaidCents > 0 && <small className="pk-paid">{moneyText(b.monthPaidCents)} paid</small>}{b.dueCents > 0 ? <small>{moneyText(b.dueCents)} due</small> : <small>paid in full</small>}</span>
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
                    <span className="pk-month-amount"><strong>{moneyText(a.prior ? a.dueCents : a.feeCents)}</strong>{a.paidCents > 0 && <small className="pk-paid">{moneyText(a.paidCents)} paid</small>}{a.dueCents > 0 ? <small>{moneyText(a.dueCents)} due</small> : <small>paid in full</small>}</span>
                    <span aria-hidden="true"></span>
                  </li>
                );
                const acts = [...customer.activities, ...customer.olderActivities];
                const owingLines = [...customer.cars.filter((b) => b.dueCents > 0).map(carLine), ...acts.filter((a) => a.dueCents > 0).map(actLine)];
                const paidLines = [...customer.cars.filter((b) => b.dueCents <= 0).map(carLine), ...acts.filter((a) => a.dueCents <= 0).map(actLine)];
                const showPaid = openPaid.has(customer.key);
                return (
                  <ul>
                    {owingLines}
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
                );
              })()}
            </article>
          ))}
        </div>
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
                      <option value="">Who took the money?</option>
                      {staffOptions.map((o) => (<option key={o.id} value={o.id}>{o.name}</option>))}
                    </select>
                  </label>
                  <label className="lst-field wide"><span>Note</span><input value={settleNote} onChange={(e) => setSettleNote(e.target.value)} /></label>
                </div>
              </div>
              <footer className="lst-modal-foot">
                {settleBusy && <span className="lst-hint" role="status" style={{ marginRight: "auto" }}><RefreshCw className="spin" size={13} /> {settleBusy}</span>}
                <button className="lst-btn ghost" type="button" disabled={Boolean(settleBusy)} onClick={() => setSettleKey("")}>Cancel</button>
                <button className="lst-add" type="button" disabled={Boolean(settleBusy) || !settleBy} onClick={() => void runSettle(customer, retry)}>
                  <Banknote size={16} /> {retry ? `Try the ${settleFailed.length} again` : `Record ${moneyText(plan.totalCents)}`}
                </button>
              </footer>
            </div>
          </div>
        );
      })()}
      {preview && <PdfPreview {...preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
