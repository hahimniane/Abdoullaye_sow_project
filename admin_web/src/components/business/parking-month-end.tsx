"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Copy, FileDown, RefreshCw, SquarePen } from "lucide-react";

import { currentLanguage, text } from "@/lib/format";
import { deliverPdf } from "@/lib/invoice-pdf";
import {
  buildParkingMonthBillPdf,
  buildParkingMonthSummaryPdf,
  parkingMonthFileName,
} from "@/lib/parking-month-pdf";
import {
  monthLabel,
  moneyText,
  parkingMonthBillText,
  parkingMonthSummary,
  previousMonthKey,
  shiftMonthKey,
  type ParkingMonthBill,
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
  const lang = currentLanguage() === "fr" ? "fr" : "en";
  const orgName = text(business?.name, "") || businessName;
  const identity = useMemo(() => ({ ...(business ?? {}), name: orgName }), [business, orgName]);

  const summary = useMemo(() => parkingMonthSummary(rows, monthKey), [rows, monthKey]);
  const thisMonth = new Date().toISOString().slice(0, 7);
  const listed = showAll ? [...summary.bills].sort((a, b) => b.dueCents - a.dueCents || a.customerName.localeCompare(b.customerName)) : summary.owing;
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
      const outcome = await deliverPdf(blob, parkingMonthFileName("summary", monthKey, "", orgName));
      setFlash(outcome === "shared" ? "PDF handed to the share sheet." : "PDF saved to your downloads.");
    } catch {
      setFlash("The PDF could not be made. Try again.");
    } finally {
      setBusyId("");
    }
  }

  async function saveBill(bill: ParkingMonthBill) {
    setBusyId(bill.id);
    setFlash("");
    try {
      const blob = await buildParkingMonthBillPdf({ business: identity, bill, language: lang });
      const outcome = await deliverPdf(blob, parkingMonthFileName("bill", monthKey, bill.customerName, orgName));
      setFlash(outcome === "shared" ? "PDF handed to the share sheet." : "PDF saved to your downloads.");
    } catch {
      setFlash("The PDF could not be made. Try again.");
    } finally {
      setBusyId("");
    }
  }

  async function copyBill(bill: ParkingMonthBill) {
    try {
      await navigator.clipboard.writeText(parkingMonthBillText(bill, orgName));
      setFlash(`Copied ${bill.customerName}'s bill — paste it into WhatsApp.`);
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
          {busyId === "summary" ? <RefreshCw className="spin" size={14} /> : <FileDown size={14} />} Save the month as PDF
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
        <div className="pk-stat"><span>Cars on the lot</span><b>{summary.carsOnLot}</b><small>{summary.carsOwing} still owing</small></div>
        <div className="pk-stat"><span>Billed</span><b>{moneyText(summary.billedCents)}</b><small>for the month</small></div>
        <div className="pk-stat"><span>Collected</span><b>{moneyText(summary.collectedCents)}</b><small>toward the month</small></div>
        <div className="pk-stat"><span>Still owed</span><b className={summary.dueCents > 0 ? "owed" : ""}>{moneyText(summary.dueCents)}</b>
          <small>{summary.olderOwedCents > 0 ? `incl. ${moneyText(summary.olderOwedCents)} from before` : "by the cars below"}</small>
        </div>
      </div>

      <div className="pk-month-tools">
        <div className="pk-view" role="group" aria-label="Which cars">
          <button type="button" className={!showAll ? "on" : ""} aria-pressed={!showAll} onClick={() => setShowAll(false)}>Who owes ({summary.carsOwing})</button>
          <button type="button" className={showAll ? "on" : ""} aria-pressed={showAll} onClick={() => setShowAll(true)}>Every car ({summary.carsOnLot})</button>
        </div>
      </div>

      {listed.length === 0 ? (
        <div className="empty-state">{summary.carsOnLot === 0 ? "No car was on the lot that month." : "Nobody owes anything for this month."}</div>
      ) : (
        <div className="mini-table">
          <div className="ctn-table pk-month-table">
            <div className="mini-table-head"><span>Customer</span><span>Car</span><span>This month</span><span>Due</span><span aria-hidden="true"></span></div>
            {listed.map((bill) => {
              const car = rowById.get(bill.id);
              return (
                <div className="mini-table-row" key={bill.id}>
                  <span><strong>{bill.customerName || "—"}</strong>{bill.customerPhone && <small>{bill.customerPhone}</small>}</span>
                  <span><strong>{bill.vehicle || "—"}</strong><small>{bill.vinNumber ? bill.vinNumber : bill.trackingCode}{bill.stillParked ? " · still parked" : " · left"}</small></span>
                  <span>
                    <strong>{moneyText(bill.monthCents)}</strong>
                    <small>{bill.days} day{bill.days === 1 ? "" : "s"} × {moneyText(bill.dayRateCents)}{bill.priorUnpaidCents > 0 ? ` · + ${moneyText(bill.priorUnpaidCents)} from before` : ""}</small>
                  </span>
                  <span>
                    {bill.dueCents > 0
                      ? <><strong className="pk-owed">{moneyText(bill.dueCents)}</strong>{bill.monthPaidCents > 0 && <small>{moneyText(bill.monthPaidCents)} paid</small>}</>
                      : <span className="lst-badge ok">Paid</span>}
                  </span>
                  <span className="ctn-row-actions pk-month-actions">
                    <button className="ghost-button" type="button" disabled={busyId !== ""} title="Save the bill as PDF" onClick={() => void saveBill(bill)}>
                      {busyId === bill.id ? <RefreshCw className="spin" size={14} /> : <FileDown size={14} />}
                    </button>
                    <button className="ghost-button" type="button" title="Copy the bill as text" onClick={() => void copyBill(bill)}><Copy size={14} /></button>
                    {car && <button className="ghost-button" type="button" title="Open the car to record a payment" onClick={() => onOpenCar(car)}><SquarePen size={14} /></button>}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
