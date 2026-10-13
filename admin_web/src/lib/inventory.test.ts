import assert from "node:assert/strict";
import { test } from "node:test";

import {
  INVENTORY_MESSAGES,
  INVENTORY_MOVEMENT_LABELS,
  INVENTORY_STATUS_LABELS,
  addToBasket,
  adjustInventoryStockRequest,
  archiveInventoryItemRequest,
  basketLineFromItem,
  basketLineTotals,
  basketTotals,
  createInventoryItemRequest,
  deleteConfirmationMatches,
  deleteInventoryItemRequest,
  emptyInventoryItemDraft,
  emptyStockDraft,
  filterInventoryItems,
  inventoryCallableFailure,
  inventoryCodeFrom,
  inventoryCounts,
  inventoryDraftChanged,
  inventoryDraftFromItem,
  inventoryIsLow,
  inventoryItemFromRow,
  inventoryLabelsRequest,
  inventoryLabelsUrl,
  inventoryMessage,
  inventoryMovementEntries,
  inventorySaleFromRow,
  inventoryStatus,
  inventorySummaryRequest,
  inventoryTagUrl,
  itemCountText,
  leftText,
  newClientRequestId,
  photoUrlOk,
  productCountText,
  readInventorySummary,
  readSaleResponse,
  readWholeNumber,
  recordInventorySaleRequest,
  runInventoryCall,
  signedCount,
  stockAfter,
  tagCountText,
  updateInventoryItemRequest,
  validateBasket,
  validateInventoryItemDraft,
  validateLabelCopies,
  validateStockDraft,
  validateVoidReason,
  voidConsequenceText,
  voidInventorySaleRequest,
  voidedByText,
  businessHasInventory,
  setBusinessInventoryRequest,
  type BasketLine,
  type InventoryItemDraft,
} from "./inventory.ts";

const item = (over: Record<string, unknown> = {}) => inventoryItemFromRow({
  id: "i1",
  name: "Shea butter",
  code: "IT-K7M4P2",
  priceCents: 1250,
  costCents: 800,
  quantity: 10,
  lowStockAt: 3,
  category: "Care",
  photoUrl: "",
  archived: false,
  countWasOff: false,
  ...over,
});

const draft = (over: Partial<InventoryItemDraft> = {}): InventoryItemDraft => ({
  ...emptyInventoryItemDraft,
  name: "Shea butter",
  price: "12,50",
  quantity: "4",
  ...over,
});

// ---------------------------------------------------------------------------
// The code and the tag.
// ---------------------------------------------------------------------------

test("a product's code is read from the bare code, a typed one, or the tag's link", () => {
  assert.equal(inventoryCodeFrom("IT-K7M4P2"), "IT-K7M4P2");
  assert.equal(inventoryCodeFrom(" it k7m4p2 "), "IT-K7M4P2");
  assert.equal(inventoryCodeFrom("https://customer.laawoldigital.com/i/IT-K7M4P2"), "IT-K7M4P2");
  assert.equal(inventoryCodeFrom("https://customer.laawoldigital.com/i/it-k7m4p2?x=1"), "IT-K7M4P2");
  // Packages, bookings, a zero for an O, a wrong length: not a product.
  assert.equal(inventoryCodeFrom("CL-K7M4P2"), "");
  assert.equal(inventoryCodeFrom("IT-K7M4P0"), "");
  assert.equal(inventoryCodeFrom("IT-K7M4P"), "");
  assert.equal(inventoryCodeFrom(""), "");
  assert.equal(inventoryTagUrl("it-k7m4p2"), "https://customer.laawoldigital.com/i/IT-K7M4P2");
});

// ---------------------------------------------------------------------------
// Status, filters, search.
// ---------------------------------------------------------------------------

test("low means at or below the threshold, and always at zero; archived wins", () => {
  assert.equal(inventoryStatus(item({ quantity: 10, lowStockAt: 3 })), "ok");
  assert.equal(inventoryStatus(item({ quantity: 3, lowStockAt: 3 })), "low");
  assert.equal(inventoryStatus(item({ quantity: 1, lowStockAt: 3 })), "low");
  assert.equal(inventoryStatus(item({ quantity: 1, lowStockAt: null })), "ok");
  // Zero is low whatever the threshold says - even with none set.
  assert.equal(inventoryStatus(item({ quantity: 0, lowStockAt: null })), "out");
  assert.equal(inventoryStatus(item({ quantity: 0, lowStockAt: 0 })), "out");
  assert.equal(inventoryIsLow(item({ quantity: 0, lowStockAt: null })), true);
  assert.equal(inventoryIsLow(item({ quantity: 5, lowStockAt: 3 })), false);
  assert.equal(inventoryStatus(item({ archived: true, quantity: 0 })), "archived");
  assert.equal(inventoryIsLow(item({ archived: true, quantity: 0 })), false);
  for (const label of Object.values(INVENTORY_STATUS_LABELS)) assert.ok(label);
});

test("a stored row is read defensively: no negative counts, unknown cost stays unknown", () => {
  const read = inventoryItemFromRow({ id: "x", name: " Soap ", priceCents: "300", quantity: -4, costCents: null, lowStockAt: "" });
  assert.equal(read.name, "Soap");
  assert.equal(read.priceCents, 300);
  assert.equal(read.quantity, 0);
  assert.equal(read.costCents, null);
  assert.equal(read.lowStockAt, null);
  assert.equal(inventoryItemFromRow({ id: "x", costCents: 0 }).costCents, 0);
  assert.equal(inventoryItemFromRow(null).id, "");
});

const rows = [
  { id: "a", name: "Zinc cream", code: "IT-222222", category: "Care", priceCents: 500, quantity: 5, lowStockAt: 2 },
  { id: "b", name: "Black soap", code: "IT-333333", category: "Care", priceCents: 500, quantity: 1, lowStockAt: 2 },
  { id: "c", name: "Écorce tea", code: "IT-444444", category: "Tea", priceCents: 500, quantity: 0 },
  { id: "d", name: "Old stock", code: "IT-555555", category: "", priceCents: 500, quantity: 0, archived: true },
  { id: "e", name: "Mystery", code: "IT-666666", category: "", priceCents: 500, quantity: 9, countWasOff: true },
];

test("the filters: all is what is on sale, low includes zero, count-was-off, archived", () => {
  assert.deepEqual(filterInventoryItems(rows, "all", "").map((i) => i.id), ["b", "c", "e", "a"]);
  assert.deepEqual(filterInventoryItems(rows, "low", "").map((i) => i.id), ["b", "c"]);
  assert.deepEqual(filterInventoryItems(rows, "countOff", "").map((i) => i.id), ["e"]);
  assert.deepEqual(filterInventoryItems(rows, "archived", "").map((i) => i.id), ["d"]);
  assert.deepEqual(inventoryCounts(rows), { onSale: 4, low: 2, countOff: 1 });
});

test("search matches name, category and code, accents and case aside, every word", () => {
  assert.deepEqual(filterInventoryItems(rows, "all", "soap").map((i) => i.id), ["b"]);
  assert.deepEqual(filterInventoryItems(rows, "all", "ECORCE").map((i) => i.id), ["c"]);
  assert.deepEqual(filterInventoryItems(rows, "all", "care zinc").map((i) => i.id), ["a"]);
  assert.deepEqual(filterInventoryItems(rows, "all", "it-444444").map((i) => i.id), ["c"]);
  assert.deepEqual(filterInventoryItems(rows, "all", "444444").map((i) => i.id), ["c"]);
  // A pasted tag link finds exactly that product (valid-alphabet code needed).
  const real = [{ id: "z", name: "Real", code: "IT-K7M4P2", priceCents: 1, quantity: 1 }, ...rows];
  assert.deepEqual(filterInventoryItems(real, "all", "https://customer.laawoldigital.com/i/IT-K7M4P2").map((i) => i.id), ["z"]);
  assert.deepEqual(filterInventoryItems(rows, "all", "nothing here"), []);
  // Rows with no id are not products.
  assert.deepEqual(filterInventoryItems([{ name: "ghost" }], "all", ""), []);
});

// ---------------------------------------------------------------------------
// The product form.
// ---------------------------------------------------------------------------

test("a good draft has no problems; every bad field is named at once", () => {
  assert.deepEqual(validateInventoryItemDraft(draft(), true), []);
  assert.deepEqual(validateInventoryItemDraft(draft({ quantity: "" }), false), [], "the count is not edited with the product");
  assert.deepEqual(
    validateInventoryItemDraft(draft({ name: " ", price: "0", cost: "abc", quantity: "-1", lowStockAt: "x", photoUrl: "http://a.b/c.png" }), true),
    ["name_required", "price_invalid", "cost_invalid", "quantity_invalid", "low_stock_invalid", "photo_url_invalid"],
  );
  assert.deepEqual(validateInventoryItemDraft(draft({ name: "x".repeat(121) }), true), ["name_too_long"]);
  assert.deepEqual(validateInventoryItemDraft(draft({ category: "c".repeat(61) }), true), ["category_too_long"]);
  // Cost is optional and may be zero; the price must be real money.
  assert.deepEqual(validateInventoryItemDraft(draft({ cost: "0" }), true), []);
  assert.deepEqual(validateInventoryItemDraft(draft({ price: "12.505" }), true), ["price_invalid"]);
  assert.deepEqual(validateInventoryItemDraft(draft({ price: "9999999999" }), true), ["price_invalid"]);
  for (const code of validateInventoryItemDraft(draft({ name: "", price: "" }), true)) assert.ok(INVENTORY_MESSAGES[code]);
});

test("typed money is read the one way: '12,50' is twelve dollars fifty", () => {
  const request = createInventoryItemRequest("biz", draft({ price: "12,50", cost: "8" }));
  assert.equal(request.priceCents, 1250);
  assert.equal((request as { costCents?: number }).costCents, 800);
  assert.equal(createInventoryItemRequest("biz", draft({ price: "1.200,50" })).priceCents, 120050);
});

test("the create request sends only what was entered", () => {
  assert.deepEqual(createInventoryItemRequest(" biz ", draft()), {
    businessId: "biz",
    name: "Shea butter",
    priceCents: 1250,
    quantity: 4,
  });
  assert.deepEqual(
    createInventoryItemRequest("biz", draft({ cost: "8", lowStockAt: "2", category: " Care ", photoUrl: "https://x.test/a.png" })),
    {
      businessId: "biz",
      name: "Shea butter",
      priceCents: 1250,
      quantity: 4,
      costCents: 800,
      lowStockAt: 2,
      category: "Care",
      photoUrl: "https://x.test/a.png",
    },
  );
  // A starting count of zero is a real answer and is sent.
  assert.equal(createInventoryItemRequest("biz", draft({ quantity: "0" })).quantity, 0);
});

test("the update request never carries the count and clears what was cleared", () => {
  const before = item();
  const same = inventoryDraftFromItem(before);
  assert.equal(inventoryDraftChanged(before, same), false);
  assert.equal(inventoryDraftChanged(before, { ...same, name: "Shea" }), true);
  // The same money typed another way is not a change; another amount is.
  assert.equal(inventoryDraftChanged(before, { ...same, price: "12,50" }), false);
  assert.equal(inventoryDraftChanged(before, { ...same, price: "13" }), true);
  const unchangedCost = updateInventoryItemRequest("biz", before, same);
  assert.equal("quantity" in unchangedCost, false);
  assert.deepEqual(unchangedCost, {
    businessId: "biz",
    itemId: "i1",
    name: "Shea butter",
    priceCents: 1250,
    costCents: 800,
    lowStockAt: 3,
    category: "Care",
    photoUrl: "",
  });
  // Cleared cost and low-stock number go as null; never-set ones are left out.
  const cleared = updateInventoryItemRequest("biz", before, { ...same, cost: "", lowStockAt: "", category: "", photoUrl: "" });
  assert.equal((cleared as { costCents?: unknown }).costCents, null);
  assert.equal((cleared as { lowStockAt?: unknown }).lowStockAt, null);
  assert.equal(cleared.category, "");
  const neverSet = updateInventoryItemRequest("biz", item({ costCents: null, lowStockAt: null }), { ...same, cost: "", lowStockAt: "" });
  assert.equal("costCents" in neverSet, false);
  assert.equal("lowStockAt" in neverSet, false);
});

test("a photo is a link to an https page, never an upload and never plain http", () => {
  assert.equal(photoUrlOk(""), true);
  assert.equal(photoUrlOk("https://cdn.example.com/a b.png"), false);
  assert.equal(photoUrlOk("https://cdn.example.com/a.png"), true);
  assert.equal(photoUrlOk("http://cdn.example.com/a.png"), false);
  assert.equal(photoUrlOk("javascript:alert(1)"), false);
  assert.equal(photoUrlOk("data:image/png;base64,AAAA"), false);
  assert.equal(photoUrlOk("cdn.example.com/a.png"), false);
});

test("whole numbers: blank is null, anything else exact", () => {
  assert.equal(readWholeNumber(""), null);
  assert.equal(readWholeNumber(" 12 "), 12);
  assert.ok(Number.isNaN(readWholeNumber("1.5")));
  assert.ok(Number.isNaN(readWholeNumber("-1")));
  assert.ok(Number.isNaN(readWholeNumber("1e3")));
  assert.ok(Number.isNaN(readWholeNumber("0", 1)));
  assert.ok(Number.isNaN(readWholeNumber("1000001")));
});

test("archive and delete requests: delete always carries confirm, and a code must be typed", () => {
  assert.deepEqual(archiveInventoryItemRequest("biz", "i1", true), { businessId: "biz", itemId: "i1", archived: true });
  assert.deepEqual(archiveInventoryItemRequest("biz", "i1", false), { businessId: "biz", itemId: "i1", archived: false });
  assert.deepEqual(deleteInventoryItemRequest("biz", "i1"), { businessId: "biz", itemId: "i1", confirm: true });
  assert.equal(deleteConfirmationMatches({ code: "IT-K7M4P2", name: "Shea" }, "it k7m4p2"), true);
  assert.equal(deleteConfirmationMatches({ code: "IT-K7M4P2", name: "Shea" }, "IT-K7M4P"), false);
  assert.equal(deleteConfirmationMatches({ code: "IT-K7M4P2", name: "Shea" }, ""), false);
  assert.equal(deleteConfirmationMatches({ code: "", name: "" }, ""), false);
});

// ---------------------------------------------------------------------------
// Stock.
// ---------------------------------------------------------------------------

test("add needs a positive whole number, set a count from zero", () => {
  assert.deepEqual(validateStockDraft({ mode: "add", quantity: "5", note: "" }), []);
  assert.deepEqual(validateStockDraft({ mode: "add", quantity: "0", note: "" }), ["add_quantity_invalid"]);
  assert.deepEqual(validateStockDraft({ mode: "add", quantity: "", note: "" }), ["add_quantity_invalid"]);
  assert.deepEqual(validateStockDraft({ mode: "set", quantity: "0", note: "" }), []);
  assert.deepEqual(validateStockDraft({ mode: "set", quantity: "-2", note: "" }), ["set_quantity_invalid"]);
  assert.deepEqual(validateStockDraft({ mode: "set", quantity: "3", note: "n".repeat(201) }), ["note_too_long"]);
  assert.deepEqual(validateStockDraft(emptyStockDraft), ["add_quantity_invalid"]);
});

test("the count after a change is shown before it is made", () => {
  assert.equal(stockAfter(10, { mode: "add", quantity: "5", note: "" }), 15);
  assert.equal(stockAfter(10, { mode: "set", quantity: "2", note: "" }), 2);
  assert.equal(stockAfter(10, { mode: "set", quantity: "0", note: "" }), 0);
  assert.equal(stockAfter(10, { mode: "add", quantity: "x", note: "" }), null);
});

test("the stock request: mode, count and an optional note", () => {
  assert.deepEqual(adjustInventoryStockRequest("biz", "i1", { mode: "add", quantity: "5", note: "" }), {
    businessId: "biz", itemId: "i1", mode: "add", quantity: 5,
  });
  assert.deepEqual(adjustInventoryStockRequest("biz", "i1", { mode: "set", quantity: "0", note: " recount " }), {
    businessId: "biz", itemId: "i1", mode: "set", quantity: 0, note: "recount",
  });
});

// ---------------------------------------------------------------------------
// Tags.
// ---------------------------------------------------------------------------

test("tag copies run from 1 to 500", () => {
  assert.deepEqual(validateLabelCopies("1"), []);
  assert.deepEqual(validateLabelCopies("500"), []);
  assert.deepEqual(validateLabelCopies("0"), ["copies_invalid"]);
  assert.deepEqual(validateLabelCopies("501"), ["copies_invalid"]);
  assert.deepEqual(validateLabelCopies(""), ["copies_invalid"]);
  assert.deepEqual(validateLabelCopies("2.5"), ["copies_invalid"]);
  assert.deepEqual(inventoryLabelsRequest("biz", "i1", "12"), { businessId: "biz", itemId: "i1", copies: 12 });
  assert.equal(inventoryLabelsUrl({ url: "https://x.test/d?t=1" }), "https://x.test/d?t=1");
  assert.equal(inventoryLabelsUrl({ url: "javascript:alert(1)" }), "");
  assert.equal(inventoryLabelsUrl(undefined), "");
});

// ---------------------------------------------------------------------------
// The basket (the app sells; the maths is shared).
// ---------------------------------------------------------------------------

const butter = item({ id: "b1", name: "Butter", priceCents: 1000 });
const soap = item({ id: "s1", name: "Soap", priceCents: 400 });

test("a basket line opens at one, at the list price", () => {
  assert.deepEqual(basketLineFromItem(butter), {
    itemId: "b1", name: "Butter", code: "IT-K7M4P2", quantity: "1", listPriceCents: 1000, soldPrice: "10",
  });
});

test("scanning the same product again adds one to its line", () => {
  let lines: BasketLine[] = [];
  lines = addToBasket(lines, butter);
  lines = addToBasket(lines, soap);
  lines = addToBasket(lines, butter);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].quantity, "2");
  assert.equal(lines[1].quantity, "1");
  // An unreadable quantity restarts at one rather than becoming NaN.
  lines = addToBasket([{ ...lines[0], quantity: "x" }], butter);
  assert.equal(lines[0].quantity, "1");
});

test("totals: quantity times the price it sold at; a markdown is a discount", () => {
  const lines: BasketLine[] = [
    { ...basketLineFromItem(butter), quantity: "3", soldPrice: "9" },
    { ...basketLineFromItem(soap), quantity: "2", soldPrice: "4" },
  ];
  assert.deepEqual(basketLineTotals(lines[0]), {
    quantity: 3, listPriceCents: 1000, soldPriceCents: 900, lineTotalCents: 2700, discountCents: 300, valid: true,
  });
  assert.deepEqual(basketTotals(lines), { totalCents: 3500, listTotalCents: 3800, discountCents: 300, itemCount: 5 });
});

test("selling above the list price is not a discount, and a free line is a full discount", () => {
  const above = { ...basketLineFromItem(butter), soldPrice: "12" };
  assert.equal(basketLineTotals(above).discountCents, 0);
  assert.equal(basketLineTotals(above).lineTotalCents, 1200);
  const free = { ...basketLineFromItem(butter), quantity: "2", soldPrice: "0" };
  assert.equal(basketLineTotals(free).discountCents, 2000);
  assert.equal(basketLineTotals(free).lineTotalCents, 0);
});

test("an unreadable line adds nothing instead of poisoning the total", () => {
  const bad = { ...basketLineFromItem(butter), quantity: "two" };
  assert.equal(basketLineTotals(bad).valid, false);
  assert.deepEqual(basketTotals([bad, basketLineFromItem(soap)]), { totalCents: 400, listTotalCents: 400, discountCents: 0, itemCount: 1 });
});

test("a basket needs a line, readable numbers, a known payment method", () => {
  const ok = [basketLineFromItem(butter)];
  assert.deepEqual(validateBasket(ok, "cash"), []);
  assert.deepEqual(validateBasket([], "cash"), ["sale_lines_required"]);
  assert.deepEqual(validateBasket(ok, "bitcoin"), ["payment_method_invalid"]);
  assert.deepEqual(validateBasket(ok, ""), ["payment_method_invalid"]);
  assert.deepEqual(validateBasket([{ ...ok[0], quantity: "0" }], "zelle"), ["sale_quantity_invalid"]);
  assert.deepEqual(validateBasket([{ ...ok[0], soldPrice: "abc" }], "zelle"), ["sold_price_invalid"]);
  assert.deepEqual(validateBasket([{ ...ok[0], soldPrice: "-1" }], "zelle"), ["sold_price_invalid"]);
  // A price of zero is allowed (a gift).
  assert.deepEqual(validateBasket([{ ...ok[0], soldPrice: "0" }], "cash"), []);
  assert.deepEqual(validateBasket([{ ...ok[0], quantity: "900000", soldPrice: "9999" }], "cash"), ["sale_total_too_large"]);
});

test("the sale request carries cents and the retry key; a retry reuses the key", () => {
  const request = recordInventorySaleRequest("biz", "web-1", "cash", [
    { ...basketLineFromItem(butter), quantity: "3", soldPrice: "9,50" },
    basketLineFromItem(soap),
  ]);
  assert.deepEqual(request, {
    businessId: "biz",
    clientRequestId: "web-1",
    paymentMethod: "cash",
    lines: [
      { itemId: "b1", quantity: 3, soldPriceCents: 950 },
      { itemId: "s1", quantity: 1, soldPriceCents: 400 },
    ],
  });
  assert.equal(newClientRequestId(() => "abc"), "web-abc");
  assert.notEqual(newClientRequestId(), newClientRequestId());
});

test("the sale response lists the products whose count was off", () => {
  assert.deepEqual(readSaleResponse({ saleId: "s9", totalCents: 3500, warnings: [{ itemId: "b1", reason: "count_was_off" }, { itemId: "x", reason: "other" }] }), {
    saleId: "s9", totalCents: 3500, countWasOffItemIds: ["b1"],
  });
  assert.deepEqual(readSaleResponse(undefined), { saleId: "", totalCents: 0, countWasOffItemIds: [] });
});

// ---------------------------------------------------------------------------
// A recorded sale.
// ---------------------------------------------------------------------------

const saleRow = {
  id: "sale1",
  lines: [
    { itemId: "b1", name: "Butter", code: "IT-K7M4P2", quantity: 3, listPriceCents: 1000, soldPriceCents: 900, costCents: 600, countWasOff: false },
    { itemId: "s1", name: "Soap", code: "IT-222222", quantity: 2, listPriceCents: 400, soldPriceCents: 400, costCents: null, countWasOff: true },
  ],
  totalCents: 3500,
  paymentMethod: "card_in_person",
  soldByStaffId: "u1",
  voided: false,
};

test("a sale keeps the list price and the sold price side by side", () => {
  const sale = inventorySaleFromRow(saleRow);
  assert.equal(sale.totalCents, 3500);
  assert.equal(sale.listTotalCents, 3800);
  assert.equal(sale.discountCents, 300);
  assert.equal(sale.itemCount, 5);
  assert.equal(sale.methodLabel, "Card in person");
  assert.equal(sale.anyCountWasOff, true);
  assert.deepEqual(sale.lines.map((l) => [l.repriced, l.lineTotalCents, l.discountCents]), [[true, 2700, 300], [false, 800, 0]]);
  assert.equal(sale.lines[1].costCents, null);
  assert.equal(sale.voided, false);
});

test("the stored total is the record; a sale with none is added up from its lines", () => {
  assert.equal(inventorySaleFromRow({ ...saleRow, totalCents: 9999 }).totalCents, 9999);
  assert.equal(inventorySaleFromRow({ ...saleRow, totalCents: undefined }).totalCents, 3500);
});

test("a voided sale stays in the history, marked, with who voided it", () => {
  const sale = inventorySaleFromRow({ ...saleRow, voided: true, voidedByStaffId: "u2", voidedAt: new Date(0), voidReason: "wrong item" });
  assert.equal(sale.voided, true);
  assert.equal(sale.voidedByStaffId, "u2");
  assert.equal(sale.voidReason, "wrong item");
  assert.equal(sale.lines.length, 2);
});

test("the void request: the reason is optional and trimmed", () => {
  assert.deepEqual(voidInventorySaleRequest("biz", "sale1", ""), { businessId: "biz", saleId: "sale1" });
  assert.deepEqual(voidInventorySaleRequest("biz", "sale1", " rang twice "), { businessId: "biz", saleId: "sale1", reason: "rang twice" });
  assert.deepEqual(validateVoidReason("x".repeat(201)), ["note_too_long"]);
  assert.deepEqual(validateVoidReason(""), []);
});

// ---------------------------------------------------------------------------
// Stock history.
// ---------------------------------------------------------------------------

test("the stock history is newest first, with signed changes and who did it", () => {
  const entries = inventoryMovementEntries([
    { id: "m1", type: "initial", delta: 10, quantityAfter: 10, byStaffId: "u1", createdAt: new Date(1000) },
    { id: "m2", type: "sale", delta: -3, quantityAfter: 7, saleId: "sale1", byStaffId: "u2", createdAt: new Date(3000) },
    { id: "m3", type: "set", delta: 0, quantityAfter: 7, note: "recount", byStaffId: "u1", createdAt: new Date(2000) },
    { id: "m4", type: "weird", delta: 2, quantityAfter: 9, createdAt: new Date(4000) },
  ]);
  assert.deepEqual(entries.map((e) => e.id), ["m4", "m2", "m3", "m1"]);
  assert.deepEqual(entries.map((e) => e.deltaText), ["+2", "-3", "0", "+10"]);
  assert.equal(entries[1].label, INVENTORY_MOVEMENT_LABELS.sale);
  assert.equal(entries[0].label, "weird");
  assert.equal(entries[2].note, "recount");
  assert.equal(signedCount(-1), "-1");
});

// ---------------------------------------------------------------------------
// The summary.
// ---------------------------------------------------------------------------

test("the summary request carries the range and the viewer's time zone", () => {
  assert.deepEqual(inventorySummaryRequest("biz", "today", "America/New_York"), { businessId: "biz", range: "today", timeZone: "America/New_York" });
  assert.equal(inventorySummaryRequest("biz", "month", "").range, "month");
});

test("the summary answer is read tolerantly", () => {
  const read = readInventorySummary({
    salesCount: 4, itemsSold: 9, revenueCents: 12000, costCents: 7000, profitCents: 5000, discountCents: 300,
    best: [{ itemId: "b1", name: "Butter", quantity: 5, revenueCents: 4500 }],
    low: [{ itemId: "s1", name: "Soap", quantity: 1, lowStockAt: 2 }, { itemId: "t1", name: "Tea", quantity: 0, lowStockAt: null }],
    countWasOff: [{ itemId: "m", name: "Mystery" }],
  });
  assert.equal(read?.revenueCents, 12000);
  assert.equal(read?.profitCents, 5000);
  assert.deepEqual(read?.low.map((l) => l.lowStockAt), [2, null]);
  assert.deepEqual(read?.countWasOff, [{ itemId: "m", name: "Mystery", brand: "" }]);
  const empty = readInventorySummary({});
  assert.equal(empty?.salesCount, 0);
  assert.deepEqual(empty?.best, []);
  assert.equal(readInventorySummary(null), null);
  // A loss is a negative profit, and stays negative.
  assert.equal(readInventorySummary({ profitCents: -500 })?.profitCents, -500);
});

// ---------------------------------------------------------------------------
// What the server says.
// ---------------------------------------------------------------------------

test("the server's reason codes become sentences", () => {
  for (const reason of ["item_archived", "item_not_found", "sale_voided"]) {
    const failure = inventoryCallableFailure({ code: "functions/failed-precondition", message: "raw server words", details: { reason } });
    assert.equal(failure.reason, reason);
    assert.equal(failure.message, INVENTORY_MESSAGES[reason as keyof typeof INVENTORY_MESSAGES]);
  }
});

test("an unknown reason keeps the server's readable message; opaque ones become a plain sentence", () => {
  assert.equal(inventoryCallableFailure({ code: "functions/invalid-argument", message: "That name is already used.", details: { reason: "name_taken" } }).message, "That name is already used.");
  assert.equal(inventoryCallableFailure({ code: "functions/internal", message: "internal" }).message, "The change did not save.");
  assert.equal(inventoryCallableFailure({ message: "functions/not-found" }).message, "The change did not save.");
  assert.equal(inventoryCallableFailure(undefined).message, "The change did not save.");
  assert.equal(inventoryCallableFailure("Something broke").message, "Something broke");
});

test("permission and sign-in refusals read the same whatever the transport said", () => {
  assert.equal(inventoryCallableFailure({ code: "functions/permission-denied", message: "Missing permission." }).message, INVENTORY_MESSAGES.permission_denied);
  assert.equal(inventoryCallableFailure({ code: "functions/unauthenticated", message: "Unauthenticated" }).message, INVENTORY_MESSAGES.sign_in_required);
  assert.equal(inventoryCallableFailure({ code: "functions/unavailable", message: "unavailable" }).message, INVENTORY_MESSAGES.offline);
});

test("validation codes read as one sentence each", () => {
  assert.equal(
    inventoryMessage(["name_required", "price_invalid"]),
    "Enter the product's name. Enter the price in dollars, more than zero.",
  );
});

test("a failed call always takes the busy flag down and hands the failure over", async () => {
  const flags: boolean[] = [];
  let failure = "";
  await runInventoryCall((b) => flags.push(b), async () => { throw { details: { reason: "sale_voided" } }; }, (f) => { failure = f.reason; });
  assert.deepEqual(flags, [true, false]);
  assert.equal(failure, "sale_voided");
  const ok: boolean[] = [];
  await runInventoryCall((b) => ok.push(b), async () => undefined, () => assert.fail("no failure expected"));
  assert.deepEqual(ok, [true, false]);
});

// ---------------------------------------------------------------------------
// Sentences with numbers, in both languages.
// ---------------------------------------------------------------------------

test("count sentences are built per language", () => {
  assert.equal(productCountText(1), "1 product");
  assert.equal(productCountText(12), "12 products");
  assert.equal(productCountText(12, "fr"), "12 produits");
  assert.equal(itemCountText(1, "fr"), "1 article");
  assert.equal(leftText(5), "5 left");
  assert.equal(leftText(5, "fr"), "5 restants");
  assert.equal(tagCountText(2, "fr"), "2 étiquettes");
  assert.equal(voidedByText("Anna"), "Voided by Anna");
  assert.equal(voidedByText("Anna", "fr"), "Annulée par Anna");
  assert.equal(voidedByText("", "fr"), "Annulée");
  assert.match(voidConsequenceText(3), /3 items sold goes back/);
  assert.match(voidConsequenceText(3, "fr"), /Le stock des 3 articles vendus revient/);
  assert.match(voidConsequenceText(1, "fr"), /Le stock de l’article vendu revient/);
});

test("a business has Inventory only when its stored services list says so", () => {
  assert.equal(businessHasInventory({ enabledServices: ["freight", "inventory"] }), true);
  assert.equal(businessHasInventory({ enabledServices: ["freight"] }), false);
  assert.equal(businessHasInventory({ enabledServices: [] }), false);
  // Never stored a list: the server does not give it Inventory either.
  assert.equal(businessHasInventory({}), false);
  assert.equal(businessHasInventory(null), false);
  assert.equal(businessHasInventory(undefined), false);
  // Only enabledServices counts, like the server.
  assert.equal(businessHasInventory({ services: ["inventory"], businessServices: ["inventory"] }), false);
  assert.equal(businessHasInventory({ enabledServices: "inventory" }), false);
});

test("the admin switch sends the business and a real boolean", () => {
  assert.deepEqual(setBusinessInventoryRequest("biz-1", true), { businessId: "biz-1", enabled: true });
  assert.deepEqual(setBusinessInventoryRequest("biz-1", false), { businessId: "biz-1", enabled: false });
  assert.deepEqual(setBusinessInventoryRequest("  biz-1 ", "yes" as unknown as boolean), { businessId: "biz-1", enabled: false });
});

// ===========================================================================
// v2: categories and stores.
// ===========================================================================

import {
  UNCATEGORIZED_FILTER,
  archiveInventoryCategoryRequest,
  archiveInventoryStoreRequest,
  archivedNameText,
  availableInStoreText,
  buildStockIndex,
  categoryCountText,
  categoryForItem,
  categoryKey,
  categoryOptions,
  categoryResolver,
  countChangeText,
  createInventoryCategoryRequest,
  createInventoryStoreRequest,
  emptyStoreDraft,
  emptyTransferDraft,
  inventoryCategories,
  inventoryStaffAccessFromRow,
  inventoryStockRowFromRow,
  inventoryStores,
  inventoryViewerFromProfile,
  isMultiStore,
  itemCategoryName,
  itemInCategory,
  itemStockView,
  legacyStoreId,
  lowInStoresText,
  readCreatedCategoryId,
  readCreatedStoreId,
  readStartingStock,
  renameInventoryCategoryRequest,
  resolveStoreAccess,
  saleStoreId,
  saleFocusFrom,
  saleFocusStoreFilter,
  saleVisibleToViewer,
  salesInStore,
  setInventoryStaffAccessRequest,
  staffAccessChanged,
  staffHasInventoryPermission,
  stockCountFor,
  storeCountText,
  storeDraftChanges,
  storeDraftFromStore,
  storeNameIndex,
  transferAfter,
  transferInventoryStockRequest,
  updateInventoryStoreRequest,
  validateCategoryName,
  validateStaffAccess,
  validateStoreDraft,
  validateTransferDraft,
  type InventoryCategory,
  type InventoryListScope,
  type InventoryRefusal,
} from "./inventory.ts";

const categoryRows = [
  { id: "c-care", name: "Care", nameKey: "care", archived: false },
  { id: "c-hair", name: "Hair", nameKey: "hair", archived: false },
  { id: "c-old", name: "Old line", nameKey: "old line", archived: true },
];
const categories = inventoryCategories(categoryRows, true);

const storeRows = [
  { id: "s-main", name: "Main store", isMain: true, createdAt: { seconds: 100 } },
  { id: "s-down", name: "Downtown", createdAt: { seconds: 200 } },
  { id: "s-gone", name: "Closed", archived: true, createdAt: { seconds: 300 } },
];
const stores = inventoryStores(storeRows);
const twoStores = stores.filter((s) => !s.archived);

const stockRows = [
  { id: "i1__s-main", itemId: "i1", storeId: "s-main", quantity: 7 },
  { id: "i1__s-down", itemId: "i1", storeId: "s-down", quantity: 3 },
];

// ---------------------------------------------------------------------------
// Categories.
// ---------------------------------------------------------------------------

test("the category list is the business's own: by name, archived ones only when asked for", () => {
  assert.deepEqual(inventoryCategories(categoryRows).map((c) => c.name), ["Care", "Hair"]);
  assert.deepEqual(inventoryCategories(categoryRows, true).map((c) => c.name), ["Care", "Hair", "Old line"]);
  // A row with no name or no id is not a category; the key is derived when the row lacks one.
  assert.deepEqual(inventoryCategories([{ id: "x" }, { name: "No id" }, { id: "y", name: " Soap " }]).map((c) => [c.id, c.name, c.nameKey]), [["y", "Soap", "soap"]]);
  assert.equal(categoryKey("  Hair CARE "), "hair care");
});

test("a product's category is found by its id, else by name (a legacy typed one), and a rename shows at once", () => {
  const byId = categoryForItem({ categoryId: "c-care", category: "Care (old name)" }, categories);
  assert.equal(byId?.id, "c-care");
  const legacy = categoryForItem({ categoryId: "", category: "  hair " }, categories);
  assert.equal(legacy?.id, "c-hair");
  assert.equal(categoryForItem({ categoryId: "", category: "Never listed" }, categories), null);
  assert.equal(categoryForItem({ categoryId: "", category: "" }, categories), null);
  // The list's current name wins over the snapshot the product was saved with.
  assert.equal(itemCategoryName({ categoryId: "c-care", category: "Skin" }, categories), "Care");
  assert.equal(itemCategoryName({ categoryId: "", category: "Never listed" }, categories), "Never listed");
  // An active category takes a name an archived one also has.
  const twins: InventoryCategory[] = [
    { id: "a", name: "Soap", nameKey: "soap", archived: true },
    { id: "b", name: "Soap", nameKey: "soap", archived: false },
  ];
  assert.equal(categoryResolver(twins)({ categoryId: "", category: "soap" })?.id, "b");
});

test("the category filter: everything, one category, or the products with none", () => {
  const care = item({ categoryId: "c-care", category: "Care" });
  const legacy = item({ id: "i2", categoryId: "", category: "Hair" });
  const typedOnly = item({ id: "i3", categoryId: "", category: "Not in the list" });
  const none = item({ id: "i4", categoryId: "", category: "" });
  assert.equal(itemInCategory(care, categories, ""), true);
  assert.equal(itemInCategory(care, categories, "c-care"), true);
  assert.equal(itemInCategory(care, categories, "c-hair"), false);
  assert.equal(itemInCategory(legacy, categories, "c-hair"), true);
  assert.equal(itemInCategory(none, categories, UNCATEGORIZED_FILTER), true);
  assert.equal(itemInCategory(care, categories, UNCATEGORIZED_FILTER), false);
  // A typed category the list does not hold yet is neither in a listed category nor "none".
  assert.equal(itemInCategory(typedOnly, categories, UNCATEGORIZED_FILTER), false);
  assert.equal(itemInCategory(typedOnly, categories, "c-care"), false);
  const rows = [care, legacy, typedOnly, none].map((i) => ({ ...i }));
  assert.deepEqual(filterInventoryItems(rows, "all", "", { categories, categoryId: "c-hair" }).map((i) => i.id), ["i2"]);
  assert.deepEqual(filterInventoryItems(rows, "all", "", { categories, categoryId: UNCATEGORIZED_FILTER }).map((i) => i.id), ["i4"]);
  assert.equal(filterInventoryItems(rows, "all", "", { categories }).length, 4);
  // A search by category reads the list's current name.
  assert.deepEqual(filterInventoryItems([{ ...care, category: "Skin" }], "all", "care", { categories }).map((i) => i.id), ["i1"]);
});

test("the dropdown offers the active categories, and the product's own even when archived", () => {
  assert.deepEqual(categoryOptions(categories).map((c) => c.id), ["c-care", "c-hair"]);
  assert.deepEqual(categoryOptions(categories, "c-old").map((c) => c.id), ["c-care", "c-hair", "c-old"]);
});

test("a category name is checked before the call: required, 60 characters, and unique per business", () => {
  assert.deepEqual(validateCategoryName("", categories), ["category_name_required"]);
  assert.deepEqual(validateCategoryName("   ", categories), ["category_name_required"]);
  assert.deepEqual(validateCategoryName("x".repeat(61), categories), ["category_too_long"]);
  assert.deepEqual(validateCategoryName("Skin", categories), []);
  assert.deepEqual(validateCategoryName("  hair ", categories), ["category_name_taken"]);
  // Archived categories still own their name, as on the server.
  assert.deepEqual(validateCategoryName("OLD LINE", categories), ["category_name_taken"]);
  // Renaming keeps its own name, or changes its case.
  assert.deepEqual(validateCategoryName("Hair", categories, "c-hair"), []);
  assert.deepEqual(validateCategoryName("hair", categories, "c-hair"), []);
  assert.deepEqual(validateCategoryName("Care", categories, "c-hair"), ["category_name_taken"]);
});

test("the category requests carry the business and trimmed values", () => {
  assert.deepEqual(createInventoryCategoryRequest(" b1 ", " Skin "), { businessId: "b1", name: "Skin" });
  assert.deepEqual(renameInventoryCategoryRequest("b1", "c1", " Hair care "), { businessId: "b1", categoryId: "c1", name: "Hair care" });
  assert.deepEqual(archiveInventoryCategoryRequest("b1", "c1", true), { businessId: "b1", categoryId: "c1", archived: true });
  assert.deepEqual(archiveInventoryCategoryRequest("b1", "c1", "yes" as unknown as boolean), { businessId: "b1", categoryId: "c1", archived: false });
  assert.equal(readCreatedCategoryId({ success: true, categoryId: "c9" }), "c9");
  assert.equal(readCreatedCategoryId(null), "");
});

test("the product form turns a chosen category into an id, a typed one stays text, and clearing clears both", () => {
  // The form opened on a legacy product: matched by name, not changed by the match.
  const legacy = item({ categoryId: "", category: "hair" });
  const opened = inventoryDraftFromItem(legacy, categories);
  assert.equal(opened.categoryId, "c-hair");
  assert.equal(opened.category, "Hair");
  assert.equal(inventoryDraftChanged(legacy, opened, categories), false);
  // Not in the list: stays as typed text.
  const typed = inventoryDraftFromItem(item({ categoryId: "", category: "Brand new" }), categories);
  assert.equal(typed.categoryId, "");
  assert.equal(typed.category, "Brand new");

  // Create: an id when one was chosen, the v1 text otherwise, nothing when empty.
  assert.equal(createInventoryItemRequest("b1", draft({ categoryId: "c-care", category: "Care" })).categoryId, "c-care");
  assert.equal("category" in createInventoryItemRequest("b1", draft({ categoryId: "c-care", category: "Care" })), false);
  const v1 = createInventoryItemRequest("b1", draft({ category: "Care" }));
  assert.equal(v1.category, "Care");
  assert.equal("categoryId" in v1, false);
  const bare = createInventoryItemRequest("b1", draft());
  assert.equal("category" in bare || "categoryId" in bare, false);

  // Update: id when chosen; text as in v1; clearing sends "" (and clears the id the product had).
  const base = item({ categoryId: "c-care", category: "Care" });
  assert.deepEqual(pick(updateInventoryItemRequest("b1", base, draft({ categoryId: "c-hair", category: "Hair" })), ["category", "categoryId"]), { categoryId: "c-hair" });
  assert.deepEqual(pick(updateInventoryItemRequest("b1", base, draft({ category: "Typed" })), ["category", "categoryId"]), { category: "Typed" });
  assert.deepEqual(pick(updateInventoryItemRequest("b1", base, draft({ category: "" })), ["category", "categoryId"]), { category: "", categoryId: "" });
  assert.deepEqual(pick(updateInventoryItemRequest("b1", item({ categoryId: "", category: "Old" }), draft({ category: "" })), ["category", "categoryId"]), { category: "" });
  // Moving to another category counts as a change.
  assert.equal(inventoryDraftChanged(base, { ...inventoryDraftFromItem(base, categories), categoryId: "c-hair", category: "Hair" }, categories), true);
});

function pick(source: Record<string, unknown>, keys: string[]): Record<string, unknown> {
  return Object.fromEntries(keys.filter((key) => key in source).map((key) => [key, source[key]]));
}

// ---------------------------------------------------------------------------
// Stores: single-store mode, access, and per-store stock.
// ---------------------------------------------------------------------------

test("a business is multi-store only with two or more active stores", () => {
  assert.equal(isMultiStore([]), false);
  assert.equal(isMultiStore(inventoryStores([storeRows[0]])), false);
  assert.equal(isMultiStore(twoStores), true);
  // An archived store does not count, so archiving back to one store is single-store again.
  assert.equal(isMultiStore(inventoryStores(storeRows, true).filter((s) => s.id !== "s-down")), false);
  assert.deepEqual(stores.map((s) => s.id), ["s-main", "s-down"]);
  assert.deepEqual(inventoryStores(storeRows, true).map((s) => s.id), ["s-main", "s-down", "s-gone"]);
  assert.equal(legacyStoreId(stores), "s-main");
  assert.equal(legacyStoreId([]), "");
  assert.equal(storeNameIndex(stores).get("s-down"), "Downtown");
});

test("who sees which stores: the owner and all-stores staff everything, staff their home store only", () => {
  const owner = { isOwner: true, homeStoreId: "", allStores: false };
  const anyStaff = { isOwner: false, homeStoreId: "s-down", allStores: false };
  const roaming = { isOwner: false, homeStoreId: "", allStores: true };
  const homeless = { isOwner: false, homeStoreId: "", allStores: false };
  const stale = { isOwner: false, homeStoreId: "s-gone", allStores: false };

  const a = resolveStoreAccess(owner, storeRows);
  assert.deepEqual([a.multi, a.canSeeAll, a.scopedStoreId, a.needsHomeStore, a.canTransfer, a.canManageStores], [true, true, "", false, true, true]);
  const b = resolveStoreAccess(anyStaff, storeRows);
  assert.deepEqual([b.multi, b.canSeeAll, b.scopedStoreId, b.needsHomeStore, b.canTransfer, b.canManageStores], [true, false, "s-down", false, false, false]);
  assert.equal(b.defaultStoreId, "s-down");
  const c = resolveStoreAccess(roaming, storeRows);
  assert.deepEqual([c.canSeeAll, c.scopedStoreId, c.canTransfer, c.canManageStores], [true, "", true, false]);
  // No (valid) home store in a multi-store business: nothing to see until one is assigned.
  assert.equal(resolveStoreAccess(homeless, storeRows).needsHomeStore, true);
  assert.equal(resolveStoreAccess(stale, storeRows).needsHomeStore, true);

  // A single store: nothing about stores, for anyone; the owner alone can add one.
  const single = inventoryStores([storeRows[0]]);
  for (const viewer of [owner, anyStaff, homeless]) {
    const s = resolveStoreAccess(viewer, single);
    assert.deepEqual([s.multi, s.needsHomeStore, s.canTransfer, s.scopedStoreId], [false, false, false, ""]);
  }
  assert.equal(resolveStoreAccess(owner, []).canManageStores, true);
  assert.equal(resolveStoreAccess(anyStaff, []).canManageStores, false);

  assert.deepEqual(inventoryViewerFromProfile({ role: "businessOwner" }), { isOwner: true, homeStoreId: "", allStores: false });
  assert.deepEqual(inventoryViewerFromProfile({ role: "staff", inventoryHomeStoreId: " s-down ", inventoryAllStores: true }), { isOwner: false, homeStoreId: "s-down", allStores: true });
  assert.deepEqual(inventoryViewerFromProfile(null), { isOwner: false, homeStoreId: "", allStores: false });
});

test("a store's draft is checked and sent as the contract says: blank address and phone are left out, an edit sends what changed", () => {
  assert.deepEqual(validateStoreDraft(emptyStoreDraft), ["store_name_required"]);
  assert.deepEqual(validateStoreDraft({ name: "x".repeat(81), address: "", phone: "" }), ["store_name_too_long"]);
  assert.deepEqual(validateStoreDraft({ name: "Uptown", address: "a".repeat(201), phone: "" }), ["store_detail_too_long"]);
  assert.deepEqual(validateStoreDraft({ name: "Uptown", address: "12 Main St", phone: "212-555-0100" }), []);
  assert.deepEqual(createInventoryStoreRequest(" b1 ", { name: " Uptown ", address: "", phone: "  " }), { businessId: "b1", name: "Uptown" });
  assert.deepEqual(createInventoryStoreRequest("b1", { name: "Uptown", address: "12 Main St", phone: "212" }), { businessId: "b1", name: "Uptown", address: "12 Main St", phone: "212" });
  const store = inventoryStores([{ id: "s1", name: "Uptown", address: "12 Main St", phone: "212" }])[0];
  assert.deepEqual(storeDraftChanges(store, storeDraftFromStore(store)), {});
  assert.deepEqual(updateInventoryStoreRequest("b1", store, { name: "Uptown", address: "", phone: "212" }), { businessId: "b1", storeId: "s1", address: "" });
  assert.deepEqual(updateInventoryStoreRequest("b1", store, { name: "Up", address: "12 Main St", phone: "212" }), { businessId: "b1", storeId: "s1", name: "Up" });
  assert.deepEqual(archiveInventoryStoreRequest("b1", "s1", true), { businessId: "b1", storeId: "s1", archived: true });
  assert.equal(readCreatedStoreId({ storeId: "s2" }), "s2");
});

test("per-store counts are indexed once and read by product and store; a store that never held it reads 0", () => {
  const index = buildStockIndex([...stockRows, { id: "i2__s-main", quantity: 4 }, { id: "bad" }, { itemId: "i3" }]);
  assert.equal(stockCountFor(index, "i1", "s-main"), 7);
  assert.equal(stockCountFor(index, "i1", "s-down"), 3);
  // The id carries both halves when the fields are missing.
  assert.equal(stockCountFor(index, "i2", "s-main"), 4);
  assert.equal(stockCountFor(index, "i1", "s-nowhere"), 0);
  assert.equal(stockCountFor(undefined, "i1", "s-main"), 0);
  assert.equal(index.has("i3"), false);
  assert.deepEqual(inventoryStockRowFromRow({ id: "a__b", quantity: -3, countWasOff: true }), { itemId: "a", storeId: "b", quantity: 0, countWasOff: true });
});

test("single-store display is exactly what it always was", () => {
  const stock = buildStockIndex(stockRows);
  for (const scope of [{}, { stores: [] }, { stores: twoStores.slice(0, 1) }, { stores: twoStores.slice(0, 1), stock, storeId: "s-main" }] as InventoryListScope[]) {
    for (const over of [{}, { quantity: 0 }, { quantity: 2 }, { archived: true }, { countWasOff: true }]) {
      const it = item(over);
      const view = itemStockView(it, scope);
      assert.equal(view.multi, false);
      assert.equal(view.status, inventoryStatus(it));
      assert.equal(view.low, inventoryIsLow(it));
      assert.equal(view.shown, it.quantity);
      assert.equal(view.countWasOff, it.countWasOff);
      assert.deepEqual(view.cells, []);
    }
  }
});

test("multi-store: a product not yet counted per store sits whole at the Main store", () => {
  const none = buildStockIndex([]);
  const it = item({ quantity: 48, countWasOff: true, lowStockAt: 60 });
  const main = itemStockView(it, { stores: twoStores, stock: none, storeId: "s-main" });
  // Shown whole, flagged by the product's own count-was-off, never low (nothing recorded there yet).
  assert.deepEqual([main.shown, main.status, main.countWasOff, main.lowStoreNames], [48, "ok", true, []]);
  const down = itemStockView(it, { stores: twoStores, stock: none, storeId: "s-down" });
  assert.deepEqual([down.shown, down.status], [0, "ok"]);
  const all = itemStockView(it, { stores: twoStores, stock: none });
  assert.deepEqual(all.cells.map((c) => [c.storeName, c.quantity]), [["Main store", 48], ["Downtown", 0]]);
  // Once counted per store, a missing Main row really is 0.
  const counted = itemStockView(item({ quantity: 48, storeStock: true }), { stores: twoStores, stock: none, storeId: "s-main" });
  assert.equal(counted.shown, 0);
  // A store list without a Main flag reads as before.
  const unflagged = inventoryStores([{ id: "s-main", name: "Main store" }, { id: "s-down", name: "Downtown" }]);
  assert.equal(itemStockView(it, { stores: unflagged, stock: none, storeId: "s-main" }).shown, 0);
});

test("multi-store: the total, each store's count, and low per store with the store named", () => {
  const stock = buildStockIndex(stockRows);
  const it = item({ quantity: 10, lowStockAt: 3 });
  const all = itemStockView(it, { stores: twoStores, stock });
  assert.equal(all.multi, true);
  assert.equal(all.total, 10);
  assert.equal(all.shown, 10);
  assert.deepEqual(all.cells.map((c) => [c.storeName, c.quantity]), [["Main store", 7], ["Downtown", 3]]);
  // Downtown holds 3, at the threshold: low there, not in the Main store.
  assert.deepEqual(all.lowStoreNames, ["Downtown"]);
  assert.equal(all.status, "low");
  assert.equal(all.low, true);
  assert.equal(lowInStoresText(all.lowStoreNames), "Low in Downtown");
  assert.equal(lowInStoresText(["A", "B"], "fr"), "Bas dans A, B");

  const main = itemStockView(it, { stores: twoStores, stock, storeId: "s-main" });
  assert.deepEqual([main.shown, main.status, main.low, main.lowStoreNames], [7, "ok", false, []]);
  const down = itemStockView(it, { stores: twoStores, stock, storeId: "s-down" });
  assert.deepEqual([down.shown, down.status, down.low, down.lowStoreNames], [3, "low", true, ["Downtown"]]);

  // Zero after a count was recorded is low (out in that store); the product as a whole is not out.
  const drained = buildStockIndex([{ itemId: "i1", storeId: "s-main", quantity: 5 }, { itemId: "i1", storeId: "s-down", quantity: 0 }]);
  const empty = itemStockView(it, { stores: twoStores, stock: drained, storeId: "s-down" });
  assert.deepEqual([empty.status, empty.low], ["out", true]);
  assert.equal(itemStockView(item({ quantity: 5, lowStockAt: null }), { stores: twoStores, stock: drained }).status, "low");
  // Nothing anywhere: out of stock.
  assert.equal(itemStockView(item({ quantity: 0 }), { stores: twoStores, stock: drained }).status, "out");
});

test("a store that never held a product is not flagged low there (adding a store must not flag every product)", () => {
  const onlyMain = buildStockIndex([{ itemId: "i1", storeId: "s-main", quantity: 9 }]);
  const it = item({ quantity: 9, lowStockAt: 3 });
  const all = itemStockView(it, { stores: twoStores, stock: onlyMain });
  assert.deepEqual(all.cells.map((c) => [c.storeId, c.stocked, c.low]), [["s-main", true, false], ["s-down", false, false]]);
  assert.equal(all.status, "ok");
  const down = itemStockView(it, { stores: twoStores, stock: onlyMain, storeId: "s-down" });
  assert.deepEqual([down.shown, down.status, down.low], [0, "ok", false]);
});

test("archived products are never low, in any store; count-was-off is read per store when one is chosen", () => {
  const stock = buildStockIndex([
    { itemId: "i1", storeId: "s-main", quantity: 0 },
    { itemId: "i1", storeId: "s-down", quantity: 4, countWasOff: true },
  ]);
  const archivedItem = item({ archived: true, quantity: 4 });
  assert.deepEqual([itemStockView(archivedItem, { stores: twoStores, stock }).status, itemStockView(archivedItem, { stores: twoStores, stock }).low], ["archived", false]);
  const it = item({ quantity: 4, countWasOff: true });
  assert.equal(itemStockView(it, { stores: twoStores, stock }).countWasOff, true);
  assert.equal(itemStockView(it, { stores: twoStores, stock, storeId: "s-main" }).countWasOff, false);
  assert.equal(itemStockView(it, { stores: twoStores, stock, storeId: "s-down" }).countWasOff, true);
});

test("the products list narrows to a store's low stock and the chips count the same way", () => {
  const stock = buildStockIndex([
    { itemId: "a", storeId: "s-main", quantity: 9 },
    { itemId: "a", storeId: "s-down", quantity: 1 },
    { itemId: "b", storeId: "s-main", quantity: 1 },
    { itemId: "b", storeId: "s-down", quantity: 8 },
    { itemId: "c", storeId: "s-main", quantity: 6 },
    { itemId: "c", storeId: "s-down", quantity: 6 },
  ]);
  const rows = [
    { id: "a", name: "A", quantity: 10, lowStockAt: 2 },
    { id: "b", name: "B", quantity: 9, lowStockAt: 2 },
    { id: "c", name: "C", quantity: 12, lowStockAt: 2 },
  ];
  const ids = (scope: InventoryListScope) => filterInventoryItems(rows, "low", "", scope).map((i) => i.id);
  assert.deepEqual(ids({ stores: twoStores, stock }), ["a", "b"]);
  assert.deepEqual(ids({ stores: twoStores, stock, storeId: "s-down" }), ["a"]);
  assert.deepEqual(ids({ stores: twoStores, stock, storeId: "s-main" }), ["b"]);
  assert.equal(inventoryCounts(rows, { stores: twoStores, stock }).low, 2);
  assert.equal(inventoryCounts(rows, { stores: twoStores, stock, storeId: "s-down" }).low, 1);
  // Without a scope, the v1 count: the product's own total against its own threshold.
  assert.equal(inventoryCounts(rows).low, 0);
  assert.equal(inventoryCounts(rows).onSale, 3);
});

// ---------------------------------------------------------------------------
// The product form and the stock dialog with stores.
// ---------------------------------------------------------------------------

test("a multi-store product takes a starting count per store; a single-store one still takes the one number", () => {
  assert.deepEqual(readStartingStock({ "s-main": "5", "s-down": "", x: "0" }), { stock: { "s-main": 5 }, invalid: false });
  assert.equal(readStartingStock({ "s-main": "-1" }).invalid, true);
  assert.equal(readStartingStock({ "s-main": "2.5" }).invalid, true);
  assert.deepEqual(readStartingStock(undefined), { stock: {}, invalid: false });

  const multi = createInventoryItemRequest("b1", draft({ quantity: "99", stock: { "s-main": "5", "s-down": "3" } }), { multiStore: true });
  assert.deepEqual(multi.stock, { "s-main": 5, "s-down": 3 });
  assert.equal("quantity" in multi, false);
  assert.deepEqual(createInventoryItemRequest("b1", draft({ stock: { "s-main": "" } }), { multiStore: true }).stock, {});
  // The v1 shape is unchanged for a single-store business.
  const single = createInventoryItemRequest("b1", draft({ stock: { "s-main": "5" } }));
  assert.equal(single.quantity, 4);
  assert.equal("stock" in single, false);

  assert.deepEqual(validateInventoryItemDraft(draft({ quantity: "abc" }), true), ["quantity_invalid"]);
  // In a multi-store business the single number is not asked for; the per-store ones are checked.
  assert.deepEqual(validateInventoryItemDraft(draft({ quantity: "abc", stock: { "s-main": "3" } }), true, { multiStore: true }), []);
  assert.deepEqual(validateInventoryItemDraft(draft({ stock: { "s-main": "x" } }), true, { multiStore: true }), ["stock_store_invalid"]);
  assert.deepEqual(validateInventoryItemDraft(draft({ stock: { "s-main": "x" } }), false, { multiStore: true }), []);
});

test("add stock and set count name the store only when there are several", () => {
  const stockDraft = { mode: "add" as const, quantity: "3", note: "" };
  assert.deepEqual(adjustInventoryStockRequest("b1", "i1", stockDraft), { businessId: "b1", itemId: "i1", mode: "add", quantity: 3 });
  assert.deepEqual(adjustInventoryStockRequest("b1", "i1", stockDraft, "s-down"), { businessId: "b1", itemId: "i1", mode: "add", quantity: 3, storeId: "s-down" });
  assert.deepEqual(adjustInventoryStockRequest("b1", "i1", { mode: "set", quantity: "0", note: " recount " }, " s-main "), { businessId: "b1", itemId: "i1", mode: "set", quantity: 0, storeId: "s-main", note: "recount" });
  // The "stock after" preview works on the store's count.
  assert.equal(stockAfter(7, stockDraft), 10);
});

// ---------------------------------------------------------------------------
// Transfers.
// ---------------------------------------------------------------------------

test("a transfer needs a product, two different stores and a quantity the source holds", () => {
  const ok = { itemId: "i1", fromStoreId: "s-main", toStoreId: "s-down", quantity: "3", note: "" };
  assert.deepEqual(validateTransferDraft(ok, 7), []);
  assert.deepEqual(validateTransferDraft(ok, null), []);
  assert.deepEqual(validateTransferDraft(emptyTransferDraft), ["transfer_item_required", "transfer_store_required", "transfer_quantity_invalid"]);
  assert.deepEqual(validateTransferDraft({ ...ok, toStoreId: "s-main" }, 7), ["same_store"]);
  assert.deepEqual(validateTransferDraft({ ...ok, toStoreId: "" }, 7), ["transfer_store_required"]);
  assert.deepEqual(validateTransferDraft({ ...ok, quantity: "0" }, 7), ["transfer_quantity_invalid"]);
  assert.deepEqual(validateTransferDraft({ ...ok, quantity: "2.5" }, 7), ["transfer_quantity_invalid"]);
  assert.deepEqual(validateTransferDraft({ ...ok, quantity: "8" }, 7), ["insufficient_stock"]);
  assert.deepEqual(validateTransferDraft({ ...ok, quantity: "7" }, 7), []);
  assert.deepEqual(validateTransferDraft({ ...ok, note: "n".repeat(201) }, 7), ["note_too_long"]);
  // Every refusal reads as a sentence.
  for (const code of ["same_store", "insufficient_stock", "transfer_item_required", "transfer_store_required", "transfer_quantity_invalid"] as InventoryRefusal[]) {
    assert.ok(INVENTORY_MESSAGES[code].endsWith("."), code);
  }
});

test("the transfer request and its preview", () => {
  assert.deepEqual(
    transferInventoryStockRequest(" b1 ", { itemId: "i1", fromStoreId: "s-main", toStoreId: "s-down", quantity: "3", note: "" }),
    { businessId: "b1", itemId: "i1", fromStoreId: "s-main", toStoreId: "s-down", quantity: 3 },
  );
  assert.equal(
    transferInventoryStockRequest("b1", { itemId: "i1", fromStoreId: "s-main", toStoreId: "s-down", quantity: "3", note: " shelf restock " }).note,
    "shelf restock",
  );
  assert.deepEqual(transferAfter(7, 3, "2"), { from: 5, to: 5 });
  assert.equal(transferAfter(7, 3, "8"), null);
  assert.equal(transferAfter(7, 3, ""), null);
  assert.equal(transferAfter(7, 3, "0"), null);
  assert.equal(countChangeText("Main store", 7, 5), "Main store 7 → 5");
  assert.equal(availableInStoreText(7, "Main store"), "7 available in Main store");
  assert.equal(availableInStoreText(1, "Main store", "fr"), "1 disponible dans Main store");
});

// ---------------------------------------------------------------------------
// Staff store access.
// ---------------------------------------------------------------------------

test("a team member's store access is read, checked and sent as the owner set it", () => {
  assert.deepEqual(inventoryStaffAccessFromRow({ inventoryHomeStoreId: "s-down", inventoryAllStores: true }), { homeStoreId: "s-down", allStores: true });
  assert.deepEqual(inventoryStaffAccessFromRow({}), { homeStoreId: "", allStores: false });
  assert.deepEqual(inventoryStaffAccessFromRow({ inventoryAllStores: "true" }), { homeStoreId: "", allStores: false });
  assert.deepEqual(validateStaffAccess({ homeStoreId: "", allStores: false }, twoStores), ["staff_store_required"]);
  assert.deepEqual(validateStaffAccess({ homeStoreId: "s-gone", allStores: false }, twoStores), ["staff_store_required"]);
  assert.deepEqual(validateStaffAccess({ homeStoreId: "s-down", allStores: false }, twoStores), []);
  assert.deepEqual(validateStaffAccess({ homeStoreId: "", allStores: true }, twoStores), []);
  assert.deepEqual(
    setInventoryStaffAccessRequest(" b1 ", " u1 ", { homeStoreId: " s-down ", allStores: true }),
    { businessId: "b1", userId: "u1", homeStoreId: "s-down", allStores: true },
  );
  assert.deepEqual(
    setInventoryStaffAccessRequest("b1", "u1", { homeStoreId: "s-down", allStores: "yes" as unknown as boolean }),
    { businessId: "b1", userId: "u1", homeStoreId: "s-down", allStores: false },
  );
  assert.equal(staffAccessChanged({ inventoryHomeStoreId: "s-down" }, { homeStoreId: "s-down", allStores: false }), false);
  assert.equal(staffAccessChanged({ inventoryHomeStoreId: "s-down" }, { homeStoreId: "s-main", allStores: false }), true);
  assert.equal(staffAccessChanged({}, { homeStoreId: "", allStores: true }), true);
  // The controls are for staff who hold the Inventory permission.
  assert.equal(staffHasInventoryPermission({ businessPermissions: ["people", "inventory"] }), true);
  assert.equal(staffHasInventoryPermission({ businessPermissions: ["people"] }), false);
  assert.equal(staffHasInventoryPermission({}), true);
});

// ---------------------------------------------------------------------------
// The summary, sales and history with stores and categories.
// ---------------------------------------------------------------------------

test("the summary request names a store only when one is chosen", () => {
  assert.deepEqual(inventorySummaryRequest("b1", "today", "America/New_York"), { businessId: "b1", range: "today", timeZone: "America/New_York" });
  assert.deepEqual(inventorySummaryRequest("b1", "month", "UTC", ""), { businessId: "b1", range: "month", timeZone: "UTC" });
  assert.deepEqual(inventorySummaryRequest("b1", "month", "UTC", " s-down "), { businessId: "b1", range: "month", timeZone: "UTC", storeId: "s-down" });
});

test("the summary's category and store blocks are read tolerantly and sorted by money", () => {
  const read = readInventorySummary({
    salesCount: 3,
    byCategory: [
      { categoryId: "c-hair", name: "Hair", itemsSold: 2, revenueCents: 2500, profitCents: 900 },
      { categoryId: "", name: "Uncategorized", itemsSold: 1, revenueCents: 9000, profitCents: 0 },
      { categoryId: "c-care", name: "Care", itemsSold: 4, revenueCents: 2500, profitCents: -100 },
      { categoryId: "c-none", name: "Nothing sold" },
    ],
    byStore: [
      { storeId: "s-down", name: "Downtown", salesCount: 1, itemsSold: 1, revenueCents: 500, profitCents: 200 },
      { storeId: "s-main", name: "Main store", salesCount: 2, itemsSold: 3, revenueCents: 8000, profitCents: 3000 },
    ],
    low: [{ itemId: "i1", name: "Shea", quantity: 1, lowStockAt: 3, storeId: "s-down", storeName: "Downtown" }, { itemId: "i2", name: "Soap", quantity: 0 }],
  });
  assert.ok(read);
  // Most money first; equal money by name; voided sales are the server's to leave out.
  assert.deepEqual(read.byCategory.map((c) => c.categoryId), ["", "c-care", "c-hair", "c-none"]);
  assert.deepEqual(read.byCategory[1], { categoryId: "c-care", name: "Care", itemsSold: 4, revenueCents: 2500, profitCents: -100 });
  assert.deepEqual(read.byCategory[3], { categoryId: "c-none", name: "Nothing sold", itemsSold: 0, revenueCents: 0, profitCents: 0 });
  assert.deepEqual(read.byStore.map((s) => s.storeId), ["s-main", "s-down"]);
  assert.deepEqual([read.low[0].storeId, read.low[0].storeName, read.low[1].storeId, read.low[1].storeName], ["s-down", "Downtown", "", ""]);
  // An answer from a v1 server has neither block.
  const old = readInventorySummary({ salesCount: 1 });
  assert.deepEqual([old?.byCategory, old?.byStore], [[], []]);
});

test("a sale knows its store; one from before stores counts under the Main store", () => {
  const sale = (over: Record<string, unknown>) => inventorySaleFromRow({ id: "x", lines: [], totalCents: 0, ...over });
  assert.deepEqual([sale({ storeId: "s-down", storeName: "Downtown" }).storeId, sale({ storeId: "s-down", storeName: "Downtown" }).storeName], ["s-down", "Downtown"]);
  assert.deepEqual([sale({}).storeId, sale({}).storeName], ["", ""]);
  const mixed = [sale({ id: "a", storeId: "s-down" }), sale({ id: "b" }), sale({ id: "c", storeId: "s-main" })];
  assert.deepEqual(salesInStore(mixed, "", stores).map((s) => s.id), ["a", "b", "c"]);
  assert.deepEqual(salesInStore(mixed, "s-main", stores).map((s) => s.id), ["b", "c"]);
  assert.deepEqual(salesInStore(mixed, "s-down", stores).map((s) => s.id), ["a"]);
  assert.equal(saleStoreId(mixed[1], stores), "s-main");
  assert.equal(saleStoreId(mixed[0], stores), "s-down");
});

test("the counter's sale request names a store only when asked to (old builds send none)", () => {
  const lines: BasketLine[] = [basketLineFromItem(item())];
  assert.equal("storeId" in recordInventorySaleRequest("b1", "web-1", "cash", lines), false);
  assert.equal(recordInventorySaleRequest("b1", "web-1", "cash", lines, " s-down ").storeId, "s-down");
});

test("stock history reads the store and tells a transfer's two sides", () => {
  const entries = inventoryMovementEntries([
    { id: "m1", type: "transfer_out", delta: -2, quantityAfter: 5, storeId: "s-main", transferId: "t1", createdAt: { seconds: 20 } },
    { id: "m2", type: "transfer_in", delta: 2, quantityAfter: 5, storeId: "s-down", transferId: "t1", createdAt: { seconds: 20 } },
    { id: "m3", type: "something_new", delta: 1, quantityAfter: 1, transferId: "t2", createdAt: { seconds: 10 } },
    { id: "m4", type: "add", delta: 3, quantityAfter: 3, createdAt: { seconds: 5 } },
  ]);
  const by = Object.fromEntries(entries.map((e) => [e.id, e]));
  assert.deepEqual([by.m1.label, by.m1.storeId, by.m1.transferId, by.m1.deltaText], ["Moved out to another store", "s-main", "t1", "-2"]);
  assert.equal(by.m2.label, "Moved in from another store");
  // An unknown type that carries a transfer id is still a transfer, in words.
  assert.equal(by.m3.label, "Stock moved");
  assert.deepEqual([by.m4.label, by.m4.storeId, by.m4.transferId], ["Stock added", "", ""]);
});

// ---------------------------------------------------------------------------
// Refusals.
// ---------------------------------------------------------------------------

test("every new server refusal reads as a friendly sentence, not the server's words", () => {
  const codes = [
    "category_name_required", "category_name_taken", "category_not_found",
    "store_name_required", "store_not_found", "store_archived", "store_has_stock", "store_not_allowed",
    "home_store_required", "same_store", "insufficient_stock", "owner_only",
  ] as const;
  for (const reason of codes) {
    const failure = inventoryCallableFailure({ code: "functions/failed-precondition", message: "raw server words", details: { reason, reasons: [reason] } });
    assert.equal(failure.reason, reason);
    assert.equal(failure.message, INVENTORY_MESSAGES[reason]);
    assert.notEqual(failure.message, "raw server words");
    assert.match(failure.message, /^[A-Z].*\.$/);
  }
  assert.match(INVENTORY_MESSAGES.store_has_stock, /Move it to another store first/);
  assert.match(INVENTORY_MESSAGES.owner_only, /owner/);
  // An unknown code still falls back to the server's readable message.
  assert.equal(inventoryCallableFailure({ code: "functions/not-found", message: "Something specific.", details: { reason: "brand_new_code" } }).message, "Something specific.");
});

test("sentences with a count or a name are built per language", () => {
  assert.equal(storeCountText(1), "1 store");
  assert.equal(storeCountText(3), "3 stores");
  assert.equal(storeCountText(2, "fr"), "2 magasins");
  assert.equal(categoryCountText(1, "fr"), "1 catégorie");
  assert.equal(categoryCountText(4), "4 categories");
  assert.equal(archivedNameText("Hair", "en", true), "Hair (archived)");
  assert.equal(archivedNameText("Hair", "fr", true), "Hair (archivée)");
  assert.equal(archivedNameText("Downtown", "fr"), "Downtown (archivé)");
});

// ---------------------------------------------------------------------------
// v3: brands and quick entry.
// ---------------------------------------------------------------------------

import {
  NO_BRAND_FILTER,
  archiveInventoryBrandRequest,
  brandCountText,
  brandForItem,
  brandKey,
  brandOptions,
  brandResolver,
  createInventoryBrandRequest,
  inventoryBrands,
  itemInBrand,
  productDisplayName,
  quickEntryDraft,
  readCreatedBrandId,
  renameInventoryBrandRequest,
  saleLinesSummary,
  savedNextText,
  validateBrandName,
  withCurrentBrand,
  type InventoryBrand,
} from "./inventory.ts";

const brandRows = [
  { id: "b-jordan", name: "Jordan", nameKey: "jordan", archived: false },
  { id: "b-nike", name: "Nike", nameKey: "nike", archived: false },
  { id: "b-old", name: "Old Skool", nameKey: "old skool", archived: true },
];
const brands: InventoryBrand[] = inventoryBrands(brandRows, true);

test("a product reads brand first, then name; without a brand it reads as before", () => {
  assert.equal(productDisplayName({ name: "11", brand: "Jordan" }), "Jordan 11");
  assert.equal(productDisplayName({ name: "Shea butter", brand: "" }), "Shea butter");
  assert.equal(productDisplayName({ name: "Shea butter" }), "Shea butter");
  assert.equal(productDisplayName({ name: " 11 ", brand: " Jordan " }), "Jordan 11");
  // A sale line carries the brand it was sold under.
  const sale = inventorySaleFromRow({ id: "s", lines: [{ itemId: "i", name: "11", brand: "Jordan", brandId: "b-jordan", quantity: 1, listPriceCents: 100, soldPriceCents: 100 }] });
  assert.equal(sale.lines[0].brand, "Jordan");
  assert.equal(productDisplayName(sale.lines[0]), "Jordan 11");
  assert.deepEqual(saleLinesSummary(sale), { names: ["Jordan 11"], more: 0 });
});

test("a product row reads its brand fields; a row without them has none", () => {
  const withBrand = item({ name: "11", brand: "Jordan", brandId: "b-jordan" });
  assert.equal(withBrand.brand, "Jordan");
  assert.equal(withBrand.brandId, "b-jordan");
  const plain = item();
  assert.equal(plain.brand, "");
  assert.equal(plain.brandId, "");
});

test("the brand list is the business's own: by name, archived ones only when asked for", () => {
  assert.deepEqual(inventoryBrands(brandRows).map((b) => b.name), ["Jordan", "Nike"]);
  assert.deepEqual(inventoryBrands(brandRows, true).map((b) => b.name), ["Jordan", "Nike", "Old Skool"]);
  assert.deepEqual(inventoryBrands([{ id: "", name: "x" }, { id: "y", name: "" }, null, 5]), []);
  assert.equal(brandKey("  JoRdAn "), "jordan");
  assert.deepEqual(brandOptions(brands).map((b) => b.id), ["b-jordan", "b-nike"]);
  assert.deepEqual(brandOptions(brands, "b-old").map((b) => b.id), ["b-jordan", "b-nike", "b-old"]);
  assert.equal(brandCountText(1, "fr"), "1 marque");
  assert.equal(brandCountText(3), "3 brands");
});

test("a brand is found by id, else by name, and a rename shows at once", () => {
  assert.equal(brandForItem({ brandId: "b-jordan", brand: "Air (old name)" }, brands)?.name, "Jordan");
  assert.equal(brandForItem({ brandId: "", brand: " nike " }, brands)?.id, "b-nike");
  assert.equal(brandForItem({ brandId: "", brand: "" }, brands), null);
  assert.equal(brandForItem({ brandId: "", brand: "Unlisted" }, brands), null);
  const resolve = brandResolver(brands);
  assert.equal(withCurrentBrand(item({ name: "11", brand: "Air", brandId: "b-jordan" }), resolve).brand, "Jordan");
  // Unknown to the list: the snapshot stays.
  assert.equal(withCurrentBrand(item({ name: "11", brand: "Unlisted" }), resolve).brand, "Unlisted");
});

test("the brand filter: everything, one brand, or the products with none", () => {
  const jordan = item({ brandId: "b-jordan", brand: "Jordan" });
  const none = item({ id: "i2" });
  const typedOnly = item({ id: "i3", brand: "Unlisted" });
  assert.equal(itemInBrand(jordan, brands, ""), true);
  assert.equal(itemInBrand(jordan, brands, "b-jordan"), true);
  assert.equal(itemInBrand(jordan, brands, "b-nike"), false);
  assert.equal(itemInBrand(none, brands, NO_BRAND_FILTER), true);
  assert.equal(itemInBrand(jordan, brands, NO_BRAND_FILTER), false);
  assert.equal(itemInBrand(typedOnly, brands, NO_BRAND_FILTER), false);
});

test("the list and the search read the brand: 'Jordan 11' is found by brand, by name, or both", () => {
  const list = [
    { id: "x1", name: "11", brand: "Jordan", brandId: "b-jordan", code: "IT-111111", category: "Shoes", priceCents: 500, quantity: 2 },
    { id: "x2", name: "Air Max", brand: "Nike", brandId: "b-nike", code: "IT-222222", category: "Shoes", priceCents: 500, quantity: 2 },
    { id: "x3", name: "Plain tee", code: "IT-333333", category: "Shirts", priceCents: 500, quantity: 2 },
  ];
  const scope = { brands };
  assert.deepEqual(filterInventoryItems(list, "all", "jordan", scope).map((i) => i.id), ["x1"]);
  assert.deepEqual(filterInventoryItems(list, "all", "jordan 11", scope).map((i) => i.id), ["x1"]);
  assert.deepEqual(filterInventoryItems(list, "all", "11", scope).map((i) => i.id), ["x1"]);
  assert.deepEqual(filterInventoryItems(list, "all", "nike shoes", scope).map((i) => i.id), ["x2"]);
  // Without the list the stored snapshot still searches.
  assert.deepEqual(filterInventoryItems(list, "all", "jordan").map((i) => i.id), ["x1"]);
  // Sorted by what is shown: brand first.
  assert.deepEqual(filterInventoryItems(list, "all", "", scope).map((i) => productDisplayName(i)), ["Jordan 11", "Nike Air Max", "Plain tee"]);
  assert.equal(filterInventoryItems(list, "all", "", scope)[0].brand, "Jordan");
  // The filter row.
  assert.deepEqual(filterInventoryItems(list, "all", "", { ...scope, brandId: "b-nike" }).map((i) => i.id), ["x2"]);
  assert.deepEqual(filterInventoryItems(list, "all", "", { ...scope, brandId: NO_BRAND_FILTER }).map((i) => i.id), ["x3"]);
  // A rename shows at once, in the display and in the search.
  const renamed: InventoryBrand[] = [{ id: "b-jordan", name: "Air Jordan", nameKey: "air jordan", archived: false }];
  const hit = filterInventoryItems(list, "all", "air jordan", { brands: renamed });
  assert.deepEqual(hit.map((i) => productDisplayName(i)), ["Air Jordan 11"]);
});

test("brand names are checked before the call: required, 60 at most, one per business", () => {
  assert.deepEqual(validateBrandName("  ", brands), ["brand_name_required"]);
  assert.deepEqual(validateBrandName("x".repeat(61), brands), ["brand_too_long"]);
  assert.deepEqual(validateBrandName("  JORDAN ", brands), ["brand_name_taken"]);
  assert.deepEqual(validateBrandName("Jordan", brands, "b-jordan"), []);
  assert.deepEqual(validateBrandName("Adidas", brands), []);
});

test("the brand requests carry the business id and exactly the contract's fields", () => {
  assert.deepEqual(createInventoryBrandRequest(" biz ", "  Jordan  "), { businessId: "biz", name: "Jordan" });
  assert.deepEqual(renameInventoryBrandRequest("biz", "b-jordan", " Air Jordan "), { businessId: "biz", brandId: "b-jordan", name: "Air Jordan" });
  assert.deepEqual(archiveInventoryBrandRequest("biz", "b-jordan", true), { businessId: "biz", brandId: "b-jordan", archived: true });
  assert.deepEqual(archiveInventoryBrandRequest("biz", "b-jordan", "yes" as unknown as boolean), { businessId: "biz", brandId: "b-jordan", archived: false });
  assert.equal(readCreatedBrandId({ brandId: " b-9 " }), "b-9");
  assert.equal(readCreatedBrandId({}), "");
  assert.equal(readCreatedBrandId(null), "");
});

test("a product request sends the brand id when chosen, the typed name otherwise, nothing when there is none", () => {
  // None: exactly the v2 request.
  const v2 = createInventoryItemRequest("biz", draft({ category: "Care" }));
  assert.equal("brandId" in v2, false);
  assert.equal("brand" in v2, false);
  // Chosen from the list: the id alone.
  const chosen = createInventoryItemRequest("biz", draft({ brandId: "b-jordan", brand: "Jordan", categoryId: "c-care", category: "Care" }));
  assert.equal(chosen.brandId, "b-jordan");
  assert.equal("brand" in chosen, false);
  assert.equal(chosen.categoryId, "c-care");
  // Typed (the list could not be read): the name.
  const typed = createInventoryItemRequest("biz", draft({ brand: " Jordan ", brandId: "" }));
  assert.equal(typed.brand, "Jordan");
  assert.equal("brandId" in typed, false);
});

test("editing: a chosen brand goes by id, a typed one by name, a cleared one clears both, a never-branded product sends nothing", () => {
  const branded = item({ name: "11", brand: "Jordan", brandId: "b-jordan" });
  const base = inventoryDraftFromItem(branded, [], brands);
  assert.equal(base.brandId, "b-jordan");
  assert.equal(base.brand, "Jordan");
  const same = updateInventoryItemRequest("biz", branded, base);
  assert.equal(same.brandId, "b-jordan");
  assert.equal("brand" in same, false);
  const cleared = updateInventoryItemRequest("biz", branded, { ...base, brand: "", brandId: "" });
  assert.equal(cleared.brand, "");
  assert.equal(cleared.brandId, "");
  const typed = updateInventoryItemRequest("biz", branded, { ...base, brand: "Nike", brandId: "" });
  assert.equal(typed.brand, "Nike");
  assert.equal("brandId" in typed, false);
  const never = updateInventoryItemRequest("biz", item(), inventoryDraftFromItem(item(), [], brands));
  assert.equal("brand" in never, false);
  assert.equal("brandId" in never, false);
});

test("a change of brand alone is a change worth saving; the same brand is not", () => {
  const branded = item({ name: "11", brand: "Jordan", brandId: "b-jordan" });
  const base = inventoryDraftFromItem(branded, [], brands);
  assert.equal(inventoryDraftChanged(branded, base, [], brands), false);
  assert.equal(inventoryDraftChanged(branded, { ...base, brandId: "b-nike", brand: "Nike" }, [], brands), true);
  assert.equal(inventoryDraftChanged(branded, { ...base, brandId: "", brand: "" }, [], brands), true);
  // A product whose snapshot lags a rename is not "changed" by being matched to the list.
  const lagging = item({ name: "11", brand: "Air", brandId: "b-jordan" });
  assert.equal(inventoryDraftChanged(lagging, inventoryDraftFromItem(lagging, [], brands), [], brands), false);
});

test("a too-long brand typed into the form is refused before the call", () => {
  assert.deepEqual(validateInventoryItemDraft(draft({ brand: "b".repeat(61) }), true), ["brand_too_long"]);
  assert.deepEqual(validateInventoryItemDraft(draft({ brand: "Jordan", brandId: "b-jordan" }), true), []);
});

test("quick entry keeps ONLY the brand and the category; everything else starts empty", () => {
  const saved = draft({
    name: "11", price: "150", cost: "90", quantity: "12", lowStockAt: "3", photoUrl: "https://x.test/a.png",
    brand: "Jordan", brandId: "b-jordan", category: "Shoes", categoryId: "c-shoes", stock: { "s-main": "5", "s-down": "7" },
  });
  const next = quickEntryDraft(saved);
  assert.equal(next.brand, "Jordan");
  assert.equal(next.brandId, "b-jordan");
  assert.equal(next.category, "Shoes");
  assert.equal(next.categoryId, "c-shoes");
  assert.equal(next.name, "");
  assert.equal(next.price, "");
  assert.equal(next.cost, "");
  assert.equal(next.quantity, emptyInventoryItemDraft.quantity);
  assert.equal(next.lowStockAt, "");
  assert.equal(next.photoUrl, "");
  assert.deepEqual(next.stock, {});
  // The saved draft is not touched, and the empty form's own stock map is not shared.
  assert.equal(saved.name, "11");
  assert.notEqual(next.stock, emptyInventoryItemDraft.stock);
  // Nothing to keep: the empty form.
  assert.deepEqual(quickEntryDraft(draft({ name: "x" })), { ...emptyInventoryItemDraft, stock: {} });
});

test("the summary reads byBrand, richest first, with the No brand row; an older answer has none", () => {
  const read = readInventorySummary({
    byBrand: [
      { brandId: "", name: "No brand", itemsSold: 1, revenueCents: 500, profitCents: 100 },
      { brandId: "b-nike", name: "Nike", itemsSold: 2, revenueCents: 9000, profitCents: -50 },
      { brandId: "b-jordan", name: "Jordan", itemsSold: 3, revenueCents: 9000, profitCents: 4000 },
    ],
    best: [{ itemId: "i", name: "11", brand: "Jordan", quantity: 1, revenueCents: 100 }],
  });
  assert.deepEqual(read?.byBrand.map((b) => b.brandId), ["b-jordan", "b-nike", ""]);
  assert.equal(read?.byBrand[1].profitCents, -50);
  assert.equal(read?.best[0].brand, "Jordan");
  assert.deepEqual(readInventorySummary({})?.byBrand, []);
});

test("the brand refusals read as friendly sentences", () => {
  assert.equal(INVENTORY_MESSAGES.brand_name_required, "Enter the brand's name.");
  assert.equal(INVENTORY_MESSAGES.brand_name_taken, "You already have a brand with that name.");
  assert.equal(INVENTORY_MESSAGES.brand_not_found, "That brand no longer exists.");
  assert.equal(INVENTORY_MESSAGES.brand_too_long, "The brand is too long.");
  const failure = inventoryCallableFailure({ code: "functions/already-exists", message: "raw words", details: { reason: "brand_name_taken" } });
  assert.equal(failure.reason, "brand_name_taken");
  assert.equal(failure.message, INVENTORY_MESSAGES.brand_name_taken);
});

test("quick entry's confirmation is built per language", () => {
  assert.equal(savedNextText("Jordan 11"), "Saved Jordan 11. Add the next one.");
  assert.equal(savedNextText("Jordan 11", "fr"), "Jordan 11 enregistré. Ajoutez le suivant.");
});

test("a sale alert's focus: needs a sale id, keeps its store, is new on every click", () => {
  assert.equal(saleFocusFrom("", "s-down", 1), null);
  assert.equal(saleFocusFrom(undefined, "s-down", 1), null);
  assert.deepEqual(saleFocusFrom(" sale-1 ", " s-down ", 7), { saleId: "sale-1", storeId: "s-down", key: 7 });
  // A single-store business sends no store.
  assert.deepEqual(saleFocusFrom("sale-1", "", 2), { saleId: "sale-1", storeId: "", key: 2 });
  assert.notEqual(saleFocusFrom("sale-1", "", 2), saleFocusFrom("sale-1", "", 2));
});

test("a sale alert narrows the list to its store only for whoever sees every store", () => {
  const focus = { storeId: "s-down" };
  const owner = resolveStoreAccess({ isOwner: true, homeStoreId: "", allStores: false }, storeRows);
  const roaming = resolveStoreAccess({ isOwner: false, homeStoreId: "", allStores: true }, storeRows);
  const staff = resolveStoreAccess({ isOwner: false, homeStoreId: "s-main", allStores: false }, storeRows);
  assert.equal(saleFocusStoreFilter(focus, owner), "s-down");
  assert.equal(saleFocusStoreFilter(focus, roaming), "s-down");
  // Staff of another store keep their own view (the sale itself is then "not available").
  assert.equal(saleFocusStoreFilter(focus, staff), "");
  // A store that is gone, no store, a single-store business, no alert: no filter.
  assert.equal(saleFocusStoreFilter({ storeId: "s-gone" }, owner), "");
  assert.equal(saleFocusStoreFilter({ storeId: "" }, owner), "");
  assert.equal(saleFocusStoreFilter(focus, resolveStoreAccess({ isOwner: true, homeStoreId: "", allStores: false }, [storeRows[0]])), "");
  assert.equal(saleFocusStoreFilter(null, owner), "");
});

test("a sale opened by id is shown only to someone whose list could show it", () => {
  const owner = resolveStoreAccess({ isOwner: true, homeStoreId: "", allStores: false }, storeRows);
  const downStaff = resolveStoreAccess({ isOwner: false, homeStoreId: "s-down", allStores: false }, storeRows);
  const homeless = resolveStoreAccess({ isOwner: false, homeStoreId: "", allStores: false }, storeRows);
  const single = resolveStoreAccess({ isOwner: false, homeStoreId: "", allStores: false }, [storeRows[0]]);
  const downSale = { id: "a", businessId: "biz-1", storeId: "s-down" };
  const mainSale = { id: "b", businessId: "biz-1", storeId: "s-main" };
  assert.equal(saleVisibleToViewer(downSale, "biz-1", owner), true);
  assert.equal(saleVisibleToViewer(mainSale, "biz-1", owner), true);
  assert.equal(saleVisibleToViewer(downSale, "biz-1", downStaff), true);
  assert.equal(saleVisibleToViewer(mainSale, "biz-1", downStaff), false);
  assert.equal(saleVisibleToViewer(downSale, "biz-1", homeless), false);
  // Another business's sale never; a missing business or row never.
  assert.equal(saleVisibleToViewer(downSale, "biz-2", owner), false);
  assert.equal(saleVisibleToViewer(downSale, "", owner), false);
  assert.equal(saleVisibleToViewer(null, "biz-1", owner), false);
  // A single-store business: every inventory staff member, whatever the sale's store field says.
  assert.equal(saleVisibleToViewer({ businessId: "biz-1" }, "biz-1", single), true);
});
