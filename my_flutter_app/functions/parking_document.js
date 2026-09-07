"use strict";

// Printable parking documents: an INVOICE while money is owed, a RECEIPT once
// it has been paid. Both are server-rendered HTML at a stable URL rather than
// a generated PDF binary, for three reasons:
//   * every platform can already print HTML to PDF (browser print dialog on
//     web, the OS share sheet on iOS/Android), so one implementation covers
//     both clients and needs no PDF library or binary storage;
//   * the document stays live - a receipt reflects the payment as recorded,
//     instead of freezing whatever was true the moment a file was written;
//   * it can be handed to a customer as a link (WhatsApp, email, SMS) with no
//     attachment plumbing.
// The decision of WHICH document a record should produce is pure and tested
// here; the HTML is a plain template with print CSS.

const LOGO_URL = "https://laawoldigital.com/assets/logo.png";

/**
 * The logo a document prints in its header: the business's own when it has
 * uploaded one (an https URL only - a document is public HTML), else the
 * Laawol mark. Both logos on the same sheet would read as co-branding the
 * business never asked for, so the platform mark moves to the footer.
 * @param {Object} business A businesses document.
 * @return {{url: string, own: boolean}} The logo to print.
 */
function documentLogo(business) {
  const org = business && typeof business === "object" ? business : {};
  const own = text(org.logoUrl || org.profileImageUrl, 600);
  if (/^https:\/\/[^\s"'<>]+$/i.test(own)) return {url: own, own: true};
  return {url: LOGO_URL, own: false};
}

const PARKING_DOCUMENT_TYPES = Object.freeze({
  RECEIPT: "receipt",
  INVOICE: "invoice",
});

function text(value, maxLength = 200) {
  return String(value === null || value === undefined ? "" : value)
      .trim().slice(0, maxLength);
}

// Firestore hands back a Timestamp, not a string. String()-ing one yields
// "[object Object]", which is exactly what printed on the first receipts.
// Everything a record might plausibly carry is normalized here instead.
function formatDate(value) {
  if (value === null || value === undefined || value === "") return "";
  let date = null;
  if (typeof value.toDate === "function") {
    try {
      date = value.toDate();
    } catch (error) {
      date = null;
    }
  } else if (value instanceof Date) {
    date = value;
  } else if (typeof value === "object" &&
      (typeof value._seconds === "number" ||
        typeof value.seconds === "number")) {
    const seconds = typeof value._seconds === "number" ?
      value._seconds : value.seconds;
    date = new Date(seconds * 1000);
  } else if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value);
    // A string that is not a date at all (already-formatted copy, a note)
    // is printed as it stands rather than turned into "Invalid Date".
    if (Number.isNaN(parsed.getTime())) return text(value, 60);
    date = parsed;
  }
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    year: "numeric", month: "short", day: "numeric", timeZone: "UTC",
  });
}

// The lot's own address, as a business would put it on its paperwork. The
// business profile wins when it is filled in; otherwise the address recorded
// against the car is used, because that is where the vehicle actually is.
function formatBusinessAddress({business, entry}) {
  const org = business || {};
  const record = entry || {};
  const line1 = text(org.addressLine1, 160) || text(record.parkingAddress, 160);
  const line2 = text(org.addressLine2, 160);
  const city = text(org.city, 80) || text(record.parkingCity, 80);
  const region = [city, text(org.state, 40)].filter(Boolean).join(", ");
  const tail = [region, text(org.postalCode, 20)].filter(Boolean).join(" ");
  return [line1, line2, tail, text(org.country, 80)]
      .filter(Boolean).join(", ");
}

function money(cents) {
  const amount = Number(cents || 0) / 100;
  return `$${(Number.isFinite(amount) ? amount : 0).toFixed(2)}`;
}

function escapeHtml(value) {
  return String(value === null || value === undefined ? "" : value)
      .replace(/[&<>"']/g, (char) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        "\"": "&quot;",
        "'": "&#39;",
      }[char]));
}

/**
 * Which document a parking record should produce right now.
 * A paid record gets a receipt; anything still owed gets an invoice. This is
 * deliberately derived from the record rather than passed in by the caller,
 * so a business cannot print a "receipt" for money that never arrived.
 * @param {Object} entry A parkedCars document.
 * @return {string} One of PARKING_DOCUMENT_TYPES.
 */
function parkingDocumentType(entry) {
  const record = entry && typeof entry === "object" ? entry : {};
  const paymentStatus = text(record.paymentStatus, 40);
  if (paymentStatus === "succeeded" || paymentStatus === "paid") {
    return PARKING_DOCUMENT_TYPES.RECEIPT;
  }
  return PARKING_DOCUMENT_TYPES.INVOICE;
}

/**
 * The label a business reads on the button and the document heading.
 * @param {string} type A PARKING_DOCUMENT_TYPES value.
 * @return {string} Human-readable title.
 */
function parkingDocumentTitle(type) {
  return type === PARKING_DOCUMENT_TYPES.RECEIPT ? "Receipt" : "Invoice";
}

/**
 * Flattens a parkedCars document into the rows a document renders, so the
 * template stays dumb and this stays testable.
 * @param {Object} args entry, business and the durable payment link.
 * @return {Object} The document model.
 */
function parkingDocumentModel({
  entry, business, paymentLinkUrl, paymentLinkQrSvg,
}) {
  const record = entry && typeof entry === "object" ? entry : {};
  const org = business && typeof business === "object" ? business : {};
  const type = parkingDocumentType(record);
  const paid = type === PARKING_DOCUMENT_TYPES.RECEIPT;

  const amountCents = Number(
      record.amountDueCents || record.totalCostCents || 0,
  );
  const car = [record.carYear, record.carMake, record.carModel]
      .map((part) => text(part, 60)).filter(Boolean).join(" ");

  const method = text(record.paymentMethod, 40);
  const methodLabel = method === "payment_link" ?
    "Card payment (Stripe)" :
    method === "direct" ? "Paid directly to the business" : "";

  return {
    type,
    paid,
    title: parkingDocumentTitle(type),
    // A receipt and an invoice for the same car must be tellable apart in a
    // filing cabinet, hence the prefix rather than the bare tracking code.
    reference: `${paid ? "REC" : "INV"}-${text(record.trackingCode, 40)}`,
    trackingCode: text(record.trackingCode, 40),
    businessName: text(org.name || record.businessName, 160),
    businessAddress: formatBusinessAddress({business: org, entry: record}),
    businessPhone: text(org.phone, 40),
    businessEmail: text(org.email, 180),
    customerName: text(record.customerName || record.ownerName, 120),
    customerPhone: text(record.customerPhone, 40),
    customerEmail: text(record.customerEmail, 180),
    car,
    vin: text(record.vinNumber, 40),
    startDate: formatDate(record.parkingDate),
    endDate: formatDate(record.parkingEndDate),
    amount: money(amountCents),
    amountCents,
    methodLabel,
    // Only an invoice carries a way to pay; printing a live payment link on
    // a receipt would invite a second payment. The QR follows the same rule -
    // a scannable code on a receipt is the same mistake in a friendlier form.
    paymentLinkUrl: paid ? "" : text(paymentLinkUrl, 400),
    paymentLinkQrSvg: paid ? "" : String(paymentLinkQrSvg || ""),
    issuedAt: formatDate(record.documentIssuedAt),
    logo: documentLogo(org),
    rows: [
      ["Customer", text(record.customerName || record.ownerName, 120)],
      ["Phone", text(record.customerPhone, 40)],
      ["Email", text(record.customerEmail, 180)],
      ["Vehicle", car],
      ["VIN", text(record.vinNumber, 40)],
      ["Parked from", formatDate(record.parkingDate)],
      ["Parked until", formatDate(record.parkingEndDate) ||
        (record.parkingDate ? "Open-ended" : "")],
      ["Tracking code", text(record.trackingCode, 40)],
      ["Payment method", methodLabel],
    ],
    dueNote: "Please settle this invoice to complete your parking booking.",
    subject: "parking",
  };
}

/**
 * Which document a lot-ledger activity produces right now: a receipt once
 * paid (online or in person), an invoice while a payment link is open, and
 * nothing printable for a cancelled or voided entry.
 * @param {Object} entry A lotActivities document.
 * @return {string|""} One of PARKING_DOCUMENT_TYPES, or "" when none applies.
 */
function lotActivityDocumentType(entry) {
  const record = entry && typeof entry === "object" ? entry : {};
  if (record.voided === true) return "";
  const status = text(record.paymentStatus, 40);
  if (status === "succeeded") return PARKING_DOCUMENT_TYPES.RECEIPT;
  if (status === "awaiting_payment_link") return PARKING_DOCUMENT_TYPES.INVOICE;
  return "";
}

const LOT_RECEIVED_VIA_LABELS = Object.freeze({
  zelle: "Zelle", cash: "Cash", cashapp: "Cash App", venmo: "Venmo",
  check: "Check", card_in_person: "Card, in person", other: "Other",
});

/**
 * Flattens a lot-ledger activity into the same document model a parking
 * record produces, so one template prints both.
 * @param {Object} args entry, business, paymentLinkUrl, paymentLinkQrSvg.
 * @return {Object} The document model.
 */
function lotActivityDocumentModel({
  entry, business, paymentLinkUrl, paymentLinkQrSvg,
}) {
  const record = entry && typeof entry === "object" ? entry : {};
  const org = business && typeof business === "object" ? business : {};
  const type = lotActivityDocumentType(record) ||
    PARKING_DOCUMENT_TYPES.INVOICE;
  const paid = type === PARKING_DOCUMENT_TYPES.RECEIPT;
  const amountCents = Number(record.feeCents || 0);
  const car = [record.carYear, record.carMake, record.carModel]
      .map((part) => text(part, 60)).filter(Boolean).join(" ");
  const method = text(record.paymentMethod, 40);
  const via = LOT_RECEIVED_VIA_LABELS[text(record.receivedVia, 40)] || "";
  const methodLabel = method === "payment_link" ?
    "Card payment (Stripe)" :
    method === "direct" ? (via ? `${via}, paid to the business` :
      "Paid directly to the business") : "";
  const service = text(record.customLabel || record.activityTypeLabel, 120);
  return {
    type,
    paid,
    title: parkingDocumentTitle(type),
    reference: `${paid ? "REC" : "INV"}-${text(record.trackingCode, 40)}`,
    trackingCode: text(record.trackingCode, 40),
    businessName: text(org.name, 160),
    businessAddress: formatBusinessAddress({business: org, entry: {}}),
    businessPhone: text(org.phone, 40),
    businessEmail: text(org.email, 180),
    customerName: text(record.customerName, 120),
    customerPhone: text(record.customerPhone, 40),
    customerEmail: text(record.customerEmail, 180),
    car,
    vin: text(record.vinNumber, 40),
    amount: money(amountCents),
    amountCents,
    methodLabel,
    paymentLinkUrl: paid ? "" : text(paymentLinkUrl, 400),
    paymentLinkQrSvg: paid ? "" : String(paymentLinkQrSvg || ""),
    issuedAt: formatDate(record.paidAt || record.activityDate),
    logo: documentLogo(org),
    rows: [
      ["Customer", text(record.customerName, 120)],
      ["Phone", text(record.customerPhone, 40)],
      ["Email", text(record.customerEmail, 180)],
      ["Service", service],
      ["Date", formatDate(record.activityDate)],
      ["Vehicle", car],
      ["VIN", text(record.vinNumber, 40)],
      ["Auction house", text(record.auctionHouse, 60)],
      ["Reference", text(record.trackingCode, 40)],
      ["Payment method", methodLabel],
    ],
    dueNote: "Please settle this invoice for the service above.",
    subject: "service",
  };
}

function row(label, value) {
  if (!value) return "";
  return `<tr><th>${escapeHtml(label)}</th>` +
    `<td>${escapeHtml(value)}</td></tr>`;
}

/**
 * Renders the printable document.
 * @param {Object} model The output of parkingDocumentModel.
 * @return {string} A complete HTML page.
 */
function renderParkingDocument(model) {
  const paidBanner = model.paid ?
    `<p class="stamp paid">PAID</p>` :
    `<p class="stamp due">PAYMENT DUE</p>`;

  // The QR is what makes a PRINTED invoice payable: nobody types a
  // 116-character URL off a sheet of paper. The link stays for the digital
  // copy, where tapping is easier than scanning.
  const qrBlock = model.paymentLinkQrSvg ?
    `<div class="qr">${model.paymentLinkQrSvg}
       <span>Scan to pay</span></div>` :
    "";

  const payBlock = model.paymentLinkUrl ?
    `<div class="pay">
       ${qrBlock}
       <div class="pay-body">
         <p class="pay-title">Pay online</p>
         <p class="pay-link"><a href="${escapeHtml(model.paymentLinkUrl)}">` +
           `${escapeHtml(model.paymentLinkUrl)}</a></p>
         <p class="pay-note">Scan the code or open the link. It stays valid
           until the parking is paid or the business cancels it.</p>
       </div>
     </div>` :
    "";

  // Older callers hand in a model without rows; rebuild the parking rows.
  const rows = model.rows || [
    ["Customer", model.customerName], ["Phone", model.customerPhone],
    ["Email", model.customerEmail], ["Vehicle", model.car],
    ["VIN", model.vin], ["Parked from", model.startDate],
    ["Parked until", model.endDate], ["Tracking code", model.trackingCode],
    ["Payment method", model.methodLabel],
  ];

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(model.title)} ${escapeHtml(model.reference)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#eef1f0;color:#12211f;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    padding:24px}
  .sheet{background:#fff;max-width:720px;margin:0 auto;padding:40px;
    border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.08)}
  header{display:flex;align-items:center;justify-content:space-between;
    gap:16px;border-bottom:2px solid #0D9488;padding-bottom:18px}
  .brand{display:flex;align-items:center;gap:12px}
  .brand img{width:44px;height:44px;border-radius:9px;display:block}
  .brand b{font-size:19px;letter-spacing:.2px}
  .brand span{display:block;color:#5b6b68;font-size:12px;font-weight:500;
    line-height:1.5}
  .brand div{min-width:0}
  .doc-title{text-align:right}
  .doc-title h1{margin:0;font-size:24px;letter-spacing:.5px;
    text-transform:uppercase;color:#0D9488}
  .doc-title p{margin:4px 0 0;color:#5b6b68;font-size:13px}
  .stamp{display:inline-block;margin:20px 0 0;padding:6px 14px;
    border-radius:999px;font-weight:700;font-size:13px;letter-spacing:.6px}
  .stamp.paid{background:#dcfce7;color:#166534}
  .stamp.due{background:#fef3c7;color:#92400e}
  table{width:100%;border-collapse:collapse;margin-top:22px}
  th,td{text-align:left;padding:9px 0;border-bottom:1px solid #eceeed;
    font-size:14px;vertical-align:top}
  th{width:190px;color:#5b6b68;font-weight:600}
  .total{margin-top:26px;display:flex;justify-content:space-between;
    align-items:center;background:#f6f8f8;border-radius:10px;padding:16px 20px}
  .total span{color:#5b6b68;font-size:13px;font-weight:600;
    text-transform:uppercase;letter-spacing:.5px}
  .total b{font-size:26px}
  .pay{margin-top:24px;border:1px dashed #0D9488;border-radius:10px;
    padding:16px 20px;background:#f2fbfa;display:flex;align-items:center;
    gap:18px}
  .pay-body{flex:1;min-width:0}
  .qr{flex:0 0 auto;text-align:center}
  .qr svg{width:104px;height:104px;display:block;background:#fff;
    border-radius:6px;padding:6px}
  .qr span{display:block;margin-top:6px;font-size:11px;font-weight:600;
    color:#0D9488;letter-spacing:.3px}
  .pay-title{margin:0 0 6px;font-weight:700;font-size:14px}
  .pay-link{margin:0;font-size:12px;word-break:break-all}
  .pay-link a{color:#0D9488}
  .pay-note{margin:8px 0 0;color:#5b6b68;font-size:12px}
  footer{margin-top:30px;border-top:1px solid #eceeed;padding-top:14px;
    color:#5b6b68;font-size:12px;line-height:1.6}
  .actions{max-width:720px;margin:0 auto 16px;text-align:right}
  .actions button{background:#0D9488;color:#fff;border:0;border-radius:8px;
    padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
  @media print{
    body{background:#fff;padding:0}
    .sheet{box-shadow:none;border-radius:0;max-width:none;padding:0}
    .actions{display:none}
  }
</style></head><body>
<div class="actions">
  <button type="button" onclick="window.print()">Print or save as PDF</button>
</div>
<div class="sheet">
  <header>
    <div class="brand">
      <img src="${escapeHtml((model.logo && model.logo.url) || LOGO_URL)}"
        alt="${escapeHtml(model.businessName || "Laawol Digital")}">
      <div><b>${escapeHtml(model.businessName || "Laawol Digital")}</b>
        <span>${escapeHtml(model.businessAddress)}</span>
        <span>${escapeHtml([model.businessPhone, model.businessEmail]
      .filter(Boolean).join("  |  "))}</span></div>
    </div>
    <div class="doc-title">
      <h1>${escapeHtml(model.title)}</h1>
      <p>${escapeHtml(model.reference)}</p>
    </div>
  </header>
  ${paidBanner}
  <table>
    ${rows.map(([label, value]) => row(label, value)).join("")}
  </table>
  <div class="total"><span>${model.paid ? "Amount paid" : "Amount due"}</span>
    <b>${escapeHtml(model.amount)}</b></div>
  ${payBlock}
  <footer>
    ${model.paid ?
      "Thank you. This document confirms payment was received in full." :
      escapeHtml(model.dueNote ||
        "Please settle this invoice to complete your parking booking.")}
    <br>Issued through Laawol Digital &middot; laawoldigital.com
  </footer>
</div>
</body></html>`;
}

module.exports = {
  PARKING_DOCUMENT_TYPES,
  documentLogo,
  lotActivityDocumentType,
  lotActivityDocumentModel,
  parkingDocumentType,
  parkingDocumentTitle,
  parkingDocumentModel,
  renderParkingDocument,
};
