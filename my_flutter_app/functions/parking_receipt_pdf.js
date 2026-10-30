"use strict";

/**
 * The receipt PDF a parked car's customer gets with every payment
 * (docs/PARKING_WHATSAPP.md §2): the business, a receipt number, the day,
 * the customer and car, this payment, what has been paid in all and what is
 * still owed (or PAID IN FULL). Every label is English / French, like the
 * WhatsApp messages it rides with. Dates are US style, month first.
 *
 * Pure: `receiptModel` turns records into the lines to print and
 * `renderReceiptPdf` draws them; no Firestore, Storage or network.
 */

const PDFDocument = require("pdfkit");

const MONTHS = Object.freeze([
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
]);

// How the money came in, in both languages.
const METHOD_LABEL = Object.freeze({
  cash: "Cash / Espèces",
  zelle: "Zelle",
  cashapp: "Cash App",
  venmo: "Venmo",
  check: "Check / Chèque",
  card_in_person: "Card in person / Carte en personne",
  card_link: "Card, payment link / Carte, lien de paiement",
  online: "Online / En ligne",
  other: "Other / Autre",
});

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

/**
 * @param {number} cents Whole cents.
 * @return {string} "$1,234.50".
 */
function money(cents) {
  const n = Math.round(Number(cents) || 0);
  const whole = Math.trunc(Math.abs(n) / 100).toLocaleString("en-US");
  const part = String(Math.abs(n) % 100).padStart(2, "0");
  return `${n < 0 ? "-" : ""}$${whole}.${part}`;
}

/**
 * A moment as a US date, month first, in the business's day.
 *
 * @param {number} ms Epoch milliseconds.
 * @param {string} [timeZone] IANA zone; New York when omitted.
 * @return {string} "Oct 29, 2026" ("" for no moment).
 */
function usDate(ms, timeZone = "America/New_York") {
  if (!Number.isFinite(Number(ms)) || Number(ms) <= 0) return "";
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, year: "numeric", month: "numeric", day: "numeric",
  }).formatToParts(new Date(Number(ms)));
  const get = (type) => Number(parts.find((p) => p.type === type)?.value);
  return `${MONTHS[get("month") - 1]} ${get("day")}, ${get("year")}`;
}

/**
 * "Oct 29" for a receipt's file name.
 *
 * @param {number} ms Epoch milliseconds.
 * @param {string} [timeZone] IANA zone; New York when omitted.
 * @return {string} The short day.
 */
function shortDay(ms, timeZone) {
  return usDate(ms, timeZone).replace(/, \d{4}$/, "");
}

/**
 * The lines of one receipt.
 *
 * @param {object} args {business: {name, phone}, car, payment: {amountCents,
 *   method, receivedByName, atMs, number}, balance: parkingBalanceNow's
 *   answer, timeZone?}.
 * @return {object} What to print: {title, businessName, businessPhone,
 *   receiptNumber, rows: [{label, value, strong?}], balanceRow: {label,
 *   value, paidInFull}, footer}.
 */
function receiptModel(args) {
  const car = args?.car && typeof args.car === "object" ? args.car : {};
  const payment = args?.payment || {};
  const balance = args?.balance || {};
  const business = args?.business || {};
  const zone = args?.timeZone || "America/New_York";
  const code = text(car.trackingCode, 40);
  const number = Math.max(1, Math.round(Number(payment.number) || 1));
  const vehicle = [car.carYear, car.carMake, car.carModel]
      .map((v) => text(v, 80)).filter(Boolean).join(" ");
  const vin = text(car.vinNumber, 17).toUpperCase();
  const method = METHOD_LABEL[text(payment.method, 40).toLowerCase()] ||
    METHOD_LABEL.other;
  const sinceKey = text(balance.sinceDayKey, 10);
  const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceKey) ?
    `${MONTHS[Number(sinceKey.slice(5, 7)) - 1]} ` +
      `${Number(sinceKey.slice(8, 10))}, ${sinceKey.slice(0, 4)}` : "";
  const rows = [
    {label: "Receipt no. / N° de reçu", value: `${code}-${number}`},
    {label: "Date / Date", value: usDate(payment.atMs, zone)},
    {label: "Customer / Client", value: text(car.customerName, 120) || "—"},
    {label: "Car / Voiture", value: vehicle || "—"},
  ];
  if (vin) rows.push({label: "VIN / NIV", value: vin});
  if (since) {
    rows.push({label: "Parked since / Stationné depuis", value: since});
  }
  if (Number(balance.dailyRateCents) > 0) {
    rows.push({label: "Daily rate / Tarif par jour",
      value: money(balance.dailyRateCents)});
  }
  rows.push(
      {label: "Days so far / Jours à ce jour",
        value: String(Math.max(0, Math.round(Number(balance.days) || 0)))},
      {label: "Parking to date / Stationnement à ce jour",
        value: money(balance.accruedCents)},
      {label: "This payment / Ce paiement", value: money(payment.amountCents),
        strong: true},
      {label: "Method / Mode de paiement", value: method},
  );
  const by = text(payment.receivedByName, 120);
  if (by) rows.push({label: "Received by / Reçu par", value: by});
  rows.push({label: "Total paid / Total payé",
    value: money(balance.paidCents)});
  const paidInFull = balance.paidInFull === true;
  return {
    title: "RECEIPT / REÇU",
    businessName: text(business.name, 120) || "Laawol",
    businessPhone: text(business.phone, 40),
    receiptNumber: `${code}-${number}`,
    rows,
    balanceRow: {
      label: paidInFull ? "Status / Statut" : "Balance owed / Solde à payer",
      value: paidInFull ? "PAID IN FULL / PAYÉ EN TOTALITÉ" :
        money(balance.balanceCents),
      paidInFull,
    },
    footer: "Issued through Laawol Digital · laawoldigital.com",
  };
}

/**
 * Draws a receipt.
 *
 * @param {object} model From receiptModel.
 * @param {object} [options] {compress}: `compress: false` leaves the page
 *   content readable (tests).
 * @return {Promise<Buffer>} The PDF.
 */
function renderReceiptPdf(model, {compress = true} = {}) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 54,
      compress,
      info: {
        Title: `Receipt ${model.receiptNumber}`,
        Author: model.businessName,
        Producer: "Laawol Digital",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      draw(doc, model);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * @param {object} doc A PDFDocument.
 * @param {object} model From receiptModel.
 */
function draw(doc, model) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.font("Helvetica-Bold").fontSize(20).fillColor("#111827")
      .text(model.businessName, left, 54, {width});
  if (model.businessPhone) {
    doc.font("Helvetica").fontSize(10).fillColor("#6b7280")
        .text(model.businessPhone, left, doc.y + 2, {width});
  }
  doc.font("Helvetica-Bold").fontSize(26).fillColor("#111827")
      .text(model.title, left, doc.y + 18, {width});
  doc.moveTo(left, doc.y + 8).lineTo(left + width, doc.y + 8)
      .lineWidth(1).strokeColor("#d1d5db").stroke();
  let y = doc.y + 22;
  const labelWidth = 230;
  for (const row of model.rows) {
    doc.font("Helvetica").fontSize(11).fillColor("#6b7280")
        .text(row.label, left, y, {width: labelWidth});
    doc.font(row.strong ? "Helvetica-Bold" : "Helvetica").fontSize(11)
        .fillColor("#111827")
        .text(row.value, left + labelWidth + 10, y,
            {width: width - labelWidth - 10, align: "right"});
    y = Math.max(doc.y, y + 14) + 7;
  }
  doc.moveTo(left, y).lineTo(left + width, y)
      .lineWidth(1).strokeColor("#d1d5db").stroke();
  y += 14;
  const paid = model.balanceRow.paidInFull;
  doc.font("Helvetica-Bold").fontSize(13).fillColor("#111827")
      .text(model.balanceRow.label, left, y, {width: labelWidth});
  doc.font("Helvetica-Bold").fontSize(13)
      .fillColor(paid ? "#047857" : "#b91c1c")
      .text(model.balanceRow.value, left + labelWidth + 10, y,
          {width: width - labelWidth - 10, align: "right"});
  doc.font("Helvetica").fontSize(9).fillColor("#6b7280")
      .text(model.footer, left, doc.page.height - 80, {width, align: "center"});
}

module.exports = {
  METHOD_LABEL,
  money,
  receiptModel,
  renderReceiptPdf,
  shortDay,
  usDate,
};
