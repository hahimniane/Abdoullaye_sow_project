"use strict";

/**
 * Package labels: what gets stuck on every barrel, box and car going into a
 * container, so whoever handles it - here, at the port, at the warehouse in
 * Conakry - can tell whose it is by pointing a phone at it.
 *
 * Paper on a barrel gets wet, scraped and torn, so a label is built to
 * survive losing part of itself:
 *   - a QR code at the highest error correction (H), which still reads with
 *     about 30% of it gone, where a barcode dies with one scratched bar;
 *   - the tracking code printed large beside it, so a label too damaged to
 *     scan can still be typed, or copied onto the package in marker;
 *   - two labels per package, for two sides of it.
 *
 * The QR holds the public tracking link, not a private id: a stranger who
 * scans a lost barrel sees where it is going and nothing personal, and the
 * business's app reads the code out of the same link to show the owner.
 *
 * Pure: the caller loads the records and renders the QR codes (the `qrcode`
 * package is async); this turns them into a model and the model into a page.
 */

const {trackingLink} = require("./container_updates");
const {documentLogo} = require("./parking_document");

const LABELS_PER_PACKAGE = 2;
// One container can hold a lot of barrels; a sheet beyond this is a typo in
// a quantity, not a print job.
const MAX_LABELS = 1200;

const LABEL_FORMATS = Object.freeze({
  // US Letter, 2 x 3 labels of 4" x 3 1/3" - Avery 5524 (weatherproof),
  // 5164 and 8164 share the layout.
  sheet: {page: "letter", columns: 2, rows: 3, width: "4in",
    height: "3.333in", marginTop: "0.5in", marginSide: "0.156in",
    gap: "0.1875in"},
  // 4" x 6" thermal roll - one label per page, for Zebra, Rollo and the
  // like, printing on synthetic stock that shrugs off rain.
  thermal: {page: "4in 6in", columns: 1, rows: 1, width: "4in",
    height: "6in", marginTop: "0", marginSide: "0", gap: "0"},
});

const escape = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => (
  {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[char]
));
const text = (value, max = 200) => String(value ?? "").trim().slice(0, max);
const positiveInt = (value) => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
};

/**
 * @param {*} value A requested format.
 * @return {"sheet"|"thermal"} A known format.
 */
function labelFormat(value) {
  return text(value, 20) === "thermal" ? "thermal" : "sheet";
}

/**
 * Labels per package: two by default (two sides), one when the business is
 * reprinting a single torn label.
 *
 * @param {*} value A requested count.
 * @return {1|2} The count.
 */
function labelCopies(value) {
  return Number(value) === 1 ? 1 : LABELS_PER_PACKAGE;
}

/**
 * What one package is, for the label.
 *
 * @param {object} line A containerLines row.
 * @return {string} e.g. "Barrel", "2015 Toyota Camry".
 */
function packageName(line) {
  const kind = text(line.kind, 20);
  if (kind === "car") {
    return [line.carYear, line.carMake, line.carModel]
        .map((v) => text(v, 80)).filter(Boolean).join(" ") || "Car";
  }
  if (kind === "barrels") return "Barrel";
  return text(line.description, 80) || "Package";
}

/**
 * Every label for a container: one per copy per package per line, in the
 * order the lines were loaded. Lines without a tracking code are left out
 * (the caller assigns codes first).
 *
 * @param {object} input {container, lines, business, consoleUrl}.
 * @return {object} The labels model.
 */
function containerLabelsModel({container, lines, business, consoleUrl,
  onlyCode = "", copies = LABELS_PER_PACKAGE}) {
  const only = text(onlyCode, 40).toUpperCase();
  const perPackage = labelCopies(copies);
  const c = container && typeof container === "object" ? container : {};
  const org = business && typeof business === "object" ? business : {};
  const reference = text(c.containerNumber, 20) || text(c.label, 120) ||
    text(c.bookingReference, 60) || "Container";
  const labels = [];
  const codes = [];
  for (const row of Array.isArray(lines) ? lines : []) {
    const line = row && typeof row === "object" ? row : {};
    const code = text(line.trackingCode, 40);
    if (!code || (only && code !== only)) continue;
    codes.push(code);
    const packages = text(line.kind, 20) === "car" ?
      1 : Math.max(1, positiveInt(line.quantity));
    const stock = text(line.ownerKind, 20) === "stock";
    for (let n = 1; n <= packages; n++) {
      for (let copy = 1; copy <= perPackage; copy++) {
        if (labels.length >= MAX_LABELS) break;
        labels.push({
          code,
          link: trackingLink(consoleUrl, code),
          what: packageName(line),
          vin: text(line.kind, 20) === "car" ? text(line.vinNumber, 17) : "",
          packageNumber: n,
          packageCount: packages,
          // The name painted on the barrel is the receiver's; the sender is
          // the fallback for a line with no receiver yet.
          receiver: text(line.receiverName, 120),
          sender: stock ? "" : text(line.customerName, 120),
        });
      }
    }
  }
  return {
    reference,
    destination: text(c.destinationCountryName, 120),
    businessName: text(org.name, 160),
    businessPhone: text(org.phone, 40),
    logo: documentLogo(org),
    codes: [...new Set(codes)],
    labels,
    onlyCode: only,
    copies: perPackage,
    truncated: labels.length >= MAX_LABELS,
  };
}

/**
 * @param {object} model From containerLabelsModel.
 * @param {object} opts {format, qrSvgByCode: {[code]: svg string}}.
 * @return {string} The printable page.
 */
function renderContainerLabels(model, opts = {}) {
  const m = model || {};
  const format = labelFormat(opts.format);
  const f = LABEL_FORMATS[format];
  const qr = opts.qrSvgByCode || {};
  const perPage = f.columns * f.rows;
  const cells = (m.labels || []).map((label) => `<div class="label">
    <div class="qr">${qr[label.code] || ""}</div>
    <div class="info">
      <div class="code">${escape(label.code)}</div>
      <div class="pkg">${escape(label.what)}${label.packageCount > 1 ?
    ` &middot; ${escape(label.packageNumber)} / ${escape(label.packageCount)}` :
    ""}</div>
      ${label.vin ? `<div class="sub">VIN ${escape(label.vin)}</div>` : ""}
      ${label.receiver ? `<div class="to"><span>To / Pour</span>` +
        `${escape(label.receiver)}</div>` : ""}
      ${!label.receiver && label.sender ? `<div class="to"><span>` +
        `From / De</span>${escape(label.sender)}</div>` : ""}
      ${m.destination ? `<div class="sub">${escape(m.destination)}</div>` : ""}
    </div>
    <div class="foot">
      <span>${escape(m.businessName || "Laawol Digital")}${m.businessPhone ?
    ` &middot; ${escape(m.businessPhone)}` : ""}</span>
      <span>${escape(m.reference)}</span>
    </div>
  </div>`);
  const pages = [];
  for (let i = 0; i < cells.length; i += perPage) {
    pages.push(`<section class="page">${cells.slice(i, i + perPage)
        .join("")}</section>`);
  }
  const title = `Labels ${m.reference || ""} - ${m.businessName || "Laawol"}`;
  const big = format === "thermal";
  // Each toolbar link changes one setting and keeps the others.
  const current = {labels: format, copies: String(m.copies || 2),
    ...(m.onlyCode ? {code: m.onlyCode} : {})};
  const link = (change) => escape(`${opts.query || ""}&${
    new URLSearchParams({...current, ...change}).toString()}`);
  const empty = "<p class=\"hint\">No packages on this container yet.</p>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escape(title)}</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#eef1f0;color:#000;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .actions{position:sticky;top:0;background:#fff;padding:12px 16px;
    display:flex;flex-wrap:wrap;gap:10px;align-items:center;
    border-bottom:1px solid #dfe3e2;font-size:14px}
  .actions b{margin-right:auto}
  .actions a,.actions button{background:#0D9488;color:#fff;border:0;
    border-radius:8px;padding:9px 14px;font-size:14px;font-weight:600;
    cursor:pointer;text-decoration:none}
  .actions a.off{background:#e6ecea;color:#12211f}
  .hint{max-width:8.5in;margin:12px auto;padding:0 16px;color:#5b6b68;
    font-size:13px;line-height:1.5}
  .page{width:${format === "thermal" ? "4in" : "8.5in"};
    ${format === "thermal" ? "height:6in;" : "min-height:11in;"}
    margin:16px auto;background:#fff;
    padding:${f.marginTop} ${f.marginSide};display:grid;
    grid-template-columns:repeat(${f.columns},${f.width});
    grid-auto-rows:${f.height};column-gap:${f.gap};align-content:start;
    box-shadow:0 4px 16px rgba(0,0,0,.08)}
  .label{position:relative;overflow:hidden;padding:${big ? "0.25in" :
    "0.14in"};display:grid;grid-template-columns:${big ?
  "1fr" : "1.75in 1fr"};grid-template-rows:${big ? "auto 1fr auto" :
  "1fr auto"};gap:${big ? "0.12in" : "0.08in 0.14in"};
    border:1px dashed #c8cfcd}
  .qr{${big ? "width:2.6in;height:2.6in;margin:0 auto;" :
    "width:1.75in;height:1.75in;"}align-self:center}
  .qr svg{width:100%;height:100%;display:block}
  .info{min-width:0;display:flex;flex-direction:column;gap:3px;
    ${big ? "text-align:center;" : ""}}
  .code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace;
    font-weight:800;font-size:${big ? "30pt" : "17pt"};letter-spacing:1px;
    line-height:1.1}
  .pkg{font-weight:700;font-size:${big ? "15pt" : "10.5pt"}}
  .to{font-weight:800;font-size:${big ? "17pt" : "12pt"};line-height:1.15;
    overflow-wrap:anywhere}
  .to span{display:block;font-weight:600;font-size:7.5pt;
    text-transform:uppercase;letter-spacing:.5px;color:#333}
  .sub{font-size:${big ? "11pt" : "8.5pt"};color:#222}
  .foot{grid-column:1/-1;display:flex;justify-content:space-between;gap:8px;
    border-top:1px solid #000;padding-top:3px;font-size:7.5pt;
    font-weight:600}
  .foot span{overflow:hidden;white-space:nowrap;text-overflow:ellipsis}
  @page{size:${f.page};margin:0}
  @media print{
    body{background:#fff}
    .actions,.hint{display:none}
    .page{margin:0;box-shadow:none;break-after:page}
    .label{border-color:transparent}
  }
</style></head><body>
<div class="actions">
  <b>${escape(m.labels?.length || 0)} labels &middot; ${escape(
    m.onlyCode || m.reference)}</b>
  <a class="${format === "sheet" ? "" : "off"}" href="?${link(
    {labels: "sheet"})}">Sheet (Avery 5524)</a>
  <a class="${format === "thermal" ? "" : "off"}" href="?${link(
    {labels: "thermal"})}">Thermal 4&times;6</a>
  <a class="${m.copies === 1 ? "off" : ""}" href="?${link(
    {copies: "2"})}">2 per package</a>
  <a class="${m.copies === 1 ? "" : "off"}" href="?${link(
    {copies: "1"})}">1 per package</a>
  <button type="button" onclick="window.print()">Print</button>
</div>
<p class="hint">Stick each label flat on a clean, dry surface - the lid
or the upper side of a barrel, never across a seam - and cover it with clear
packing tape. Use weatherproof polyester or vinyl labels; on a thermal
printer use thermal-transfer labels with a resin ribbon, because direct
thermal labels fade in a hot container. Write the code on the package in
marker too. If a label won't scan, type the code shown on it.<br>
Collez chaque étiquette à plat sur une surface propre et sèche, couvrez-la
de ruban adhésif transparent et écrivez aussi le code au marqueur sur le
colis. Si une étiquette ne se lit plus, saisissez le code imprimé.${
  m.truncated ? "<br><b>Only the first 1200 labels are shown.</b>" : ""}</p>
${pages.join("\n") || empty}
</body></html>`;
}

module.exports = {
  LABELS_PER_PACKAGE,
  LABEL_FORMATS,
  labelFormat,
  labelCopies,
  containerLabelsModel,
  renderContainerLabels,
};
