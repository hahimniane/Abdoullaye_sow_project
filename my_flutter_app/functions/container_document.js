"use strict";

/**
 * The printable loading list: one page per container, for whoever opens the
 * box at the other end. Server-rendered HTML like the parking documents - it
 * prints cleanly from any phone and needs no PDF engine.
 *
 * Pure: the caller loads the container, its lines and the business; this
 * turns them into a model and the model into a page.
 */

const {containerCounts} = require("./container_manifest");

const escape = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => (
  {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[char]
));

function dateLabel(value) {
  const date = value && typeof value.toDate === "function" ?
    value.toDate() : (value instanceof Date ? value : null);
  if (!date || Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("en-US", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

/**
 * @param {{container: object, lines: object[], business: object}} input
 *   The stored records.
 * @return {object} What the page shows.
 */
function containerDocumentModel({container, lines, business}) {
  const c = container && typeof container === "object" ? container : {};
  const rows = Array.isArray(lines) ? lines : [];
  const status = String(c.status || "loading");
  return {
    businessName: String(business?.name || "").trim(),
    label: String(c.label || "").trim(),
    containerNumber: String(c.containerNumber || "").trim(),
    bookingReference: String(c.bookingReference || "").trim(),
    destination: String(c.destinationCountryName || "").trim(),
    status,
    sailedOn: dateLabel(c.sailedAt),
    arrivedOn: dateLabel(c.arrivedAt),
    notes: String(c.notes || "").trim(),
    counts: containerCounts(rows),
    lines: rows.map((row) => {
      const r = row && typeof row === "object" ? row : {};
      const kind = String(r.kind || "");
      let what = "";
      if (kind === "car") {
        what = [r.carYear, r.carMake, r.carModel]
            .map((v) => String(v || "").trim())
            .filter(Boolean).join(" ") || "Car";
      } else if (kind === "barrels") {
        what = "Barrels";
      } else {
        what = String(r.description || "").trim() || "Other";
      }
      return {
        kind,
        what,
        vin: kind === "car" ? String(r.vinNumber || "") : "",
        quantity: kind === "car" ? 1 : Math.max(1, Number(r.quantity) || 1),
        whose: String(r.ownerKind || "") === "stock" ?
          "Business stock" : String(r.customerName || "").trim(),
        phone: String(r.ownerKind || "") === "stock" ?
          "" : String(r.customerPhone || "").trim(),
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
  const heading = m.containerNumber || m.label || "Container";
  const sub = [m.label && m.containerNumber ? m.label : "",
    m.bookingReference ? `Ref ${m.bookingReference}` : ""]
      .filter(Boolean).join(" · ");
  const stateLine = m.status === "arrived" ?
    `Arrived ${m.arrivedOn}` :
    (m.status === "shipped" ? `Sailed ${m.sailedOn}` : "Loading");
  const rows = (m.lines || []).map((line, i) => `<tr>` +
    `<td>${i + 1}</td>` +
    `<td>${escape(line.what)}${line.vin ?
      `<br><small>${escape(line.vin)}</small>` : ""}</td>` +
    `<td>${escape(line.quantity)}</td>` +
    `<td>${escape(line.whose)}${line.phone ?
      `<br><small>${escape(line.phone)}</small>` : ""}</td>` +
    `</tr>`).join("");
  const counts = m.counts || {};
  const summary = [
    counts.carCount ?
      `${counts.carCount} car${counts.carCount === 1 ? "" : "s"}` : "",
    counts.barrelCount ? `${counts.barrelCount} barrels` : "",
    counts.otherCount ? `${counts.otherCount} other` : "",
  ].filter(Boolean).join(" · ") || "Nothing on board";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width,initial-scale=1">` +
    `<title>Loading list - ${escape(heading)}</title><style>` +
    `body{margin:0;background:#f6f7f6;color:#12211f;` +
    `font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;` +
    `padding:24px}main{background:#fff;max-width:720px;margin:0 auto;` +
    `padding:28px;border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.06)}` +
    `h1{font-size:22px;margin:0}h2{font-size:12px;letter-spacing:.08em;` +
    `text-transform:uppercase;color:#5b6b68;margin:22px 0 8px}` +
    `.sub{color:#5b6b68;margin:4px 0 0}.meta{display:flex;flex-wrap:wrap;` +
    `gap:16px;margin:16px 0 0;font-size:14px}.meta b{display:block;` +
    `font-size:11px;letter-spacing:.06em;text-transform:uppercase;` +
    `color:#5b6b68}table{width:100%;border-collapse:collapse;margin-top:8px;` +
    `font-size:14px}th{text-align:left;font-size:11px;letter-spacing:.06em;` +
    `text-transform:uppercase;color:#5b6b68;padding:6px 4px;` +
    `border-bottom:1px solid #d7e0de}td{padding:8px 4px;vertical-align:top;` +
    `border-bottom:1px solid #eef2f1}small{color:#5b6b68}.notes{white-space:` +
    `pre-wrap}.foot{margin-top:18px;font-size:12px;color:#5b6b68}` +
    `@media print{body{background:#fff;padding:0}main{box-shadow:none;` +
    `max-width:none;border-radius:0}}</style></head><body><main>` +
    `<h2>Loading list</h2><h1>${escape(heading)}</h1>` +
    (sub ? `<p class="sub">${escape(sub)}</p>` : "") +
    `<div class="meta">` +
    (m.businessName ?
      `<div><b>Shipper</b>${escape(m.businessName)}</div>` : "") +
    (m.destination ?
      `<div><b>Destination</b>${escape(m.destination)}</div>` : "") +
    `<div><b>Status</b>${escape(stateLine)}</div>` +
    `<div><b>On board</b>${escape(summary)}</div></div>` +
    `<table><thead><tr><th>#</th><th>What</th><th>Qty</th><th>Whose</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>` +
    (m.notes ? `<h2>Notes</h2><p class="notes">${escape(m.notes)}</p>` : "") +
    `<p class="foot">Printed ${escape(m.printedOn)}. This list is the ` +
    `shipper's own record of what was loaded.</p></main></body></html>`;
}

module.exports = {containerDocumentModel, renderContainerDocument};
