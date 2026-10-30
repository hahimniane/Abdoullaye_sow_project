"use strict";

/**
 * The receipt PDF a parked car's customer gets with every payment
 * (docs/PARKING_WHATSAPP.md §2). It is drawn to match the printable parking
 * document (`parking_document.js`, served by `/d`): the same header (the
 * business's logo, name, address and contact on the left; the document type
 * in brand teal and its number on the right), the thin teal rule, a status
 * pill, label / value rows with hairlines, the shaded amount box and the
 * footer note, in the same colours. Every label is English / French, like
 * the WhatsApp messages it rides with. Dates are US style, month first.
 *
 * `receiptModel` turns records into the lines to print and is pure;
 * `renderReceiptPdf` draws them. The only network use is the logo, fetched
 * with a short timeout and never allowed to fail a receipt.
 */

const PDFDocument = require("pdfkit");
const {
  COLORS,
  documentLogo,
  formatBusinessAddress,
} = require("./parking_document");

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

// Money counted into the business's own account, not a staff member's hands.
const BUSINESS_ACCOUNT_RECEIVER = "business_account";

const LOGO_TIMEOUT_MS = 3000;
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

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
 * A "YYYY-MM-DD" day key as a US date.
 *
 * @param {*} key The day key.
 * @return {string} "Oct 20, 2026", or "" for anything else.
 */
function usDayKey(key) {
  const value = text(key, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  return `${MONTHS[Number(value.slice(5, 7)) - 1]} ` +
    `${Number(value.slice(8, 10))}, ${value.slice(0, 4)}`;
}

/**
 * The lines of one receipt, the same rows the web document prints plus
 * what is particular to a payment.
 *
 * @param {object} args {business: {name, phone, email, logoUrl,
 *   profileImageUrl, address fields}, car, payment: {amountCents, method,
 *   receivedByName, receivedByStaffId, atMs, number}, balance:
 *   parkingBalanceNow's answer, timeZone?}.
 * @return {object} What to print: {title, reference, receiptNumber,
 *   businessName, businessAddress, businessContact, logoUrl, status:
 *   {label, paidInFull}, rows: [{label, value}], amount: {label, value},
 *   totals: [{label, value, tone}], footer: string[]}.
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
      .map((v) => text(v, 60)).filter(Boolean).join(" ");
  const method = METHOD_LABEL[text(payment.method, 40).toLowerCase()] ||
    METHOD_LABEL.other;
  const since = usDayKey(balance.sinceDayKey);
  const until = usDayKey(balance.leftDayKey);
  const customer = text(car.customerName || car.ownerName, 120);
  const rows = [
    ["Customer / Client", customer],
    ["Phone / Téléphone", text(car.customerPhone, 40)],
    ["Vehicle / Véhicule", vehicle],
    ["VIN / NIV", text(car.vinNumber, 17).toUpperCase()],
    ["Parked from / Stationné depuis", since],
    ["Parked until / Stationné jusqu'au", since ?
      (until || "Still parked / Toujours stationné") : ""],
    ["Tracking code / Code de suivi", code],
    ["Payment method / Mode de paiement", method],
    ["Payment received / Paiement reçu le", usDate(payment.atMs, zone)],
    ["Amount of this payment / Montant de ce paiement",
      money(payment.amountCents)],
  ];
  const byName = text(payment.receivedByName, 120);
  const received = text(payment.receivedByStaffId, 120) ===
    BUSINESS_ACCOUNT_RECEIVER ?
    "Business account / Compte de l'entreprise" : byName;
  rows.push(["Received by / Reçu par", received]);

  const paidInFull = balance.paidInFull === true;
  const name = text(business.name, 160) || "Laawol";
  return {
    title: "RECEIPT / REÇU",
    reference: `REC-${code}-${number}`,
    receiptNumber: `${code}-${number}`,
    businessName: name,
    businessAddress: formatBusinessAddress({business, entry: car}),
    businessContact: [text(business.phone, 40), text(business.email, 180)]
        .filter(Boolean).join("  |  "),
    logoUrl: documentLogo(business).url,
    status: {
      label: paidInFull ? "PAID / PAYÉ" : "PARTLY PAID / PAYÉ EN PARTIE",
      paidInFull,
    },
    rows: rows.filter(([, value]) => value)
        .map(([label, value]) => ({label, value})),
    amount: {label: "AMOUNT PAID / MONTANT PAYÉ",
      value: money(payment.amountCents)},
    totals: [
      {label: "Total paid so far / Total payé à ce jour",
        value: money(balance.paidCents)},
      paidInFull ?
        {label: "Balance / Solde", value: "Paid in full / Payé en totalité",
          tone: "paid"} :
        {label: "Balance owed / Solde à payer",
          value: money(balance.balanceCents), tone: "due"},
    ],
    footer: [
      "Thank you — this receipt confirms your payment. / " +
        "Merci — ce reçu confirme votre paiement.",
      "Issued through Laawol Digital · laawoldigital.com",
    ],
  };
}

// How many charges a bill receipt lists one by one before "and N more".
const BILL_RECEIPT_MAX_LINES = 12;

/**
 * The receipt of one month bill payment (docs/PARKING_BILL_PAYMENTS.md):
 * the same page as a car's receipt, listing what the money paid, oldest
 * first, with the bill's balance afterwards.
 *
 * @param {object} args `{business, payment, timeZone}`; `payment` is the
 *   parkingBillPayments document (`customerName, customerPhone, monthKey,
 *   amountCents, receivedVia, receivedByStaffId, receivedByName, atMs,
 *   number, parts: [{label, trackingCode, amountCents, full}], leftCents`).
 * @return {object} The model renderReceiptPdf draws.
 */
function billReceiptModel(args) {
  const payment = args?.payment || {};
  const business = args?.business || {};
  const zone = args?.timeZone || "America/New_York";
  const parts = Array.isArray(payment.parts) ? payment.parts : [];
  const method = METHOD_LABEL[text(payment.receivedVia, 40).toLowerCase()] ||
    METHOD_LABEL.other;
  const [year, month] = text(payment.monthKey, 7).split("-").map(Number);
  const monthText = year && month >= 1 && month <= 12 ?
    `${MONTHS[month - 1]} ${year}` : "";
  const rows = [
    ["Customer / Client", text(payment.customerName, 120)],
    ["Phone / Téléphone", text(payment.customerPhone, 40)],
    ["Bill / Facture", monthText],
    ["Payment method / Mode de paiement", method],
    ["Payment received / Paiement reçu le", usDate(payment.atMs, zone)],
  ];
  const received = text(payment.receivedByStaffId, 120) ===
    BUSINESS_ACCOUNT_RECEIVER ?
    "Business account / Compte de l'entreprise" :
    text(payment.receivedByName, 120);
  rows.push(["Received by / Reçu par", received]);
  const shown = parts.length > BILL_RECEIPT_MAX_LINES ?
    parts.slice(0, BILL_RECEIPT_MAX_LINES - 1) : parts;
  for (const part of shown) {
    const code = text(part.trackingCode, 40);
    const label = text(part.label, 80) || "Parking";
    rows.push([`${label}${code ? ` · ${code}` : ""}`,
      `${money(part.amountCents)}${part.full ?
        " · paid / payé" : ""}`]);
  }
  if (shown.length < parts.length) {
    const rest = parts.slice(shown.length);
    rows.push([`And ${rest.length} more / Et ${rest.length} autres`,
      money(rest.reduce((sum, p) => sum + (Number(p.amountCents) || 0), 0))]);
  }
  const leftCents = Math.max(0, Math.round(Number(payment.leftCents) || 0));
  const paidInFull = leftCents === 0;
  const number = Math.max(1, Math.round(Number(payment.number) || 1));
  const id = text(payment.id, 80);
  const name = text(business.name, 160) || "Laawol";
  return {
    title: "RECEIPT / REÇU",
    reference: `REC-${text(payment.monthKey, 7).replace("-", "")}-${
      id.slice(0, 6).toUpperCase()}`,
    receiptNumber: `${number}`,
    businessName: name,
    businessAddress: formatBusinessAddress({business, entry: {}}),
    businessContact: [text(business.phone, 40), text(business.email, 180)]
        .filter(Boolean).join("  |  "),
    logoUrl: documentLogo(business).url,
    status: {
      label: paidInFull ? "PAID / PAYÉ" : "PARTLY PAID / PAYÉ EN PARTIE",
      paidInFull,
    },
    rows: rows.filter(([, value]) => value)
        .map(([label, value]) => ({label, value})),
    amount: {label: "AMOUNT PAID / MONTANT PAYÉ",
      value: money(payment.amountCents)},
    totals: [
      {label: "Bill before this payment / Facture avant ce paiement",
        value: money(leftCents + (Number(payment.amountCents) || 0))},
      paidInFull ?
        {label: "Balance / Solde", value: "Paid in full / Payé en totalité",
          tone: "paid"} :
        {label: "Balance owed / Solde à payer", value: money(leftCents),
          tone: "due"},
    ],
    footer: [
      "Thank you — this receipt confirms your payment. / " +
        "Merci — ce reçu confirme votre paiement.",
      "Issued through Laawol Digital · laawoldigital.com",
    ],
  };
}

/**
 * Fetches a logo's bytes: https only, PNG or JPEG (all pdfkit can draw),
 * small, and quick. Resolves to null on any failure.
 *
 * @param {string} url The logo.
 * @param {number} timeoutMs Give up after this long.
 * @return {Promise<?Buffer>} The image, or null.
 */
async function fetchLogoBytes(url, timeoutMs = LOGO_TIMEOUT_MS) {
  if (!/^https:\/\//i.test(String(url || ""))) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {signal: controller.signal});
    if (!response.ok) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= LOGO_MAX_BYTES ? bytes : null;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Runs the logo fetch under a hard deadline, whatever the fetcher does.
 *
 * @param {function(string): Promise<?Buffer>} fetchLogo The fetcher.
 * @param {string} url The logo.
 * @param {number} timeoutMs The deadline.
 * @return {Promise<?Buffer>} The image, or null on failure or timeout.
 */
async function logoWithin(fetchLogo, url, timeoutMs) {
  let timer;
  const deadline = new Promise((resolve) => {
    timer = setTimeout(() => resolve(null), timeoutMs);
  });
  try {
    const bytes = await Promise.race([
      Promise.resolve().then(() => fetchLogo(url)), deadline,
    ]);
    return Buffer.isBuffer(bytes) && bytes.length > 0 ? bytes : null;
  } catch (error) {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Draws a document on the shared page (Letter, 48 pt margins, the logo
 * fetched under a hard deadline): the one place a PDF of this family is
 * started, so the receipt and the invoice cannot drift apart.
 *
 * @param {object} head {title, author, logoUrl}: the PDF's info and the
 *   logo to fetch.
 * @param {function(object, ?Buffer): void} paint Draws on the PDFDocument,
 *   given the logo bytes (or null).
 * @param {object} [options] {compress}: `compress: false` leaves the page
 *   content readable (tests). {fetchLogo(url)}: replaces the logo download.
 *   {logoTimeoutMs}: the logo deadline (3 seconds).
 * @return {Promise<Buffer>} The PDF.
 */
async function renderPdf(head, paint, {
  compress = true, fetchLogo = fetchLogoBytes,
  logoTimeoutMs = LOGO_TIMEOUT_MS,
} = {}) {
  const logo = head.logoUrl ?
    await logoWithin(fetchLogo, head.logoUrl, logoTimeoutMs) : null;
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margin: 48,
      compress,
      info: {
        Title: head.title,
        Author: head.author,
        Producer: "Laawol Digital",
      },
    });
    const chunks = [];
    doc.on("data", (chunk) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      paint(doc, logo);
      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Draws a receipt.
 *
 * @param {object} model From receiptModel.
 * @param {object} [options] See renderPdf.
 * @return {Promise<Buffer>} The PDF.
 */
function renderReceiptPdf(model, options) {
  return renderPdf({
    title: `Receipt ${model.reference}`,
    author: model.businessName,
    logoUrl: model.logoUrl,
  }, (doc, logo) => draw(doc, model, logo), options);
}

/**
 * The business's mark: its logo in a rounded square, or, when there is no
 * usable image, the business's initial on a brand-teal square.
 *
 * @param {object} doc A PDFDocument.
 * @param {object} model From receiptModel.
 * @param {?Buffer} logo The image bytes, if any.
 * @param {number} x Left.
 * @param {number} y Top.
 * @param {number} size Side of the square.
 */
function drawLogo(doc, model, logo, x, y, size) {
  const radius = size * 0.2;
  if (logo) {
    try {
      doc.save();
      doc.roundedRect(x, y, size, size, radius).clip();
      doc.image(logo, x, y, {cover: [size, size], align: "center",
        valign: "center"});
      doc.restore();
      return;
    } catch (error) {
      doc.restore();
    }
  }
  doc.roundedRect(x, y, size, size, radius).fill(COLORS.teal);
  const initial = Array.from(model.businessName)[0]?.toUpperCase() || "L";
  doc.font("Helvetica-Bold").fontSize(size * 0.5).fillColor("#ffffff")
      .text(initial, x, y + size * 0.25, {width: size, align: "center",
        lineBreak: false});
}

/**
 * The header every document of the family starts with: the business's logo,
 * name, address and contact on the left, the document's title and number on
 * the right, then the thin teal rule.
 *
 * @param {object} doc A PDFDocument.
 * @param {object} model {businessName, businessAddress, businessContact,
 *   title, reference}.
 * @param {?Buffer} logo The logo bytes, if any.
 * @return {number} The y just below the rule.
 */
function drawHeader(doc, model, logo) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const right = left + width;
  const top = doc.page.margins.top;

  // The business on the left, the document on the right.
  const logoSize = 46;
  drawLogo(doc, model, logo, left, top, logoSize);
  const brandX = left + logoSize + 12;
  const titleWidth = 210;
  const brandWidth = width - logoSize - 12 - titleWidth - 12;
  let by = top + 2;
  doc.font("Helvetica-Bold").fontSize(15).fillColor(COLORS.ink)
      .text(model.businessName, brandX, by, {width: brandWidth});
  by = doc.y + 1;
  for (const line of [model.businessAddress, model.businessContact]) {
    if (!line) continue;
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted)
        .text(line, brandX, by, {width: brandWidth});
    by = doc.y + 1;
  }
  doc.font("Helvetica-Bold").fontSize(19).fillColor(COLORS.teal)
      .text(model.title, right - titleWidth, top + 2,
          {width: titleWidth, align: "right"});
  doc.font("Helvetica").fontSize(10).fillColor(COLORS.muted)
      .text(model.reference, right - titleWidth, doc.y + 3,
          {width: titleWidth, align: "right"});
  const y = Math.max(by, doc.y, top + logoSize) + 14;
  doc.moveTo(left, y).lineTo(right, y)
      .lineWidth(2).strokeColor(COLORS.teal).stroke();
  return y;
}

/**
 * The status pill under the header.
 *
 * @param {object} doc A PDFDocument.
 * @param {number} y Where the pill starts (below the rule).
 * @param {{label: string, paidInFull: boolean}} status The pill.
 * @return {number} The y below it, ready for the next block.
 */
function drawStatusPill(doc, y, status) {
  const left = doc.page.margins.left;
  const top = y + 18;
  const paid = status.paidInFull;
  doc.font("Helvetica-Bold").fontSize(10);
  const pillWidth = doc.widthOfString(status.label) + 28;
  doc.roundedRect(left, top, pillWidth, 22, 11)
      .fill(paid ? COLORS.paidBg : COLORS.dueBg);
  doc.fillColor(paid ? COLORS.paidInk : COLORS.dueInk)
      .text(status.label, left, top + 6, {width: pillWidth,
        align: "center", lineBreak: false});
  return top + 22 + 12;
}

/**
 * Label / value rows with a hairline under each.
 *
 * @param {object} doc A PDFDocument.
 * @param {Array<{label: string, value: string}>} rows The rows.
 * @param {number} y Where the first row starts.
 * @return {number} The y below the last hairline.
 */
function drawRows(doc, rows, y) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const right = left + width;
  const labelWidth = 250;
  const valueX = left + labelWidth + 12;
  const valueWidth = right - valueX;
  for (const row of rows) {
    doc.font("Helvetica-Bold").fontSize(9.5);
    const labelHeight = doc.heightOfString(row.label, {width: labelWidth});
    doc.font("Helvetica").fontSize(11);
    const valueHeight = doc.heightOfString(row.value, {width: valueWidth});
    const height = Math.max(labelHeight, valueHeight);
    doc.font("Helvetica-Bold").fontSize(9.5).fillColor(COLORS.muted)
        .text(row.label, left, y + 8 + (height - labelHeight) / 2,
            {width: labelWidth});
    doc.font("Helvetica").fontSize(11).fillColor(COLORS.ink)
        .text(row.value, valueX, y + 7 + (height - valueHeight) / 2,
            {width: valueWidth, align: "right"});
    y += height + 15;
    doc.moveTo(left, y).lineTo(right, y)
        .lineWidth(0.75).strokeColor(COLORS.hairline).stroke();
  }
  return y;
}

/**
 * The footer: a hairline, then the notes.
 *
 * @param {object} doc A PDFDocument.
 * @param {string[]} lines The notes.
 * @param {number} y Where the hairline goes.
 * @return {number} The y below the last note.
 */
function drawFooter(doc, lines, y) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  doc.moveTo(left, y).lineTo(left + width, y)
      .lineWidth(0.75).strokeColor(COLORS.hairline).stroke();
  y += 12;
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted);
  for (const line of lines) {
    doc.text(line, left, y, {width});
    y = doc.y + 3;
  }
  return y;
}

/**
 * @param {object} doc A PDFDocument.
 * @param {object} model From receiptModel.
 * @param {?Buffer} logo The logo bytes, if any.
 */
function draw(doc, model, logo) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const ink = COLORS.ink;
  const muted = COLORS.muted;

  let y = drawHeader(doc, model, logo);
  y = drawStatusPill(doc, y, model.status);
  y = drawRows(doc, model.rows, y);

  // The shaded amount box.
  y += 22;
  const boxHeight = 118;
  doc.roundedRect(left, y, width, boxHeight, 9).fill(COLORS.box);
  const pad = 18;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(muted)
      .text(model.amount.label, left + pad, y + 24,
          {width: width / 2 - pad, lineBreak: false});
  doc.font("Helvetica-Bold").fontSize(26).fillColor(ink)
      .text(model.amount.value, left + width / 2, y + 14,
          {width: width / 2 - pad, align: "right", lineBreak: false});
  let ty = y + 58;
  for (const total of model.totals) {
    doc.font("Helvetica").fontSize(10.5).fillColor(muted)
        .text(total.label, left + pad, ty,
            {width: width / 2, lineBreak: false});
    const tone = total.tone === "paid" ? COLORS.paidInk :
      total.tone === "due" ? COLORS.dueInk : ink;
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(tone)
        .text(total.value, left + width / 2, ty,
            {width: width / 2 - pad, align: "right", lineBreak: false});
    ty += 25;
  }
  y += boxHeight + 28;

  drawFooter(doc, model.footer, y);
}

module.exports = {
  METHOD_LABEL,
  billReceiptModel,
  drawFooter,
  drawHeader,
  drawLogo,
  drawRows,
  drawStatusPill,
  fetchLogoBytes,
  money,
  receiptModel,
  renderPdf,
  renderReceiptPdf,
  shortDay,
  usDate,
  usDayKey,
};
