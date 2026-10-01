/**
 * Month-end parking papers, built in the browser: one car's bill for the
 * month, and the business's one-page summary of it. Same header as the
 * invoices - the business's logo, name, address and contact - so a
 * customer who has had one recognises the other. jsPDF loads on first use.
 */

import { businessAddressText, fetchLogo } from "./invoice-pdf.ts";
import {
  monthLabel,
  moneyText,
  type ParkingMonthCustomer,
  type ParkingMonthSummary,
} from "./parking-month-statement.ts";

type Row = Record<string, unknown>;
type Lang = "en" | "fr";
const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);

const COPY = {
  en: {
    bill: "PARKING BILL", summary: "MONTH END", billedTo: "Billed to", vehicle: "Vehicle",
    period: "Period", days: "days", day: "day", parking: "Parking", priorUnpaid: "Unpaid from before",
    paid: "Paid", balanceDue: "Balance due", paidInFull: "Paid in full", stillParked: "Still parked",
    left: "Left", carsOnLot: "Cars on the lot", carsOwing: "Still owing", billed: "Billed",
    collected: "Collected", owed: "Still owed", whoOwes: "Who still owes", customer: "Customer",
    due: "Due", none: "Nobody owes anything for this month.", soFar: "so far",
    car: "Car", amount: "Amount", to: "to", registeredTo: "registered to", monthTotal: "Total for the month", cars: "cars",
    footer: "Issued through Laawol Digital · laawoldigital.com",
  },
  fr: {
    bill: "FACTURE DE PARKING", summary: "FIN DE MOIS", billedTo: "Facturé à", vehicle: "Véhicule",
    period: "Période", days: "jours", day: "jour", parking: "Parking", priorUnpaid: "Impayé des mois précédents",
    paid: "Payé", balanceDue: "Solde dû", paidInFull: "Payé en totalité", stillParked: "Toujours garée",
    left: "Partie", carsOnLot: "Voitures au parking", carsOwing: "Doivent encore", billed: "Facturé",
    collected: "Encaissé", owed: "Encore dû", whoOwes: "Qui doit encore", customer: "Client",
    due: "Dû", none: "Personne ne doit rien pour ce mois.", soFar: "à ce jour",
    car: "Voiture", amount: "Montant", to: "au", registeredTo: "enregistrée au nom de", monthTotal: "Total du mois", cars: "voitures",
    footer: "Émis via Laawol Digital · laawoldigital.com",
  },
} as const;

const INK: [number, number, number] = [18, 33, 31];
const MUTED: [number, number, number] = [91, 107, 104];
const BRAND: [number, number, number] = [13, 148, 136];
const DUE: [number, number, number] = [146, 64, 14];
const OK: [number, number, number] = [22, 101, 52];
const W = 612;
const M = 48;
const R = W - M;

type Doc = InstanceType<typeof import("jspdf").jsPDF>;

/** The shared header; returns the y the body starts at. */
async function header(doc: Doc, business: Row, kind: string, title: string, sub: string): Promise<number> {
  const y = M;
  const name = text(business.name, 160) || "Laawol Digital";
  const logo = await fetchLogo(text(business.logoUrl, 500) || text(business.profileImageUrl, 500));
  let x = M;
  if (logo) {
    try {
      doc.addImage(logo.data, logo.type, M, y, 44, 44);
      x = M + 56;
    } catch {
      x = M;
    }
  }
  doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(16).text(name, x, y + 16);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  let sy = y + 30;
  for (const line of [businessAddressText(business), [text(business.phone, 40), text(business.email, 180)].filter(Boolean).join("  |  ")].filter(Boolean)) {
    doc.text(doc.splitTextToSize(line, 300), x, sy);
    sy += 12;
  }
  doc.setFont("helvetica", "bold").setFontSize(20).setTextColor(...BRAND).text(kind, R, y + 18, { align: "right" });
  doc.setFontSize(12).setTextColor(...INK).text(title, R, y + 36, { align: "right" });
  if (sub) doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED).text(sub, R, y + 50, { align: "right" });
  const top = Math.max(sy, y + 58) + 8;
  doc.setDrawColor(...BRAND).setLineWidth(1.5).line(M, top, R, top);
  return top + 24;
}

function footer(doc: Doc, lang: Lang) {
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED).text(COPY[lang].footer, W / 2, 792 - 30, { align: "center" });
}

function row(doc: Doc, y: number, label: string, value: string, opts: { bold?: boolean; color?: [number, number, number] } = {}) {
  doc.setFont("helvetica", opts.bold ? "bold" : "normal").setFontSize(opts.bold ? 12 : 10.5)
    .setTextColor(...(opts.color ?? (opts.bold ? INK : MUTED)));
  doc.text(label, M, y);
  doc.text(value, R, y, { align: "right" });
}

export async function buildParkingMonthBillPdf(input: { business: Row; customer: ParkingMonthCustomer; language: Lang }): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const t = COPY[input.language];
  const c = input.customer;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = await header(doc, input.business, t.bill, monthLabel(c.monthKey, input.language), `${c.cars.length} ${c.cars.length === 1 ? t.car.toLowerCase() : t.cars}`);

  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED).text(t.billedTo.toUpperCase(), M, y);
  doc.setFontSize(13).setTextColor(...INK).text(c.customerName || "—", M, y + 16);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...MUTED);
  const who = [c.customerPhone, c.customerEmail].filter(Boolean).join("  |  ");
  if (who) doc.text(who, M, y + 30);
  y += 54;

  // One line per car: what it is, the days it covers, days x rate, amount.
  const colPeriod = M + 220;
  const colRate = R - 90;
  const head = () => {
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED);
    doc.text(t.car.toUpperCase(), M, y);
    doc.text(t.period.toUpperCase(), colPeriod, y);
    doc.text(`${t.days.toUpperCase()} ×`, colRate, y, { align: "right" });
    doc.text(t.amount.toUpperCase(), R, y, { align: "right" });
    y += 6;
    doc.setDrawColor(230, 233, 232).setLineWidth(1).line(M, y, R, y);
    y += 16;
  };
  head();
  for (const b of c.cars) {
    if (y > 792 - 140) {
      footer(doc, input.language);
      doc.addPage();
      y = M;
      head();
    }
    doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...INK).text(b.vehicle || t.car, M, y);
    doc.setFont("helvetica", "normal").setFontSize(10).text(`${b.periodFrom} ${t.to} ${b.periodTo}`, colPeriod, y);
    doc.text(`${b.days} × ${moneyText(b.dayRateCents)}`, colRate, y, { align: "right" });
    doc.setFont("helvetica", "bold").text(moneyText(b.monthCents), R, y, { align: "right" });
    let ly = y + 12;
    const sub = [b.vinNumber ? `VIN ${b.vinNumber}` : "", b.registeredTo ? `${t.registeredTo} ${b.registeredTo}` : "", b.stillParked ? t.stillParked : t.left]
      .filter(Boolean).join("  ·  ");
    doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED).text(sub, M, ly);
    ly += 8;
    doc.setDrawColor(236, 238, 237).setLineWidth(0.5).line(M, ly, R, ly);
    y = ly + 16;
  }

  y += 4;
  row(doc, y, t.monthTotal, moneyText(c.monthCents), { color: INK });
  y += 18;
  if (c.priorUnpaidCents > 0) {
    row(doc, y, t.priorUnpaid, moneyText(c.priorUnpaidCents), { color: DUE });
    y += 18;
  }
  if (c.monthPaidCents > 0) {
    row(doc, y, t.paid, `-${moneyText(c.monthPaidCents)}`, { color: OK });
    y += 18;
  }
  doc.setDrawColor(...INK).setLineWidth(1.2).line(M, y - 6, R, y - 6);
  y += 12;
  if (c.dueCents > 0) row(doc, y, t.balanceDue, moneyText(c.dueCents), { bold: true, color: DUE });
  else row(doc, y, t.paidInFull, moneyText(0), { bold: true, color: OK });

  footer(doc, input.language);
  return doc.output("blob");
}

export async function buildParkingMonthSummaryPdf(input: { business: Row; summary: ParkingMonthSummary; language: Lang }): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const t = COPY[input.language];
  const s = input.summary;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  let y = await header(doc, input.business, t.summary, monthLabel(s.monthKey, input.language), t.parking);

  const stats: Array<[string, string, [number, number, number]]> = [
    [t.carsOnLot, String(s.carsOnLot), INK],
    [t.billed, moneyText(s.billedCents), INK],
    [t.collected, moneyText(s.collectedCents), OK],
    [t.owed, moneyText(s.dueCents), s.dueCents > 0 ? DUE : INK],
  ];
  const colW = (R - M) / stats.length;
  stats.forEach(([label, value, color], i) => {
    const x = M + i * colW;
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED).text(label.toUpperCase(), x, y);
    doc.setFontSize(16).setTextColor(...color).text(value, x, y + 20);
  });
  y += 48;

  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED).text(`${t.whoOwes.toUpperCase()} (${s.customersOwing.length})`, M, y);
  y += 8;
  doc.setDrawColor(230, 233, 232).setLineWidth(1).line(M, y, R, y);
  y += 16;
  if (s.customersOwing.length === 0) {
    doc.setFont("helvetica", "normal").setFontSize(10.5).setTextColor(...INK).text(t.none, M, y);
  }
  for (const b of s.customersOwing) {
    if (y > 792 - 80) {
      footer(doc, input.language);
      doc.addPage();
      y = M;
    }
    doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...INK).text(b.customerName || "—", M, y);
    doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED)
      .text((doc.splitTextToSize(`${b.customerPhone}${b.customerPhone ? " · " : ""}${b.cars.length} ${b.cars.length === 1 ? t.car.toLowerCase() : t.cars}: ${b.cars.map((car) => car.vehicle).join(", ")}`, R - 80 - (M + 150)) as string[])[0], M + 150, y);
    doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...DUE).text(moneyText(b.dueCents), R, y, { align: "right" });
    y += 6;
    doc.setDrawColor(236, 238, 237).setLineWidth(0.5).line(M, y, R, y);
    y += 14;
  }
  footer(doc, input.language);
  return doc.output("blob");
}

export function parkingMonthFileName(kind: "bill" | "summary", monthKey: string, who: string, business: string): string {
  const slug = (v: string) => v.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return [kind === "bill" ? "parking-bill" : "parking-month-end", monthKey, slug(who), slug(business)].filter(Boolean).join("-") + ".pdf";
}
