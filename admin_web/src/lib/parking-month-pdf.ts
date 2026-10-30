/**
 * Month-end parking papers, built in the browser: one car's bill for the
 * month, and the business's one-page summary of it. Same header as the
 * invoices - the business's logo, name, address and contact - so a
 * customer who has had one recognises the other. jsPDF loads on first use.
 */

import { formatDayKey } from "./format.ts";
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
    bill: "MONTHLY BILL", summary: "MONTH END", billedTo: "Billed to", vehicle: "Vehicle",
    period: "Period", days: "days", day: "day", parking: "Parking", priorUnpaid: "Unpaid from before",
    paid: "Paid", balanceDue: "Balance due", paidInFull: "Paid in full", stillParked: "Still parked",
    left: "Left", carsOnLot: "Cars on the lot", carsOwing: "Still owing", billed: "Billed",
    collected: "Collected", owed: "Still owed", whoOwes: "Who still owes", customer: "Customer",
    due: "Due", none: "Nobody owes anything for this month.", soFar: "so far",
    car: "Car", amount: "Amount", to: "to", activities: "Activities", date: "Date", activity: "Activity", item: "item", items: "items", paidToward: "Paid toward", dueLabel: "due", paidLabel: "paid", olderItems: "Unpaid from before", registeredTo: "registered to", monthTotal: "Total for the month", cars: "cars",
    footer: "Issued through Laawol Digital · laawoldigital.com",
    estimate: "Estimate · whole month",
    expensesPaid: "Expenses you paid for the lot", expense: "Expense", lessExpenses: "Less expenses",
    earlierExpenses: "Expenses from earlier months",
    lessStaffExpenses: "Less staff expenses", businessOwes: "Business owes",
    parkingBill: "Parking bill", noParkingBill: "No parking bill",
  },
  fr: {
    bill: "FACTURE MENSUELLE", summary: "FIN DE MOIS", billedTo: "Facturé à", vehicle: "Véhicule",
    period: "Période", days: "jours", day: "jour", parking: "Parking", priorUnpaid: "Impayé des mois précédents",
    paid: "Payé", balanceDue: "Solde dû", paidInFull: "Payé en totalité", stillParked: "Toujours garée",
    left: "Partie", carsOnLot: "Voitures au parking", carsOwing: "Doivent encore", billed: "Facturé",
    collected: "Encaissé", owed: "Encore dû", whoOwes: "Qui doit encore", customer: "Client",
    due: "Dû", none: "Personne ne doit rien pour ce mois.", soFar: "à ce jour",
    car: "Voiture", amount: "Montant", to: "au", activities: "Activités", date: "Date", activity: "Activité", item: "élément", items: "éléments", paidToward: "Payé pour", dueLabel: "dû", paidLabel: "payé", olderItems: "Impayé des mois précédents", registeredTo: "enregistrée au nom de", monthTotal: "Total du mois", cars: "voitures",
    footer: "Émis via Laawol Digital · laawoldigital.com",
    estimate: "Estimation · mois entier",
    expensesPaid: "Dépenses que vous avez payées pour le parc", expense: "Dépense", lessExpenses: "Moins les dépenses",
    earlierExpenses: "Dépenses des mois précédents",
    lessStaffExpenses: "Dépenses équipe", businessOwes: "L’entreprise doit",
    parkingBill: "Facture de parking", noParkingBill: "Pas de facture de parking",
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

type RGB = [number, number, number];

/** One line of the bill's totals block: its label on the left and its
 * amount on the right, both drawn on the same baseline `y`. */
export type BillTotalRow = { label: string; value: string; y: number; color: RGB; bold: boolean };

/** Where the totals block draws, from `top` down: each row's baseline, the
 * rule above the balance, and where the block ends. */
export type BillTotalsLayout = { rows: BillTotalRow[]; ruleY: number; endY: number };

/**
 * The bill's totals block, laid out from `top` (pure; no page breaks - the
 * caller makes room for `endY - top` first). Total for the month, Unpaid
 * from before, what each payment went toward, Less expenses, the rule,
 * then Balance due (or Paid in full). Every amount shares its label's y.
 */
export function billTotalsLayout(c: ParkingMonthCustomer, language: Lang, top: number): BillTotalsLayout {
  const t = COPY[language];
  const day = (key: string) => formatDayKey(key, language);
  const rows: BillTotalRow[] = [];
  let y = top;
  const add = (label: string, value: string, color: RGB, step: number) => {
    rows.push({ label, value, y, color, bold: false });
    y += step;
  };
  add(t.monthTotal, moneyText(c.monthCents), INK, 18);
  if (c.priorUnpaidCents > 0) add(t.priorUnpaid, moneyText(c.priorUnpaidCents), DUE, 18);
  // Which item each payment went toward, not just a lump sum.
  for (const b of c.cars) {
    if (b.monthPaidCents > 0) add(`${t.paidToward} ${b.vehicle || t.car}`, `-${moneyText(b.monthPaidCents)}`, OK, 16);
  }
  for (const a of c.activities) {
    if (a.paidCents > 0) add(`${t.paidToward} ${a.label}${a.vehicle ? ` · ${a.vehicle}` : ""} (${day(a.date)})`, `-${moneyText(a.paidCents)}`, OK, 16);
  }
  if ((c.expenseCreditCents || 0) > 0) add(t.lessExpenses, `-${moneyText(c.expenseCreditCents)}`, OK, 16);
  const ruleY = y - 4;
  y += 14;
  rows.push(c.dueCents > 0
    ? { label: t.balanceDue, value: moneyText(c.dueCents), y, color: DUE, bold: true }
    : { label: t.paidInFull, value: moneyText(0), y, color: OK, bold: true });
  return { rows, ruleY, endY: y + 6 };
}

/** The slice of jsPDF the totals block draws with (a fake in tests). */
export type TotalsDoc = {
  setFont(name: string, style: string): TotalsDoc;
  setFontSize(size: number): TotalsDoc;
  setTextColor(r: number, g: number, b: number): TotalsDoc;
  setDrawColor(r: number, g: number, b: number): TotalsDoc;
  setLineWidth(w: number): TotalsDoc;
  line(x1: number, y1: number, x2: number, y2: number): TotalsDoc;
  text(text: string, x: number, y: number, options?: { align?: "right" }): TotalsDoc;
};

/** Draws a laid-out totals block: label and amount of a row at the row's y. */
export function drawBillTotals(doc: TotalsDoc, layout: BillTotalsLayout): void {
  for (const r of layout.rows) {
    if (r.bold) doc.setDrawColor(...INK).setLineWidth(1.2).line(M, layout.ruleY, R, layout.ruleY);
    doc.setFont("helvetica", r.bold ? "bold" : "normal").setFontSize(r.bold ? 12 : 10.5).setTextColor(...r.color);
    doc.text(r.label, M, r.y);
    doc.text(r.value, R, r.y, { align: "right" });
  }
}

export async function buildParkingMonthBillPdf(input: { business: Row; customer: ParkingMonthCustomer; language: Lang; estimate?: boolean }): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const t = COPY[input.language];
  const day = (key: string) => formatDayKey(key, input.language);
  const c = input.customer;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const items = c.cars.length + c.activities.length;
  const billTitle = monthLabel(c.monthKey, input.language) + (input.estimate ? ` · ${t.estimate}` : "");
  let y = await header(doc, input.business, t.bill, billTitle, `${items} ${items === 1 ? t.item : t.items}`);

  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED).text(t.billedTo.toUpperCase(), M, y);
  doc.setFontSize(13).setTextColor(...INK).text(c.customerName || "—", M, y + 16);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...MUTED);
  const who = [c.customerPhone, c.customerEmail].filter(Boolean).join("  |  ");
  if (who) doc.text(who, M, y + 30);
  y += 50;

  const colMid = M + 220;
  const colRate = R - 90;
  const room = (need: number) => {
    if (y + need > 792 - 70) {
      footer(doc, input.language);
      doc.addPage();
      y = M;
    }
  };
  const section = (title: string, first: string, mid: string, rate: string) => {
    room(60);
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...BRAND).text(title, M, y);
    y += 14;
    doc.setFontSize(8).setTextColor(...MUTED);
    doc.text(first.toUpperCase(), M, y);
    doc.text(mid.toUpperCase(), colMid, y);
    if (rate) doc.text(rate.toUpperCase(), colRate, y, { align: "right" });
    doc.text(t.amount.toUpperCase(), R, y, { align: "right" });
    y += 6;
    doc.setDrawColor(230, 233, 232).setLineWidth(1).line(M, y, R, y);
    y += 15;
  };
  const line = (title: string, mid: string, rate: string, amount: string, sub: string) => {
    room(34);
    doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...INK).text((doc.splitTextToSize(title, colMid - M - 10) as string[])[0], M, y);
    doc.setFont("helvetica", "normal").setFontSize(10).text(mid, colMid, y);
    if (rate) doc.text(rate, colRate, y, { align: "right" });
    doc.setFont("helvetica", "bold").text(amount, R, y, { align: "right" });
    let ly = y + 12;
    if (sub) {
      doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(...MUTED).text((doc.splitTextToSize(sub, R - M) as string[])[0], M, ly);
      ly += 8;
    }
    doc.setDrawColor(236, 238, 237).setLineWidth(0.5).line(M, ly, R, ly);
    y = ly + 15;
  };
  // What each item stands at: paid toward it, still due on it.
  const standing = (paid: number, due: number) =>
    [paid > 0 ? `${moneyText(paid)} ${t.paidLabel}` : "", due > 0 ? `${moneyText(due)} ${t.dueLabel}` : ""].filter(Boolean).join(" · ");

  if (c.cars.length) {
    section(t.parking, t.car, t.period, `${t.days} ×`);
    for (const b of c.cars) {
      line(b.vehicle || t.car, `${day(b.periodFrom)} ${t.to} ${day(b.periodTo)}`, `${b.days} × ${moneyText(b.dayRateCents)}`, moneyText(b.monthCents),
        [b.vinNumber ? `VIN ${b.vinNumber}` : "", b.registeredTo ? `${t.registeredTo} ${b.registeredTo}` : "", b.stillParked ? t.stillParked : t.left,
          b.priorUnpaidCents > 0 ? `+ ${moneyText(b.priorUnpaidCents)} ${t.priorUnpaid.toLowerCase()}` : "",
          standing(b.monthPaidCents, b.monthUnpaidCents + b.priorUnpaidCents)].filter(Boolean).join("  ·  "));
    }
  }
  if (c.activities.length) {
    section(t.activities, t.activity, t.date, "");
    for (const a of c.activities) {
      line(`${a.label}${a.vehicle ? ` · ${a.vehicle}` : ""}`, day(a.date), "", moneyText(a.feeCents),
        [a.vinNumber ? `VIN ${a.vinNumber}` : "", a.registeredTo ? `${t.registeredTo} ${a.registeredTo}` : "", standing(a.paidCents, a.dueCents)].filter(Boolean).join("  ·  "));
    }
  }
  if (c.olderActivities.length) {
    section(t.olderItems, t.activity, t.date, "");
    for (const a of c.olderActivities) {
      line(`${a.label}${a.vehicle ? ` · ${a.vehicle}` : ""}`, day(a.date), "", moneyText(a.dueCents),
        [a.vinNumber ? `VIN ${a.vinNumber}` : "", a.registeredTo ? `${t.registeredTo} ${a.registeredTo}` : "", standing(a.paidCents, a.dueCents)].filter(Boolean).join("  ·  "));
    }
  }

  // A linked staff member's lot expenses (docs/STAFF_EXPENSE_CREDIT.md).
  // This month's, each as its expense line's name then its note, and the
  // earlier months' part of the credit, so the lines add up to "Less
  // expenses".
  const credited = (c.expenseCreditCents || 0) > 0;
  const earlier = credited ? c.earlierExpenseCents || 0 : 0;
  if (credited && ((c.expenseLines || []).length || earlier > 0)) {
    section(t.expensesPaid, t.expense, t.date, "");
    for (const l of c.expenseLines || []) {
      line(l.label || t.expense, l.date ? day(l.date) : "", "", `-${moneyText(l.amountCents)}`, l.staffName);
    }
    if (earlier > 0) line(t.earlierExpenses, "", "", `-${moneyText(earlier)}`, "");
  }

  // The totals block is laid out whole (each amount on its label's line)
  // and kept on one page.
  let totals = billTotalsLayout(c, input.language, y + 4);
  if (totals.endY > 792 - 70) {
    room(totals.endY - y);
    totals = billTotalsLayout(c, input.language, y + 4);
  }
  drawBillTotals(doc as unknown as TotalsDoc, totals);

  footer(doc, input.language);
  return doc.output("blob");
}

export async function buildParkingMonthSummaryPdf(input: {
  business: Row;
  summary: ParkingMonthSummary;
  language: Lang;
  estimate?: boolean;
  /** customerKey -> the linked customer's name, for "Business owes" rows
   * whose customer has no bill this month. */
  linkedCustomerNames?: Record<string, string>;
}): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const t = COPY[input.language];
  const s = input.summary;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const summaryTitle = monthLabel(s.monthKey, input.language) + (input.estimate ? ` · ${t.estimate}` : "");
  let y = await header(doc, input.business, t.summary, summaryTitle, t.parking);

  const stats: Array<[string, string, [number, number, number]]> = [
    [t.carsOnLot, String(s.carsOnLot), INK],
    [t.billed, moneyText(s.billedCents), INK],
    [t.collected, moneyText(s.collectedCents), OK],
    ...((s.expenseCreditCents || 0) > 0
      ? [[t.lessStaffExpenses, `-${moneyText(s.expenseCreditCents)}`, OK] as [string, string, [number, number, number]]]
      : []),
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
      .text((doc.splitTextToSize(`${b.customerPhone}${b.customerPhone ? " · " : ""}${[...b.cars.map((car) => car.vehicle), ...b.activities.map((x) => x.label), ...b.olderActivities.map((x) => x.label)].join(", ")}`, R - 80 - (M + 150)) as string[])[0], M + 150, y);
    doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...DUE).text(moneyText(b.dueCents), R, y, { align: "right" });
    y += 6;
    doc.setDrawColor(236, 238, 237).setLineWidth(0.5).line(M, y, R, y);
    y += 14;
  }
  // Staff the business still owes for lot expenses they paid.
  const owes = s.businessOwes || [];
  if (owes.length > 0) {
    if (y > 792 - 120) {
      footer(doc, input.language);
      doc.addPage();
      y = M;
    }
    y += 14;
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED)
      .text(`${t.businessOwes.toUpperCase()} (${owes.length}) · ${moneyText(s.businessOwesCents)}`, M, y);
    y += 8;
    doc.setDrawColor(230, 233, 232).setLineWidth(1).line(M, y, R, y);
    y += 16;
    for (const o of owes) {
      if (y > 792 - 80) {
        footer(doc, input.language);
        doc.addPage();
        y = M;
      }
      const bill = s.customers.find((c) => c.key === o.customerKey);
      const linked = bill?.customerName || (o.customerKey ? input.linkedCustomerNames?.[o.customerKey] ?? "" : "");
      doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...INK).text(o.staffName || "—", M, y);
      doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED)
        .text(linked ? `${t.parkingBill}: ${linked}` : t.noParkingBill, M + 150, y);
      doc.setFont("helvetica", "bold").setFontSize(10.5).setTextColor(...DUE).text(moneyText(o.owedCents), R, y, { align: "right" });
      y += 6;
      doc.setDrawColor(236, 238, 237).setLineWidth(0.5).line(M, y, R, y);
      y += 14;
    }
  }
  footer(doc, input.language);
  return doc.output("blob");
}

export function parkingMonthFileName(kind: "bill" | "summary", monthKey: string, who: string, business: string): string {
  const slug = (v: string) => v.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return [kind === "bill" ? "parking-bill" : "parking-month-end", monthKey, slug(who), slug(business)].filter(Boolean).join("-") + ".pdf";
}
