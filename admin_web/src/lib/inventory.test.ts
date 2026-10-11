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
  assert.deepEqual(read?.countWasOff, [{ itemId: "m", name: "Mystery" }]);
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
