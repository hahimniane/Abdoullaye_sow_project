import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { INVENTORY_MESSAGES } from "./inventory.ts";

// The console wiring of Inventory v3 (brands and quick entry), pinned by
// reading the source the way inventory-v2-contract.test.ts does. The contract
// is docs/INVENTORY.md "Brands and quick entry (v3)": exact callable names,
// the request shapes, the refusal codes, and "a product without a brand reads
// and sends exactly what it did in v2".

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const B = "../components/business/";
const panel = read(B + "inventory-panel.tsx");
const itemDialog = read(B + "inventory-item-dialog.tsx");
const brandsDialog = read(B + "inventory-brands-dialog.tsx");
const categoriesDialog = read(B + "inventory-categories-dialog.tsx");
const summaryCard = read(B + "inventory-summary-card.tsx");
const detail = read(B + "inventory-item-detail.tsx");
const salesList = read(B + "inventory-sales-list.tsx");
const voidDialog = read(B + "inventory-void-dialog.tsx");
const stockDialog = read(B + "inventory-stock-dialog.tsx");
// v5: the New transfer dialog replaced the instant "Move stock" one.
const transferDialog = read(B + "inventory-transfer-compose-dialog.tsx");
const deleteDialog = read(B + "inventory-delete-dialog.tsx");
const businessData = read("./business-data.ts");
const inventorySource = read("./inventory.ts");

// ---------------------------------------------------------------------------
// The callables, by their contract names, from the screens that own them.
// ---------------------------------------------------------------------------

test("every v3 callable is called through httpsCallable by the screen that owns it", () => {
  const calls: Array<[string, string, string]> = [
    ["createInventoryBrand", "the brands manager", brandsDialog],
    ["createInventoryBrand", "the product form", itemDialog],
    ["renameInventoryBrand", "the brands manager", brandsDialog],
    ["archiveInventoryBrand", "the brands manager", brandsDialog],
  ];
  for (const [callable, owner, source] of calls) {
    assert.match(source, new RegExp(`httpsCallable\\(\\s*functions,\\s*"${callable}"\\s*\\)`), `${callable} is not called by ${owner}`);
  }
  // Nothing is written from the browser; brands are never deleted.
  const all = [panel, itemDialog, brandsDialog, summaryCard, detail, salesList].join("\n");
  assert.doesNotMatch(all, /\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\(/);
  assert.doesNotMatch(brandsDialog, /deleteInventoryBrand/);
  // Rename and archive are the manager's; the product form only adds on the spot.
  assert.doesNotMatch(itemDialog, /renameInventoryBrand|archiveInventoryBrand/);
});

test("the requests are built by the tested pure helpers, never by hand in a screen", () => {
  assert.match(brandsDialog, /createInventoryBrandRequest\(businessId, name\)/);
  assert.match(brandsDialog, /renameInventoryBrandRequest\(businessId, brand\.id, editName\)/);
  assert.match(brandsDialog, /archiveInventoryBrandRequest\(businessId, brand\.id, next\)/);
  assert.match(itemDialog, /createInventoryBrandRequest\(businessId, newBrand\)/);
  assert.match(itemDialog, /createInventoryItemRequest\(businessId, draft, form\)/);
  assert.match(itemDialog, /updateInventoryItemRequest\(businessId, item, draft\)/);
  // The helpers put the contract's fields in: businessId on every one, the id alone when chosen.
  assert.match(inventorySource, /export function createInventoryBrandRequest\(businessId: string, name: unknown\) \{\s*return \{ businessId: text\(businessId\), name: text\(name, MAX_BRAND\) \};/);
  assert.match(inventorySource, /return \{ businessId: text\(businessId\), brandId: text\(brandId\), name: text\(name, MAX_BRAND\) \};/);
  assert.match(inventorySource, /return \{ businessId: text\(businessId\), brandId: text\(brandId\), archived: archived === true \};/);
  assert.match(inventorySource, /if \(brandId\) return \{ brandId \};\s*const brand = text\(draft\.brand \?\? "", MAX_BRAND\);\s*return brand \? \{ brand \} : \{\};/);
  assert.match(inventorySource, /return item\.brandId \|\| item\.brand \? \{ brand: "", brandId: "" \} : \{\};/);
});

test("a failure from any of them reaches the person in friendly words", () => {
  assert.match(brandsDialog, /runInventoryCall\(setBusy/);
  assert.match(brandsDialog, /\(failure\) => setError\(failure\.message\)/);
  assert.match(itemDialog, /runInventoryCall\(setAddingBrandBusy/);
});

// ---------------------------------------------------------------------------
// The read.
// ---------------------------------------------------------------------------

test("brands are read whole through the shared business hook, like categories", () => {
  assert.match(businessData, /export function useInventoryBrands\(businessId: string, enabled: boolean\): BusinessRowsResult \{\s*return useBusinessCollection\("inventoryBrands", businessId, enabled, \{ pageSize: null, sort: "query" \}\);/);
  assert.doesNotMatch([panel, itemDialog, brandsDialog, summaryCard, detail].join("\n"), /useBusinessCollection\(|query\(/);
  assert.match(panel, /useInventoryBrands\(businessId, enabled\)/);
  // A list that could not be read leaves the v2 screens working and the form takes a typed brand.
  assert.match(panel, /const brandsAvailable = !brandsRead\.error;/);
  assert.match(itemDialog, /brandsAvailable \? \(/);
  assert.match(itemDialog, /onChange=\{\(e\) => set\(\{ brand: e\.target\.value, brandId: "" \}\)\}/);
  // The load error line shows only the reads that matter to everyone, as for categories.
  assert.doesNotMatch(panel, /const loadError = [^;]*brandsRead/);
});

// ---------------------------------------------------------------------------
// Brands on the screens.
// ---------------------------------------------------------------------------

test("the product form picks a brand from the list and can add one on the spot", () => {
  assert.match(itemDialog, /<option value="">No brand<\/option>/);
  assert.match(itemDialog, /<option value=\{NEW_BRAND\}>Add a new brand<\/option>/);
  assert.match(itemDialog, /validateBrandName\(newBrand, knownBrands\)/);
  assert.match(itemDialog, /aria-label="Brand"/);
  assert.match(itemDialog, /placeholder="New brand name"/);
});

test("the list has a Brands manager and a brand filter beside the category one", () => {
  assert.match(panel, /<InventoryBrandsDialog/);
  assert.match(panel, /<BadgeCheck size=\{16\} \/> Brands/);
  assert.match(panel, /aria-label="Filter by brand"/);
  assert.match(panel, /<option value="">All brands<\/option>/);
  assert.match(panel, /<option value=\{NO_BRAND_FILTER\}>No brand<\/option>/);
  assert.match(panel, /placeholder="Brand, name, category or code"/);
  // The filter row follows the category one.
  assert.ok(panel.indexOf('aria-label="Filter by category"') < panel.indexOf('aria-label="Filter by brand"'));
  // The chip counts ignore the brand filter, like the category one.
  assert.match(panel, /\{ \.\.\.scope, categoryId: "", brandId: "" \}/);
});

test("the summary lists every brand that sold, with a No brand row", () => {
  assert.match(summaryCard, /<h4>Brands<\/h4>/);
  assert.match(summaryCard, /<th>Brand<\/th><th>Items sold<\/th><th>Revenue<\/th><th>Profit<\/th>/);
  assert.match(summaryCard, /summary\.byBrand\.map\(\(row\) => \(/);
  assert.match(summaryCard, /row\.brandId \? <strong data-no-translate>\{row\.name\}<\/strong> : <strong>No brand<\/strong>/);
  assert.match(inventorySource, /byBrand: byMoneyThenName\(/);
});

test("brand in front, everywhere a product's name shows", () => {
  assert.match(panel, /<strong data-no-translate>\{productDisplayName\(item\)\}<\/strong>/);
  assert.match(detail, /<h2 data-no-translate>\{productDisplayName\(item\)\}<\/h2>/);
  assert.match(stockDialog, /\{productDisplayName\(item\)\}/);
  assert.match(deleteDialog, /\{productDisplayName\(item\)\}/);
  assert.match(transferDialog, /<strong data-no-translate>\{productDisplayName\(item\)\}<\/strong> <small><code className="ctn-code" data-no-translate>\{item\.code\}<\/code><\/small>/);
  assert.match(salesList, /\{productDisplayName\(line\)\}/);
  assert.match(voidDialog, /\{line\.quantity\} × \{productDisplayName\(line\)\}/);
  assert.match(summaryCard, /productDisplayName\(\{ name: row\.name, brand: row\.brand \|\| brandByItem\?\.get\(row\.itemId\) \|\| "" \}\)/);
  // The tag dialog is handed the same display name wherever it is opened.
  assert.match(panel, /setTagsFor\(\{ id: item\.id, name: productDisplayName\(item\), code: item\.code \}\)/);
  assert.match(itemDialog, /name: productDisplayName\(\{ name: draft\.name, brand: draft\.brand \}\)/);
  // No screen prints a product's bare name any more.
  for (const [name, source] of [["panel", panel], ["detail", detail], ["stock dialog", stockDialog], ["delete dialog", deleteDialog], ["transfer dialog", transferDialog], ["sales list", salesList], ["void dialog", voidDialog]] as const) {
    assert.doesNotMatch(source, /\{(item|line)\.name\}/, name);
  }
});

// ---------------------------------------------------------------------------
// Quick entry.
// ---------------------------------------------------------------------------

test("'Save and add another like it' is a second save button on new products only, and keeps brand and category", () => {
  assert.match(itemDialog, /\{!editing && \(\s*<button[^>]*onClick=\{\(\) => void save\("another"\)\}><CopyPlus size=\{16\} \/> Save and add another like it<\/button>/);
  assert.match(itemDialog, /setDraft\(quickEntryDraft\(draft\)\)/);
  // It stays on the form (no close, no tags) and puts the cursor back on the name.
  assert.match(itemDialog, /if \(mode === "another"\) \{[\s\S]*?return;\s*\}\s*onCreated\(/);
  assert.match(itemDialog, /nameRef\.current\?\.focus\(\)/);
  // The helper keeps exactly the brand and the category.
  assert.match(inventorySource, /export function quickEntryDraft\(saved: InventoryItemDraft\): InventoryItemDraft \{\s*return \{\s*\.\.\.emptyInventoryItemDraft,\s*stock: \{\},\s*category: saved\.category,\s*categoryId: saved\.categoryId \?\? "",\s*brand: saved\.brand \?\? "",\s*brandId: saved\.brandId \?\? "",\s*\};/);
  // The existing buttons keep their meaning.
  assert.match(itemDialog, /void save\("print"\)\}><Printer size=\{16\} \/> Save &amp; print tags/);
  assert.match(itemDialog, /onClick=\{\(\) => void save\("save"\)\}/);
});

test("the v2 screens keep their shape", () => {
  assert.match(categoriesDialog, /createInventoryCategoryRequest\(businessId, name\)/);
  assert.match(panel, /<InventoryCategoriesDialog/);
  assert.match(panel, /aria-label="Filter by category"/);
});

// ---------------------------------------------------------------------------
// French.
// ---------------------------------------------------------------------------

test("every brand refusal the contract names has a friendly sentence in both languages", () => {
  for (const code of ["brand_name_required", "brand_name_taken", "brand_not_found", "brand_too_long"]) {
    assert.ok(code in INVENTORY_MESSAGES, `${code} has no sentence`);
    const english = INVENTORY_MESSAGES[code as keyof typeof INVENTORY_MESSAGES];
    assert.notEqual(translateValue(english, "fr"), english, code);
  }
});

test("every new brand string has its French", () => {
  const strings = [
    "Brand", "Brands", "All brands", "No brand", "Filter by brand", "Add a new brand", "New brand name", "Brand name", "Archived brands",
    "A brand goes in front of a product's name, like “Jordan 11”. The same list is used in every store. A brand is archived, never deleted: its products keep it.",
    "No brands yet. Add the first one above, or add one while you create a product.",
    "Brand added.", "Brand renamed.", "Brand archived. Its products keep it.", "Brand restored.",
    "Brand, name, category or code",
    "Type the name without the brand. The brand you pick below is shown in front of it.",
    "Save and add another like it",
  ];
  for (const english of strings) {
    assert.ok(english in TEXT_TRANSLATIONS, `${english} has no French`);
    assert.notEqual(translateValue(english, "fr"), english, english);
  }
  // The French comes back to the English it came from.
  assert.equal(translateValue(translateValue("Brands", "fr"), "en"), "Brands");
  assert.equal(translateValue("No brand", "fr"), "Aucune marque");
});

test("the strings the brand screens print are all in the source the French table was written from", () => {
  // A screen string that changes wording must change its French key with it.
  assert.match(brandsDialog, /<h3>Brands<\/h3>/);
  assert.match(brandsDialog, /No brands yet\. Add the first one above, or add one while you create a product\./);
  assert.match(brandsDialog, /onFlash\("Brand added\."\)/);
  assert.match(brandsDialog, /onFlash\("Brand renamed\."\)/);
  assert.match(brandsDialog, /onFlash\(next \? "Brand archived\. Its products keep it\." : "Brand restored\."\)/);
  assert.match(brandsDialog, /<h4 className="ivt-manage-sub">Archived brands<\/h4>/);
});
