"use strict";

/**
 * The printable loading list: one page per container, for whoever opens the
 * box at the other end. Server-rendered HTML at a stable URL, like the
 * parking receipts and for the same reasons (see parking_document.js): every
 * platform prints HTML to PDF already, the page stays live, and it travels
 * as a link. It wears the business's own identity - logo, name, address -
 * because the person reading it in Conakry has never heard of Laawol; they
 * know the shipper.
 *
 * Pure: the caller loads the container, its lines and the business; this
 * turns them into a model and the model into a page.
 */

const {containerCounts} = require("./container_manifest");
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
 * What the stamp says. Loading is amber (still open), sailed is the brand
 * teal (in motion), arrived is green (closed) - the same three tones the
 * receipts use for due and paid, so a reader who knows one knows the other.
 *
 * @param {object} c The container.
 * @return {{text: string, tone: string}} The stamp.
 */
function containerStamp(c) {
  const status = text(c.status, 20) || "loading";
  if (status === "arrived") {
    const on = dateLabel(c.arrivedAt);
    return {text: on ? `ARRIVED ${on}` : "ARRIVED", tone: "arrived"};
  }
  if (status === "shipped") {
    const on = dateLabel(c.sailedAt);
    return {text: on ? `SAILED ${on}` : "SAILED", tone: "sailed"};
  }
  return {text: "LOADING", tone: "loading"};
}

/**
 * @param {{container: object, lines: object[], business: object}} input
 *   The stored records.
 * @return {object} What the page shows.
 */
function containerDocumentModel({container, lines, business}) {
  const c = container && typeof container === "object" ? container : {};
  const org = business && typeof business === "object" ? business : {};
  const rows = Array.isArray(lines) ? lines : [];
  const number = text(c.containerNumber, 20);
  const label = text(c.label, 120);
  return {
    title: "Loading list",
    // The number is what the port knows the box by; until there is one, the
    // working name stands in and the label line is left empty rather than
    // saying the same thing twice.
    reference: number || label || "Container",
    label: number && label ? label : "",
    bookingReference: text(c.bookingReference, 60),
    logo: documentLogo(org),
    businessName: text(org.name, 160),
    businessAddress: formatBusinessAddress({business: org, entry: {}}),
    businessPhone: text(org.phone, 40),
    businessEmail: text(org.email, 180),
    destination: text(c.destinationCountryName, 120),
    status: text(c.status, 20) || "loading",
    stamp: containerStamp(c),
    startedOn: dateLabel(c.createdAt),
    sailedOn: dateLabel(c.sailedAt),
    arrivedOn: dateLabel(c.arrivedAt),
    notes: text(c.notes, 500),
    counts: containerCounts(rows),
    lines: rows.map((row) => {
      const r = row && typeof row === "object" ? row : {};
      const kind = text(r.kind, 20);
      let what = "";
      if (kind === "car") {
        what = [r.carYear, r.carMake, r.carModel]
            .map((v) => text(v, 80)).filter(Boolean).join(" ") || "Car";
      } else if (kind === "barrels") {
        what = "Barrels";
      } else {
        what = text(r.description, 120) || "Other";
      }
      const stock = text(r.ownerKind, 20) === "stock";
      return {
        kind,
        what,
        vin: kind === "car" ? text(r.vinNumber, 17) : "",
        quantity: kind === "car" ? 1 : Math.max(1, Number(r.quantity) || 1),
        whose: stock ? "Business stock" : text(r.customerName, 120),
        phone: stock ? "" : text(r.customerPhone, 40),
      };
    }),
    printedOn: dateLabel(new Date()),
  };
}

/**
 * @param {object} model From containerDocumentModel.
 * @return {string} The page.
 */
function renderContainerDocument(model) {
  const m = model || {};
  const counts = m.counts || {};
  const onBoard = [
    counts.carCount ?
      `${counts.carCount} car${counts.carCount === 1 ? "" : "s"}` : "",
    counts.barrelCount ? `${counts.barrelCount} barrels` : "",
    counts.otherCount ? `${counts.otherCount} other` : "",
  ].filter(Boolean).join(" · ") || "Nothing on board";
  const rows = (m.lines || []).map((line, i) => `<tr>
    <td class="n">${i + 1}</td>
    <td><b>${escape(line.what)}</b>${line.vin ?
      `<span class="sub">${escape(line.vin)}</span>` : ""}</td>
    <td class="qty">${escape(line.quantity)}</td>
    <td><b>${escape(line.whose)}</b>${line.phone ?
      `<span class="sub">${escape(line.phone)}</span>` : ""}</td>
  </tr>`).join("");
  const meta = [
    ["Destination", m.destination],
    ["Booking / BL", m.bookingReference],
    ["Started", m.startedOn],
    ["On board", onBoard],
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
  .sheet{background:#fff;max-width:760px;margin:0 auto;padding:40px;
    border-radius:12px;box-shadow:0 8px 28px rgba(0,0,0,.08)}
  header{display:flex;align-items:center;justify-content:space-between;
    gap:16px;border-bottom:2px solid #0D9488;padding-bottom:18px}
  .brand{display:flex;align-items:center;gap:12px}
  .brand img{width:44px;height:44px;border-radius:9px;display:block;
    object-fit:cover}
  .brand b{font-size:19px;letter-spacing:.2px}
  .brand span{display:block;color:#5b6b68;font-size:12px;font-weight:500;
    line-height:1.5}
  .brand div{min-width:0}
  .doc-title{text-align:right}
  .doc-title h1{margin:0;font-size:24px;letter-spacing:.5px;
    text-transform:uppercase;color:#0D9488}
  .doc-title p{margin:4px 0 0;color:#12211f;font-size:15px;font-weight:700}
  .doc-title small{display:block;margin-top:2px;color:#5b6b68;font-size:12px;
    font-weight:500}
  .stamp{display:inline-block;margin:20px 0 0;padding:6px 14px;
    border-radius:999px;font-weight:700;font-size:13px;letter-spacing:.6px}
  .stamp.loading{background:#fef3c7;color:#92400e}
  .stamp.sailed{background:#ccfbf1;color:#0f766e}
  .stamp.arrived{background:#dcfce7;color:#166534}
  .meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
    gap:12px;margin-top:18px}
  .meta div{background:#f6f8f8;border-radius:10px;padding:12px 14px}
  .meta span{display:block;color:#5b6b68;font-size:11px;font-weight:600;
    text-transform:uppercase;letter-spacing:.5px}
  .meta b{display:block;margin-top:4px;font-size:14px}
  table{width:100%;border-collapse:collapse;margin-top:24px}
  th{text-align:left;padding:8px 6px;border-bottom:2px solid #eceeed;
    color:#5b6b68;font-size:11px;font-weight:600;text-transform:uppercase;
    letter-spacing:.5px}
  td{padding:10px 6px;border-bottom:1px solid #eceeed;font-size:14px;
    vertical-align:top}
  td.n{width:36px;color:#5b6b68}
  td.qty{width:56px;text-align:right;font-variant-numeric:tabular-nums}
  th.qty{text-align:right}
  td b{font-weight:600}
  .sub{display:block;color:#5b6b68;font-size:12px;margin-top:2px;
    font-variant-numeric:tabular-nums}
  h2{margin:26px 0 8px;font-size:11px;letter-spacing:.5px;
    text-transform:uppercase;color:#5b6b68}
  .notes{margin:0;white-space:pre-wrap;font-size:14px;line-height:1.5}
  footer{margin-top:30px;border-top:1px solid #eceeed;padding-top:14px;
    color:#5b6b68;font-size:12px;line-height:1.6}
  .actions{max-width:760px;margin:0 auto 16px;text-align:right}
  .actions button{background:#0D9488;color:#fff;border:0;border-radius:8px;
    padding:10px 18px;font-size:14px;font-weight:600;cursor:pointer}
  @page{margin:14mm}
  @media print{
    body{background:#fff;padding:0}
    .sheet{box-shadow:none;border-radius:0;max-width:none;padding:0}
    .actions{display:none}
    tr{break-inside:avoid}
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
      <h1>${escape(m.title || "Loading list")}</h1>
      <p>${escape(m.reference)}</p>
      ${m.label ? `<small>${escape(m.label)}</small>` : ""}
    </div>
  </header>
  <p class="stamp ${escape((m.stamp && m.stamp.tone) || "loading")}">` +
    `${escape((m.stamp && m.stamp.text) || "LOADING")}</p>
  <div class="meta">${meta}</div>
  <table>
    <thead><tr><th>#</th><th>What</th><th class="qty">Qty</th><th>Whose</th>
    </tr></thead>
    <tbody>${rows || `<tr><td colspan="4" class="n">Nothing loaded.</td></tr>`}
    </tbody>
  </table>
  ${m.notes ? `<h2>Notes</h2><p class="notes">${escape(m.notes)}</p>` : ""}
  <footer>
    Printed ${escape(m.printedOn)}. This list is the shipper's own record of
    what was loaded${m.businessName ? `, issued by ${escape(m.businessName)}` :
      ""}.
    <br>Issued through Laawol Digital &middot; laawoldigital.com
  </footer>
</div>
</body></html>`;
}

module.exports = {containerDocumentModel, renderContainerDocument};
