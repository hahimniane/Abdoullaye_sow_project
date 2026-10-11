"use strict";

/**
 * The printable page of product tags: one 2 inch by 1 inch thermal label per
 * copy, the product's QR code and nothing else. The tag is stuck on the
 * product, so the code has to survive a scuffed corner: the QR is drawn at
 * error correction level H (the caller renders it), and every copy of one
 * product is the SAME code - printing again never changes it.
 *
 * Pure: the caller renders the QR (the `qrcode` package is async) and passes
 * the SVG in.
 */

const escape = (value) => String(value ?? "").replace(/[&<>"]/g, (char) => (
  {"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;"}[char]
));

/**
 * @param {object} model From tagsModel: {code, link, copies}.
 * @param {object} opts {qrSvg: the QR as an SVG string}.
 * @return {string} The printable page.
 */
function renderInventoryTags(model, opts = {}) {
  const m = model || {};
  const copies = Math.max(1, Math.min(500, Number(m.copies) || 1));
  const tag = `<section class="tag"><div class="qr">${opts.qrSvg || ""}` +
    "</div></section>";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Tags - Laawol</title>
<style>
  *{box-sizing:border-box}
  body{margin:0;background:#eef1f0;color:#000;
    font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
  .actions{position:sticky;top:0;background:#fff;padding:12px 16px;
    display:flex;flex-wrap:wrap;gap:10px;align-items:center;
    border-bottom:1px solid #dfe3e2;font-size:14px}
  .actions b{margin-right:auto}
  .actions button{background:#0D9488;color:#fff;border:0;border-radius:8px;
    padding:9px 14px;font-size:14px;font-weight:600;cursor:pointer}
  .hint{max-width:6in;margin:12px auto;padding:0 16px;color:#5b6b68;
    font-size:13px;line-height:1.5}
  .tag{width:2in;height:1in;margin:12px auto;background:#fff;display:flex;
    align-items:center;justify-content:center;padding:0.04in;
    box-shadow:0 2px 8px rgba(0,0,0,.1)}
  .qr{width:0.92in;height:0.92in}
  .qr svg{width:100%;height:100%;display:block}
  @page{size:2in 1in;margin:0}
  @media print{
    body{background:#fff}
    .actions,.hint{display:none}
    .tag{margin:0;box-shadow:none;break-after:page;page-break-after:always}
  }
</style></head><body>
<div class="actions">
  <b>${escape(copies)} ${copies === 1 ? "tag" : "tags"} &middot; 2 &times; 1 in
    / ${escape(copies)} ${copies === 1 ? "étiquette" : "étiquettes"}</b>
  <button type="button" onclick="window.print()">Print / Imprimer</button>
</div>
<p class="hint">Print on 2 &times; 1 inch thermal labels. Every tag carries the
same code, so print as many as you need. Stick it flat on the product or its
package and cover it with clear tape.<br>
Imprimez sur des étiquettes thermiques de 2 &times; 1 pouce. Toutes les
étiquettes portent le même code. Collez-la à plat sur le produit ou son
emballage.</p>
${Array.from({length: copies}, () => tag).join("\n")}
</body></html>`;
}

module.exports = {renderInventoryTags};
