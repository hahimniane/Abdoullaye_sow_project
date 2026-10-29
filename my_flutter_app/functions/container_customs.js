"use strict";

/**
 * The customs list (docs/AIR_PACKAGES.md §4.9): one printable page per
 * container - a flight or a box - with every package on it: its code, who
 * sent it and who collects it, what is inside (with serial numbers), its
 * weight and its declared value, totalled at the bottom. Printed from the
 * declarations staff typed at drop-off, for the customs desk at the other
 * end.
 *
 * Money is on this page (declared values), so the link is handed out only
 * to staff with the containers permission; it is never the labels page, and
 * never the customer's tracking page.
 *
 * Pure: the caller loads the container, its lines and the business; this
 * turns them into a model and the model into a page.
 */

const {
  containerKindWord,
  containerLineWhat,
  isAirContainer,
  lineCustomer,
} = require("./container_manifest");
const {weightText} = require("./package_proof");
const {documentLogo, formatBusinessAddress} = require("./parking_document");

const LOGO_URL = "https://laawoldigital.com/assets/logo.png";

const escape = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => (
  {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[char]
));
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);

function dateLabel(value) {
  const date = value && typeof value.toDate === "function" ?
    value.toDate() : (value instanceof Date ? value : null);
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

/**
 * "$1,250.00"; "" when there is no value.
 *
 * @param {number|null} cents Whole cents.
 * @return {string} The amount.
 */
function usdText(cents) {
  if (!Number.isFinite(cents) || cents < 0) return "";
  return (cents / 100).toLocaleString("en-US",
      {style: "currency", currency: "USD"});
}

/**
 * What is inside, for customs: every item with its count and its serial
 * ("2 × iPhone 13 (S/N 356789…), clothes"). Unlike the chat's
 * `contentsText`, serials are printed - that is what the desk asks for.
 *
 * @param {object[]} contents The line's `contents`.
 * @return {string} The list, or "".
 */
function customsContentsText(contents) {
  return (Array.isArray(contents) ? contents : [])
      .filter((item) => item && text(item.label, 60))
      .map((item) => {
        const label = text(item.label, 60);
        const quantity = Number(item.quantity) || 1;
        const serial = text(item.serial, 40);
        return (quantity > 1 ? `${quantity} × ${label}` : label) +
          (serial ? ` (S/N ${serial})` : "");
      })
      .join(", ");
}

/**
 * @param {object} input `{container, lines, business}` as stored.
 * @return {object} What the page shows.
 */
function containerCustomsModel({container, lines, business}) {
  const c = container && typeof container === "object" ? container : {};
  const org = business && typeof business === "object" ? business : {};
  const rows = Array.isArray(lines) ? lines : [];
  const air = isAirContainer(c);
  const reference = (air ? text(c.airWaybill, 20) : text(c.containerNumber,
      20)) || text(c.label, 120) || text(c.bookingReference, 60) ||
    containerKindWord(c);
  let totalWeightLb = 0;
  let weighed = 0;
  let totalValueCents = 0;
  let valued = 0;
  const list = rows.map((row, i) => {
    const r = row && typeof row === "object" ? row : {};
    const sender = text(r.ownerKind, 20) === "stock" ?
      {name: "Business stock", phone: ""} : lineCustomer(r);
    const weightLb = Number(r.weightLb);
    const hasWeight = Number.isFinite(weightLb) && weightLb > 0;
    if (hasWeight) {
      totalWeightLb += weightLb;
      weighed += 1;
    }
    const valueCents = Number(r.declaredValueCents);
    const hasValue = Number.isInteger(valueCents) && valueCents >= 0;
    if (hasValue) {
      totalValueCents += valueCents;
      valued += 1;
    }
    return {
      n: i + 1,
      code: text(r.trackingCode, 40),
      senderName: sender.name,
      senderPhone: sender.phone,
      receiverName: text(r.receiverName, 120),
      receiverPhone: text(r.receiverPhone, 40),
      // The declared items; a package with none declared says what it is.
      contents: customsContentsText(r.contents) || containerLineWhat(r),
      weightLb: hasWeight ? weightLb : null,
      weightText: hasWeight ? weightText(weightLb) : "",
      declaredValueCents: hasValue ? valueCents : null,
      declaredValueText: hasValue ? usdText(valueCents) : "",
    };
  });
  const totalWeight = Math.round(totalWeightLb * 10) / 10;
  return {
    title: "Customs list",
    titleFr: "Liste pour la douane",
    kindWord: containerKindWord(c),
    kindWordFr: containerKindWord(c, "fr"),
    air,
    reference,
    airline: air ? text(c.airline, 60) : "",
    airWaybill: air ? text(c.airWaybill, 20) : "",
    containerNumber: air ? "" : text(c.containerNumber, 20),
    label: text(c.label, 120),
    bookingReference: text(c.bookingReference, 60),
    logo: documentLogo(org),
    businessName: text(org.name, 160),
    businessAddress: formatBusinessAddress({business: org, entry: {}}),
    businessPhone: text(org.phone, 40),
    businessEmail: text(org.email, 180),
    destination: text(c.destinationCountryName, 120),
    departedOn: dateLabel(c.sailedAt),
    arrivedOn: dateLabel(c.arrivedAt),
    lines: list,
    totals: {
      lineCount: list.length,
      weightLb: weighed ? totalWeight : null,
      weightText: weighed ? weightText(totalWeight) : "",
      // How many lines the totals cover, so a gap is seen, not hidden.
      weighed,
      declaredValueCents: valued ? totalValueCents : null,
      declaredValueText: valued ? usdText(totalValueCents) : "",
      valued,
    },
    printedOn: dateLabel(new Date()),
  };
}

/**
 * @param {object} model From containerCustomsModel.
 * @return {string} The page: US Letter, portrait, one table.
 */
function renderContainerCustoms(model) {
  const m = model || {};
  const totals = m.totals || {};
  const person = (name, phone) => `${name ? `<b>${escape(name)}</b>` : ""}${
    phone ? `<span class="sub">${escape(phone)}</span>` : ""}`;
  const rows = (m.lines || []).map((line) => `<tr>
    <td class="n">${escape(line.n)}</td>
    <td class="code">${escape(line.code)}</td>
    <td>${person(line.senderName, line.senderPhone)}</td>
    <td>${person(line.receiverName, line.receiverPhone)}</td>
    <td>${escape(line.contents)}</td>
    <td class="num">${escape(line.weightText)}</td>
    <td class="num">${escape(line.declaredValueText)}</td>
  </tr>`).join("");
  const count = Number(totals.lineCount) || 0;
  const gaps = [
    count && totals.weighed < count ?
      `weight on ${totals.weighed} of ${count} packages` : "",
    count && totals.valued < count ?
      `declared value on ${totals.valued} of ${count} packages` : "",
  ].filter(Boolean).join("; ");
  const meta = [
    [`${m.kindWord} / ${m.kindWordFr}`, m.reference],
    ["Airline / Compagnie", m.airline],
    ["Booking / Réservation", m.bookingReference],
    ["Destination", m.destination],
    ["Departure / Départ", m.departedOn],
    ["Arrival / Arrivée", m.arrivedOn],
  ].filter(([, v]) => v).map(([k, v]) =>
    `<div><span>${escape(k)}</span><b>${escape(v)}</b></div>`).join("");
  const name = m.businessName || "Laawol Digital";
  const fileTitle = `${m.title} ${m.reference} - ${name}`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(fileTitle)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#eef1f0;color:#12211f;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
    padding:24px}
  .sheet{background:#fff;width:8.5in;min-height:11in;margin:0 auto;
    padding:0.6in 0.5in;border-radius:12px;
    box-shadow:0 8px 28px rgba(0,0,0,.08)}
  header{display:flex;align-items:center;justify-content:space-between;
    gap:16px;border-bottom:2px solid #0D9488;padding-bottom:14px}
  .brand{display:flex;align-items:center;gap:12px}
  .brand img{width:40px;height:40px;border-radius:9px;display:block;
    object-fit:cover}
  .brand b{font-size:17px;letter-spacing:.2px}
  .brand span{display:block;color:#5b6b68;font-size:11px;font-weight:500;
    line-height:1.5}
  .brand div{min-width:0}
  .doc-title{text-align:right}
  .doc-title h1{margin:0;font-size:20px;letter-spacing:.5px;
    text-transform:uppercase;color:#0D9488}
  .doc-title small{display:block;margin-top:2px;color:#5b6b68;font-size:11px;
    font-weight:500}
  .doc-title p{margin:4px 0 0;font-size:14px;font-weight:700}
  .meta{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;
    margin-top:14px}
  .meta div{background:#f6f8f8;border-radius:8px;padding:8px 10px}
  .meta span{display:block;color:#5b6b68;font-size:10px;font-weight:600;
    text-transform:uppercase;letter-spacing:.5px}
  .meta b{display:block;margin-top:3px;font-size:13px}
  table{width:100%;border-collapse:collapse;margin-top:18px;font-size:11px}
  th{text-align:left;padding:6px 5px;border-bottom:2px solid #eceeed;
    color:#5b6b68;font-size:9.5px;font-weight:600;text-transform:uppercase;
    letter-spacing:.4px;vertical-align:bottom}
  th i{display:block;font-style:normal;font-weight:500;
    text-transform:none;letter-spacing:0}
  td{padding:7px 5px;border-bottom:1px solid #eceeed;vertical-align:top}
  td.n{width:24px;color:#5b6b68}
  td.code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    font-weight:700;white-space:nowrap}
  td.num,th.num{text-align:right;white-space:nowrap;
    font-variant-numeric:tabular-nums}
  td b{font-weight:600}
  .sub{display:block;color:#5b6b68;font-size:10px;margin-top:1px;
    font-variant-numeric:tabular-nums}
  tfoot td{border-top:2px solid #12211f;border-bottom:0;font-weight:700;
    padding-top:8px}
  .gaps{margin:8px 0 0;color:#92400e;font-size:11px}
  footer{margin-top:24px;border-top:1px solid #eceeed;padding-top:12px;
    color:#5b6b68;font-size:11px;line-height:1.6}
  .actions{width:8.5in;margin:0 auto 16px;text-align:right}
  .actions button{background:#0D9488;color:#fff;border:0;border-radius:8px;
    padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
  @page{size:letter portrait;margin:12mm}
  @media print{
    body{background:#fff;padding:0}
    .sheet{box-shadow:none;border-radius:0;width:auto;min-height:0;
      padding:0}
    .actions{display:none}
    tr{break-inside:avoid}
    thead{display:table-header-group}
  }
</style></head><body>
<div class="actions">
  <button type="button" onclick="window.print()">Print or save as PDF</button>
</div>
<div class="sheet">
  <header>
    <div class="brand">
      <img src="${escape((m.logo && m.logo.url) || LOGO_URL)}"
        alt="${escape(name)}">
      <div><b>${escape(name)}</b>
        ${m.businessAddress ? `<span>${escape(m.businessAddress)}</span>` : ""}
        ${[m.businessPhone, m.businessEmail].filter(Boolean).length ?
          `<span>${escape([m.businessPhone, m.businessEmail]
              .filter(Boolean).join("  |  "))}</span>` : ""}</div>
    </div>
    <div class="doc-title">
      <h1>${escape(m.title || "Customs list")}</h1>
      <small>${escape(m.titleFr || "Liste pour la douane")}</small>
      <p>${escape(m.kindWord)} ${escape(m.reference)}</p>
    </div>
  </header>
  <div class="meta">${meta}</div>
  <table>
    <thead><tr><th>#</th><th>Code</th>
    <th>Sender<i>Expéditeur</i></th><th>Receiver<i>Destinataire</i></th>
    <th>Contents<i>Contenu</i></th>
    <th class="num">Weight (lb)<i>Poids</i></th>
    <th class="num">Declared value (USD)<i>Valeur déclarée</i></th>
    </tr></thead>
    <tbody>${rows ||
      `<tr><td colspan="7" class="n">Nothing on this ${
        escape(String(m.kindWord || "container").toLowerCase())}.</td></tr>`}
    </tbody>
    <tfoot><tr><td colspan="5">Total / Total &middot; ${escape(count)} ${
  count === 1 ? "package" : "packages"}</td>
    <td class="num">${escape(totals.weightText)}</td>
    <td class="num">${escape(totals.declaredValueText)}</td></tr></tfoot>
  </table>
  ${gaps ? `<p class="gaps">Totals cover ${escape(gaps)}.</p>` : ""}
  <footer>
    Printed ${escape(m.printedOn)}. Declared by the senders at drop-off and
    recorded by ${escape(name)}.
    <br>Issued through Laawol Digital &middot; laawoldigital.com
  </footer>
</div>
</body></html>`;
}

module.exports = {
  containerCustomsModel,
  customsContentsText,
  renderContainerCustoms,
  usdText,
};
