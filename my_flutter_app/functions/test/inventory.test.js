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
      category: "Care", photoUrl: "", archived: false, countWasOff: false,
      createdByStaffId: "staff", updatedByStaffId: "staff",
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
      profitCents: 0, discountCents: 0, linesWithoutCost: 0, best: []});
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
      "getInventorySummary"];
    for (const name of names) {
      const start = source.indexOf(`exports.${name} = onCall(`);
      assert.ok(start > 0, `${name} is exported`);
      const body = source.slice(start, start + 900);
      assert.match(body, /requireInventoryAccess\(uid, businessId\)/,
          `${name} checks permission and service`);
    }
  });

  it("serves the tags view from the shared /d handler", () => {
    assert.match(source, /view \|\| ""\) === "inventoryTags"/);
  });
});
