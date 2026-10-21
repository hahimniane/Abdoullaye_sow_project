"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const inv = require("../inventory");
const {renderInventoryTags} = require("../inventory_tags");
const {INVOICE_PAYMENT_METHODS, MAX_CENTS} = require("../invoice_ledger");

const item = (extra = {}) => ({
  name: "Shea butter", code: "IT-K7M4P2", priceCents: 1000, costCents: 400,
  quantity: 5, lowStockAt: 2, archived: false, countWasOff: false, ...extra,
});
const items = (entries) => new Map(Object.entries(entries));

describe("inventory: a product", () => {
  const valid = {name: "Shea butter", priceCents: 1000, quantity: 5};

  it("accepts the minimum a product needs", () => {
    assert.deepEqual(inv.validateItemCreate(valid), []);
  });

  it("names every problem at once", () => {
    assert.deepEqual(inv.validateItemCreate({}).sort(),
        ["name_required", "price_invalid", "quantity_invalid"]);
    assert.deepEqual(
        inv.validateItemCreate({...valid, costCents: -1, lowStockAt: 1.5,
          photoUrl: "http://x.test/a.png", category: "c".repeat(61)}).sort(),
        ["category_too_long", "cost_invalid", "low_stock_invalid",
          "photo_url_invalid"]);
  });

  it("holds the price to whole cents above zero and within MAX_CENTS", () => {
    for (const bad of [0, -5, 1.5, "abc", "", null, MAX_CENTS + 1, true]) {
      assert.deepEqual(
          inv.validateItemCreate({...valid, priceCents: bad}),
          ["price_invalid"], String(bad));
    }
    assert.deepEqual(
        inv.validateItemCreate({...valid, priceCents: MAX_CENTS}), []);
    // digits typed as a string are still a whole number
    assert.deepEqual(
        inv.validateItemCreate({...valid, priceCents: "1250"}), []);
  });

  it("treats an empty cost or low-stock level as 'not set'", () => {
    assert.deepEqual(inv.validateItemCreate(
        {...valid, costCents: "", lowStockAt: null}), []);
    const record = inv.itemCreateRecord(
        {...valid, costCents: "", lowStockAt: null},
        {businessId: "b", code: "IT-AAAAAA", uid: "u"});
    assert.equal(record.costCents, null);
    assert.equal(record.lowStockAt, null);
    // zero is a real cost and a real level
    const zero = inv.itemCreateRecord(
        {...valid, costCents: 0, lowStockAt: 0},
        {businessId: "b", code: "IT-AAAAAA", uid: "u"});
    assert.equal(zero.costCents, 0);
    assert.equal(zero.lowStockAt, 0);
  });

  it("refuses a name that is empty or too long, and an http photo", () => {
    assert.deepEqual(inv.validateItemCreate({...valid, name: "   "}),
        ["name_required"]);
    assert.deepEqual(
        inv.validateItemCreate({...valid, name: "n".repeat(121)}),
        ["name_too_long"]);
    assert.deepEqual(inv.validateItemCreate(
        {...valid, photoUrl: "https://cdn.test/a.png"}), []);
    assert.deepEqual(inv.validateItemCreate(
        {...valid, photoUrl: "javascript:alert(1)"}), ["photo_url_invalid"]);
    assert.deepEqual(inv.validateItemCreate({...valid, photoUrl: ""}), []);
  });

  it("builds the stored record with a clean start", () => {
    const record = inv.itemCreateRecord(
        {...valid, name: "  Shea butter ", category: " Care "},
        {businessId: "biz", code: "IT-K7M4P2", uid: "staff"});
    assert.deepEqual(record, {
      businessId: "biz", name: "Shea butter", code: "IT-K7M4P2",
      priceCents: 1000, costCents: null, quantity: 5, lowStockAt: null,
      category: "Care", categoryId: "", brandId: "", brand: "",
      photoUrl: "", archived: false,
      countWasOff: false, createdByStaffId: "staff",
      updatedByStaffId: "staff",
    });
  });

  it("updates only what was sent, never the count", () => {
    assert.deepEqual(inv.validateItemUpdate({}), ["nothing_to_update"]);
    assert.deepEqual(inv.validateItemUpdate({quantity: 3, name: "x"}),
        ["quantity_not_editable"]);
    assert.deepEqual(inv.validateItemUpdate({priceCents: 0}),
        ["price_invalid"]);
    assert.deepEqual(inv.validateItemUpdate({name: ""}), ["name_required"]);
    assert.deepEqual(inv.validateItemUpdate({costCents: null}), []);
    assert.deepEqual(
        inv.itemUpdatePatch({priceCents: "1500", costCents: "",
          lowStockAt: null, category: " Skin "}),
        {priceCents: 1500, costCents: null, lowStockAt: null,
          category: "Skin"});
  });

  it("describes an edit as the history shows it", () => {
    const diff = inv.itemFieldDiff(item(),
        {priceCents: 1200, name: "Shea butter", costCents: null});
    assert.deepEqual(diff, [
      {field: "Price", from: "$10.00", to: "$12.00"},
      {field: "Cost", from: "$4.00", to: "—"},
    ]);
  });

  it("is low at its level, and always when it is out", () => {
    assert.equal(inv.itemIsLow(item({quantity: 3})), false);
    assert.equal(inv.itemIsLow(item({quantity: 2})), true);
    assert.equal(inv.itemIsLow(item({quantity: 0, lowStockAt: null})), true);
    assert.equal(inv.itemIsLow(item({quantity: 9, lowStockAt: null})), false);
    assert.equal(inv.itemIsLow(item({quantity: 1, lowStockAt: 0})), false);
  });
});

describe("inventory: stock actions", () => {
  it("adds a positive number on top", () => {
    const plan = inv.planStockAdjust(item({quantity: 5}),
        {mode: "add", quantity: 3});
    assert.deepEqual(plan, {errors: [], type: "add", quantityAfter: 8,
      delta: 3, countWasOff: false});
  });

  it("add keeps the 'count was off' flag; set clears it", () => {
    const off = item({quantity: 0, countWasOff: true});
    assert.equal(inv.planStockAdjust(off,
        {mode: "add", quantity: 2}).countWasOff, true);
    const set = inv.planStockAdjust(off, {mode: "set", quantity: 4});
    assert.equal(set.countWasOff, false);
    assert.equal(set.delta, 4);
  });

  it("corrects a count down too, and to zero", () => {
    const plan = inv.planStockAdjust(item({quantity: 5}),
        {mode: "set", quantity: 0});
    assert.equal(plan.quantityAfter, 0);
    assert.equal(plan.delta, -5);
  });

  it("refuses a bad mode, a zero add and a count past the cap", () => {
    assert.deepEqual(inv.planStockAdjust(item(), {mode: "x", quantity: 1})
        .errors, ["mode_invalid"]);
    assert.deepEqual(inv.planStockAdjust(item(), {mode: "add", quantity: 0})
        .errors, ["quantity_invalid"]);
    assert.deepEqual(inv.planStockAdjust(item(), {mode: "add", quantity: -2})
        .errors, ["quantity_invalid"]);
    assert.deepEqual(inv.planStockAdjust(item(), {mode: "set", quantity: 1.5})
        .errors, ["quantity_invalid"]);
    assert.deepEqual(
        inv.planStockAdjust(item({quantity: inv.MAX_QUANTITY}),
            {mode: "add", quantity: 1}).errors, ["quantity_invalid"]);
  });

  it("writes a movement row with a signed delta", () => {
    assert.deepEqual(inv.movementRecord({businessId: "b", itemId: "i",
      type: "sale", delta: -2, quantityAfter: 3, uid: "u", saleId: "s"}),
    {businessId: "b", itemId: "i", type: "sale", delta: -2, quantityAfter: 3,
      byStaffId: "u", note: "", saleId: "s"});
  });
});

describe("inventory: recording a sale", () => {
  const base = {clientRequestId: "req-12345678", paymentMethod: "cash",
    lines: [{itemId: "a", quantity: 1, soldPriceCents: 1000}]};

  it("accepts a well-formed sale", () => {
    const {errors, lines} = inv.cleanSaleInput(base);
    assert.deepEqual(errors, []);
    assert.deepEqual(lines,
        [{itemId: "a", quantity: 1, soldPriceCents: 1000}]);
  });

  it("takes the payment methods invoices use", () => {
    for (const method of INVOICE_PAYMENT_METHODS) {
      assert.deepEqual(
          inv.cleanSaleInput({...base, paymentMethod: method}).errors, []);
    }
    assert.deepEqual(
        inv.cleanSaleInput({...base, paymentMethod: "bitcoin"}).errors,
        ["payment_method_invalid"]);
  });

  it("needs a usable retry key", () => {
    for (const bad of ["", "short", "has space in it", "a/b/c/d/e/f/g", null]) {
      assert.deepEqual(
          inv.cleanSaleInput({...base, clientRequestId: bad}).errors,
          ["client_request_id_invalid"], String(bad));
    }
  });

  it("needs lines, within the cap", () => {
    assert.deepEqual(inv.cleanSaleInput({...base, lines: []}).errors,
        ["lines_required"]);
    assert.deepEqual(inv.cleanSaleInput({...base, lines: undefined}).errors,
        ["lines_required"]);
    const many = Array.from({length: 51}, () => base.lines[0]);
    assert.deepEqual(inv.cleanSaleInput({...base, lines: many}).errors,
        ["lines_too_many"]);
  });

  it("holds each line to a whole quantity and an explicit price", () => {
    const errorsFor = (line) => inv.cleanSaleInput(
        {...base, lines: [{itemId: "a", quantity: 1, soldPriceCents: 500,
          ...line}]}).errors;
    assert.deepEqual(errorsFor({quantity: 0}), ["quantity_invalid"]);
    assert.deepEqual(errorsFor({quantity: 1.5}), ["quantity_invalid"]);
    assert.deepEqual(errorsFor({quantity: -1}), ["quantity_invalid"]);
    // an empty price field is not a free item
    assert.deepEqual(errorsFor({soldPriceCents: ""}), ["price_invalid"]);
    assert.deepEqual(errorsFor({soldPriceCents: undefined}),
        ["price_invalid"]);
    assert.deepEqual(errorsFor({soldPriceCents: -1}), ["price_invalid"]);
    assert.deepEqual(errorsFor({soldPriceCents: 9.5}), ["price_invalid"]);
    assert.deepEqual(errorsFor({itemId: ""}), ["item_not_found"]);
    assert.deepEqual(errorsFor({itemId: "x/y"}), ["item_not_found"]);
    // zero is an explicit price: a giveaway, shown as a full discount
    assert.deepEqual(errorsFor({soldPriceCents: 0}), []);
  });

  it("refuses a total above MAX_CENTS", () => {
    assert.deepEqual(inv.cleanSaleInput({...base, lines: [
      {itemId: "a", quantity: 2, soldPriceCents: MAX_CENTS}]}).errors,
    ["total_too_large"]);
  });

  it("uses one document per business and retry key", () => {
    const a = inv.saleDocId("biz1", "req-12345678");
    assert.equal(a, inv.saleDocId("biz1", "req-12345678"));
    assert.notEqual(a, inv.saleDocId("biz2", "req-12345678"));
    assert.notEqual(a, inv.saleDocId("biz1", "req-87654321"));
    assert.match(a, /^[0-9a-f]{40}$/);
  });

  it("refuses a missing, foreign or archived product", () => {
    const lines = [{itemId: "a", quantity: 1, soldPriceCents: 100},
      {itemId: "b", quantity: 1, soldPriceCents: 100}];
    assert.deepEqual(inv.saleItemRefusal(lines, items({a: item()})),
        {reason: "item_not_found", itemIds: ["b"]});
    assert.deepEqual(
        inv.saleItemRefusal(lines, items({a: item(),
          b: item({archived: true})})),
        {reason: "item_archived", itemIds: ["b"]});
    assert.equal(inv.saleItemRefusal(lines,
        items({a: item(), b: item()})), null);
  });
});

describe("inventory: what a sale does", () => {
  it("snapshots name, code, list price, sold price and cost", () => {
    const plan = inv.planSale(
        [{itemId: "a", quantity: 2, soldPriceCents: 800}],
        items({a: item({quantity: 5})}));
    assert.deepEqual(plan.lines, [{
      itemId: "a", name: "Shea butter", code: "IT-K7M4P2", quantity: 2,
      categoryId: "", category: "", brandId: "", brand: "",
      listPriceCents: 1000, soldPriceCents: 800, costCents: 400,
      countWasOff: false, stockDeducted: 2,
    }]);
    assert.equal(plan.totalCents, 1600);
    assert.deepEqual(plan.items,
        [{itemId: "a", quantityAfter: 3, countWasOff: false}]);
    assert.deepEqual(plan.movements,
        [{itemId: "a", delta: -2, quantityAfter: 3}]);
    assert.deepEqual(plan.warnings, []);
  });

  it("keeps an unknown cost unknown, not zero", () => {
    const plan = inv.planSale(
        [{itemId: "a", quantity: 1, soldPriceCents: 800}],
        items({a: item({costCents: null})}));
    assert.equal(plan.lines[0].costCents, null);
  });

  it("selling the exact count empties the shelf without a warning", () => {
    const plan = inv.planSale(
        [{itemId: "a", quantity: 5, soldPriceCents: 1000}],
        items({a: item({quantity: 5})}));
    assert.equal(plan.items[0].quantityAfter, 0);
    assert.equal(plan.items[0].countWasOff, false);
    assert.deepEqual(plan.warnings, []);
  });

  it("floors at zero, flags the line and the product, and warns", () => {
    const plan = inv.planSale(
        [{itemId: "a", quantity: 3, soldPriceCents: 1000}],
        items({a: item({quantity: 1})}));
    assert.equal(plan.lines[0].quantity, 3);
    assert.equal(plan.lines[0].stockDeducted, 1);
    assert.equal(plan.lines[0].countWasOff, true);
    assert.equal(plan.totalCents, 3000);
    assert.deepEqual(plan.items,
        [{itemId: "a", quantityAfter: 0, countWasOff: true}]);
    assert.deepEqual(plan.movements,
        [{itemId: "a", delta: -1, quantityAfter: 0}]);
    assert.deepEqual(plan.warnings,
        [{itemId: "a", reason: "count_was_off"}]);
  });

  it("selling an item already at zero records the sale and never goes " +
    "negative", () => {
    const plan = inv.planSale(
        [{itemId: "a", quantity: 1, soldPriceCents: 1000}],
        items({a: item({quantity: 0})}));
    assert.equal(plan.items[0].quantityAfter, 0);
    assert.equal(plan.movements[0].delta, 0);
    assert.equal(plan.lines[0].countWasOff, true);
  });

  it("shares one product's stock across two lines sold at two prices", () => {
    const plan = inv.planSale([
      {itemId: "a", quantity: 2, soldPriceCents: 1000},
      {itemId: "a", quantity: 2, soldPriceCents: 800},
    ], items({a: item({quantity: 3})}));
    assert.deepEqual(plan.lines.map((l) => [l.stockDeducted, l.countWasOff]),
        [[2, false], [1, true]]);
    assert.deepEqual(plan.items,
        [{itemId: "a", quantityAfter: 0, countWasOff: true}]);
    assert.equal(plan.totalCents, 3600);
    assert.equal(plan.warnings.length, 1);
  });

  it("a product already flagged stays flagged", () => {
    const plan = inv.planSale(
        [{itemId: "a", quantity: 1, soldPriceCents: 1000}],
        items({a: item({quantity: 5, countWasOff: true})}));
    assert.equal(plan.items[0].countWasOff, true);
    assert.equal(plan.lines[0].countWasOff, false);
    assert.deepEqual(plan.warnings, []);
  });

  it("reads warnings back off a stored sale", () => {
    assert.deepEqual(inv.saleWarnings({lines: [
      {itemId: "a", countWasOff: true}, {itemId: "a", countWasOff: true},
      {itemId: "b", countWasOff: false}]}),
    [{itemId: "a", reason: "count_was_off"}]);
  });
});

describe("inventory: voiding a sale", () => {
  it("puts back what left the shelf, never invented stock", () => {
    const sale = {lines: [
      {itemId: "a", quantity: 3, stockDeducted: 1},
      {itemId: "b", quantity: 2, stockDeducted: 2},
    ]};
    const plan = inv.planVoid(sale,
        items({a: item({quantity: 0}), b: item({quantity: 4})}));
    assert.deepEqual(plan.items, [
      {itemId: "a", quantityAfter: 1}, {itemId: "b", quantityAfter: 6}]);
    assert.deepEqual(plan.movements.map((m) => m.delta), [1, 2]);
    assert.deepEqual(plan.skipped, []);
  });

  it("skips a product that has been deleted since", () => {
    const plan = inv.planVoid(
        {lines: [{itemId: "gone", quantity: 1, stockDeducted: 1}]},
        items({}));
    assert.deepEqual(plan.items, []);
    assert.deepEqual(plan.skipped, ["gone"]);
  });

  it("restores two lines of one product cumulatively", () => {
    const plan = inv.planVoid({lines: [
      {itemId: "a", quantity: 2, stockDeducted: 2},
      {itemId: "a", quantity: 2, stockDeducted: 1}]},
    items({a: item({quantity: 0})}));
    assert.deepEqual(plan.items, [{itemId: "a", quantityAfter: 3}]);
  });
});

describe("inventory: summary", () => {
  const line = (itemId, quantity, sold, list, cost, name = itemId) => ({
    itemId, name, quantity, soldPriceCents: sold, listPriceCents: list,
    costCents: cost,
  });

  it("totals sales, discounts and known costs; leaves voided out", () => {
    const sales = [
      {lines: [line("a", 2, 800, 1000, 400), line("b", 1, 500, 500, null)]},
      {lines: [line("a", 1, 1200, 1000, 400)]},
      {voided: true, lines: [line("a", 9, 1000, 1000, 400)]},
    ];
    const s = inv.summarizeSales(sales);
    assert.equal(s.salesCount, 2);
    assert.equal(s.itemsSold, 4);
    assert.equal(s.revenueCents, 1600 + 500 + 1200);
    assert.equal(s.costCents, 3 * 400);
    // profit counts only the lines whose cost is known (a: 2800 - 1200)
    assert.equal(s.profitCents, 2800 - 1200);
    assert.equal(s.linesWithoutCost, 1);
    // only a price BELOW list is a discount: (1000-800) * 2
    assert.equal(s.discountCents, 400);
  });

  it("names the five best sellers by pieces, then revenue", () => {
    const sales = [{lines: [
      line("a", 5, 100, 100, 1, "A"), line("b", 5, 300, 300, 1, "B"),
      line("c", 4, 100, 100, 1, "C"), line("d", 3, 100, 100, 1, "D"),
      line("e", 2, 100, 100, 1, "E"), line("f", 1, 100, 100, 1, "F"),
    ]}];
    const best = inv.summarizeSales(sales).best;
    assert.deepEqual(best.map((b) => b.itemId), ["b", "a", "c", "d", "e"]);
    assert.deepEqual(best[0], {itemId: "b", name: "B", quantity: 5,
      revenueCents: 1500});
  });

  it("is all zeros when there are no sales", () => {
    assert.deepEqual(inv.summarizeSales([]), {
      salesCount: 0, itemsSold: 0, revenueCents: 0, costCents: 0,
      profitCents: 0, discountCents: 0, linesWithoutCost: 0, best: [],
      paidNowCents: 0, creditCents: 0, creditOutstandingCents: 0});
  });

  it("lists low and 'count was off' products, hiding archived ones", () => {
    const shelf = inv.summarizeShelf([
      {id: "1", name: "Zero", quantity: 0, lowStockAt: null},
      {id: "2", name: "Low", quantity: 2, lowStockAt: 2},
      {id: "3", name: "Fine", quantity: 9, lowStockAt: 2},
      {id: "4", name: "Hidden", quantity: 0, archived: true},
      {id: "5", name: "Off", quantity: 7, lowStockAt: 2, countWasOff: true},
      {id: "6", name: "Hidden off", quantity: 7, archived: true,
        countWasOff: true},
    ]);
    assert.deepEqual(shelf.low.map((l) => l.itemId), ["1", "2"]);
    assert.equal(shelf.lowCount, 2);
    assert.deepEqual(shelf.low[0],
        {itemId: "1", name: "Zero", quantity: 0, lowStockAt: null});
    assert.deepEqual(shelf.countWasOff, [{itemId: "5", name: "Off"}]);
    assert.equal(shelf.countWasOffCount, 1);
  });
});

describe("inventory: today and this month in the viewer's zone", () => {
  const at = (iso) => new Date(iso);

  it("starts the day at local midnight", () => {
    // 23:30 on Oct 9 in New York (EDT) is already Oct 10 in UTC.
    const b = inv.rangeBounds("today", "America/New_York",
        at("2026-10-10T03:30:00Z"));
    assert.equal(new Date(b.startMs).toISOString(), "2026-10-09T04:00:00.000Z");
    assert.equal(b.startKey, "2026-10-09");
    assert.equal(b.zone, "America/New_York");
  });

  it("starts the month on the 1st, local", () => {
    const b = inv.rangeBounds("month", "America/New_York",
        at("2026-10-10T03:30:00Z"));
    assert.equal(new Date(b.startMs).toISOString(), "2026-10-01T04:00:00.000Z");
    assert.equal(b.startKey, "2026-10-01");
  });

  it("uses the offset of the day it starts, across a DST change", () => {
    // New York left daylight time on Nov 1 2026 at 2am; Nov 1 midnight was
    // still EDT, and Nov 10 is EST.
    const nov = inv.rangeBounds("month", "America/New_York",
        at("2026-11-10T12:00:00Z"));
    assert.equal(new Date(nov.startMs).toISOString(),
        "2026-11-01T04:00:00.000Z");
    const day = inv.rangeBounds("today", "America/New_York",
        at("2026-11-10T12:00:00Z"));
    assert.equal(new Date(day.startMs).toISOString(),
        "2026-11-10T05:00:00.000Z");
  });

  it("works east of UTC", () => {
    const b = inv.rangeBounds("today", "Asia/Tokyo",
        at("2026-10-10T20:00:00Z"));
    assert.equal(new Date(b.startMs).toISOString(), "2026-10-10T15:00:00.000Z");
    assert.equal(b.startKey, "2026-10-11");
  });

  it("reads a missing or unknown zone as UTC", () => {
    for (const zone of ["", undefined, "Not/AZone"]) {
      const b = inv.rangeBounds("today", zone, at("2026-10-10T03:30:00Z"));
      assert.equal(new Date(b.startMs).toISOString(),
          "2026-10-10T00:00:00.000Z");
      assert.equal(b.zone, "UTC");
    }
  });
});

describe("inventory: tags", () => {
  it("accepts 1 to 500 copies and nothing else", () => {
    assert.equal(inv.tagCopies(1), 1);
    assert.equal(inv.tagCopies("500"), 500);
    for (const bad of [0, 501, -1, 1.5, "", null, undefined, "x"]) {
      assert.equal(inv.tagCopies(bad), null, String(bad));
    }
  });

  it("encodes the customer console's /i/ link", () => {
    assert.equal(inv.inventoryLink("", "it-k7m4p2"),
        "https://customer.laawoldigital.com/i/IT-K7M4P2");
    assert.equal(inv.inventoryLink("https://x.test/", "IT-K7M4P2"),
        "https://x.test/i/IT-K7M4P2");
  });

  it("prints the same code N times, QR only, no product details", () => {
    const model = inv.tagsModel({item: item(), copies: 3, consoleUrl: ""});
    assert.deepEqual(model, {code: "IT-K7M4P2",
      link: "https://customer.laawoldigital.com/i/IT-K7M4P2", copies: 3});
    const page = renderInventoryTags(model, {qrSvg: "<svg id=\"qr\"></svg>"});
    assert.equal(page.match(/class="tag"/g).length, 3);
    assert.equal(page.match(/<svg id="qr">/g).length, 3);
    assert.match(page, /@page\{size:2in 1in/);
    assert.ok(!page.includes("Shea butter"), "no product name");
    assert.ok(!page.includes("1000"), "no price");
    assert.ok(!page.includes("IT-K7M4P2"), "QR only: no printed code");
  });
});

describe("inventory: wiring in index.js", () => {
  const source = fs.readFileSync(
      path.join(__dirname, "..", "index.js"), "utf8");

  it("is a business service and a staff permission section", () => {
    assert.match(source,
        /const VALID_BUSINESS_SERVICES = \[[^\]]*"inventory"/);
    assert.match(source,
        /const VALID_BUSINESS_PERMISSIONS = \[[^\]]*"inventory"/);
  });

  it("is not switched on for a business that never chose its services", () => {
    assert.match(source, new RegExp(
        "const DEFAULT_BUSINESS_SERVICES =\\s*VALID_BUSINESS_SERVICES" +
        "\\.filter\\(\\s*\\(service\\) => service !== \"inventory\"\\)"));
  });

  it("gates every callable on the section and the service", () => {
    const names = ["createInventoryItem", "updateInventoryItem",
      "adjustInventoryStock", "archiveInventoryItem", "deleteInventoryItem",
      "recordInventorySale", "voidInventorySale", "getInventoryLabelsUrl",
      "getInventorySummary", "createInventoryCategory",
      "renameInventoryCategory", "archiveInventoryCategory",
      "syncInventoryCategories", "createInventoryStore",
      "updateInventoryStore", "archiveInventoryStore",
      "setInventoryStaffAccess", "transferInventoryStock"];
    for (const name of names) {
      const start = source.indexOf(`exports.${name} = onCall(`);
      assert.ok(start > 0, `${name} is exported`);
      const body = source.slice(start, start + 900);
      assert.match(body, /requireInventory(Access|Context)\(uid, businessId\)/,
          `${name} checks permission and service`);
    }
  });

  it("serves the tags view from the shared /d handler", () => {
    assert.match(source, /view \|\| ""\) === "inventoryTags"/);
  });
});

describe("ownerEditableServices", () => {
  const {ownerEditableServices} = require("../inventory");
  const ORDER = ["barrelShipping", "freight", "inventory"];
  it("lets an owner neither add nor drop Inventory", () => {
    assert.deepEqual(
        ownerEditableServices(["freight", "inventory"], ["freight"], false,
            ORDER), ["freight"]);
    assert.deepEqual(
        ownerEditableServices(["freight"], ["freight", "inventory"], false,
            ORDER), ["freight", "inventory"]);
    assert.deepEqual(ownerEditableServices(["inventory"], undefined, false,
        ORDER), []);
  });
  it("lets the owner switch it from Services & coverage (profile save)",
      () => {
        const owner = {ownerMayToggle: true};
        assert.deepEqual(ownerEditableServices(["freight", "inventory"],
            ["freight"], false, ORDER, owner), ["freight", "inventory"]);
        assert.deepEqual(ownerEditableServices(["freight"],
            ["freight", "inventory"], false, ORDER, owner), ["freight"]);
        // Only a strict true opens it.
        assert.deepEqual(ownerEditableServices(["inventory"], [], false,
            ORDER, {ownerMayToggle: "yes"}), []);
      });
  it("lets a platform admin set it freely", () => {
    assert.deepEqual(
        ownerEditableServices(["freight", "inventory"], ["freight"], true,
            ORDER), ["freight", "inventory"]);
    assert.deepEqual(ownerEditableServices(["freight"], ["inventory"], true,
        ORDER), ["freight"]);
  });
});

describe("planInventoryService", () => {
  const {planInventoryService} = require("../inventory");
  const ORDER = ["barrelShipping", "freight", "parking", "inventory"];
  it("adds inventory last and keeps the other services in order", () => {
    const plan = planInventoryService(["freight", "barrelShipping"], true,
        ORDER);
    assert.deepEqual(plan, {valid: true, changed: true, enabled: true,
      services: ["barrelShipping", "freight", "inventory"]});
  });
  it("removes only inventory", () => {
    const plan = planInventoryService(["freight", "inventory", "parking"],
        false, ORDER);
    assert.equal(plan.changed, true);
    assert.deepEqual(plan.services, ["freight", "parking"]);
  });
  it("changes nothing when it is already in that state", () => {
    assert.equal(planInventoryService(["freight", "inventory"], true, ORDER)
        .changed, false);
    assert.equal(planInventoryService(["freight"], false, ORDER).changed,
        false);
    assert.equal(planInventoryService([], false, ORDER).changed, false);
  });
  it("drops unknown services and survives a missing list", () => {
    assert.deepEqual(planInventoryService(["freight", "bogus"], true, ORDER)
        .services, ["freight", "inventory"]);
    assert.deepEqual(planInventoryService(undefined, true, ORDER).services,
        ["inventory"]);
  });
  it("only accepts a real boolean", () => {
    for (const bad of [undefined, null, "true", 1, 0, {}]) {
      const plan = planInventoryService(["freight"], bad, ORDER);
      assert.equal(plan.valid, false, String(bad));
      assert.equal(plan.changed, false, String(bad));
    }
  });
});

describe("The admin Inventory switch is wired on the server", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const body = src.slice(src.indexOf("exports.setBusinessInventoryService"),
      src.indexOf("exports.deleteAdminRecord"));
  it("is a callable gated to the businesses capability, with an audit", () => {
    assert.ok(body.length > 100);
    assert.match(body,
        /requireAdminCapability\(\s*adminUser,\s*"businesses"/);
    assert.match(body, /setAdminAuditLog\(/);
    assert.match(body, /not-found/);
  });
});

describe("Who may switch Inventory in the owner-facing callables", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  it("filters the application and the profile update", () => {
    const uses = src.match(/inventory\.ownerEditableServices\(/g) || [];
    assert.equal(uses.length, 2);
  });
  it("lets the owner switch it only in the profile save", () => {
    const apply = src.slice(src.indexOf("exports.submitBusinessApplication"),
        src.indexOf("exports.createAdminBusiness"));
    const profile = src.slice(src.indexOf("exports.updateBusinessProfile"));
    assert.doesNotMatch(apply, /ownerMayToggle/);
    assert.match(profile.slice(0, 6000), /ownerMayToggle: true/);
  });
});


describe("Asking for Inventory is a flag, not a service", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const apply = src.slice(src.indexOf("exports.submitBusinessApplication"),
      src.indexOf("exports.createAdminBusiness"));
  const toggle = src.slice(src.indexOf("exports.setBusinessInventoryService"),
      src.indexOf("exports.deleteAdminRecord"));
  it("reads requestInventory as a strict boolean, apart from the services",
      () => {
        assert.match(apply,
            /requestedInventory = request\.data\?\.requestInventory === true/);
        // Services still go through the owner filter; the flag never feeds it.
        assert.match(apply, /inventory\.ownerEditableServices\(/);
        assert.doesNotMatch(apply, /enabledServices:[^,\n]*requestedInventory/);
        assert.doesNotMatch(apply, /\.push\(\s*"inventory"/);
      });
  it("stores the flag on the business and the application", () => {
    assert.ok((apply.match(/requestedInventory/g) || []).length >= 5);
  });
  it("is cleared by the admin switch when Inventory goes on", () => {
    assert.match(toggle, /requestedInventory: false/);
    assert.match(toggle, /plan\.enabled && business\.requestedInventory/);
  });
});

// ---------------------------------------------------------------------------
// Categories and stores (v2): the pure rules.
// ---------------------------------------------------------------------------

describe("inventory v2: refusal kinds", () => {
  it("maps the new codes to the right error kind", () => {
    assert.equal(inv.refusalKind("store_not_allowed"), "permission-denied");
    assert.equal(inv.refusalKind("owner_only"), "permission-denied");
    assert.equal(inv.refusalKind("category_name_taken"), "already-exists");
    for (const code of ["category_not_found", "store_not_found",
      "user_not_found"]) {
      assert.equal(inv.refusalKind(code), "not-found", code);
    }
    for (const code of ["store_archived", "store_has_stock",
      "home_store_required", "insufficient_stock", "last_store_active"]) {
      assert.equal(inv.refusalKind(code), "failed-precondition", code);
    }
    for (const code of ["category_name_required", "store_name_required",
      "same_store", "all_stores_invalid", "store_field_too_long"]) {
      assert.equal(inv.refusalKind(code), "invalid-argument", code);
    }
    // v1 kinds are unchanged.
    assert.equal(inv.refusalKind("item_not_found"), "not-found");
    assert.equal(inv.refusalKind("service_disabled"), "failed-precondition");
    assert.equal(inv.refusalKind("price_invalid"), "invalid-argument");
  });

  it("has an English message for every code the contract names", () => {
    for (const code of ["category_name_required", "category_name_taken",
      "category_not_found", "store_name_required", "store_not_found",
      "store_archived", "store_has_stock", "store_not_allowed",
      "home_store_required", "same_store", "insufficient_stock",
      "owner_only", "last_store_active", "user_not_found",
      "all_stores_invalid", "store_field_too_long"]) {
      assert.ok(inv.INVENTORY_MESSAGES[code], code);
    }
  });
});

describe("inventory v2: categories", () => {
  it("keys a name by trimmed, single-spaced, lower case", () => {
    assert.equal(inv.categoryNameKey("  Skin   Care "), "skin care");
    assert.equal(inv.categoryNameKey(null), "");
    assert.equal(inv.categoryDisplayName("  Skin   Care "), "Skin Care");
  });

  it("validates a name", () => {
    assert.deepEqual(inv.validateCategoryName("Skin"), []);
    assert.deepEqual(inv.validateCategoryName("   "),
        ["category_name_required"]);
    assert.deepEqual(inv.validateCategoryName(undefined),
        ["category_name_required"]);
    assert.deepEqual(inv.validateCategoryName("x".repeat(61)),
        ["category_too_long"]);
    assert.deepEqual(inv.validateCategoryName("x".repeat(60)), []);
  });

  it("gives one lock id per business and name", () => {
    const a = inv.categoryKeyDocId("biz", "skin");
    assert.match(a, /^[0-9a-f]{40}$/);
    assert.equal(a, inv.categoryKeyDocId("biz", "skin"));
    assert.notEqual(a, inv.categoryKeyDocId("other", "skin"));
    assert.notEqual(a, inv.categoryKeyDocId("biz", "hair"));
  });

  it("takes categoryId as an update field and refuses it with a count", () => {
    assert.deepEqual(inv.validateItemUpdate({categoryId: ""}), []);
    assert.deepEqual(inv.validateItemUpdate({stock: {a: 1}}),
        ["quantity_not_editable"]);
    assert.deepEqual(inv.validateItemUpdate({categoryId: 5}),
        ["category_not_found"]);
  });

  it("stores the resolved category on a new product", () => {
    const record = inv.itemCreateRecord(
        {name: "Soap", priceCents: 500, quantity: 2, category: "ignored"},
        {businessId: "biz", code: "IT-K7M4P2", uid: "u", quantity: 9,
          category: {categoryId: "c1", name: "Skin"}});
    assert.equal(record.category, "Skin");
    assert.equal(record.categoryId, "c1");
    assert.equal(record.quantity, 9);
  });

  it("snapshots the category on a sale line", () => {
    const plan = inv.planSale(
        [{itemId: "a", quantity: 1, soldPriceCents: 800}],
        items({a: item({categoryId: "c1", category: "Skin"})}));
    assert.equal(plan.lines[0].categoryId, "c1");
    assert.equal(plan.lines[0].category, "Skin");
  });

  describe("byCategory", () => {
    const line = (extra) => ({itemId: "a", quantity: 1, soldPriceCents: 1000,
      costCents: 400, categoryId: "", category: "", ...extra});
    const cats = [{id: "c1", name: "Skin"}, {id: "c2", name: "Hair"}];

    it("groups, sorts by revenue, leaves voided sales out", () => {
      const out = inv.summarizeByCategory([
        {voided: false, lines: [
          line({categoryId: "c1", category: "Skin", quantity: 2}),
          line({categoryId: "c2", category: "Hair", quantity: 1,
            soldPriceCents: 5000, costCents: null}),
          line({})]},
        {voided: true, lines: [line({categoryId: "c1", quantity: 99})]},
      ], {categories: cats});
      assert.deepEqual(out, [
        {categoryId: "c2", name: "Hair", itemsSold: 1, revenueCents: 5000,
          profitCents: 0},
        {categoryId: "c1", name: "Skin", itemsSold: 2, revenueCents: 2000,
          profitCents: 2000 - 800},
        {categoryId: "", name: "Uncategorized", itemsSold: 1,
          revenueCents: 1000, profitCents: 600}]);
    });

    it("shows a category's current name, not the one at sale time", () => {
      const out = inv.summarizeByCategory([{voided: false, lines: [
        line({categoryId: "c1", category: "Old name"})]}],
      {categories: cats});
      assert.equal(out[0].name, "Skin");
    });

    it("reads a line with no snapshot through the product's category", () => {
      const legacy = {itemId: "a", quantity: 1, soldPriceCents: 700};
      assert.equal(inv.lineIsLegacyCategory(legacy), true);
      assert.equal(inv.lineIsLegacyCategory(line({})), false);
      const out = inv.summarizeByCategory(
          [{voided: false, lines: [legacy, {...legacy, itemId: "gone"}]}],
          {categories: cats, items: new Map([
            ["a", {categoryId: "c2", category: "Hair"}]])});
      assert.deepEqual(out.map((e) => [e.categoryId, e.name, e.revenueCents]),
          [["c2", "Hair", 700], ["", "Uncategorized", 700]]);
    });

    it("matches typed text with no id to the list by name", () => {
      const out = inv.summarizeByCategory([{voided: false, lines: [
        line({category: " skin "}), line({category: "Odd one"})]}],
      {categories: cats});
      assert.deepEqual(out.map((e) => [e.categoryId, e.name]).sort(),
          [["", "Odd one"], ["c1", "Skin"]].sort());
    });

    it("is empty without sales", () => {
      assert.deepEqual(inv.summarizeByCategory([], {categories: cats}), []);
    });
  });
});

describe("inventory v2: the stock map of a new product", () => {
  it("reads {storeId: count} and refuses anything else", () => {
    assert.deepEqual(inv.parseStockMap({a: 1, b: "2", c: 0}),
        {errors: [], entries: [["a", 1], ["b", 2], ["c", 0]]});
    for (const bad of [null, undefined, [], "x", {}, {a: -1}, {a: 1.5},
      {a: ""}, {"a/b": 1}, {a: 1000001}]) {
      assert.deepEqual(inv.parseStockMap(bad).errors, ["quantity_invalid"],
          JSON.stringify(bad));
    }
  });

  it("lets a stock map stand in for the quantity on create", () => {
    const base = {name: "x", priceCents: 5};
    assert.deepEqual(inv.validateItemCreate({...base, stock: {a: 2}}), []);
    assert.deepEqual(inv.validateItemCreate({...base, stock: {a: -2}}),
        ["quantity_invalid"]);
    assert.deepEqual(inv.validateItemCreate({...base}),
        ["quantity_invalid"]);
    assert.deepEqual(inv.validateItemCreate({...base, quantity: 1}), []);
  });

  it("adds a store and transfer id to a movement only when given", () => {
    const base = {businessId: "b", itemId: "i", type: "sale", delta: -1,
      quantityAfter: 4, uid: "u"};
    const plain = inv.movementRecord(base);
    assert.equal("storeId" in plain, false);
    assert.equal("transferId" in plain, false);
    const full = inv.movementRecord({...base, storeId: "s",
      transferId: "t"});
    assert.deepEqual([full.storeId, full.transferId], ["s", "t"]);
    assert.ok(inv.MOVEMENT_TYPES.includes("transfer_out"));
    assert.ok(inv.MOVEMENT_TYPES.includes("transfer_in"));
  });
});

describe("inventory v2: stores and access", () => {
  const stores = [
    {id: "main", name: "Main store", isMain: true},
    {id: "annex", name: "Annex"},
    {id: "old", name: "Old", archived: true}];
  const staff = inv.storeAccessOf({role: "staff",
    inventoryHomeStoreId: "annex"});
  const owner = inv.storeAccessOf({role: "businessOwner"});
  const rover = inv.storeAccessOf({role: "staff", inventoryAllStores: true});
  const nobody = inv.storeAccessOf({role: "staff"});
  const pick = (access, requestedStoreId, extra = {}) => inv.resolveStore({
    converted: true, stores, mainStoreId: "main", access,
    requestedStoreId, ...extra});

  it("tells owners, admins and all-stores staff from the rest", () => {
    assert.deepEqual(owner, {owner: true, all: true, homeStoreId: ""});
    assert.equal(inv.storeAccessOf({role: "admin"}).all, true);
    assert.deepEqual(rover, {owner: false, all: true, homeStoreId: ""});
    assert.deepEqual(staff, {owner: false, all: false, homeStoreId: "annex"});
    assert.equal(inv.storeAccessOf({role: "staff",
      inventoryAllStores: "true"}).all, false);
    assert.equal(inv.storeAccessOf(null).all, false);
  });

  it("has no store at all before the first one is added", () => {
    const none = {converted: false, stores: [], mainStoreId: "",
      access: owner};
    assert.deepEqual(inv.resolveStore({...none, requestedStoreId: ""}),
        {store: null, code: null});
    assert.deepEqual(inv.resolveStore({...none, requestedStoreId: "x"}),
        {store: null, code: "store_not_found"});
  });

  it("defaults to the home store, the Main store for an all-stores user",
      () => {
        assert.equal(pick(staff, "").store.id, "annex");
        assert.equal(pick(owner, "").store.id, "main");
        assert.equal(pick(rover, "").store.id, "main");
        assert.equal(pick(inv.storeAccessOf({role: "staff",
          inventoryAllStores: true, inventoryHomeStoreId: "annex"}), "")
            .store.id, "annex");
      });

  it("cannot sell without a home store in a multi-store business", () => {
    assert.equal(pick(nobody, "").code, "home_store_required");
    // A home store that was archived counts as none.
    assert.equal(pick(inv.storeAccessOf({role: "staff",
      inventoryHomeStoreId: "old"}), "").code, "home_store_required");
  });

  it("lets staff name their own store only", () => {
    assert.equal(pick(staff, "annex").store.id, "annex");
    assert.equal(pick(staff, "main").code, "store_not_allowed");
    assert.equal(pick(nobody, "annex").code, "store_not_allowed");
    assert.equal(pick(owner, "main").store.id, "main");
    assert.equal(pick(rover, "annex").store.id, "annex");
  });

  it("refuses an unknown or archived store", () => {
    assert.equal(pick(owner, "nope").code, "store_not_found");
    assert.equal(pick(owner, "old").code, "store_archived");
    assert.equal(pick(staff, "old").code, "store_archived");
  });

  it("treats one active store as 'the' store for everybody", () => {
    const one = [{id: "main", name: "Main store"},
      {id: "old", name: "Old", archived: true}];
    assert.equal(inv.isMultiStore(one), false);
    assert.equal(inv.isMultiStore(stores), true);
    assert.equal(pick(nobody, "", {stores: one}).store.id, "main");
    assert.equal(pick(nobody, "main", {stores: one}).store.id, "main");
    assert.equal(pick(nobody, "", {stores: []}).code, "store_not_found");
    assert.deepEqual(inv.activeStores(stores).map((s) => s.id),
        ["main", "annex"]);
  });

  it("builds the Main store's id and a stock row's id", () => {
    assert.equal(inv.mainStoreIdOf("biz1"), "biz1_main");
    assert.equal(inv.stockDocId("item1", "store1"), "item1__store1");
  });

  it("cleans a store's fields", () => {
    assert.deepEqual(inv.cleanStoreInput(
        {name: "  Annex ", address: " 1 Rue ", phone: ""}, true),
    {errors: [], fields: {name: "Annex", address: "1 Rue", phone: ""}});
    assert.deepEqual(inv.cleanStoreInput({}, true).errors,
        ["store_name_required"]);
    assert.deepEqual(inv.cleanStoreInput({}, false),
        {errors: [], fields: {}});
    assert.deepEqual(inv.cleanStoreInput({name: ""}, false).errors,
        ["store_name_required"]);
    assert.deepEqual(inv.cleanStoreInput(
        {name: "x".repeat(121)}, true).errors, ["name_too_long"]);
    assert.deepEqual(inv.cleanStoreInput({name: "x", address: "a".repeat(201),
      phone: "9".repeat(41)}, true).errors, ["store_field_too_long"]);
    assert.deepEqual(inv.cleanStoreInput({phone: "555"}, false).fields,
        {phone: "555"});
  });
});

describe("inventory v2: per-store stock", () => {
  const ctx = {storeId: "annex", mainStoreId: "main"};
  const row = (quantity, countWasOff = false) => ({quantity, countWasOff});

  describe("what a store holds", () => {
    it("reads its own row", () => {
      assert.deepEqual(inv.effectiveRow(item({storeStock: true}), row(3, true),
          "annex", "main"), {quantity: 3, countWasOff: true, tracked: true});
    });
    it("gives a product with no rows yet, whole, to the Main store", () => {
      assert.deepEqual(inv.effectiveRow(item({quantity: 7}), undefined,
          "main", "main"), {quantity: 7, countWasOff: false, tracked: true});
      assert.deepEqual(inv.effectiveRow(item({quantity: 7}), undefined,
          "annex", "main"), {quantity: 0, countWasOff: false, tracked: false});
    });
    it("reads a missing row of a converted product as zero", () => {
      assert.deepEqual(inv.effectiveRow(item({storeStock: true, quantity: 7}),
          undefined, "main", "main"),
      {quantity: 0, countWasOff: false, tracked: false});
    });
    it("writes the Main row along with any other store's first row", () => {
      assert.deepEqual(inv.mainRowToMaterialize(item({quantity: 7}), "main",
          ["annex"]), [{storeId: "main", quantity: 7, countWasOff: false}]);
      assert.deepEqual(inv.mainRowToMaterialize(item({quantity: 7}), "main",
          ["main", "annex"]), []);
      assert.deepEqual(inv.mainRowToMaterialize(item({storeStock: true}),
          "main", ["annex"]), []);
    });
  });

  describe("a sale", () => {
    const line = (quantity) => [{itemId: "a", quantity,
      soldPriceCents: 1000}];

    it("takes the store's count and the product's total down together",
        () => {
          const it = item({quantity: 10, storeStock: true});
          const plan = inv.planStoreSale(line(3), items({a: it}),
              new Map([["a", row(4)]]), ctx);
          assert.deepEqual(plan.writes, [{itemId: "a", rowQuantity: 1,
            rowCountWasOff: false, totalAfter: 7, itemCountWasOff: false,
            extraRows: []}]);
          assert.deepEqual(plan.movements,
              [{itemId: "a", delta: -3, quantityAfter: 1}]);
          assert.deepEqual(plan.warnings, []);
          assert.equal(plan.lines[0].stockDeducted, 3);
        });

    it("floors at zero in that store and flags only the store and product",
        () => {
          const it = item({quantity: 10, storeStock: true});
          const plan = inv.planStoreSale(line(3), items({a: it}),
              new Map([["a", row(1)]]), ctx);
          assert.equal(plan.writes[0].rowQuantity, 0);
          assert.equal(plan.writes[0].rowCountWasOff, true);
          assert.equal(plan.writes[0].itemCountWasOff, true);
          assert.equal(plan.writes[0].totalAfter, 9);
          assert.equal(plan.lines[0].stockDeducted, 1);
          assert.deepEqual(plan.warnings,
              [{itemId: "a", reason: "count_was_off"}]);
        });

    it("sells from a store the product was never in without going negative",
        () => {
          const it = item({quantity: 10, storeStock: true});
          const plan = inv.planStoreSale(line(2), items({a: it}), new Map(),
              ctx);
          assert.equal(plan.writes[0].rowQuantity, 0);
          assert.equal(plan.writes[0].totalAfter, 10);
          assert.equal(plan.writes[0].rowCountWasOff, true);
        });

    it("keeps the Main pieces of a product with no rows when another store" +
        " sells", () => {
      const plan = inv.planStoreSale(line(1), items({a: item({quantity: 7})}),
          new Map(), ctx);
      assert.deepEqual(plan.writes[0].extraRows,
          [{storeId: "main", quantity: 7, countWasOff: false}]);
      assert.equal(plan.writes[0].totalAfter, 7);
    });

    it("sells a product with no rows from Main as if it were the shelf",
        () => {
          const plan = inv.planStoreSale(line(2),
              items({a: item({quantity: 7})}), new Map(),
              {storeId: "main", mainStoreId: "main"});
          assert.equal(plan.writes[0].rowQuantity, 5);
          assert.equal(plan.writes[0].totalAfter, 5);
          assert.deepEqual(plan.writes[0].extraRows, []);
        });

    it("keeps the product's flag when the sale itself is covered", () => {
      const plan = inv.planStoreSale(line(1),
          items({a: item({quantity: 10, storeStock: true,
            countWasOff: true})}), new Map([["a", row(5)]]), ctx);
      assert.equal(plan.writes[0].itemCountWasOff, true);
      assert.equal(plan.writes[0].rowCountWasOff, false);
    });

    it("shares one store's stock between two lines of a product", () => {
      const plan = inv.planStoreSale(
          [{itemId: "a", quantity: 2, soldPriceCents: 1000},
            {itemId: "a", quantity: 2, soldPriceCents: 900}],
          items({a: item({quantity: 3, storeStock: true})}),
          new Map([["a", row(3)]]), ctx);
      assert.equal(plan.writes.length, 1);
      assert.equal(plan.writes[0].rowQuantity, 0);
      assert.equal(plan.writes[0].totalAfter, 0);
      assert.equal(plan.lines[1].stockDeducted, 1);
    });
  });

  describe("a void", () => {
    const sale = {lines: [{itemId: "a", quantity: 3, stockDeducted: 2}]};

    it("puts back exactly what left, into the sale's store", () => {
      const plan = inv.planStoreVoid(sale,
          items({a: item({quantity: 10, storeStock: true})}),
          new Map([["a", row(1, true)]]), ctx);
      assert.deepEqual(plan.writes, [{itemId: "a", rowQuantity: 3,
        rowCountWasOff: true, totalAfter: 12, extraRows: []}]);
      assert.deepEqual(plan.movements,
          [{itemId: "a", delta: 2, quantityAfter: 3}]);
    });

    it("skips a product that was deleted", () => {
      const plan = inv.planStoreVoid(sale, new Map(), new Map(), ctx);
      assert.deepEqual(plan.writes, []);
      assert.deepEqual(plan.skipped, ["a"]);
    });

    it("restores a sale from before the stores into Main", () => {
      const plan = inv.planStoreVoid(sale, items({a: item({quantity: 5})}),
          new Map(), {storeId: "main", mainStoreId: "main"});
      assert.equal(plan.writes[0].rowQuantity, 7);
      assert.equal(plan.writes[0].totalAfter, 7);
    });
  });

  describe("an add or a set", () => {
    const rows = (entries) => new Map(Object.entries(entries));

    it("adds to one store and the total follows the rows", () => {
      const plan = inv.planStoreAdjust(item({quantity: 9, storeStock: true}),
          rows({main: row(5), annex: row(4)}), "annex",
          {mode: "add", quantity: 3}, "main");
      assert.deepEqual([plan.errors, plan.quantityAfter, plan.delta,
        plan.totalAfter, plan.itemCountWasOff],
      [[], 7, 3, 12, false]);
    });

    it("sets a count down to zero and clears that store's flag only", () => {
      const plan = inv.planStoreAdjust(item({quantity: 9, storeStock: true,
        countWasOff: true}),
      rows({main: row(5, true), annex: row(4, true)}), "annex",
      {mode: "set", quantity: 0}, "main");
      assert.equal(plan.quantityAfter, 0);
      assert.equal(plan.delta, -4);
      assert.equal(plan.rowCountWasOff, false);
      // Main is still doubtful, so the product is too.
      assert.equal(plan.itemCountWasOff, true);
      assert.equal(plan.totalAfter, 5);
      const clean = inv.planStoreAdjust(item({quantity: 9, storeStock: true,
        countWasOff: true}),
      rows({main: row(5), annex: row(4, true)}), "annex",
      {mode: "set", quantity: 4}, "main");
      assert.equal(clean.itemCountWasOff, false);
    });

    it("keeps Main's pieces when a product with no rows is set elsewhere",
        () => {
          const plan = inv.planStoreAdjust(item({quantity: 7}), new Map(),
              "annex", {mode: "set", quantity: 2}, "main");
          assert.deepEqual(plan.extraRows,
              [{storeId: "main", quantity: 7, countWasOff: false}]);
          assert.equal(plan.totalAfter, 9);
        });

    it("sets Main itself on a product with no rows", () => {
      const plan = inv.planStoreAdjust(item({quantity: 7}), new Map(), "main",
          {mode: "add", quantity: 1}, "main");
      assert.deepEqual(plan.extraRows, []);
      assert.equal(plan.quantityAfter, 8);
      assert.equal(plan.totalAfter, 8);
    });

    it("refuses bad input and a total past the limit", () => {
      const it = item({quantity: 9, storeStock: true});
      assert.deepEqual(inv.planStoreAdjust(it, new Map(), "annex",
          {mode: "x", quantity: 1}, "main").errors, ["mode_invalid"]);
      assert.deepEqual(inv.planStoreAdjust(it, new Map(), "annex",
          {mode: "add", quantity: 0}, "main").errors, ["quantity_invalid"]);
      assert.deepEqual(inv.planStoreAdjust(it,
          rows({main: row(inv.MAX_QUANTITY)}), "annex",
          {mode: "add", quantity: 1}, "main").errors, ["quantity_invalid"]);
    });
  });

  describe("a transfer", () => {
    const rows = (entries) => new Map(Object.entries(entries));
    const move = (rowsIn, quantity, from = "main", to = "annex", it = item({
      quantity: 9, storeStock: true})) => inv.planTransfer(it, rowsIn,
        {fromStoreId: from, toStoreId: to, quantity}, "main");

    it("moves pieces and never makes a count negative", () => {
      const plan = move(rows({main: row(5), annex: row(4)}), 5);
      assert.deepEqual([plan.errors, plan.amount, plan.from.quantityAfter,
        plan.to.quantityAfter], [[], 5, 0, 9]);
      assert.deepEqual(move(rows({main: row(5)}), 6).errors,
          ["insufficient_stock"]);
      assert.deepEqual(move(rows({}), 1).errors, ["insufficient_stock"]);
    });

    it("refuses the same store and bad quantities", () => {
      assert.deepEqual(move(rows({main: row(5)}), 1, "main", "main").errors,
          ["same_store"]);
      for (const bad of [0, -1, 1.5, "x", null, undefined, true]) {
        assert.deepEqual(move(rows({main: row(5)}), bad).errors,
            ["quantity_invalid"], String(bad));
      }
    });

    it("refuses to push a store past the limit", () => {
      assert.deepEqual(move(rows({main: row(5),
        annex: row(inv.MAX_QUANTITY)}), 1).errors, ["quantity_invalid"]);
    });

    it("keeps the doubtful flag of each side", () => {
      const plan = move(rows({main: row(5, true), annex: row(0, false)}), 2);
      assert.equal(plan.from.countWasOff, true);
      assert.equal(plan.to.countWasOff, false);
    });

    it("moves out of Main on a product with no rows without losing it", () => {
      const plan = move(rows({}), 3, "main", "annex", item({quantity: 7}));
      assert.deepEqual([plan.errors, plan.from.quantityAfter,
        plan.to.quantityAfter, plan.extraRows], [[], 4, 3, []]);
      // Neither side is Main: Main would still hold the pieces, so it is
      // written too, and the source (not Main) has nothing to give.
      const other = move(rows({}), 1, "annex", "depot", item({quantity: 7}));
      assert.deepEqual(other.errors, ["insufficient_stock"]);
      const between = move(rows({annex: row(2)}), 1, "annex", "depot",
          item({quantity: 7}));
      assert.deepEqual(between.extraRows,
          [{storeId: "main", quantity: 7, countWasOff: false}]);
    });
  });
});

describe("inventory v2: summaries per store", () => {
  const stores = [
    {id: "main", name: "Main store"}, {id: "annex", name: "Annex"},
    {id: "old", name: "Old", archived: true}];
  const sale = (extra, lines) => ({voided: false, lines: lines || [{
    itemId: "a", quantity: 2, soldPriceCents: 1000, costCents: 400}],
  ...extra});

  it("tells which store a sale was rung up at", () => {
    assert.equal(inv.saleStoreId({storeId: "annex"}, "main"), "annex");
    assert.equal(inv.saleStoreId({}, "main"), "main");
    assert.equal(inv.saleStoreId({}, ""), "");
  });

  it("adds up sales per store, with an empty row for a quiet store", () => {
    const out = inv.summarizeByStore([
      sale({storeId: "annex"}), sale({storeId: "annex"}),
      sale({voided: true, storeId: "annex"}),
      sale({}, [{itemId: "a", quantity: 1, soldPriceCents: 500,
        costCents: null}])], stores, "main");
    assert.deepEqual(out, [
      {storeId: "annex", name: "Annex", salesCount: 2, itemsSold: 4,
        revenueCents: 4000, profitCents: 4000 - 1600},
      {storeId: "main", name: "Main store", salesCount: 1, itemsSold: 1,
        revenueCents: 500, profitCents: 0}]);
    const quiet = inv.summarizeByStore([], stores, "main");
    assert.deepEqual(quiet.map((r) => [r.storeId, r.salesCount]),
        [["annex", 0], ["main", 0]]);
  });

  it("lists an archived store only when it sold", () => {
    const out = inv.summarizeByStore([sale({storeId: "old"})], stores,
        "main");
    assert.ok(out.some((r) => r.storeId === "old" && r.salesCount === 1));
  });

  describe("low stock and count-was-off per store", () => {
    const products = [
      {id: "a", name: "Alpha", lowStockAt: 3, storeStock: true},
      {id: "b", name: "Beta", lowStockAt: null, storeStock: true},
      {id: "c", name: "Charlie", lowStockAt: 5, quantity: 4,
        countWasOff: true},
      {id: "d", name: "Archived", archived: true, storeStock: true,
        lowStockAt: 9}];
    const rows = [
      {itemId: "a", storeId: "main", quantity: 20, countWasOff: false},
      {itemId: "a", storeId: "annex", quantity: 3, countWasOff: true},
      {itemId: "b", storeId: "main", quantity: 0, countWasOff: false},
      {itemId: "b", storeId: "old", quantity: 0, countWasOff: false},
      {itemId: "d", storeId: "main", quantity: 0, countWasOff: false}];

    it("judges each store's count against the one level", () => {
      const out = inv.summarizeShelfByStore({items: products, rows, stores,
        mainStoreId: "main"});
      assert.deepEqual(out.low.map((e) => [e.itemId, e.storeId, e.storeName,
        e.quantity]),
      [["b", "main", "Main store", 0], ["a", "annex", "Annex", 3],
        ["c", "main", "Main store", 4]]);
      assert.equal(out.lowCount, 3);
      assert.deepEqual(out.countWasOff.map((e) => [e.itemId, e.storeName]),
          [["a", "Annex"], ["c", "Main store"]]);
      assert.equal(out.countWasOffCount, 2);
    });

    it("never judges a store the product was never in", () => {
      const out = inv.summarizeShelfByStore({items: products, rows, stores,
        mainStoreId: "main"});
      assert.ok(!out.low.some((e) => e.itemId === "a" &&
        e.storeId === "main"));
      assert.ok(!out.low.some((e) => e.itemId === "c" &&
        e.storeId === "annex"));
    });

    it("hides archived stores and archived products", () => {
      const out = inv.summarizeShelfByStore({items: products, rows, stores,
        mainStoreId: "main"});
      assert.ok(!out.low.some((e) => e.storeId === "old"));
      assert.ok(!out.low.some((e) => e.itemId === "d"));
    });

    it("shows a staff member only their store", () => {
      const out = inv.summarizeShelfByStore({items: products, rows, stores,
        mainStoreId: "main", visibleStoreIds: new Set(["annex"])});
      assert.deepEqual(out.low.map((e) => e.storeId), ["annex"]);
      assert.deepEqual(out.countWasOff.map((e) => e.storeId), ["annex"]);
    });
  });

  describe("which stores a summary covers", () => {
    const scope = (access, requestedStoreId = "", extra = {}) =>
      inv.resolveSummaryScope({converted: true, stores, access,
        requestedStoreId, ...extra});
    const owner = inv.storeAccessOf({role: "businessOwner"});
    const staff = inv.storeAccessOf({role: "staff",
      inventoryHomeStoreId: "annex"});

    it("covers everything for a business without stores", () => {
      assert.deepEqual(inv.resolveSummaryScope({converted: false, stores: [],
        access: owner, requestedStoreId: ""}),
      {code: null, multi: false, filterStoreId: "", allView: false});
      assert.equal(inv.resolveSummaryScope({converted: false, stores: [],
        access: owner, requestedStoreId: "x"}).code, "store_not_found");
    });

    it("covers everything for one active store", () => {
      const one = [{id: "main", name: "Main store"}];
      assert.deepEqual(scope(staff, "", {stores: one}),
          {code: null, multi: false, filterStoreId: "", allView: false});
    });

    it("lets an all-stores caller see all or one store", () => {
      assert.deepEqual(scope(owner),
          {code: null, multi: true, filterStoreId: "", allView: true});
      assert.equal(scope(owner, "annex").filterStoreId, "annex");
      assert.equal(scope(owner, "old").filterStoreId, "old");
      assert.equal(scope(owner, "nope").code, "store_not_found");
    });

    it("gives staff their own store whatever they ask", () => {
      assert.deepEqual(scope(staff),
          {code: null, multi: true, filterStoreId: "annex", allView: false});
      assert.equal(scope(staff, "annex").code, null);
      assert.equal(scope(staff, "main").code, "store_not_allowed");
      assert.equal(scope(inv.storeAccessOf({role: "staff"})).code,
          "home_store_required");
    });
  });
});

describe("the store conversion's id ordering", () => {
  it("uses the standard FieldPath import (the emulator has it)", () => {
    // `admin.firestore.FieldPath` is undefined inside the functions emulator
    // (second store creation answered INTERNAL there); the modular import is
    // not. Keep the inventory code on the import.
    const src = fs.readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
    const start = src.indexOf("async function materializeInventoryMainStock");
    const end = src.indexOf("\n}\n", start);
    const body = src.slice(start, end);
    assert.match(body, /FirestoreFieldPath\.documentId\(\)/);
    assert.doesNotMatch(body, /admin\.firestore\.FieldPath/);
  });
});

// ---------------------------------------------------------------------------
// Brands (v3): the pure rules.
// ---------------------------------------------------------------------------

describe("inventory v3: brand refusal kinds and messages", () => {
  it("maps the brand codes to the right error kind", () => {
    assert.equal(inv.refusalKind("brand_name_taken"), "already-exists");
    assert.equal(inv.refusalKind("brand_not_found"), "not-found");
    assert.equal(inv.refusalKind("brand_name_required"), "invalid-argument");
    assert.equal(inv.refusalKind("brand_too_long"), "invalid-argument");
    // The category kinds are unchanged.
    assert.equal(inv.refusalKind("category_name_taken"), "already-exists");
    assert.equal(inv.refusalKind("category_not_found"), "not-found");
  });

  it("has an English message for every brand code", () => {
    for (const code of ["brand_name_required", "brand_name_taken",
      "brand_not_found", "brand_too_long"]) {
      assert.ok(inv.INVENTORY_MESSAGES[code], code);
    }
  });
});

describe("inventory v3: brands", () => {
  it("keys and spells a name like a category", () => {
    assert.equal(inv.brandNameKey("  Air   JORDAN "), "air jordan");
    assert.equal(inv.brandNameKey(null), "");
    assert.equal(inv.brandDisplayName("  Air   Jordan "), "Air Jordan");
  });

  it("validates a name", () => {
    assert.deepEqual(inv.validateBrandName("Jordan"), []);
    assert.deepEqual(inv.validateBrandName("   "), ["brand_name_required"]);
    assert.deepEqual(inv.validateBrandName(undefined),
        ["brand_name_required"]);
    assert.deepEqual(inv.validateBrandName("x".repeat(61)),
        ["brand_too_long"]);
    assert.deepEqual(inv.validateBrandName("x".repeat(60)), []);
  });

  it("gives one lock id per business and name", () => {
    const a = inv.brandKeyDocId("biz", "jordan");
    assert.match(a, /^[0-9a-f]{40}$/);
    assert.equal(a, inv.brandKeyDocId("biz", "jordan"));
    assert.notEqual(a, inv.brandKeyDocId("other", "jordan"));
    assert.notEqual(a, inv.brandKeyDocId("biz", "nike"));
  });

  it("reads a product as brand, space, name", () => {
    assert.equal(inv.itemDisplayName({brand: "Jordan", name: "11"}),
        "Jordan 11");
    assert.equal(inv.itemDisplayName({brand: "", name: "Soap"}), "Soap");
    assert.equal(inv.itemDisplayName({name: "Soap"}), "Soap");
  });

  it("takes brand and brandId as update fields", () => {
    assert.deepEqual(inv.validateItemUpdate({brandId: ""}), []);
    assert.deepEqual(inv.validateItemUpdate({brand: ""}), []);
    assert.deepEqual(inv.validateItemUpdate({brand: "Jordan"}), []);
    assert.deepEqual(inv.validateItemUpdate({brandId: 5}),
        ["brand_not_found"]);
    assert.deepEqual(inv.validateItemUpdate({brand: "x".repeat(61)}),
        ["brand_too_long"]);
    assert.deepEqual(inv.validateItemUpdate({stock: {a: 1}, brand: "A"}),
        ["quantity_not_editable"]);
  });

  it("checks brand fields on create, and keeps v2 requests valid", () => {
    const valid = {name: "11", priceCents: 9000, quantity: 1};
    assert.deepEqual(inv.validateItemCreate(valid), []);
    assert.deepEqual(inv.validateItemCreate({...valid, brand: "Jordan"}), []);
    assert.deepEqual(inv.validateItemCreate({...valid, brandId: ""}), []);
    assert.deepEqual(inv.validateItemCreate({...valid, brand: "x".repeat(61)}),
        ["brand_too_long"]);
    assert.deepEqual(inv.validateItemCreate({...valid, brandId: 7}),
        ["brand_not_found"]);
  });

  it("stores the resolved brand on a new product", () => {
    const record = inv.itemCreateRecord(
        {name: "11", priceCents: 500, quantity: 2, brand: "ignored"},
        {businessId: "biz", code: "IT-K7M4P2", uid: "u",
          brand: {brandId: "b1", name: "Jordan"}});
    assert.equal(record.brand, "Jordan");
    assert.equal(record.brandId, "b1");
  });

  it("stores no brand when none was resolved", () => {
    const record = inv.itemCreateRecord(
        {name: "11", priceCents: 500, quantity: 2, brand: "ignored"},
        {businessId: "biz", code: "IT-K7M4P2", uid: "u"});
    assert.equal(record.brand, "");
    assert.equal(record.brandId, "");
  });

  it("shows a brand change in the product history", () => {
    const changes = inv.itemFieldDiff({brand: ""}, {brand: "Jordan",
      brandId: "b1"});
    assert.deepEqual(changes, [{field: "Brand", from: "—", to: "Jordan"}]);
  });

  it("snapshots the brand on a sale line, empty without one", () => {
    const sold = (extra) => inv.planSale(
        [{itemId: "a", quantity: 1, soldPriceCents: 800}],
        items({a: item(extra)})).lines[0];
    const branded = sold({brandId: "b1", brand: "Jordan"});
    assert.equal(branded.brandId, "b1");
    assert.equal(branded.brand, "Jordan");
    const plain = sold({});
    assert.equal(plain.brandId, "");
    assert.equal(plain.brand, "");
  });

  it("keeps the QR tags free of any product text", () => {
    const html = renderInventoryTags(
        {code: "IT-K7M4P2", link: "https://x.test/t", copies: 1,
          name: "11", brand: "Jordan"}, {qrSvg: "<svg></svg>"});
    assert.doesNotMatch(html, /Jordan/);
  });

  describe("byBrand", () => {
    const line = (extra) => ({itemId: "a", quantity: 1, soldPriceCents: 1000,
      costCents: 400, brandId: "", brand: "", ...extra});
    const brands = [{id: "b1", name: "Jordan"}, {id: "b2", name: "Nike"}];

    it("groups, sorts by revenue, leaves voided sales out", () => {
      const out = inv.summarizeByBrand([
        {voided: false, lines: [
          line({brandId: "b1", brand: "Jordan", quantity: 2}),
          line({brandId: "b2", brand: "Nike", quantity: 1,
            soldPriceCents: 5000, costCents: null}),
          line({})]},
        {voided: true, lines: [line({brandId: "b1", quantity: 99})]},
      ], {brands});
      assert.deepEqual(out, [
        {brandId: "b2", name: "Nike", itemsSold: 1, revenueCents: 5000,
          profitCents: 0},
        {brandId: "b1", name: "Jordan", itemsSold: 2, revenueCents: 2000,
          profitCents: 2000 - 800},
        {brandId: "", name: "No brand", itemsSold: 1,
          revenueCents: 1000, profitCents: 600}]);
    });

    it("lists only brands that sold", () => {
      const out = inv.summarizeByBrand([{voided: false, lines: [
        line({brandId: "b1", brand: "Jordan"})]}], {brands});
      assert.deepEqual(out.map((e) => e.brandId), ["b1"]);
    });

    it("shows a brand's current name, not the one at sale time", () => {
      const out = inv.summarizeByBrand([{voided: false, lines: [
        line({brandId: "b1", brand: "Old name"})]}], {brands});
      assert.equal(out[0].name, "Jordan");
    });

    it("breaks revenue ties by name", () => {
      const out = inv.summarizeByBrand([{voided: false, lines: [
        line({brandId: "b2", brand: "Nike"}),
        line({brandId: "b1", brand: "Jordan"})]}], {brands});
      assert.deepEqual(out.map((e) => e.name), ["Jordan", "Nike"]);
    });

    it("reads a line with no snapshot through the product's brand", () => {
      const legacy = {itemId: "a", quantity: 1, soldPriceCents: 700};
      assert.equal(inv.lineIsLegacyBrand(legacy), true);
      assert.equal(inv.lineIsLegacyBrand(line({})), false);
      const out = inv.summarizeByBrand(
          [{voided: false, lines: [legacy, {...legacy, itemId: "gone"}]}],
          {brands, items: new Map([["a", {brandId: "b2", brand: "Nike"}]])});
      assert.deepEqual(out.map((e) => [e.brandId, e.name, e.revenueCents]),
          [["b2", "Nike", 700], ["", "No brand", 700]]);
    });

    it("matches typed text with no id to the list by name", () => {
      const out = inv.summarizeByBrand([{voided: false, lines: [
        line({brand: " jordan "}), line({brand: "Odd one"})]}], {brands});
      assert.deepEqual(out.map((e) => [e.brandId, e.name]).sort(),
          [["", "Odd one"], ["b1", "Jordan"]].sort());
    });

    it("is empty without sales", () => {
      assert.deepEqual(inv.summarizeByBrand([], {brands}), []);
    });

    it("leaves byCategory exactly as before", () => {
      const out = inv.summarizeByCategory([{voided: false, lines: [
        {itemId: "a", quantity: 1, soldPriceCents: 10, costCents: 5,
          categoryId: "c1", category: "Skin", brandId: "b1",
          brand: "Jordan"}]}], {categories: [{id: "c1", name: "Skin"}]});
      assert.deepEqual(out, [{categoryId: "c1", name: "Skin", itemsSold: 1,
        revenueCents: 10, profitCents: 5}]);
    });
  });
});

describe("inventory: sale notifications", () => {
  const BIZ = "biz-1";
  const STORE = "store-north";
  const person = (id, extra = {}) => ({
    id, businessId: BIZ, role: "staff", businessPermissions: ["inventory"],
    fullName: `${id} Person`, ...extra,
  });
  const sale = (extra = {}) => ({
    id: "sale-1", businessId: BIZ, storeId: STORE, storeName: "Main store",
    totalCents: 6000,
    lines: [{name: "11", brand: "Jordan", quantity: 1, soldPriceCents: 6000}],
    ...extra,
  });
  const people = [
    person("seller", {fullName: "Mamadou Diallo",
      inventoryHomeStoreId: STORE}),
    person("owner", {role: "businessOwner", businessPermissions: []}),
    person("same-store", {inventoryHomeStoreId: STORE}),
    person("all-stores", {inventoryHomeStoreId: "store-south",
      inventoryAllStores: true}),
    person("other-store", {inventoryHomeStoreId: "store-south"}),
    person("no-home"),
    person("ledger-only", {businessPermissions: ["ledger"],
      inventoryHomeStoreId: STORE}),
    person("muted", {inventoryHomeStoreId: STORE,
      notificationPreferences: {inventorySales: false}}),
    person("customer", {role: "customer"}),
    person("foreign", {businessId: "biz-2", inventoryAllStores: true}),
  ];
  const plan = (extra = {}) => inv.planSaleNotification({
    sale: sale(), users: people, sellerUid: "seller", multiStore: true,
    ...extra,
  });
  const uids = (out) => out.recipients.map((r) => r.uid);

  it("reaches the owner, the store's staff and all-stores staff", () => {
    assert.deepEqual(uids(plan()), ["owner", "all-stores", "same-store"]);
  });

  it("never tells the seller about their own sale", () => {
    assert.ok(!uids(plan()).includes("seller"));
    // The owner selling is not told either; the staff of the store are.
    assert.deepEqual(uids(plan({sellerUid: "owner"})),
        ["all-stores", "same-store", "seller"]);
  });

  it("skips other stores, other businesses, customers and staff without " +
      "the inventory permission", () => {
    const out = uids(plan());
    for (const uid of ["other-store", "no-home", "ledger-only", "customer",
      "foreign"]) {
      assert.ok(!out.includes(uid), uid);
    }
  });

  it("skips anyone who switched Sales at my store off", () => {
    assert.ok(!uids(plan()).includes("muted"));
    const owner = people.map((p) => p.id === "owner" ?
      {...p, notificationPreferences: {inventorySales: false,
        businessActivity: true}} : p);
    assert.ok(!uids(plan({users: owner})).includes("owner"));
    // Any other switch being off does not matter; a missing one is on.
    const other = people.map((p) => p.id === "same-store" ?
      {...p, notificationPreferences: {businessActivity: false}} : p);
    assert.ok(uids(plan({users: other})).includes("same-store"));
  });

  it("tells every inventory staff member in a single-store business", () => {
    const noStores = plan({sale: sale({storeId: "", storeName: ""}),
      multiStore: false});
    assert.deepEqual(uids(noStores),
        ["owner", "all-stores", "no-home", "other-store", "same-store"]);
    assert.equal(noStores.title, "New sale");
    // One active store left after archiving: still single-store.
    const oneStore = plan({multiStore: false});
    assert.deepEqual(uids(oneStore), uids(noStores));
    assert.equal(oneStore.title, "New sale");
  });

  it("writes the sale, the seller's first name and the total", () => {
    const out = plan();
    assert.equal(out.title, "Sale at Main store");
    assert.equal(out.body, "Mamadou sold Jordan 11 · $60.00");
    assert.deepEqual(out.data, {type: "inventory_sale", businessId: BIZ,
      saleId: "sale-1", storeId: STORE, relatedCollection: "inventorySales",
      relatedId: "sale-1"});
    for (const r of out.recipients) {
      assert.deepEqual([r.language, r.title, r.body],
          ["en", out.title, out.body]);
    }
  });

  it("names the first line and counts the others", () => {
    const several = sale({totalCents: 9550, lines: [
      {name: "11", brand: "Jordan", quantity: 2},
      {name: "Socks", brand: "", quantity: 1},
      {name: "Cap", quantity: 3},
    ]});
    assert.equal(plan({sale: several}).body,
        "Mamadou sold 2 × Jordan 11 +2 more · $95.50");
    const two = sale({lines: [{name: "Socks", quantity: 1},
      {name: "Cap", quantity: 1}]});
    assert.equal(plan({sale: two}).body,
        "Mamadou sold Socks +1 more · $60.00");
  });

  it("falls back when the seller has no name", () => {
    const nameless = people.map((p) => p.id === "seller" ?
      {...p, fullName: ""} : p);
    assert.equal(plan({users: nameless}).body,
        "Someone sold Jordan 11 · $60.00");
    // A seller who is not one of the business's people (a platform admin).
    assert.equal(plan({sellerUid: "admin-1",
      seller: {fullName: "Awa Ndiaye"}}).body,
    "Awa sold Jordan 11 · $60.00");
  });

  it("writes French for people whose profile is in French", () => {
    const french = people.map((p) => p.id === "same-store" ?
      {...p, language: "fr"} : p);
    const out = plan({users: french});
    const fr = out.recipients.find((r) => r.uid === "same-store");
    assert.deepEqual([fr.language, fr.title, fr.body],
        ["fr", "Vente à Main store", "Mamadou a vendu Jordan 11 · $60.00"]);
    assert.equal(out.recipients.find((r) => r.uid === "owner").language, "en");
    const several = inv.planSaleNotification({sale: sale({storeId: "",
      storeName: "", lines: [{name: "Cap", quantity: 3},
        {name: "Socks", quantity: 1}, {name: "Hat", quantity: 1}]}),
    users: french, sellerUid: "seller", multiStore: false});
    assert.deepEqual([several.copy.fr.title, several.copy.fr.body],
        ["Nouvelle vente", "Mamadou a vendu 3 × Cap +2 autres · $60.00"]);
    assert.equal(inv.planSaleNotification({sale: sale({lines: [
      {name: "Cap", quantity: 1}, {name: "Hat", quantity: 1}]}),
    users: [], sellerUid: "x", multiStore: true}).copy.fr.body,
    "Quelqu'un a vendu Cap +1 autre · $60.00");
    assert.equal(inv.notificationLanguageOf, undefined,
        "one language helper: notification_settings.recipientLanguage");
  });

  it("writes in the language the app saved on the profile", () => {
    // The app saves `preferredLanguage` ("en" | "fr"); the planner reads it
    // through recipientLanguage, and it wins over an older `locale`.
    const saved = people.map((p) => {
      if (p.id === "same-store") return {...p, preferredLanguage: "fr"};
      if (p.id === "owner") {
        return {...p, preferredLanguage: "en", locale: "fr_SN"};
      }
      return p;
    });
    const out = plan({users: saved});
    const byUid = Object.fromEntries(out.recipients.map((r) => [r.uid, r]));
    assert.deepEqual(
        [byUid["same-store"].language, byUid["same-store"].title],
        ["fr", "Vente à Main store"]);
    assert.deepEqual([byUid.owner.language, byUid.owner.title],
        ["en", "Sale at Main store"]);
  });

  it("puts owners first and stops at 50 people", () => {
    const crowd = [person("seller")];
    for (let i = 0; i < 70; i++) {
      crowd.push(person(`staff-${String(i).padStart(2, "0")}`,
          {inventoryAllStores: true}));
    }
    crowd.push(person("z-owner", {role: "businessOwner"}));
    const out = plan({users: crowd});
    assert.equal(out.recipients.length, inv.MAX_SALE_NOTIFICATION_RECIPIENTS);
    assert.equal(out.recipients.length, 50);
    assert.equal(out.recipients[0].uid, "z-owner");
  });

  it("tells nobody when the seller is alone", () => {
    assert.deepEqual(plan({users: [people[0]]}).recipients, []);
  });
});

// ---------------------------------------------------------------------------
// v4: credit sales and who received the money.
// ---------------------------------------------------------------------------

describe("inventory: credit sale input", () => {
  const TODAY = "2026-10-16";
  const base = {clientRequestId: "req-credit-1", paymentMethod: "cash",
    lines: [{itemId: "a", quantity: 2, soldPriceCents: 3000}]};
  const credit = (extra = {}) => ({paidNowCents: 2000,
    customerName: "Fatou Bah", customerPhone: "+1 (207) 555-0100",
    collectorStaffId: "collector-1", dueDate: "2026-10-30", ...extra});
  const clean = (extra) => inv.cleanSaleInput({...base, ...extra}, TODAY);

  it("leaves a normal sale as it was: paid in full at the counter", () => {
    const out = clean({});
    assert.deepEqual(out.errors, []);
    assert.equal(out.credit, null);
    assert.equal(out.totalCents, 6000);
    assert.equal(out.paidNowCents, 6000);
    assert.equal(inv.cleanSaleInput({...base, credit: null}).credit, null);
  });

  it("reads a credit sale: part now, the rest owed", () => {
    const out = clean({credit: credit()});
    assert.deepEqual(out.errors, []);
    assert.deepEqual(out.credit, {paidNowCents: 2000, creditCents: 4000,
      customerName: "Fatou Bah", customerPhone: "+12075550100",
      collectorStaffId: "collector-1", dueDate: "2026-10-30"});
    assert.equal(out.paidNowCents, 2000);
  });

  it("needs no payment method when nothing is paid now", () => {
    const out = clean({paymentMethod: "", credit: credit({paidNowCents: 0})});
    assert.deepEqual(out.errors, []);
    assert.equal(out.credit.creditCents, 6000);
    // Something paid now still needs the method.
    assert.deepEqual(clean({paymentMethod: "", credit: credit()}).errors,
        ["payment_method_invalid"]);
    // A normal sale still needs it.
    assert.deepEqual(clean({paymentMethod: ""}).errors,
        ["payment_method_invalid"]);
  });

  it("keeps paid-now from zero to below the total", () => {
    for (const bad of [6000, 7000, -1, 1.5, "", "abc", null]) {
      assert.deepEqual(clean({credit: credit({paidNowCents: bad})}).errors,
          ["paid_now_invalid"], String(bad));
    }
    assert.deepEqual(clean({credit: credit({paidNowCents: 5999})}).errors,
        []);
    assert.deepEqual(clean({credit: credit({paidNowCents: "0"})}).errors,
        []);
  });

  it("needs the customer's name; a phone is optional but must be whole",
      () => {
        assert.deepEqual(clean({credit: credit({customerName: " "})}).errors,
            ["credit_customer_required"]);
        // No phone, or the country code the field holds while empty: fine,
        // and stored as no phone.
        for (const none of ["", "  ", "+1", "+224", " + 1 "]) {
          const out = clean({credit: credit({customerPhone: none})});
          assert.deepEqual(out.errors, [], JSON.stringify(none));
          assert.equal(out.credit.customerPhone, "", JSON.stringify(none));
        }
        assert.deepEqual(clean({credit: credit({customerPhone:
          "207 555 0100"})}).errors, ["customer_phone_invalid"]);
        assert.deepEqual(clean({credit: credit({customerPhone: "+1 call me"})})
            .errors, ["customer_phone_invalid"]);
      });

  it("needs a collector id", () => {
    for (const bad of ["", "  ", "a/b", 7, null]) {
      assert.deepEqual(clean({credit: credit({collectorStaffId: bad})})
          .errors, ["collector_invalid"], String(bad));
    }
  });

  it("takes an optional due date, today or later", () => {
    assert.equal(clean({credit: credit({dueDate: ""})}).credit.dueDate, "");
    assert.equal(clean({credit: credit({dueDate: undefined})}).credit.dueDate,
        "");
    assert.equal(clean({credit: credit({dueDate: TODAY})}).credit.dueDate,
        TODAY);
    for (const bad of ["2026-10-15", "2026-02-30", "10/30/2026", "2026-1-5",
      20261030]) {
      assert.deepEqual(clean({credit: credit({dueDate: bad})}).errors,
          ["due_date_invalid"], String(bad));
    }
  });

  it("refuses a credit that is not an object, and lists every problem", () => {
    assert.deepEqual(clean({credit: "yes"}).errors, ["credit_invalid"]);
    assert.deepEqual(clean({credit: [1]}).errors, ["credit_invalid"]);
    assert.deepEqual(clean({credit: {}}).errors.sort(), ["collector_invalid",
      "credit_customer_required", "paid_now_invalid"]);
  });

  it("dates today in New York", () => {
    // 03:30 UTC on Oct 17 is still Oct 16 in New York.
    assert.equal(inv.todayKeyIn(new Date("2026-10-17T03:30:00Z")),
        "2026-10-16");
    assert.equal(inv.todayKeyIn(new Date("2026-10-17T04:30:00Z")),
        "2026-10-17");
  });
});

describe("inventory: credit money fields", () => {
  it("stores a normal sale as paid in full", () => {
    assert.deepEqual(inv.saleMoneyFields({totalCents: 6000, credit: null,
      receivedByStaffId: "seller"}), {receivedByStaffId: "seller",
      creditPaidCents: 0, paidNowCents: 6000, creditCents: 0,
      creditStatus: "none"});
  });

  it("stores a credit sale as open", () => {
    const credit = inv.cleanSaleInput({clientRequestId: "req-credit-2",
      lines: [{itemId: "a", quantity: 1, soldPriceCents: 5000}],
      credit: {paidNowCents: 0, customerName: "Fatou",
        customerPhone: "+224620000000", collectorStaffId: "c"}}).credit;
    assert.deepEqual(inv.saleMoneyFields({totalCents: 5000, credit,
      receivedByStaffId: "other"}), {receivedByStaffId: "other",
      creditPaidCents: 0, paidNowCents: 0, creditCents: 5000,
      creditStatus: "open", credit: {customerName: "Fatou",
        customerPhone: "+224620000000", collectorStaffId: "c", dueDate: ""},
      lastCreditReminderAt: null});
  });

  it("reads where a credit stands; old sales owe nothing", () => {
    assert.deepEqual(inv.creditStanding({totalCents: 900}),
        {creditCents: 0, creditPaidCents: 0, remainingCents: 0,
          status: "none"});
    assert.deepEqual(inv.creditStanding({creditCents: 4000,
      creditPaidCents: 1500}), {creditCents: 4000, creditPaidCents: 1500,
      remainingCents: 2500, status: "open"});
    assert.equal(inv.creditStanding({creditCents: 4000,
      creditPaidCents: 4000}).status, "paid");
    assert.equal(inv.creditStatusFor(0, 0), "none");
  });

  it("refuses later payments on a voided or non-credit sale", () => {
    assert.equal(inv.creditStateRefusal({voided: true, creditCents: 10}),
        "sale_voided");
    assert.equal(inv.creditStateRefusal({totalCents: 10}), "no_credit");
    assert.equal(inv.creditStateRefusal({creditCents: 10}), null);
    assert.equal(inv.refusalKind("sale_voided"), "failed-precondition");
    assert.equal(inv.refusalKind("no_credit"), "failed-precondition");
    assert.equal(inv.refusalKind("credit_has_payments"),
        "failed-precondition");
    assert.equal(inv.refusalKind("payment_not_found"), "not-found");
    assert.equal(inv.refusalKind("received_by_invalid"), "invalid-argument");
    assert.equal(inv.refusalKind("payment_exceeds_balance"),
        "invalid-argument");
  });

  it("takes a payment from one cent up to what is still owed", () => {
    const sale = {creditCents: 4000};
    const errors = (amountCents, live = 0, method = "cash") =>
      inv.creditPaymentErrors({amountCents, method}, sale, live);
    assert.deepEqual(errors(4000), []);
    assert.deepEqual(errors(1), []);
    assert.deepEqual(errors(2500, 1500), []);
    assert.deepEqual(errors(2501, 1500), ["payment_exceeds_balance"]);
    assert.deepEqual(errors(1, 4000), ["payment_exceeds_balance"]);
    for (const bad of [0, -5, 1.5, "", null]) {
      assert.deepEqual(errors(bad), ["amount_invalid"], String(bad));
    }
    assert.deepEqual(errors(100, 0, "bitcoin"), ["payment_method_invalid"]);
  });

  it("records who received and who typed it in", () => {
    assert.deepEqual(inv.creditPaymentRecord({businessId: "b",
      sale: {id: "s", storeId: "st"}, input: {amountCents: "1500",
        method: "zelle", note: " later "}, receivedByStaffId: "r",
      recordedByStaffId: "u"}), {businessId: "b", saleId: "s", storeId: "st",
      amountCents: 1500, method: "zelle", receivedByStaffId: "r",
      recordedByStaffId: "u", note: "later", reverted: false,
      revertedByStaffId: "", revertedAt: null});
  });

  it("changes the collector and, only when sent, the due date", () => {
    assert.deepEqual(inv.cleanCollectorChange({collectorStaffId: "c2"},
        "2026-10-16"), {errors: [], collectorStaffId: "c2",
      dueDate: undefined});
    assert.deepEqual(inv.cleanCollectorChange({collectorStaffId: "c2",
      dueDate: ""}, "2026-10-16").dueDate, "");
    assert.deepEqual(inv.cleanCollectorChange({collectorStaffId: "",
      dueDate: "2026-10-01"}, "2026-10-16").errors,
    ["collector_invalid", "due_date_invalid"]);
  });

  it("splits a range's money into paid now and on credit", () => {
    const line = {itemId: "a", name: "A", quantity: 1, soldPriceCents: 5000,
      listPriceCents: 5000, costCents: null};
    const s = inv.summarizeSales([
      {totalCents: 5000, lines: [line]},
      {totalCents: 5000, lines: [line], creditCents: 3000,
        creditPaidCents: 1000},
      {totalCents: 5000, lines: [line], creditCents: 5000, voided: true},
    ]);
    assert.equal(s.revenueCents, 10000);
    assert.equal(s.paidNowCents, 7000);
    assert.equal(s.creditCents, 3000);
    assert.equal(s.creditOutstandingCents, 2000);
  });
});

describe("inventory: credit notifications", () => {
  const sale = {id: "sale-1", businessId: "biz", storeId: "annex",
    storeName: "Annex", creditCents: 5000, creditPaidCents: 1000,
    credit: {customerName: "Fatou Bah", collectorStaffId: "col",
      dueDate: "2026-10-10"}};
  const person = (id, extra = {}) => ({id, businessId: "biz", role: "staff",
    ...extra});

  it("tells the collector what is owed, and where", () => {
    const out = inv.planCreditNotification({sale, users: [person("col")],
      actorUid: "seller", kind: "assigned", multiStore: true});
    assert.deepEqual(out.recipients, [{uid: "col", language: "en",
      title: "Credit to collect", body: "Fatou Bah owes $40.00 · Annex"}]);
    assert.deepEqual(out.copy.fr, {title: "Crédit à encaisser",
      body: "Fatou Bah doit $40.00 · Annex"});
    assert.deepEqual(out.data, {type: "inventory_sale", kind: "credit",
      businessId: "biz", saleId: "sale-1", storeId: "annex",
      relatedCollection: "inventorySales", relatedId: "sale-1"});
  });

  it("says 'sale' when the business has one store", () => {
    const out = inv.planCreditNotification({sale, users: [person("col",
        {preferredLanguage: "fr"})], kind: "assigned", multiStore: false});
    assert.deepEqual(out.recipients[0], {uid: "col", language: "fr",
      title: "Crédit à encaisser", body: "Fatou Bah doit $40.00 · vente"});
    assert.equal(inv.planCreditNotification({sale, users: [person("col")],
      kind: "assigned"}).recipients[0].body, "Fatou Bah owes $40.00 · sale");
  });

  it("tells nobody when the collector did it, switched it off, or is " +
      "someone else's", () => {
    const quiet = (users, actorUid = "") => inv.planCreditNotification({
      sale, users, actorUid, kind: "assigned"}).recipients;
    assert.deepEqual(quiet([person("col")], "col"), []);
    assert.deepEqual(quiet([person("col", {notificationPreferences:
      {inventoryCredit: false}})]), []);
    assert.deepEqual(quiet([person("col", {businessId: "other"})]), []);
    assert.deepEqual(quiet([]), []);
    // Muting sale alerts does not mute credit.
    assert.equal(quiet([person("col", {notificationPreferences:
      {inventorySales: false}})]).length, 1);
  });

  it("reminds the collector and the owners when overdue", () => {
    const out = inv.planCreditNotification({sale, kind: "overdue",
      multiStore: true, ownerUids: ["named-owner"],
      users: [person("col"), person("own", {role: "businessOwner"}),
        person("other-staff"), {id: "named-owner", role: "businessOwner"}]});
    assert.deepEqual(out.recipients.map((r) => r.uid),
        ["col", "named-owner", "own"]);
    assert.equal(out.recipients[0].title, "Credit overdue");
    assert.equal(out.recipients[0].body,
        "Fatou Bah owes $40.00 · Annex · due 10/10/2026");
    assert.deepEqual(out.copy.fr, {title: "Crédit en retard",
      body: "Fatou Bah doit $40.00 · Annex · échéance 10/10/2026"});
    // The collector being an owner is told once.
    const once = inv.planCreditNotification({sale, kind: "overdue",
      users: [person("col", {role: "businessOwner"})]});
    assert.deepEqual(once.recipients.map((r) => r.uid), ["col"]);
  });

  it("reminds an open overdue credit at most every 3 days", () => {
    const now = Date.parse("2026-10-16T12:00:00Z");
    const day = 24 * 60 * 60 * 1000;
    const open = {...sale, creditStatus: "open"};
    assert.equal(inv.shouldRemindCredit(open, "2026-10-16", now), true);
    assert.equal(inv.shouldRemindCredit({...open,
      lastCreditReminderAt: now - day}, "2026-10-16", now), false);
    assert.equal(inv.shouldRemindCredit({...open,
      lastCreditReminderAt: now - 3 * day}, "2026-10-16", now), true);
    // The daily run may start a few minutes earlier than three days ago.
    assert.equal(inv.shouldRemindCredit({...open,
      lastCreditReminderAt: {toMillis: () => now - 3 * day + 60 * 1000}},
    "2026-10-16", now), true);
    // Due today is not overdue yet; no due date never is.
    assert.equal(inv.shouldRemindCredit({...open, credit: {...sale.credit,
      dueDate: "2026-10-16"}}, "2026-10-16", now), false);
    assert.equal(inv.shouldRemindCredit({...open, credit: {...sale.credit,
      dueDate: ""}}, "2026-10-16", now), false);
    assert.equal(inv.shouldRemindCredit({...open, voided: true},
        "2026-10-16", now), false);
    assert.equal(inv.shouldRemindCredit({...open, creditPaidCents: 5000},
        "2026-10-16", now), false);
  });

  it("writes due dates month first in English, day first in French", () => {
    assert.equal(inv.dueDateText("2026-03-04", "en"), "03/04/2026");
    assert.equal(inv.dueDateText("2026-03-04", "fr"), "04/03/2026");
    assert.equal(inv.dueDateText("nope", "en"), "");
  });
});

describe("inventory: credit sources", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"),
      "utf8");
  const between = (start, end) => {
    const from = source.indexOf(start);
    assert.ok(from >= 0, start);
    const to = end ? source.indexOf(end, from) : source.indexOf("\n);\n", from);
    assert.ok(to > from, end || start);
    return source.slice(from, to);
  };

  it("pushes credit only, through the credit preference", () => {
    const fn = between("async function notifyInventoryCredit(",
        "exports.recordInventoryCreditPayment = ");
    assert.match(fn,
        /preferenceKey: inventory\.CREDIT_NOTIFICATION_PREFERENCE/);
    assert.match(fn, /pushOnly: true/);
  });

  it("claims an overdue reminder before sending it", () => {
    const fn = between("async function remindInventoryCredit(",
        "exports.remindOverdueInventoryCredit = ");
    assert.ok(fn.indexOf("lastCreditReminderAt") <
      fn.indexOf("notifyInventoryCredit("));
  });

  it("pages the morning job across businesses by due date", () => {
    const fn = between("exports.remindOverdueInventoryCredit = ");
    assert.match(fn,
        /where\("creditStatus", "==", inventory\.CREDIT_STATUS\.OPEN\)/);
    assert.match(fn, /where\("credit\.dueDate", "<", todayKey\)/);
    assert.match(fn, /orderBy\("credit\.dueDate"\)/);
    assert.match(fn, /drainPages\(/);
    assert.match(fn, /timeZone: inventory\.CREDIT_ZONE/);
  });

  it("recomputes the collected total from the live payments", () => {
    for (const name of ["recordInventoryCreditPayment",
      "revertInventoryCreditPayment"]) {
      const fn = between(`exports.${name} = `);
      assert.match(fn, /runTransaction/);
      assert.match(fn, /sumContainerLivePayments\(/);
      assert.match(fn, /requireInventorySaleStoreIn\(/);
    }
    assert.match(between("exports.voidInventorySale = "),
        /credit_has_payments/);
  });
});

describe("inventory: switching a sale between paid and credit", () => {
  const paidSale = (extra = {}) => ({
    businessId: "b", totalCents: 4000, paymentMethod: "zelle",
    soldByStaffId: "seller", receivedByStaffId: "taker", paidNowCents: 4000,
    creditCents: 0, creditPaidCents: 0, creditStatus: "none", voided: false,
    ...extra,
  });
  const creditSale = (extra = {}) => paidSale({paidNowCents: 1000,
    creditCents: 3000, creditStatus: "open", credit: {customerName: "Fatou",
      customerPhone: "", collectorStaffId: "col", dueDate: ""}, ...extra});
  const creditIn = (extra = {}) => ({paidNowCents: 1000,
    customerName: "Fatou Bah", customerPhone: "+1", collectorStaffId: "col",
    dueDate: "", ...extra});

  it("reads the target and what a sale is now", () => {
    assert.equal(inv.saleSwitchTarget("credit"), "credit");
    assert.equal(inv.saleSwitchTarget(" paid "), "paid");
    for (const bad of ["", "normal", null, 1, {}]) {
      assert.equal(inv.saleSwitchTarget(bad), "", String(bad));
    }
    assert.equal(inv.saleSwitchKind(paidSale()), "paid");
    // A sale from before v4 has no money fields: paid.
    assert.equal(inv.saleSwitchKind({totalCents: 500}), "paid");
    assert.equal(inv.saleSwitchKind(creditSale()), "credit");
    // Paid off since is still a credit sale.
    assert.equal(inv.saleSwitchKind(creditSale({creditPaidCents: 3000,
      creditStatus: "paid"})), "credit");
  });

  it("checks the credit fields like a new credit sale, against the total",
      () => {
        const ok = inv.cleanSaleSwitchInput({to: "credit",
          credit: creditIn()}, paidSale(), "2026-10-20");
        assert.deepEqual(ok.errors, []);
        assert.deepEqual(ok.credit, {paidNowCents: 1000, creditCents: 3000,
          customerName: "Fatou Bah", customerPhone: "",
          collectorStaffId: "col", dueDate: ""});
        const cases = [
          [{paidNowCents: 4000}, "paid_now_invalid"],
          [{paidNowCents: 5000}, "paid_now_invalid"],
          [{paidNowCents: -1}, "paid_now_invalid"],
          [{customerName: " "}, "credit_customer_required"],
          [{customerPhone: "207 555 0100"}, "customer_phone_invalid"],
          [{collectorStaffId: ""}, "collector_invalid"],
          [{dueDate: "2026-10-19"}, "due_date_invalid"],
        ];
        for (const [bad, code] of cases) {
          assert.deepEqual(inv.cleanSaleSwitchInput({to: "credit",
            credit: creditIn(bad)}, paidSale(), "2026-10-20").errors,
          [code], JSON.stringify(bad));
        }
        // Nothing sent: the customer and the collector are missing.
        assert.deepEqual(inv.cleanSaleSwitchInput({to: "credit"},
            paidSale()).errors.sort(),
        ["collector_invalid", "credit_customer_required", "paid_now_invalid"]);
        assert.deepEqual(inv.cleanSaleSwitchInput({to: "credit",
          credit: "x"}, paidSale()).errors, ["credit_invalid"]);
        // Paid at the time defaults to nothing only when the client says 0.
        assert.equal(inv.cleanSaleSwitchInput({to: "credit",
          credit: creditIn({paidNowCents: 0})}, paidSale()).credit
            .creditCents, 4000);
      });

  it("needs a known payment method to go to paid", () => {
    assert.deepEqual(inv.cleanSaleSwitchInput({to: "paid",
      paymentMethod: "cash"}, creditSale()).errors, []);
    for (const bad of ["", "bitcoin", undefined]) {
      assert.deepEqual(inv.cleanSaleSwitchInput({to: "paid",
        paymentMethod: bad}, creditSale()).errors,
      ["payment_method_invalid"], String(bad));
    }
    assert.deepEqual(inv.cleanSaleSwitchInput({to: "x"}, paidSale()).errors,
        ["switch_target_invalid"]);
  });

  it("refuses a voided sale, a sale already there, collected money and " +
      "too many switches", () => {
    assert.equal(inv.saleSwitchRefusal(paidSale({voided: true}), "credit"),
        "sale_voided");
    assert.equal(inv.saleSwitchRefusal(creditSale({voided: true}), "paid"),
        "sale_voided");
    assert.equal(inv.saleSwitchRefusal(creditSale(), "credit"),
        "sale_already_credit");
    assert.equal(inv.saleSwitchRefusal(paidSale(), "paid"),
        "sale_already_paid");
    assert.equal(inv.saleSwitchRefusal(creditSale(), "paid", 1),
        "credit_payments_recorded");
    assert.equal(inv.saleSwitchRefusal(creditSale({creditPaidCents: 500}),
        "paid", 0), "credit_payments_recorded");
    // Reverted payments only: nothing was collected, it may go.
    assert.equal(inv.saleSwitchRefusal(creditSale(), "paid", 0), null);
    assert.equal(inv.saleSwitchRefusal(paidSale(), "credit"), null);
    const many = Array.from({length: inv.MAX_SALE_SWITCHES},
        (_, i) => ({requestId: `r-${i}-xxxxxx`}));
    assert.equal(inv.saleSwitchRefusal(paidSale({paymentSwitches: many}),
        "credit"), "too_many_switches");
    for (const code of ["sale_already_credit", "sale_already_paid",
      "credit_payments_recorded", "too_many_switches"]) {
      assert.equal(inv.refusalKind(code), "failed-precondition", code);
      assert.ok(inv.INVENTORY_MESSAGES[code], code);
    }
    assert.equal(inv.refusalKind("switch_target_invalid"), "invalid-argument");
    assert.match(inv.INVENTORY_MESSAGES.credit_payments_recorded,
        /Record a payment/);
  });

  it("puts a paid sale on credit exactly like a credit sale rung up so",
      () => {
        const credit = inv.cleanSaleSwitchInput({to: "credit",
          credit: creditIn({dueDate: "2099-01-01"})}, paidSale()).credit;
        const {patch, entry} = inv.planSaleSwitch({sale: paidSale(),
          to: "credit", credit, byStaffId: "boss", requestId: "req-12345678"});
        const fresh = inv.saleMoneyFields({totalCents: 4000, credit,
          receivedByStaffId: "taker"});
        // The paid part keeps the method and who received it.
        assert.deepEqual(patch, {...fresh, paymentMethod: "zelle",
          creditUpdatedByStaffId: "boss"});
        assert.equal(patch.creditStatus, "open");
        assert.equal(patch.lastCreditReminderAt, null);
        assert.deepEqual(entry, {requestId: "req-12345678", from: "paid",
          to: "credit", byStaffId: "boss", totalCents: 4000,
          fromPaidNowCents: 4000, fromCreditCents: 0, toPaidNowCents: 1000,
          toCreditCents: 3000, fromPaymentMethod: "zelle",
          toPaymentMethod: "zelle", fromReceivedByStaffId: "taker",
          toReceivedByStaffId: "taker", customerName: "Fatou Bah",
          collectorStaffId: "col"});
        assert.equal(inv.saleSwitchSummary(entry), "Switched to credit: " +
          "$10.00 paid at the sale (zelle), $30.00 owed by Fatou Bah");
        assert.deepEqual(inv.saleSwitchAnswer(entry), {to: "credit",
          paidNowCents: 1000, creditCents: 3000, creditStatus: "open",
          paymentMethod: "zelle", receivedByStaffId: "taker"});
        // The summary follows: revenue unchanged, split moved to credit.
        const after = inv.summarizeSales([{...paidSale(), ...patch,
          lines: [{itemId: "i", quantity: 1, soldPriceCents: 4000}]}]);
        assert.deepEqual([after.revenueCents, after.paidNowCents,
          after.creditCents, after.creditOutstandingCents],
        [4000, 1000, 3000, 3000]);
      });

  it("takes no method when nothing was paid at the time", () => {
    const credit = inv.cleanSaleSwitchInput({to: "credit",
      credit: creditIn({paidNowCents: 0})}, paidSale()).credit;
    const {patch, entry} = inv.planSaleSwitch({sale: paidSale(),
      to: "credit", credit, byStaffId: "boss", requestId: "req-12345678"});
    assert.equal(patch.paymentMethod, "");
    assert.equal(patch.paidNowCents, 0);
    assert.equal(entry.fromPaymentMethod, "zelle");
    assert.equal(inv.saleSwitchSummary(entry),
        "Switched to credit: $40.00 owed by Fatou Bah");
    // An old sale (no receivedBy): the seller took the money.
    const old = inv.planSaleSwitch({sale: {totalCents: 4000,
      paymentMethod: "cash", soldByStaffId: "seller"}, to: "credit", credit,
    byStaffId: "boss", requestId: "req-12345678"});
    assert.equal(old.patch.receivedByStaffId, "seller");
    assert.equal(old.entry.fromPaidNowCents, 4000);
  });

  it("makes a credit sale paid in full at the time, keeping its credit " +
      "for the history", () => {
    const {patch, entry} = inv.planSaleSwitch({sale: creditSale(),
      to: "paid", paymentMethod: "cash", receivedByStaffId: "boss",
      byStaffId: "boss", requestId: "req-12345678"});
    assert.deepEqual(patch, {receivedByStaffId: "boss", creditPaidCents: 0,
      paidNowCents: 4000, creditCents: 0, creditStatus: "none",
      paymentMethod: "cash", lastCreditReminderAt: null,
      creditUpdatedByStaffId: "boss"});
    assert.equal("credit" in patch, false);
    assert.deepEqual([entry.from, entry.to, entry.fromPaidNowCents,
      entry.fromCreditCents, entry.toPaidNowCents, entry.toCreditCents,
      entry.customerName, entry.collectorStaffId],
    ["credit", "paid", 1000, 3000, 4000, 0, "Fatou", ""]);
    assert.equal(inv.saleSwitchSummary(entry),
        "Switched to paid: $40.00 paid at the sale (cash)");
    assert.equal(inv.saleSwitchAnswer(entry).creditStatus, "none");
    const sale = {...creditSale(), ...patch};
    assert.equal(inv.saleSwitchKind(sale), "paid");
    assert.equal(inv.creditStateRefusal(sale), "no_credit");
    assert.equal(inv.shouldRemindCredit({...sale,
      credit: {dueDate: "2020-01-01"}}, "2026-10-20", Date.now()), false);
  });

  it("finds a switch by its retry key and names its History row once", () => {
    const sale = paidSale({paymentSwitches: [{requestId: "req-aaaaaaaa"},
      null, "x"]});
    assert.equal(inv.saleSwitches(sale).length, 1);
    assert.ok(inv.saleSwitchEntry(sale, "req-aaaaaaaa"));
    assert.equal(inv.saleSwitchEntry(sale, "req-bbbbbbbb"), null);
    assert.equal(inv.saleSwitchEntry(sale, ""), null);
    const id = inv.saleSwitchAuditId("s1", "req-aaaaaaaa");
    assert.equal(id, inv.saleSwitchAuditId("s1", "req-aaaaaaaa"));
    assert.notEqual(id, inv.saleSwitchAuditId("s2", "req-aaaaaaaa"));
    assert.equal(id.length, 40);
  });
});

describe("inventory: switch sources", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "index.js"),
      "utf8");
  const fn = source.slice(
      source.indexOf("exports.switchInventorySalePayment = "),
      source.indexOf("\n);\n",
          source.indexOf("exports.switchInventorySalePayment = ")));

  it("is one low-instance callable gated like a void", () => {
    assert.match(source,
        /^const INVENTORY_SALE_SWITCH_MAX_INSTANCES = 1;$/m);
    assert.match(fn, /invoker: "public"/);
    assert.match(fn, /maxInstances: INVENTORY_SALE_SWITCH_MAX_INSTANCES/);
    assert.match(fn, /requireInventoryContext\(uid, businessId\)/);
    assert.match(fn, /requireInventorySaleStoreIn\(/);
  });

  it("reads, checks and writes in one transaction with its History row",
      () => {
        assert.match(fn, /runTransaction/);
        const tx = fn.slice(fn.indexOf("runTransaction"));
        assert.ok(tx.indexOf("saleSwitchEntry(") <
          tx.indexOf("saleSwitchRefusal("));
        assert.match(tx, /inventoryCreditPaymentsOf\(/);
        assert.match(tx, /tx\.set\(db\.collection\("lotLedgerAudit"\)/);
        assert.match(tx, /lotLedgerAuditRecord\(/);
        assert.doesNotMatch(fn, /\.delete\(/);
        assert.match(fn, /notifyInventoryCredit\(/);
      });
});
