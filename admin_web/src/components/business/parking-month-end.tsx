"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, FileDown, RefreshCw, SquarePen } from "lucide-react";

import { currentLanguage, text } from "@/lib/format";
import { PdfPreview, type PdfPreviewFile } from "@/components/pdf-preview";
import {
  buildParkingMonthBillPdf,
  buildParkingMonthSummaryPdf,
  parkingMonthFileName,
} from "@/lib/parking-month-pdf";
import {
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
  rows: readonly FirestoreRow[];
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
export function ParkingMonthEnd({ rows, business, businessName, initialMonth, onClose, onOpenCar }: ParkingMonthEndProps) {
  const [monthKey, setMonthKey] = useState(initialMonth || previousMonthKey());
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [flash, setFlash] = useState("");
  const [preview, setPreview] = useState<PdfPreviewFile | null>(null);
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const orgName = text(business?.name, "") || businessName;
  const identity = useMemo(() => ({ ...(business ?? {}), name: orgName }), [business, orgName]);

  const summary = useMemo(() => parkingMonthSummary(rows, monthKey), [rows, monthKey]);
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
                  <small>{customer.customerPhone}{customer.customerPhone ? " · " : ""}{customer.cars.length} car{customer.cars.length === 1 ? "" : "s"}</small>
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
                </div>
              </header>
              <ul>
                {customer.cars.map((b) => {
                  const car = rowById.get(b.id);
                  return (
                    <li key={b.id}>
                      <span className="pk-month-car">
                        <strong>{b.vehicle || "Car"}</strong>
                        <small>{[b.vinNumber, b.registeredTo ? `registered to ${b.registeredTo}` : "", b.stillParked ? "still parked" : "left"].filter(Boolean).join(" · ")}</small>
                      </span>
                      <span className="pk-month-period">{b.periodFrom} → {b.periodTo}</span>
                      <span className="pk-month-calc">{b.days} day{b.days === 1 ? "" : "s"} × {moneyText(b.dayRateCents)}</span>
                      <span className="pk-month-amount"><strong>{moneyText(b.monthCents)}</strong>{b.dueCents > 0 ? <small>{moneyText(b.dueCents)} due</small> : <small>paid</small>}</span>
                      {car && <button className="ghost-button" type="button" title="Open the car to record a payment" onClick={() => onOpenCar(car)}><SquarePen size={14} /></button>}
                    </li>
                  );
                })}
              </ul>
            </article>
          ))}
        </div>
      )}
      {preview && <PdfPreview {...preview} onClose={() => setPreview(null)} />}
    </div>
  );
}
