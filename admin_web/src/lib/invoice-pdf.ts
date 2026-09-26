/**
 * The paper: an invoice or receipt as a PDF file, built in the browser and
 * handed to the share sheet or the downloads folder. It wears the business's
 * identity - logo when one can be fetched, name, address, contact - and says
 * "Invoice" while money is owed and "Receipt" once it is not. Cost and margin
 * never appear; only what the customer is being asked for.
 *
 * jsPDF is loaded on first use so the console's main bundle never carries it.
 */

import {
  invoiceDayKey,
  invoiceTotals,
  moneyText,
  INVOICE_PAYMENT_METHOD_LABELS,
  type InvoicePaymentMethod,
} from "./invoice-ledger.ts";

type Row = Record<string, unknown>;
const text = (value: unknown, max = 200) => String(value ?? "").trim().slice(0, max);

export type InvoicePdfInput = {
  business: Row;
  invoice: Row;
  lines: readonly Row[];
  payments: readonly Row[];
  /** "en" or "fr": the paper reads in the business's language. */
  language: "en" | "fr";
};

const COPY = {
  en: {
    invoice: "INVOICE", receipt: "RECEIPT", billedTo: "Billed to", date: "Date",
    due: "Due", paidOn: "Paid on", description: "Description", qty: "Qty",
    each: "Each", amount: "Amount", total: "Total", paid: "Paid",
    balanceDue: "Balance due", paidInFull: "Paid in full", notes: "Notes",
    payments: "Payments received", issuedBy: "Issued by", customer: "Customer",
    footer: "Issued through Laawol Digital · laawoldigital.com",
  },
  fr: {
    invoice: "FACTURE", receipt: "REÇU", billedTo: "Facturé à", date: "Date",
    due: "Échéance", paidOn: "Payé le", description: "Description", qty: "Qté",
    each: "Unité", amount: "Montant", total: "Total", paid: "Payé",
    balanceDue: "Solde dû", paidInFull: "Payé en totalité", notes: "Notes",
    payments: "Paiements reçus", issuedBy: "Émis par", customer: "Client",
    footer: "Émis via Laawol Digital · laawoldigital.com",
  },
} as const;

export function businessAddressText(business: Row): string {
  const line1 = text(business.addressLine1, 160);
  const line2 = text(business.addressLine2, 160);
  const region = [text(business.city, 80), text(business.state, 40)].filter(Boolean).join(", ");
  const tail = [region, text(business.postalCode, 20)].filter(Boolean).join(" ");
  return [line1, line2, tail, text(business.country, 80)].filter(Boolean).join(", ");
}

export function invoiceFileName(invoice: Row, business: Row): string {
  const slug = (v: unknown) => text(v, 60).replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const kind = text(invoice.status, 20) === "paid" ? "receipt" : "invoice";
  return [kind, slug(invoice.number), slug(invoice.customerName), slug(business.name)].filter(Boolean).join("-") + ".pdf";
}

/** The logo as a data URL, or "" when it cannot be fetched (CORS, offline). */
async function fetchLogo(url: string): Promise<{ data: string; type: "PNG" | "JPEG" } | null> {
  if (!/^https:\/\//.test(url)) return null;
  try {
    const res = await fetch(url, { mode: "cors" });
    if (!res.ok) return null;
    const blob = await res.blob();
    const type = blob.type.includes("png") ? "PNG" : blob.type.includes("jpeg") || blob.type.includes("jpg") ? "JPEG" : null;
    if (!type) return null;
    const data = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
    return { data, type };
  } catch {
    return null;
  }
}

export async function buildInvoicePdf(input: InvoicePdfInput): Promise<Blob> {
  const { jsPDF } = await import("jspdf");
  const t = COPY[input.language];
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const W = 612;
  const M = 48;
  const R = W - M;
  const INK: [number, number, number] = [18, 33, 31];
  const MUTED: [number, number, number] = [91, 107, 104];
  const BRAND: [number, number, number] = [13, 148, 136];
  const DUE: [number, number, number] = [146, 64, 14];
  const OK: [number, number, number] = [22, 101, 52];

  const business = input.business;
  const invoice = input.invoice;
  const totals = invoiceTotals(input.lines, input.payments);
  const paid = totals.status === "paid";
  const name = text(business.name, 160) || "Laawol Digital";

  // Header: logo + identity on the left, kind + number on the right.
  let y = M;
  const logo = await fetchLogo(text(business.logoUrl, 500) || text(business.profileImageUrl, 500));
  let textX = M;
  if (logo) {
    try {
      doc.addImage(logo.data, logo.type, M, y, 44, 44);
      textX = M + 56;
    } catch {
      textX = M;
    }
  }
  doc.setTextColor(...INK).setFont("helvetica", "bold").setFontSize(16);
  doc.text(name, textX, y + 16);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(...MUTED);
  const address = businessAddressText(business);
  const contact = [text(business.phone, 40), text(business.email, 180)].filter(Boolean).join("  |  ");
  let sub = y + 30;
  for (const line of [address, contact].filter(Boolean)) {
    doc.text(doc.splitTextToSize(line, 300), textX, sub);
    sub += 12;
  }
  doc.setFont("helvetica", "bold").setFontSize(22).setTextColor(...BRAND);
  doc.text(paid ? t.receipt : t.invoice, R, y + 18, { align: "right" });
  doc.setFontSize(12).setTextColor(...INK);
  doc.text(text(invoice.number, 20), R, y + 36, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...MUTED);
  doc.text(text(invoice.title, 120), R, y + 50, { align: "right" });
  y = Math.max(sub, y + 58) + 8;
  doc.setDrawColor(...BRAND).setLineWidth(1.5).line(M, y, R, y);

  // Who and when.
  y += 22;
  doc.setFontSize(8).setTextColor(...MUTED).text(t.billedTo.toUpperCase(), M, y);
  doc.setFont("helvetica", "bold").setFontSize(13).setTextColor(...INK).text(text(invoice.customerName, 160) || "—", M, y + 16);
  doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...MUTED);
  const who = [text(invoice.customerPhone, 40), text(invoice.customerEmail, 180)].filter(Boolean).join("  |  ");
  if (who) doc.text(who, M, y + 30);
  const meta: Array<[string, string]> = [[t.date, invoiceDayKey(invoice.issuedOn)]];
  if (paid && invoiceDayKey(invoice.paidOn)) meta.push([t.paidOn, invoiceDayKey(invoice.paidOn)]);
  else if (invoiceDayKey(invoice.dueOn)) meta.push([t.due, invoiceDayKey(invoice.dueOn)]);
  let my = y;
  for (const [label, value] of meta) {
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(...MUTED).text(label.toUpperCase(), R - 110, my);
    doc.setFont("helvetica", "bold").setFontSize(10).setTextColor(...INK).text(value, R, my, { align: "right" });
    my += 16;
  }
  y = Math.max(y + 44, my + 6);

  // Lines.
  const colQty = R - 190;
  const colEach = R - 100;
  const header = () => {
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED);
    doc.text(t.description.toUpperCase(), M, y);
    doc.text(t.qty.toUpperCase(), colQty, y, { align: "right" });
    doc.text(t.each.toUpperCase(), colEach, y, { align: "right" });
    doc.text(t.amount.toUpperCase(), R, y, { align: "right" });
    y += 6;
    doc.setDrawColor(230, 233, 232).setLineWidth(1).line(M, y, R, y);
    y += 16;
  };
  header();
  const pageBottom = 792 - 72;
  for (const line of input.lines) {
    const desc = doc.splitTextToSize(text(line.description, 200), colQty - M - 60) as string[];
    const vin = text(line.vinNumber, 17);
    const height = desc.length * 12 + (vin ? 11 : 0) + 10;
    if (y + height > pageBottom) {
      doc.addPage();
      y = M;
      header();
    }
    doc.setFont("helvetica", "normal").setFontSize(10.5).setTextColor(...INK);
    doc.text(desc, M, y);
    const qty = Math.max(1, Math.trunc(Number(line.quantity) || 1));
    doc.text(String(qty), colQty, y, { align: "right" });
    doc.text(moneyText(line.unitPriceCents), colEach, y, { align: "right" });
    doc.setFont("helvetica", "bold").text(moneyText(line.amountCents), R, y, { align: "right" });
    let ly = y + desc.length * 12;
    if (vin) {
      doc.setFont("courier", "normal").setFontSize(8.5).setTextColor(...MUTED).text(`VIN ${vin}`, M, ly - 2);
      ly += 11;
    }
    doc.setDrawColor(236, 238, 237).setLineWidth(0.5).line(M, ly + 2, R, ly + 2);
    y = ly + 14;
  }

  // Totals.
  if (y + 90 > pageBottom) {
    doc.addPage();
    y = M;
  }
  const lx = R - 200;
  y += 4;
  const row = (label: string, value: string, opts: { bold?: boolean; color?: [number, number, number] } = {}) => {
    doc.setFont("helvetica", opts.bold ? "bold" : "normal").setFontSize(opts.bold ? 12 : 10)
      .setTextColor(...(opts.color ?? (opts.bold ? INK : MUTED)));
    doc.text(label, lx, y);
    doc.text(value, R, y, { align: "right" });
    y += opts.bold ? 20 : 15;
  };
  row(t.total, moneyText(totals.totalCents));
  if (totals.paidCents > 0) row(t.paid, `-${moneyText(totals.paidCents)}`, { color: OK });
  doc.setDrawColor(...INK).setLineWidth(1.2).line(lx, y - 8, R, y - 8);
  y += 6;
  if (paid) row(t.paidInFull, moneyText(0), { bold: true, color: OK });
  else row(t.balanceDue, moneyText(totals.balanceCents), { bold: true, color: DUE });

  // Payments, when any.
  const standing = input.payments.filter((p) => p.reverted !== true);
  if (standing.length > 0) {
    y += 8;
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED).text(t.payments.toUpperCase(), M, y);
    y += 14;
    doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...INK);
    for (const p of standing) {
      if (y > pageBottom) {
        doc.addPage();
        y = M;
      }
      const method = INVOICE_PAYMENT_METHOD_LABELS[text(p.method, 40) as InvoicePaymentMethod] ?? text(p.method, 40);
      doc.text(`${invoiceDayKey(p.paidOn)}  ·  ${method}${text(p.note) ? `  ·  ${text(p.note, 80)}` : ""}`, M, y);
      doc.text(moneyText(p.amountCents), R, y, { align: "right" });
      y += 14;
    }
  }

  // Notes.
  const notes = text(invoice.notes, 1000);
  if (notes) {
    y += 10;
    if (y > pageBottom - 40) {
      doc.addPage();
      y = M;
    }
    doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(...MUTED).text(t.notes.toUpperCase(), M, y);
    y += 13;
    doc.setFont("helvetica", "normal").setFontSize(9.5).setTextColor(...INK);
    const wrapped = doc.splitTextToSize(notes, R - M) as string[];
    doc.text(wrapped, M, y);
    y += wrapped.length * 12;
  }

  // Signatures and footer on the last page.
  y = Math.max(y + 40, pageBottom - 60);
  if (y > pageBottom - 10) {
    doc.addPage();
    y = pageBottom - 60;
  }
  const half = (R - M - 24) / 2;
  for (const [x, who, label] of [[M, name, t.issuedBy], [M + half + 24, text(invoice.customerName, 160), t.customer]] as Array<[number, string, string]>) {
    doc.setFont("helvetica", "normal").setFontSize(10).setTextColor(...INK).text(who, x, y);
    doc.setDrawColor(...INK).setLineWidth(0.7).line(x, y + 6, x + half, y + 6);
    doc.setFontSize(8).setTextColor(...MUTED).text(label, x, y + 18);
  }
  doc.setFontSize(8).setTextColor(...MUTED).text(t.footer, W / 2, 792 - 30, { align: "center" });

  return doc.output("blob");
}

/**
 * Hand the file over: the share sheet where there is one (a phone), else the
 * downloads folder. Returns which happened, so the caller can say so.
 */
export async function deliverPdf(blob: Blob, fileName: string): Promise<"shared" | "downloaded"> {
  const file = new File([blob], fileName, { type: "application/pdf" });
  const nav = navigator as Navigator & { canShare?: (data: ShareData) => boolean };
  if (typeof nav.share === "function" && typeof nav.canShare === "function" && nav.canShare({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: fileName });
      return "shared";
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") return "shared";
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
  return "downloaded";
}
