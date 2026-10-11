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

## Backend as built (my_flutter_app/functions: `inventory.js`, `inventory_tags.js`, callables in `index.js`)
Everything above stands. These are the exact details clients can rely on, and the few places the build made a call the contract left open (marked DECISION) or differs from it (marked DEVIATION).

**Gate and errors**
- Every callable: signed in, then `requireBusinessPermission(uid, businessId, "inventory")` (`permission-denied`), then the business must exist (`not-found`, reason `business_not_found`) and have service `inventory` in `enabledServices` (`failed-precondition`, reason `service_disabled`).
- DECISION: `inventory` is NOT in the default service list. A business that never stored `enabledServices` does not have it; an admin must switch it on. (`DEFAULT_BUSINESS_SERVICES` excludes it; `VALID_BUSINESS_SERVICES` and `VALID_BUSINESS_PERMISSIONS` include it.) The staff-permission vocabulary test (`test/business-permission-vocabulary.test.js`) fails until the console and the app lists add `inventory`.
- Every refusal is an `HttpsError` whose message is the English text of `INVENTORY_MESSAGES` and whose `details` are `{reason: <first code>, reasons: [<every code>], ...}`. Validation = `invalid-argument` (all problems at once in `reasons`); `item_not_found` / `sale_not_found` / `business_not_found` = `not-found`; `item_archived` / `sale_voided` / `service_disabled` = `failed-precondition`. Item refusals on a sale add `details.itemIds`.
- Codes: `business_not_found, service_disabled, item_not_found, item_archived, sale_not_found, sale_voided, name_required, name_too_long, price_invalid, cost_invalid, quantity_invalid, low_stock_invalid, category_too_long, photo_url_invalid, nothing_to_update, quantity_not_editable, mode_invalid, archived_invalid, confirm_required, payment_method_invalid, lines_required, lines_too_many, total_too_large, client_request_id_invalid, copies_invalid, range_invalid`.
- All successful answers carry `success: true` besides the contract fields.

**Fields and limits**
- Product: name 1..120 chars; `priceCents` integer 1..MAX_CENTS; `costCents` integer 0..MAX_CENTS or null (empty = null); `quantity` / `lowStockAt` integers 0..1,000,000 (`lowStockAt` empty = null); category <= 60 chars; `photoUrl` empty or an `https://` address (DECISION: plain string, no Storage upload, no storage rule). A product also stores `updatedByStaffId` and `documentToken` (secret behind its tag-printing link). `code` is globally unique (`IT-` + 6 chars, `generateTrackingCode("IT", "inventoryItems", "code")`).
- Archived products can still be edited, restocked, printed and deleted; they cannot be sold.
- `updateInventoryItem` with a `quantity` key is refused (`quantity_not_editable`); with nothing to change `nothing_to_update`. Answer: `{itemId, changed: [field labels]}`.
- `adjustInventoryStock`: `add` needs 1..1,000,000 and the result may not pass 1,000,000; `set` 0..1,000,000. `note` <= 200 chars. Movement `delta` for `set` is after - before (can be 0 or negative).
- `archiveInventoryItem` needs a real boolean (`archived_invalid`); repeating is a no-op. `deleteInventoryItem` needs `confirm === true` (a string "true" is refused). Delete removes only the product: its sales and its movement rows stay (sales keep the snapshot).

**Sale**
- Limits: 1..50 lines, quantity 1..1,000,000 per line, `clientRequestId` 8..100 chars of `[A-Za-z0-9_.:-]`, total <= MAX_CENTS.
- DECISION: a line's `soldPriceCents` must be typed (an empty field is `price_invalid`), and `0` is allowed (a giveaway, shown as a full discount). The product's own list price must be >= 1.
- The sale's document id is `sha256(businessId + NUL + clientRequestId)` (40 hex chars), so the same key can only ever be one sale. A retry answers `{saleId, totalCents, warnings, replayed: true}` with the stored sale's values and writes nothing; the first send has `replayed: false`.
- Two lines of one product in one sale share its stock, in order. Sold-out sales floor at 0 and set `countWasOff` on the line and the product (the flag stays until a `set`).
- ADDITIVE: each sale line also stores `stockDeducted` (what really left the shelf, <= `quantity`). Void puts back exactly that, so a floored sale never invents stock. Movement rows: one per line (`delta` can be 0 when the shelf was already empty), type `sale`, `saleId` set.
- `voidInventorySale` answers `{success, skippedItemIds}`; a product deleted since is skipped (its stock cannot be restored). It adds `voidReason` (<= 300) to the sale and one `void` movement per line whose product still exists. Void works on archived products. Double void: `sale_voided`.

**Tags**
- `getInventoryLabelsUrl {businessId, itemId, copies}`: DEVIATION from "copies 1..500" only in that an out-of-range or missing `copies` is REFUSED (`copies_invalid`), never clamped. Answer `{url}` = `<PARKING_DOCUMENT_BASE_URL or https://laawoldigital.com/d>?t=<item token>&view=inventoryTags&labels=tag&copies=N`. The token is minted once per product and reused. The page (`inventory_tags.js`) is 2 x 1 inch (`@page size 2in 1in`), one tag per page, the QR (error correction H) and nothing else (no code text, no name, no price). The QR holds `<CUSTOMER_CONSOLE_URL or https://customer.laawoldigital.com>/i/<CODE>`. The neutral public `/i/<CODE>` page and the app-link paths are the clients' (not the functions').

**Summary** `getInventorySummary {businessId, range: "today"|"month", timeZone}`
- Answer: `salesCount, itemsSold, revenueCents, costCents, profitCents, discountCents, best[5], low[], countWasOff[]` plus `range, since (ISO start of the range), timeZone (the zone used; an unknown zone reads as UTC), linesWithoutCost, lowCount, countWasOffCount, truncated`.
- DECISION: `costCents` sums quantity x cost over lines with a known cost; `profitCents` = revenue of those same lines - `costCents` (a product with no cost adds revenue but no profit), and `linesWithoutCost` says how many lines were left out, so a screen can say "profit excludes N lines". Voided sales are excluded everywhere.
- `best` = top 5 by pieces, then revenue. `low` and `countWasOff` hide archived products and are capped at 100 entries each (the `...Count` fields are exact). Reads are server-side, cursor-paged (500 per page, at most 40 pages of sales and 40 of products, 60 s budget); `truncated: true` if a bound was hit.

**History and fees**
- `lotLedgerAudit` rows: entityType `inventory_item` (entityId = product id; actions `created, edited, stock_added, stock_set, archived, restored, deleted`) and `inventory_sale` (entityId = sale id; actions `sold, voided`). DECISION: `sold` rows are written already `acknowledged: true` (`writeLotLedgerAudit` accepts an optional `acknowledged`), so counter sales are history but do not flood the Today "Needs attention" feed; all other actions are unacknowledged like the container ones.
- No charge and no platform fee: inventory never touches `platform_fees.js` or `business_billing_plan.js` (both are keyed by a charge's service, and a sale moves no money through Laawol). It needs no verification document and is not in `COLLECTION_TO_SERVICE` (the platform-admin write path does not apply: every write is a callable).

**Rules and indexes** (`firestore.rules`, `firestore.indexes.json`): `inventoryItems`, `inventorySales`, `inventoryMovements`: read `lotLedgerRead(resource.data.businessId)`, write false. Composite indexes: items (businessId, code), (businessId, archived), (businessId, name), (businessId, archived, name); sales (businessId, createdAt desc); movements (businessId, itemId), (businessId, itemId, createdAt desc). Clients must always include `where businessId == mine`; the `console-query-rules` test pins the shapes in the "Client reads" line above plus ordered-by-name and archived filters.

**Tests**: `test/inventory.test.js` (pure), `test/inventory-callables.test.js` (`npm run test:inventory`, Firestore emulator), plus inventory cases in `test/firestore-rules.test.js` and `test/console-query-rules.test.js`.
