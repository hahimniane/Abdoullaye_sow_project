# Inventory service (source of truth for server, console and app)

A shop that sells goods keeps a list of products, prints a small QR tag per
product, and staff scan a tag in the app to sell it; each sale takes stock down
and is recorded. Decisions agreed with the owner on 2026-10-10.

## Rules (settled)
- Service key `inventory` (admin switches it on per business, no charge). Staff permission section `inventory` (one level: sell, create, stock, price, reports, void). Every change records who did it.
- One product = one QR. No sizes/colors: each size or color is its own product.
- Online only. No offline queue.
- A sale is its own record (NOT an invoice). Laawol never charges the customer; it records what the shop took at the counter (payment methods reuse `INVOICE_PAYMENT_METHODS`: cash, zelle, cashapp, venmo, check, card_in_person, other).
- The price is set on the product; at the counter staff may sell at a different price per line (any staff). Keep list price AND sold price AND who sold.
- Selling a product whose count is below the quantity sold is ALLOWED: quantity floors at 0, the line and the product get `countWasOff: true` ("count was off"), the call returns a warning. Never negative.
- Undo a sale = void the whole sale: stock goes back, sale stays in history marked voided (who, when). Nothing is erased.
- Archive is the default removal (hidden from selling and the active list, history kept). Delete is allowed behind a confirmation; sales keep a snapshot of name/price/cost so history survives.
- No receipts. No size, no offline, no customer self-checkout.
- Tag = QR only, 2x1 inch thermal layout, N copies of the SAME code (reprint never changes the code). A customer's phone camera opening the link sees a neutral page with NO product details.
- The QR encodes `https://customer.laawoldigital.com/i/<CODE>`; staff scanning in the app go to the basket.

## Data (Firestore; client read-only via the business read rule used for containers; every write is a callable)
`inventoryItems/{id}`: businessId, name, code (`IT-` + 6 chars from the reduced alphabet in my_flutter_app/lib/services/package_codes.dart / functions generateTrackingCode, unique), priceCents (int), costCents (int|null), quantity (int >= 0), lowStockAt (int|null; item is "low" when quantity <= lowStockAt, and ALWAYS when quantity == 0), category (string, "" ok), photoUrl (string, "" ok), archived (bool), countWasOff (bool), createdAt, updatedAt, createdByStaffId.
`inventoryMovements/{id}`: businessId, itemId, type (`initial`|`add`|`set`|`sale`|`void`), delta (int, signed, actual change after flooring), quantityAfter, byStaffId, note, saleId (""), createdAt.
`inventorySales/{id}`: businessId, lines[{itemId, name, code, quantity, listPriceCents, soldPriceCents, costCents|null, countWasOff}], totalCents (sum of quantity*soldPriceCents), paymentMethod, soldByStaffId, clientRequestId (idempotency, unique per business), voided (bool), voidedByStaffId, voidedAt, createdAt.
Money is integer cents USD, capped like invoice_ledger.js (MAX_CENTS). Audit through the same writeLotLedgerAudit pattern (entityType `inventory_item` / `inventory_sale`).

## Callables (all: requireBusinessPermission(uid, businessId, "inventory") + service enabled check like other services; failures use details.reason codes like the container callables)
- `createInventoryItem {businessId, name, priceCents, costCents?, quantity, lowStockAt?, category?, photoUrl?}` -> {itemId, code}. Writes an `initial` movement when quantity > 0.
- `updateInventoryItem {businessId, itemId, name?, priceCents?, costCents?, lowStockAt?, category?, photoUrl?}` (never quantity).
- `adjustInventoryStock {businessId, itemId, mode: "add"|"set", quantity, note?}` -> {quantity}. `add` adds a positive number; `set` corrects the count (clears countWasOff). One movement each.
- `archiveInventoryItem {businessId, itemId, archived}`; `deleteInventoryItem {businessId, itemId, confirm: true}` (refuses without confirm).
- `recordInventorySale {businessId, clientRequestId, paymentMethod, lines:[{itemId, quantity, soldPriceCents}]}` -> {saleId, totalCents, warnings:[{itemId, reason:"count_was_off"}]}. One transaction; archived or foreign items refused (`item_archived`, `item_not_found`); same clientRequestId returns the same sale (no double sale on a retry).
- `voidInventorySale {businessId, saleId, reason?}` -> {}. Refuses if already voided (`sale_voided`).
- `getInventoryLabelsUrl {businessId, itemId, copies}` -> {url}; copies 1..500; renders through the existing label page handler (`parkingDocument` /d) as a new view `inventoryTags`, format `tag` 2in x 1in, QR only (error correction H).
- `getInventorySummary {businessId, range: "today"|"month", timeZone}` -> {salesCount, itemsSold, revenueCents, costCents (known costs only), profitCents, discountCents (sum of (list-sold)*qty where positive), best:[{itemId,name,quantity,revenueCents}] (top 5), low:[{itemId,name,quantity,lowStockAt}], countWasOff:[{itemId,name}]}. Voided sales excluded. Reads server-side (never the whole sales list in the browser).
Client reads (rules): inventoryItems where businessId (+ code for scan lookup, archived filter), inventorySales where businessId ordered by createdAt desc (paged), inventoryMovements where businessId and itemId.

## Where it shows up
- Service list entries (hard-coded in several places, see the exploration): server VALID_BUSINESS_SERVICES + COLLECTION_TO_SERVICE/hasServiceAccess; VALID_BUSINESS_PERMISSIONS (comment there warns a missing key is silently stripped); console business-service-settings.ts, admin-console businessServices + permission options + labels, profile-support-people.tsx permission map, console-router preview; app BusinessServiceKey + catalog, BusinessPermission, add_staff_screen, user_management_screen; sidebar entry `inventory` with service `inventory` and permission `inventory`.
- Public: `https://customer.laawoldigital.com/i/<CODE>` shows a plain neutral page ("This tag is for the shop's staff. Open it in the Laawol app.") with no product data, in English and French. The app's universal-link / app-link configuration (apple-app-site-association paths, Android intent filter) must include `/i/*`, like `/t/*` for packages.
- Console: Inventory tab (products list with low/countWasOff/archived filters, create/edit, stock add/set, print tags, archive/delete, sales list with void, today/month summary). App: Inventory section (products list + stock add + print tags via getInventoryLabelsUrl, Sell screen = scan -> basket (qty default 1, qty editable, price editable per line, payment method, Sold), sales list with void, today summary + low stock). Scanning the same product twice adds 1 to that line's quantity.
- All user-facing strings in English AND French (console french-dom.ts; app app_en.arb/app_fr.arb + flutter gen-l10n).

## Console notes (admin_web: what the web client assumes of the callables)
- `updateInventoryItem`: a cleared cost or low-stock number is sent as `null` (and only when the product had one); category and photoUrl clear with `""`. The count is never sent.
- `createInventoryItem` answers `{itemId, code}`; the console opens the tags dialog on it for "Save & print tags".
- Failure reasons the console words itself (`details.reason`): `item_archived`, `item_not_found`, `sale_not_found`, `sale_voided`, `confirm_required`, `service_not_enabled`, plus the validation codes `name_required`, `price_invalid`, `cost_invalid`, `quantity_invalid`, `low_stock_invalid`, `photo_url_invalid`, `copies_invalid`, `payment_method_invalid`. Any other reason falls back to the server's own message.
- Reads needing composite indexes in `firestore.indexes.json`: `inventorySales` (businessId ASC, createdAt DESC) and `inventoryMovements` (businessId ASC, itemId ASC, createdAt DESC). `inventoryItems` uses `businessId ==` + `archived ==` only (no composite).
- A voided sale may carry `voidReason`; the console shows it when present.
- Public tag page: `/i/<CODE>` is rewritten by `admin_web/public/.htaccess` to `/?service=item-tag` (the code is dropped); the page is also recognised from a bare `/i/<CODE>` path. `apple-app-site-association` lists `/i/*`; the Android intent filter (`AndroidManifest.xml`, `pathPrefix="/i/"`) is the app's to add.
