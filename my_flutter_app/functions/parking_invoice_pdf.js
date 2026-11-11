"use strict";

/**
 * The monthly invoice PDF a parking customer gets on WhatsApp
 * (docs/PARKING_INVOICES.md §1.3). It is the SAME design as the receipt
 * (`parking_receipt_pdf.js`): its header, status pill, label / value rows,
 * shaded box, footer, colours and logo handling are the receipt module's own
 * drawing helpers, not a copy. What is particular to an invoice is the body:
 * one line per car (car, VIN, days x rate = the month's amount), the month's
 * lot activities, "Unpaid from before", payments received, "Less expenses"
 * (a linked staff member's lot expenses, with the earlier months' part), the
 * shaded Balance due box and the owner's payment instructions.
 *
 * `invoiceModel` turns a month-end customer into the lines to print and is
 * pure; `renderInvoicePdf` draws them. Every label is English / French and
 * every date US style, month first.
 */

const {COLORS, documentLogo, formatBusinessAddress} =
  require("./parking_document");
const {
  drawFooter,
  drawHeader,
  drawRows,
  drawStatusPill,
  money,
  renderPdf,
  usDate,
  usDayKey,
} = require("./parking_receipt_pdf");
const {monthTextEn, monthTextFr} = require("./parking_invoices");
const {dayKeyOf, monthDays} = require("./parking_month_statement");

const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const cents = (value) => {
  const n = Math.round(Number(value) || 0);
  return n > 0 ? n : 0;
};
const norm = (value) => text(value).toLowerCase().replace(/\s+/g, " ");

/**
 * @param {number} n A count.
 * @return {string} "1 day / jour" or "3 days / jours".
 */
function daysText(n) {
  return `${n} ${n === 1 ? "day / jour" : "days / jours"}`;
}

/**
 * The tables of a bill: one line per car and one per lot activity of the
 * month. Shared by the customer's invoice and the team member's statement.
 *
 * @param {object} c A month-end customer.
 * @param {string} customerName The name at the top of the document.
 * @return {object[]} Sections `{heading, head, lines}`.
 */
function billSections(c, customerName) {
  const displayedName = norm(customerName);
  const sections = [];
  const carLines = (c.cars || []).map((b) => {
    const registered = text(b.registeredTo, 120);
    const detail = [
      b.vinNumber ? `VIN / NIV ${text(b.vinNumber, 17).toUpperCase()}` : "",
      registered && norm(registered) !== displayedName ?
        `Registered to / Au nom de ${registered}` : "",
    ].filter(Boolean).join("  ·  ");
    const days = Math.max(1, Math.round(Number(b.days) || 1));
    return {
      title: text(b.vehicle, 120) || "Car / Voiture",
      detail,
      period: [usDayKey(b.periodFrom), usDayKey(b.periodTo)]
          .filter(Boolean).join(" – "),
      calc: `${daysText(days)} × ${money(b.dayRateCents)}`,
      amount: money(b.monthCents),
    };
  });
  if (carLines.length) {
    sections.push({
      heading: "Parking / Stationnement",
      head: ["Vehicle / Véhicule", "Period / Période", "Amount / Montant"],
      lines: carLines,
    });
  }
  const activityLine = (a, amountCents) => ({
    title: text(a.label, 120) || "Activity / Activité",
    detail: text(a.vehicle, 120),
    period: usDayKey(a.date),
    calc: "",
    amount: money(amountCents),
  });
  const activities = (c.activities || []).map((a) =>
    activityLine(a, a.feeCents));
  if (activities.length) {
    sections.push({
      heading: "Activities / Activités",
      head: ["Activity / Activité", "Date", "Amount / Montant"],
      lines: activities,
    });
  }

  return sections;
}

/**
 * The money rows every bill starts with: the month's total, what was unpaid
 * from before (itemized), payments received.
 *
 * @param {object} c A month-end customer.
 * @param {string} monthEn "October 2026".
 * @param {string} monthFr "octobre 2026".
 * @return {object[]} Summary rows `{label, value, tone, sub}`.
 */
function billSummary(c, monthEn, monthFr) {
  const summary = [{
    label: `Total for ${monthEn} / Total pour ${monthFr}`,
    value: money(c.monthCents),
    tone: "",
    sub: [],
  }];
  if (cents(c.priorUnpaidCents) > 0) {
    summary.push({
      label: "Unpaid from before / Impayé des mois précédents",
      value: money(c.priorUnpaidCents),
      tone: "due",
      sub: [
        // Cars still here this month whose earlier months are unpaid: that
        // money is in the total, so it is listed too (else a customer saw
        // $2,278 "from before" with only $586 explained).
        ...(c.cars || []).filter((b) => cents(b.priorUnpaidCents) > 0)
            .map((b) => ({
              label: ["Earlier months / Mois précédents",
                "Parking / Stationnement", text(b.vehicle, 80)]
                  .filter(Boolean).join(" · "),
              value: money(b.priorUnpaidCents),
            })),
        // Cars that left before the month still owing (PARKING_CARRYOVER.md).
        ...(c.olderCars || []).map((b) => ({
          label: [`${usDayKey(b.periodFrom)} – ${usDayKey(b.periodTo)}`,
            "Parking / Stationnement", text(b.vehicle, 80)]
              .filter(Boolean).join(" · "),
          value: money(b.dueCents),
        })),
        ...(c.olderActivities || []).map((a) => ({
          label: [usDayKey(a.date), text(a.label, 80), text(a.vehicle, 80)]
              .filter(Boolean).join(" · "),
          value: money(a.dueCents),
        })),
      ],
    });
  }
  if (cents(c.monthPaidCents) > 0) {
    summary.push({
      label: "Payments received / Paiements reçus",
      value: `-${money(c.monthPaidCents)}`,
      tone: "paid",
      sub: [],
    });
  }
  // An agreed discount is its own line (docs/PARKING_DISCOUNT.md).
  if (cents(c.monthDiscountCents) > 0) {
    summary.push({
      label: "Discount / Remise",
      value: `-${money(c.monthDiscountCents)}`,
      tone: "paid",
      sub: [],
    });
  }
  return summary;
}

/**
 * The lines of one invoice.
 *
 * @param {object} args {business: the businesses document (name, phone,
 *   email, logo, address fields), recipient: one of invoiceRecipients'
 *   recipients (its `customer` is the netted month-end customer),
 *   monthKey, issuedMs, paymentInstructions, timeZone?}.
 * @return {object} What to print: {title, reference, invoiceNumber,
 *   businessName, businessAddress, businessContact, logoUrl, status:
 *   {label, paidInFull}, rows: [{label, value}], sections: [{heading,
 *   head: string[], lines: [{title, detail, period, calc, amount}]}],
 *   summary: [{label, value, tone, sub: [{label, value}]}], balance:
 *   {label, value, note}, instructions: ?{label, text}, footer: string[]}.
 */
function invoiceModel(args) {
  const business = args?.business || {};
  const recipient = args?.recipient || {};
  const c = recipient.customer || {};
  const monthKey = text(args?.monthKey, 7) || text(c.monthKey, 7);
  const zone = args?.timeZone || "America/New_York";
  const due = cents(c.dueCents);
  const stillParked = recipient.stillParked === true;
  const paidUp = due <= 0;
  const name = text(business.name, 160) || "Laawol";
  const customerName = text(c.customerName || recipient.name, 120);
  const monthEn = monthTextEn(monthKey);
  const monthFr = monthTextFr(monthKey);

  const rows = [
    ["Customer / Client", customerName],
    ["Phone / Téléphone", text(c.customerPhone || recipient.phone, 40)],
    ["Invoice for / Facture du mois", `${monthEn} / ${monthFr}`],
    ["Invoice date / Date de la facture", usDate(args?.issuedMs, zone)],
  ].filter(([, value]) => value).map(([label, value]) => ({label, value}));

  const sections = billSections(c, customerName);
  const summary = billSummary(c, monthEn, monthFr);
  const credit = cents(c.expenseCreditCents);
  if (credit > 0) {
    const sub = (c.expenseLines || []).map((l) => ({
      label: [l.date ? usDayKey(l.date) : "",
        text(l.label, 100) || "Expense / Dépense",
        l.staffName ? `paid by / payé par ${l.staffName}` : ""]
          .filter(Boolean).join(" · "),
      value: `-${money(l.amountCents)}`,
    }));
    if (cents(c.earlierExpenseCents) > 0) {
      sub.push({label: "Expenses from earlier months / " +
        "Dépenses des mois précédents",
      value: `-${money(c.earlierExpenseCents)}`});
    }
    summary.push({
      label: "Less expenses you paid for the lot / " +
        "Moins les dépenses payées pour le parking",
      value: `-${money(credit)}`,
      tone: "paid",
      sub,
    });
  }

  const instructions = text(args?.paymentInstructions, 300);
  return {
    title: "INVOICE / FACTURE",
    reference: text(recipient.invoiceNumber, 40),
    invoiceNumber: text(recipient.invoiceNumber, 40),
    businessName: name,
    businessAddress: formatBusinessAddress({business, entry: {}}),
    businessContact: [text(business.phone, 40), text(business.email, 180)]
        .filter(Boolean).join("  |  "),
    logoUrl: documentLogo(business).url,
    status: {
      label: paidUp ? "PAID UP / À JOUR" : "PAYMENT DUE / À PAYER",
      paidInFull: paidUp,
    },
    rows,
    sections,
    summary,
    balance: {
      label: "BALANCE DUE / SOLDE À PAYER",
      value: money(due),
      note: paidUp && stillParked ?
        "Nothing is due. Your car is still parked: next month's parking " +
          "will be on your next invoice. / Rien à payer. Votre voiture " +
          "est toujours stationnée : le stationnement du mois prochain " +
          "sera sur votre prochaine facture." : "",
    },
    instructions: instructions ?
      {label: "How to pay / Comment payer", text: instructions} : null,
    footer: [
      "Thank you — please keep this invoice. / " +
        "Merci — veuillez conserver cette facture.",
      "Issued through Laawol Digital · laawoldigital.com",
    ],
  };
}

/**
 * The lines of one team member's STATEMENT (docs/PARKING_INVOICES.md
 * section 6): the same design as an invoice, with the money told the way
 * Month end tells it: the month's parking and lot jobs (itemized, plus
 * anything unpaid from before), less the expenses they paid for the lot,
 * plus the cash they hold for the business at the month's end, down to what
 * they owe the business (or what the business owes them).
 *
 * @param {object} args {business, recipient: one of invoiceRecipients'
 *   statement recipients (its `statement` holds the numbers), monthKey,
 *   issuedMs, paymentInstructions, timeZone?}.
 * @return {object} The same shape as invoiceModel.
 */
function staffStatementModel(args) {
  const business = args?.business || {};
  const recipient = args?.recipient || {};
  const st = recipient.statement || {};
  const c = recipient.customer || st.customer || {};
  const monthKey = text(args?.monthKey, 7) || text(st.monthKey, 7) ||
    text(c.monthKey, 7);
  const zone = args?.timeZone || "America/New_York";
  const owes = Math.round(Number(st.owesCents) || 0);
  const settled = owes === 0;
  const name = text(business.name, 160) || "Laawol";
  const memberName = text(st.name || recipient.name, 120);
  const monthEn = monthTextEn(monthKey);
  const monthFr = monthTextFr(monthKey);
  const days = monthDays(monthKey);
  const lastDay = days ? usDayKey(dayKeyOf(days.last)) : "";

  const rows = [
    ["Team member / Membre de l'équipe", memberName],
    ["Phone / Téléphone", text(recipient.phone || c.customerPhone, 40)],
    ["Statement for / Relevé du mois", `${monthEn} / ${monthFr}`],
    ["Statement date / Date du relevé", usDate(args?.issuedMs, zone)],
  ].filter(([, value]) => value).map(([label, value]) => ({label, value}));

  const sections = billSections(c, memberName);
  // The month's total, unpaid from before and payments received, exactly as
  // an invoice lists them...
  const summary = billSummary(c, monthEn, monthFr).map((row, index) =>
    index === 0 ? {...row, label: `Parking and lot jobs for ${monthEn} / ` +
      `Stationnement et travaux de ${monthFr}`} : row);
  // ...then what they come to, when more than the month's own total.
  const jobs = Math.round(Number(st.parkingJobsCents) || 0);
  if (summary.length > 1) {
    summary.push({
      label: "Parking and lot jobs to pay / " +
        "Stationnement et travaux à payer",
      value: money(jobs),
      tone: "",
      sub: [],
    });
  }
  const expenses = cents(st.expenseCents);
  if (expenses > 0) {
    const sub = (st.expenseLines || []).map((l) => ({
      label: [l.date ? usDayKey(l.date) : "",
        text(l.label, 100) || "Expense / Dépense"]
          .filter(Boolean).join(" · "),
      value: `-${money(l.amountCents)}`,
    }));
    if (cents(st.earlierExpenseCents) > 0) {
      sub.push({label: "Expenses from earlier months / " +
        "Dépenses des mois précédents",
      value: `-${money(st.earlierExpenseCents)}`});
    }
    summary.push({
      label: "Less expenses you paid for the lot / " +
        "Moins les dépenses payées pour le parking",
      value: `-${money(expenses)}`,
      tone: "paid",
      sub,
    });
  }
  const cash = Math.round(Number(st.cashHeldCents) || 0);
  if (cash !== 0) {
    summary.push({
      label: "Cash you hold for the business / " +
        "Argent que vous gardez pour l'entreprise",
      value: `${cash > 0 ? "+" : "-"}${money(Math.abs(cash))}`,
      tone: "",
      sub: [],
    });
  }

  const upTo = lastDay ? `Up to ${lastDay}. ` : "";
  const upToFr = lastDay ? `Jusqu'au ${lastDay}. ` : "";
  const stillParked = recipient.stillParked === true || st.stillParked === true;
  const instructions = text(args?.paymentInstructions, 300);
  return {
    title: "STATEMENT / RELEVÉ",
    reference: text(recipient.invoiceNumber, 40),
    invoiceNumber: text(recipient.invoiceNumber, 40),
    businessName: name,
    businessAddress: formatBusinessAddress({business, entry: {}}),
    businessContact: [text(business.phone, 40), text(business.email, 180)]
        .filter(Boolean).join("  |  "),
    logoUrl: documentLogo(business).url,
    status: {
      label: owes > 0 ? "YOU OWE / VOUS DEVEZ" : owes < 0 ?
        "THE BUSINESS OWES YOU / L'ENTREPRISE VOUS DOIT" :
        "SETTLED / À JOUR",
      paidInFull: owes <= 0,
    },
    rows,
    sections,
    summary,
    balance: {
      label: owes < 0 ? "THE BUSINESS OWES YOU / L'ENTREPRISE VOUS DOIT" :
        settled ? "BALANCE / SOLDE" :
          "YOU OWE THE BUSINESS / VOUS DEVEZ À L'ENTREPRISE",
      value: money(Math.abs(owes)),
      note: `${upTo}${stillParked ? "Your car is still parked: " : ""}` +
        "Later months will be on your next statement. / " +
        `${upToFr}${stillParked ? "Votre voiture est toujours " +
          "stationnée : " : ""}Les mois suivants seront sur votre prochain ` +
        "relevé.",
    },
    instructions: instructions && owes > 0 ?
      {label: "How to pay / Comment payer", text: instructions} : null,
    footer: [
      "Thank you. / Merci.",
      "Issued through Laawol Digital · laawoldigital.com",
    ],
  };
}

/**
 * Draws an invoice.
 *
 * @param {object} model From invoiceModel.
 * @param {object} [options] {compress, fetchLogo, logoTimeoutMs}: as
 *   renderPdf's (tests turn compression off and replace the logo fetch).
 * @return {Promise<Buffer>} The PDF.
 */
function renderInvoicePdf(model, options) {
  return renderPdf({
    title: `${/^STATEMENT/.test(model.title) ? "Statement" : "Invoice"} ` +
      model.reference,
    author: model.businessName,
    logoUrl: model.logoUrl,
  }, (doc, logo) => draw(doc, model, logo), options);
}

/**
 * Starts a new page when the next block does not fit, with a slim running
 * header so every page says whose invoice it is.
 *
 * @param {object} doc A PDFDocument.
 * @param {object} model From invoiceModel.
 * @param {number} y Where the next block would start.
 * @param {number} need The block's height.
 * @return {number} The y to draw at.
 */
function room(doc, model, y, need) {
  const bottom = doc.page.height - doc.page.margins.bottom;
  if (y + need <= bottom) return y;
  doc.addPage();
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const top = doc.page.margins.top;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink)
      .text(model.businessName, left, top, {width: width / 2,
        lineBreak: false});
  doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted)
      .text(`${model.title} · ${model.reference} (continued / suite)`,
          left + width / 2, top + 1, {width: width / 2, align: "right",
            lineBreak: false});
  doc.moveTo(left, top + 18).lineTo(left + width, top + 18)
      .lineWidth(1).strokeColor(COLORS.teal).stroke();
  return top + 30;
}

/**
 * One section's table: a heading, a column header, then a line per item.
 *
 * @param {object} doc A PDFDocument.
 * @param {object} model From invoiceModel.
 * @param {object} section One of its sections.
 * @param {number} y Where it starts.
 * @return {number} The y below the table.
 */
function drawSection(doc, model, section, y) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const right = left + width;
  const titleWidth = 215;
  const periodX = left + titleWidth + 12;
  const periodWidth = 150;
  const amountWidth = 78;
  const amountX = right - amountWidth;

  y = room(doc, model, y, 80);
  doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.teal)
      .text(section.heading, left, y, {width, lineBreak: false});
  y += 20;
  const heads = section.head;
  doc.font("Helvetica-Bold").fontSize(8).fillColor(COLORS.muted);
  doc.text(heads[0].toUpperCase(), left, y,
      {width: titleWidth, lineBreak: false});
  doc.text(heads[1].toUpperCase(), periodX, y,
      {width: periodWidth, lineBreak: false});
  doc.text(heads[2].toUpperCase(), amountX - 20, y,
      {width: amountWidth + 20, align: "right", lineBreak: false});
  y += 14;
  doc.moveTo(left, y).lineTo(right, y)
      .lineWidth(0.75).strokeColor(COLORS.hairline).stroke();

  for (const line of section.lines) {
    doc.font("Helvetica-Bold").fontSize(10.5);
    const titleHeight = doc.heightOfString(line.title,
        {width: titleWidth});
    doc.font("Helvetica").fontSize(8.5);
    const detailHeight = line.detail ?
      doc.heightOfString(line.detail, {width: titleWidth}) : 0;
    doc.font("Helvetica").fontSize(9);
    const periodHeight = (line.period ?
      doc.heightOfString(line.period, {width: periodWidth}) : 0) +
      (line.calc ? doc.heightOfString(line.calc, {width: periodWidth}) : 0);
    const height = Math.max(titleHeight + detailHeight, periodHeight, 14);
    y = room(doc, model, y, height + 16);
    doc.font("Helvetica-Bold").fontSize(10.5).fillColor(COLORS.ink)
        .text(line.title, left, y + 8, {width: titleWidth});
    if (line.detail) {
      doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.muted)
          .text(line.detail, left, y + 8 + titleHeight,
              {width: titleWidth});
    }
    let py = y + 8;
    for (const part of [line.period, line.calc]) {
      if (!part) continue;
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted)
          .text(part, periodX, py, {width: periodWidth});
      py = doc.y + 1;
    }
    doc.font("Helvetica-Bold").fontSize(11).fillColor(COLORS.ink)
        .text(line.amount, amountX - 20, y + 8,
            {width: amountWidth + 20, align: "right", lineBreak: false});
    y += height + 15;
    doc.moveTo(left, y).lineTo(right, y)
        .lineWidth(0.75).strokeColor(COLORS.hairline).stroke();
  }
  return y + 10;
}

const SUMMARY_VALUE_WIDTH = 110;

/**
 * The height the money rows take, so the summary and the Balance due box
 * can move to the next page together instead of leaving the box alone.
 *
 * @param {object} doc A PDFDocument.
 * @param {object} model From invoiceModel.
 * @return {number} Points.
 */
function summaryHeight(doc, model) {
  const width = doc.page.width - doc.page.margins.left -
    doc.page.margins.right;
  const labelWidth = width - SUMMARY_VALUE_WIDTH - 12;
  let total = 0;
  for (const item of model.summary) {
    doc.font("Helvetica-Bold").fontSize(10);
    total += doc.heightOfString(item.label, {width: labelWidth}) + 14;
    for (const sub of item.sub) {
      doc.font("Helvetica").fontSize(8.5);
      total += doc.heightOfString(sub.label, {width: labelWidth - 16}) + 5;
    }
    total += 2;
  }
  return total;
}

/**
 * The money rows under the tables: total for the month, unpaid from before,
 * payments, expenses (with their lines indented beneath).
 *
 * @param {object} doc A PDFDocument.
 * @param {object} model From invoiceModel.
 * @param {number} y Where they start.
 * @return {number} The y below them.
 */
function drawSummary(doc, model, y) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;
  const right = left + width;
  const valueWidth = SUMMARY_VALUE_WIDTH;
  const labelWidth = width - valueWidth - 12;
  const toneInk = (tone) => tone === "paid" ? COLORS.paidInk :
    tone === "due" ? COLORS.dueInk : COLORS.ink;
  for (const item of model.summary) {
    doc.font("Helvetica-Bold").fontSize(10);
    const height = doc.heightOfString(item.label, {width: labelWidth});
    y = room(doc, model, y, height + 16);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.ink)
        .text(item.label, left, y + 7, {width: labelWidth});
    doc.font("Helvetica-Bold").fontSize(11).fillColor(toneInk(item.tone))
        .text(item.value, right - valueWidth, y + 6,
            {width: valueWidth, align: "right", lineBreak: false});
    y += height + 14;
    for (const sub of item.sub) {
      doc.font("Helvetica").fontSize(8.5);
      const subHeight = doc.heightOfString(sub.label,
          {width: labelWidth - 16});
      y = room(doc, model, y, subHeight + 6);
      doc.font("Helvetica").fontSize(8.5).fillColor(COLORS.muted)
          .text(sub.label, left + 16, y, {width: labelWidth - 16});
      doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted)
          .text(sub.value, right - valueWidth, y,
              {width: valueWidth, align: "right", lineBreak: false});
      y += subHeight + 5;
    }
    y += 2;
    doc.moveTo(left, y).lineTo(right, y)
        .lineWidth(0.75).strokeColor(COLORS.hairline).stroke();
  }
  return y;
}

/**
 * @param {object} doc A PDFDocument.
 * @param {object} model From invoiceModel.
 * @return {number} The height of the Balance due box.
 */
function boxHeightOf(doc, model) {
  const width = doc.page.width - doc.page.margins.left -
    doc.page.margins.right;
  const noteHeight = model.balance.note ?
    (doc.font("Helvetica").fontSize(9).heightOfString(model.balance.note,
        {width: width - 36}) + 8) : 0;
  return 62 + noteHeight;
}

/**
 * @param {object} doc A PDFDocument.
 * @param {object} model From invoiceModel.
 * @param {?Buffer} logo The logo bytes, if any.
 */
function draw(doc, model, logo) {
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  let y = drawHeader(doc, model, logo);
  y = drawStatusPill(doc, y, model.status);
  y = drawRows(doc, model.rows, y);
  y += 18;
  for (const section of model.sections) {
    y = drawSection(doc, model, section, y);
  }
  // The money rows and the Balance due box stay together: when they do not
  // fit under the tables, both go to the next page.
  const boxHeight = boxHeightOf(doc, model);
  const usable = doc.page.height - doc.page.margins.top -
    doc.page.margins.bottom - 30;
  y = room(doc, model, y,
      Math.min(summaryHeight(doc, model) + 20 + boxHeight, usable));
  y = drawSummary(doc, model, y);

  // The shaded Balance due box, with the owner's payment instructions
  // under it.
  y += 20;
  y = room(doc, model, y, boxHeight + 20);
  doc.roundedRect(left, y, width, boxHeight, 9).fill(COLORS.box);
  const pad = 18;
  const paidUp = model.status.paidInFull;
  doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.muted)
      .text(model.balance.label, left + pad, y + 25,
          {width: width / 2 - pad, lineBreak: false});
  doc.font("Helvetica-Bold").fontSize(26)
      .fillColor(paidUp ? COLORS.paidInk : COLORS.dueInk)
      .text(model.balance.value, left + width / 2, y + 15,
          {width: width / 2 - pad, align: "right", lineBreak: false});
  if (model.balance.note) {
    doc.font("Helvetica").fontSize(9).fillColor(COLORS.muted)
        .text(model.balance.note, left + pad, y + 58, {width: width - 36});
  }
  y += boxHeight + 18;

  if (model.instructions) {
    doc.font("Helvetica").fontSize(10.5);
    const textHeight = doc.heightOfString(model.instructions.text, {width});
    y = room(doc, model, y, textHeight + 40);
    doc.font("Helvetica-Bold").fontSize(10).fillColor(COLORS.teal)
        .text(model.instructions.label, left, y, {width, lineBreak: false});
    doc.font("Helvetica").fontSize(10.5).fillColor(COLORS.ink)
        .text(model.instructions.text, left, y + 16, {width});
    y = doc.y + 18;
  }

  y = room(doc, model, y, 60);
  drawFooter(doc, model.footer, y);
}

module.exports = {
  invoiceModel,
  renderInvoicePdf,
  staffStatementModel,
};
