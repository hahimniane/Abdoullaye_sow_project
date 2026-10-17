import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { INVENTORY_MESSAGES, INVENTORY_MOVEMENT_LABELS } from "./inventory.ts";

// The console wiring of Inventory v2 (categories and stores), pinned by
// reading the source the way inventory-contract.test.ts does. The contract is
// docs/INVENTORY.md "Categories and stores (v2)": exact callable names, the
// refusal codes, and "single-store businesses see nothing about stores".

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const B = "../components/business/";
const panel = read(B + "inventory-panel.tsx");
const itemDialog = read(B + "inventory-item-dialog.tsx");
const stockDialog = read(B + "inventory-stock-dialog.tsx");
const categoriesDialog = read(B + "inventory-categories-dialog.tsx");
const storesDialog = read(B + "inventory-stores-dialog.tsx");
const transferDialog = read(B + "inventory-transfer-dialog.tsx");
const salesList = read(B + "inventory-sales-list.tsx");
const summaryCard = read(B + "inventory-summary-card.tsx");
const detail = read(B + "inventory-item-detail.tsx");
const people = read(B + "profile-support-people.tsx");
const businessData = read("./business-data.ts");
const inventorySource = read("./inventory.ts");
const consoleSource = read("../components/business-console.tsx");

// ---------------------------------------------------------------------------
// The callables, by their contract names, from the screens that own them.
// ---------------------------------------------------------------------------

test("every v2 callable is called through httpsCallable by the screen that owns it", () => {
  const calls: Array<[string, string, string]> = [
    ["createInventoryCategory", "the categories manager", categoriesDialog],
    ["createInventoryCategory", "the product form", itemDialog],
    ["renameInventoryCategory", "the categories manager", categoriesDialog],
    ["archiveInventoryCategory", "the categories manager", categoriesDialog],
    ["createInventoryStore", "the stores manager", storesDialog],
    ["updateInventoryStore", "the stores manager", storesDialog],
    ["archiveInventoryStore", "the stores manager", storesDialog],
    ["transferInventoryStock", "the transfer dialog", transferDialog],
    ["setInventoryStaffAccess", "the People panel", people],
  ];
  for (const [callable, owner, source] of calls) {
    assert.match(source, new RegExp(`httpsCallable\\(\\s*functions,\\s*"${callable}"\\s*\\)`), `${callable} is not called by ${owner}`);
  }
  // Nothing is written from the browser, and the console still never sells.
  const all = [panel, itemDialog, stockDialog, categoriesDialog, storesDialog, transferDialog, salesList, summaryCard, detail].join("\n");
  assert.doesNotMatch(all, /\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\(/);
  assert.doesNotMatch(all, /recordInventorySale/);
  // The store callables live in the stores manager alone (the owner's).
  for (const [name, source] of [["the panel", panel], ["the product form", itemDialog], ["the stock dialog", stockDialog], ["the sales list", salesList]] as const) {
    assert.doesNotMatch(source, /createInventoryStore|updateInventoryStore|archiveInventoryStore/, name);
  }
});

test("the requests are built by the tested pure helpers, never by hand in a screen", () => {
  assert.match(categoriesDialog, /createInventoryCategoryRequest\(businessId, name\)/);
  assert.match(categoriesDialog, /renameInventoryCategoryRequest\(businessId, category\.id, editName\)/);
  assert.match(categoriesDialog, /archiveInventoryCategoryRequest\(businessId, category\.id, next\)/);
  assert.match(itemDialog, /createInventoryCategoryRequest\(businessId, newCategory\)/);
  assert.match(itemDialog, /createInventoryItemRequest\(businessId, draft, form\)/);
  assert.match(storesDialog, /createInventoryStoreRequest\(businessId, draft\)/);
  assert.match(storesDialog, /updateInventoryStoreRequest\(businessId, form, draft\)/);
  assert.match(storesDialog, /archiveInventoryStoreRequest\(businessId, store\.id, next\)/);
  assert.match(transferDialog, /transferInventoryStockRequest\(businessId, draft\)/);
  assert.match(transferDialog, /validateTransferDraft\(draft, known\)/);
  assert.match(stockDialog, /adjustInventoryStockRequest\(businessId, item\.id, draft, access\.multi \? storeId : ""\)/);
  assert.match(people, /setInventoryStaffAccessRequest\(businessId, row\.id, access\)/);
  assert.match(summaryCard, /inventorySummaryRequest\(businessId, range, timeZone, storeId\)/);
});

test("a failure from any of them reaches the person in friendly words", () => {
  for (const [name, source] of [["the categories manager", categoriesDialog], ["the stores manager", storesDialog], ["the transfer dialog", transferDialog]] as const) {
    assert.match(source, /runInventoryCall\(setBusy/, name);
    assert.match(source, /\(failure\) => setError\(failure\.message\)/, name);
  }
  // People raises the mapped sentence through its own feedback, not the transport's.
  assert.match(people, /throw new Error\(inventoryCallableFailure\(failure\)\.message\)/);
  assert.match(people, /throw new Error\(inventoryMessage\(problems\)\)/);
});

// ---------------------------------------------------------------------------
// The reads.
// ---------------------------------------------------------------------------

test("categories, stores and per-store stock are read through the shared business hooks", () => {
  assert.match(businessData, /export function useInventoryCategories\(businessId: string, enabled: boolean\): BusinessRowsResult \{\s*return useBusinessCollection\("inventoryCategories", businessId, enabled, \{ pageSize: null, sort: "query" \}\);/);
  assert.match(businessData, /export function useInventoryStores\(businessId: string, enabled: boolean\): BusinessRowsResult \{\s*return useBusinessCollection\("inventoryStores", businessId, enabled, \{ pageSize: null, sort: "query" \}\);/);
  assert.match(businessData, /useBusinessCollection\("inventoryStock", businessId, enabled, \{\s*pageSize: null,\s*\.\.\.\(store \? \{ where: \[\["storeId", "==", store\]\] \} : \{\}\),\s*sort: "query",\s*\}\);/);
  // Screens use the named hooks only.
  assert.doesNotMatch([panel, itemDialog, categoriesDialog, storesDialog, transferDialog, salesList, summaryCard, detail].join("\n"), /useBusinessCollection\(|query\(/);
  assert.match(panel, /useInventoryStores\(businessId, enabled\)/);
  assert.match(panel, /useInventoryCategories\(businessId, enabled\)/);
  // Staff of one store ask for their own store's rows and sales: the shape the rules allow.
  assert.match(panel, /useInventoryStock\(businessId, enabled && access\.multi && !access\.needsHomeStore, access\.scopedStoreId\)/);
  assert.match(salesList, /useInventorySales\(businessId, enabled && !access\.needsHomeStore, access\.scopedStoreId\)/);
  assert.match(people, /useInventoryStores\(businessId, canManageStaff && businessHasInventory\(business\)\)/);
});

// ---------------------------------------------------------------------------
// Single-store businesses see nothing about stores.
// ---------------------------------------------------------------------------

test("every store control is gated on the business having two stores, and on who is looking", () => {
  // The store filter: only whoever sees every store of a multi-store business.
  assert.match(panel, /\{access\.multi && access\.canSeeAll && \(\s*<InventoryStoreFilter/);
  // v4: the sales list's tool row always holds the credit filter; the store filter inside it is still gated.
  assert.match(salesList, /\{access\.multi && access\.canSeeAll && \(\s*<InventoryStoreFilter/);
  assert.match(summaryCard, /\{access\.multi && access\.canSeeAll && \(\s*<div className="panel-tools">\s*<InventoryStoreFilter/);
  // The Store column and the per-store figures.
  assert.match(salesList, /\{access\.multi && <span>Store<\/span>\}/);
  assert.match(salesList, /\{access\.multi && \(\s*<span><strong data-no-translate>\{nameOfStore\(sale\)/);
  assert.match(summaryCard, /const showByStore = access\.multi && access\.canSeeAll && !storeFilter && summary !== null && summary\.byStore\.length > 0;/);
  // The starting count per store replaces the one number; the single number stays for one store.
  assert.match(itemDialog, /\{!editing && !access\.multi && \(\s*<label className="lst-field"><span>How many in stock<\/span>/);
  assert.match(itemDialog, /\{!editing && access\.multi && \(\s*<fieldset/);
  // Add stock asks which store only with several.
  assert.match(stockDialog, /\{access\.multi && \(\s*<label className="lst-field"><span>Store<\/span>/);
  // Moving stock: only for those who may (owner, all-stores staff) and only with several stores.
  assert.match(panel, /\{access\.canTransfer && \(\s*<button[\s\S]*?<ArrowRightLeft size=\{16\} \/> Move stock/);
  assert.match(panel, /\{modal === "transfer" && access\.canTransfer && \(/);
  assert.match(detail, /\{access\.canTransfer && \(\s*<button[^>]*onClick=\{onTransfer\}/);
  // The stores manager: the owner's alone.
  assert.match(panel, /\{access\.canManageStores && \(\s*<button[^>]*onClick=\{\(\) => setModal\("stores"\)\}/);
  assert.match(panel, /\{modal === "stores" && access\.canManageStores && \(/);
  // The per-store lines of a product row only exist in multi-store mode.
  assert.match(panel, /stock\.multi && !scopeStoreId && stock\.cells\.length > 0/);
  assert.match(detail, /\{view\.multi && \(\s*<div className="mini-table">/);
});

test("staff who work in one store see their store everywhere and get no filter", () => {
  const access = read("./inventory.ts");
  assert.match(access, /const canSeeAll = !multi \|\| viewer\.isOwner \|\| viewer\.allStores;/);
  assert.match(access, /const scopedStoreId = multi && !canSeeAll && homeValid \? viewer\.homeStoreId : "";/);
  assert.match(access, /canTransfer: multi && canSeeAll,/);
  assert.match(access, /canManageStores: viewer\.isOwner,/);
  // The panel scopes the lists and the figures to that store, and says so when there is none.
  assert.match(panel, /const scopeStoreId = access\.multi \? \(access\.canSeeAll \? storeFilter : access\.scopedStoreId\) : "";/);
  assert.match(panel, /access\.needsHomeStore \? \(\s*<article className="panel">\s*<div className="empty-state">You have no home store yet\./);
  assert.match(summaryCard, /const storeId = access\.multi \? \(access\.canSeeAll \? storeFilter : access\.scopedStoreId\) : "";/);
  // The console passes who is looking: the owner by role, staff by their own record.
  assert.match(consoleSource, /viewer=\{inventoryViewerFromProfile\(profile\)\}/);
});

// ---------------------------------------------------------------------------
// Categories on the screens.
// ---------------------------------------------------------------------------

test("the product form picks a category from the list and can add one on the spot", () => {
  assert.match(itemDialog, /<option value="">No category<\/option>/);
  assert.match(itemDialog, /<option value=\{NEW_CATEGORY\}>Add a new category<\/option>/);
  assert.match(itemDialog, /validateCategoryName\(newCategory, known\)/);
  // A list that could not be read falls back to the typed text of v1.
  assert.match(itemDialog, /categoriesAvailable \? \(/);
  assert.match(itemDialog, /onChange=\{\(e\) => set\(\{ category: e\.target\.value, categoryId: "" \}\)\}/);
  // The list, the filter and the manager live in the panel; archived categories are managed, never deleted.
  assert.match(panel, /<InventoryCategoriesDialog/);
  assert.match(panel, /aria-label="Filter by category"/);
  assert.match(panel, /<option value=\{UNCATEGORIZED_FILTER\}>Uncategorized<\/option>/);
  assert.doesNotMatch(categoriesDialog, /deleteInventoryCategory/);
});

test("the summary lists every category with items sold, money and profit side by side", () => {
  assert.match(summaryCard, /<h4>Categories<\/h4>/);
  assert.match(summaryCard, /<th>Category<\/th><th>Items sold<\/th><th>Revenue<\/th><th>Profit<\/th>/);
  assert.match(summaryCard, /summary\.byCategory\.map\(\(row\) => \(/);
  assert.match(summaryCard, /row\.categoryId \? <strong data-no-translate>\{row\.name\}<\/strong> : <strong>Uncategorized<\/strong>/);
  assert.match(summaryCard, /<th>Store<\/th><th>Sales<\/th><th>Items sold<\/th><th>Revenue<\/th><th>Profit<\/th>/);
  // The block sorts by money in the pure reader, not on screen.
  assert.match(inventorySource, /byCategory: byMoneyThenName\(/);
});

// ---------------------------------------------------------------------------
// People: the owner's store controls.
// ---------------------------------------------------------------------------

test("People offers Home store and Works in all stores to the owner, for staff who hold Inventory, in a multi-store business", () => {
  assert.match(people, /canManageStaff && saveInventoryAccess && inventoryStores\.length >= 2 && permissions\.includes\("inventory"\)/);
  assert.match(people, /<span>Home store<\/span>/);
  assert.match(people, /role="switch"/);
  assert.match(people, /<span>Works in all stores<\/span>/);
  assert.match(people, /const storeAccessStores = inventoryStoreList\.length >= 2 \? inventoryStoreList : \[\];/);
  // The current values are the member's own record, and saving is refused until something changed.
  assert.match(people, /inventoryStaffAccessFromRow\(row\)/);
  assert.match(people, /disabled=\{saving \|\| !staffAccessChanged\(row, storeAccess\)\}/);
  // Confirmed in both languages like the permissions save.
  assert.match(people, /confirmFr:\s*`Enregistrer l’accès aux magasins de /);
});

// ---------------------------------------------------------------------------
// French.
// ---------------------------------------------------------------------------

/** Spelled the same in French. */
const SAME = new Set(["Total", "Note", "Photo", "Code"]);

function missingFrench(strings: readonly string[]): string[] {
  return strings.filter((english) => !SAME.has(english) && !(english in TEXT_TRANSLATIONS));
}

test("every refusal code the contract names for v2 has a friendly sentence in both languages", () => {
  const codes = [
    "category_name_required", "category_name_taken", "category_not_found",
    "store_name_required", "store_not_found", "store_archived", "store_has_stock", "store_not_allowed",
    "home_store_required", "same_store", "insufficient_stock", "owner_only",
  ];
  for (const code of codes) {
    assert.ok(code in INVENTORY_MESSAGES, `${code} has no sentence`);
    const english = INVENTORY_MESSAGES[code as keyof typeof INVENTORY_MESSAGES];
    assert.notEqual(translateValue(english, "fr"), english, code);
  }
  // The checks made before the call read the same way.
  const early = [
    "stock_store_invalid", "store_required", "transfer_item_required", "transfer_store_required", "transfer_quantity_invalid",
    "store_name_too_long", "store_detail_too_long", "staff_store_required",
  ];
  for (const code of early) {
    const english = INVENTORY_MESSAGES[code as keyof typeof INVENTORY_MESSAGES];
    assert.ok(english, code);
    assert.notEqual(translateValue(english, "fr"), english, code);
  }
});

test("the new stock-history labels and the People strings have their French", () => {
  const strings = [
    ...Object.values(INVENTORY_MOVEMENT_LABELS),
    "Inventory stores", "Home store", "No home store", "Works in all stores", "Save store access", "Store access saved",
    "Stock moved.", "Store added.", "Store updated.", "Store archived.", "Store restored.",
    "Category added.", "Category renamed.", "Category archived. Its products keep it.", "Category restored.",
  ];
  assert.deepEqual(missingFrench(strings), []);
  for (const english of strings) assert.notEqual(translateValue(english, "fr"), english, english);
  // The French comes back to the English it came from.
  assert.equal(translateValue(translateValue("Home store", "fr"), "en"), "Home store");
  assert.equal(translateValue(translateValue("Stores", "fr"), "en"), "Stores");
});
