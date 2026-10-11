import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import ts from "typescript";

import { ATTRIBUTE_TRANSLATIONS, TEXT_TRANSLATIONS, translateValue } from "./french-dom.ts";
import { INVOICE_PAYMENT_METHOD_LABELS } from "./invoice-ledger.ts";
import { ITEM_TAG_NOTICE } from "./customer-service-intent.ts";
import {
  INVENTORY_FILTER_LABELS,
  INVENTORY_MESSAGES,
  INVENTORY_MOVEMENT_LABELS,
  INVENTORY_RANGE_LABELS,
  INVENTORY_STATUS_LABELS,
  businessRequestedInventory,
} from "./inventory.ts";
import { BUSINESS_SERVICE_IDS } from "./business-service-settings.ts";
import { businessSidebarTabs } from "./business-sidebar.ts";
import { storeLinksFor } from "./app-store-links.ts";

// The console wiring the inventory feature depends on, pinned by reading the
// source the way waiting-packages-contract.test.ts does, plus a scan that
// every sentence the new screens show has its French: the guardrail is "a
// string only in English is a bug", and a screen's JSX is where it is easiest
// to forget one.

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const B = "../components/business/";
const screens = {
  "the inventory panel": B + "inventory-panel.tsx",
  "the product form": B + "inventory-item-dialog.tsx",
  "the stock dialog": B + "inventory-stock-dialog.tsx",
  "the tags dialog": B + "inventory-tags-dialog.tsx",
  "the delete dialog": B + "inventory-delete-dialog.tsx",
  "the void dialog": B + "inventory-void-dialog.tsx",
  "the sales list": B + "inventory-sales-list.tsx",
  "the summary card": B + "inventory-summary-card.tsx",
  "the product detail": B + "inventory-item-detail.tsx",
  "the public tag page": "../components/item-tag-page.tsx",
} as const;
const sources = Object.fromEntries(Object.entries(screens).map(([name, path]) => [name, read(path)])) as Record<keyof typeof screens, string>;
const allSource = Object.values(sources).join("\n");
const businessDataSource = read("./business-data.ts");

// ---------------------------------------------------------------------------
// Every string on the new screens is in the French dictionary.
// ---------------------------------------------------------------------------

/** Spelled the same in French, or not words at all (units, symbols). */
const SAME_IN_FRENCH = new Set(["Description", "Destination", "Total", "Photo", "Note", "Code", "https://", "Laawol Digital"]);

const ATTRIBUTES_WITH_COPY = new Set(["placeholder", "title", "aria-label", "label", "alt"]);
/** Functions whose string arguments end up on screen. */
const SPEAKING_CALLS = new Set(["onFlash", "setError", "setDraftError", "setFlash", "setFlashError", "say"]);

function sourceFileOf(source: string, fileName: string) {
  return ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

/** The English a file shows: JSX text, copy attributes, and the messages its handlers raise. */
function screenStrings(source: string, fileName: string): string[] {
  const file = sourceFileOf(source, fileName);
  const found = new Set<string>();
  const add = (raw: string) => {
    const value = raw.replace(/\s+/g, " ").trim();
    if (/[A-Za-z]{2}/.test(value)) found.add(value);
  };
  /** Literals a value expression can evaluate to: either branch of a ?:, the right side of && and ||. */
  const literalsOf = (node: ts.Node | undefined): void => {
    if (!node) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) add(node.text);
    else if (ts.isParenthesizedExpression(node)) literalsOf(node.expression);
    else if (ts.isConditionalExpression(node)) { literalsOf(node.whenTrue); literalsOf(node.whenFalse); }
    else if (ts.isBinaryExpression(node)) { literalsOf(node.right); }
  };
  const optedOut = (node: ts.Node): boolean => {
    for (let at: ts.Node | undefined = node; at; at = at.parent) {
      const attrs = ts.isJsxElement(at) ? at.openingElement.attributes : ts.isJsxSelfClosingElement(at) ? at.attributes : null;
      if (attrs?.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === "data-no-translate")) return true;
    }
    return false;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isJsxText(node) && !optedOut(node)) add(node.getText().replace(/&amp;/g, "&").replace(/&apos;/g, "'"));
    if (ts.isJsxAttribute(node) && ATTRIBUTES_WITH_COPY.has(node.name.getText()) && !optedOut(node)) {
      const init = node.initializer;
      if (init && ts.isStringLiteral(init)) add(init.text);
      else if (init && ts.isJsxExpression(init)) literalsOf(init.expression);
    }
    if (ts.isJsxExpression(node) && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent)) && !optedOut(node)) literalsOf(node.expression);
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText();
      if (SPEAKING_CALLS.has(callee)) node.arguments.forEach(literalsOf);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found];
}

function missingFrench(strings: readonly string[]): string[] {
  return strings.filter((english) => {
    if (SAME_IN_FRENCH.has(english)) return false;
    return !(english in TEXT_TRANSLATIONS) && !(english in ATTRIBUTE_TRANSLATIONS);
  });
}

for (const [name, path] of Object.entries(screens)) {
  test(`every sentence on ${name} has its French`, () => {
    const strings = screenStrings(read(path), path);
    assert.ok(strings.length >= 2, "the scan found nothing to check");
    assert.deepEqual(missingFrench(strings), []);
  });
}

test("the sentences the pure module builds for the new screens have their French", () => {
  const strings: string[] = [
    ...Object.values(INVENTORY_MESSAGES),
    ...Object.values(INVENTORY_STATUS_LABELS),
    ...Object.values(INVENTORY_FILTER_LABELS),
    ...Object.values(INVENTORY_MOVEMENT_LABELS),
    ...Object.values(INVENTORY_RANGE_LABELS),
    ...Object.values(INVOICE_PAYMENT_METHOD_LABELS),
    "The tags are not ready yet. Try again in a moment.",
    "The change did not save.",
  ];
  assert.deepEqual(missingFrench(strings), []);
  // And the words really change, rather than the key mapping to itself.
  for (const english of [...Object.values(INVENTORY_MESSAGES), ...Object.values(INVENTORY_MOVEMENT_LABELS)]) {
    assert.notEqual(translateValue(english, "fr"), english, english);
  }
});

test("the strings the console's other places gained for inventory have their French", () => {
  // The sidebar entry (its label and description) and the permission chip.
  const strings = ["Inventory", "Products, stock and counter sales"];
  assert.deepEqual(missingFrench(strings), []);
  assert.equal(translateValue("Inventory", "fr"), "Inventaire");
});

test("no sentence sits under data-no-translate: only typed values, numbers and sentences already built per language", () => {
  // A translatable sentence nested in an opted-out element is never translated
  // (and never scanned above). Opted-out elements may hold expressions, and
  // text with no words in it (a ×, a dot, a dash).
  const offenders: string[] = [];
  for (const [name, source] of Object.entries(sources)) {
    const file = sourceFileOf(source, name);
    const visit = (node: ts.Node): void => {
      if (ts.isJsxElement(node) && node.openingElement.attributes.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === "data-no-translate")) {
        for (const child of node.children) {
          if (ts.isJsxText(child) && /[A-Za-z]{2}/.test(child.getText().replace(/&amp;/g, "&"))) {
            offenders.push(`${name}: ${child.getText().trim().slice(0, 60)}`);
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
  }
  assert.deepEqual(offenders, []);
});

// ---------------------------------------------------------------------------
// The wiring.
// ---------------------------------------------------------------------------

test("every callable the inventory screens use is called through httpsCallable, and nothing is client-written", () => {
  for (const [callable, name] of [
    ["createInventoryItem", "the product form"],
    ["updateInventoryItem", "the product form"],
    ["adjustInventoryStock", "the stock dialog"],
    ["archiveInventoryItem", "the inventory panel"],
    ["deleteInventoryItem", "the delete dialog"],
    ["voidInventorySale", "the void dialog"],
    ["getInventoryLabelsUrl", "the tags dialog"],
  ] as const) {
    assert.match(sources[name], new RegExp(`httpsCallable\\(functions, "${callable}"\\)`), `${callable} is not called`);
  }
  // The summary is the server's: asked for, never added up from the list on screen.
  assert.match(sources["the summary card"], /useServerTotals<SummaryResponse>\(\s*"getInventorySummary"/);
  assert.doesNotMatch(allSource, /\b(setDoc|updateDoc|addDoc|deleteDoc|writeBatch|runTransaction)\(/);
  // Counter selling is the app's: the console never records a sale.
  assert.doesNotMatch(allSource, /recordInventorySale/);
});

test("products, sales and stock history are read through the shared business hooks", () => {
  assert.match(businessDataSource, /export function useInventoryItems\(businessId: string, archived: boolean, enabled: boolean\): BusinessRowsResult \{\s*return useBusinessCollection\("inventoryItems", businessId, enabled, \{\s*pageSize: null,\s*where: \[\["archived", "==", archived\]\],/);
  assert.match(businessDataSource, /return useBusinessCollection\("inventorySales", businessId, enabled, \{ sort: "query" \}\);/);
  assert.match(businessDataSource, /return useBusinessCollection\("inventoryMovements", businessId, enabled && Boolean\(itemId\), \{\s*where: \[\["itemId", "==", itemId\]\],/);
  assert.doesNotMatch(allSource, /useBusinessCollection\(|query\(/, "screens read through the named hooks");
  assert.match(sources["the inventory panel"], /useInventoryItems\(businessId, false, enabled\)/);
  assert.match(sources["the inventory panel"], /useInventoryItems\(businessId, true, enabled && filter === "archived"\)/);
  assert.match(sources["the sales list"], /useInventorySales\(businessId, enabled\)/);
  assert.match(sources["the product detail"], /useInventoryMovements\(businessId, item\.id, enabled\)/);
});

test("the panel offers the products list, the sales list, the summary and the product's own screen", () => {
  const panel = sources["the inventory panel"];
  assert.match(panel, /<InventorySummaryCard/);
  assert.match(panel, /<InventorySalesList/);
  assert.match(panel, /<InventoryItemDetail/);
  assert.match(panel, /INVENTORY_FILTER_LABELS\[id\]/);
  for (const filter of ["all", "low", "countOff", "archived"]) {
    assert.ok(filter in { all: 1, low: 1, countOff: 1, archived: 1 });
    assert.ok(INVENTORY_FILTER_LABELS[filter as keyof typeof INVENTORY_FILTER_LABELS]);
  }
  assert.match(panel, /<InventoryDeleteDialog/);
  assert.match(panel, /<InventoryVoidDialog/);
  assert.match(panel, /<InventoryTagsDialog/);
  assert.match(panel, /<InventoryStockDialog/);
  assert.match(panel, /<InventoryItemDialog/);
});

test("the photo is a link field, never an upload", () => {
  const form = sources["the product form"];
  assert.match(form, /<span>Photo link<\/span>/);
  assert.doesNotMatch(allSource, /type="file"|uploadBytes|getStorage|ref\(storage/);
});

test("delete asks for the product's code, and an unconfirmed delete never reaches the server", () => {
  const dialog = sources["the delete dialog"];
  assert.match(dialog, /deleteConfirmationMatches\(item, typed\)/);
  assert.match(dialog, /disabled=\{busy \|\| !matches\}/);
  assert.match(dialog, /if \(!matches\) \{\s*setError\(inventoryMessage\(\["delete_not_confirmed"\]\)\);\s*return;/);
});

test("a void names what it does and keeps the sale in the list", () => {
  const dialog = sources["the void dialog"];
  assert.match(dialog, /voidConsequenceText\(sale\.itemCount, lang\)/);
  assert.match(dialog, /voidInventorySaleRequest\(businessId, sale\.id, reason\)/);
  // The list marks it instead of dropping it, and offers Void only on a live sale.
  const list = sources["the sales list"];
  assert.match(list, /\{!sale\.voided && \(\s*<button/);
  assert.match(list, /sale\.voided && <span className=\{statusPillClass\("muted"\)\}>Voided<\/span>/);
});

test("the sales list shows the list price next to the sold price, and who sold", () => {
  const list = sources["the sales list"];
  assert.match(list, /<th>List price<\/th><th>Sold at<\/th>/);
  assert.match(list, /moneyText\(line\.listPriceCents\)/);
  assert.match(list, /moneyText\(line\.soldPriceCents\)/);
  assert.match(list, /staffName\(sale\.soldByStaffId\)/);
});

test("every async action disables repeat activation and shows progress", () => {
  for (const name of ["the product form", "the stock dialog", "the tags dialog", "the delete dialog", "the void dialog"] as const) {
    assert.match(sources[name], /aria-busy=\{busy\}/, name);
    assert.match(sources[name], /className="spin"/, name);
  }
});

test("Inventory is a service, a staff permission, and a sidebar tab gated on both", () => {
  assert.ok((BUSINESS_SERVICE_IDS as readonly string[]).includes("inventory"));
  const tab = businessSidebarTabs.find((entry) => entry.id === "inventory");
  assert.equal(tab?.service, "inventory");
  assert.equal(tab?.permission, "inventory");
  const admin = read("../components/admin-console.tsx");
  assert.match(admin, /\{ id: "inventory", label: "Inventory" \},\n\];/);
  assert.match(admin, /"containers",\n  "inventory",\n\] as const;/);
  assert.match(admin, /inventory: "inventory",\n\};/);
  const people = read("../components/business/profile-support-people.tsx");
  assert.match(people, /\{id: "inventory", label: "Inventory"\}/);
  assert.match(people, /inventory: "inventory",\n\};/);
  const consoleSource = read("../components/business-console.tsx");
  assert.match(consoleSource, /activeTab === "inventory" && \(\s*<InventoryPanel/);
  assert.match(consoleSource, /inventory: <Boxes \{\.\.\.props\} \/>/);
  // The preview business shows the tab.
  assert.match(read("../components/console-router.tsx"), /"carParking",\n    "inventory",\n  \],\n\};/);
});

test("a new business does not start with Inventory switched on", () => {
  const admin = read("../components/admin-console.tsx");
  assert.match(admin, /const defaultBusinessServiceIds = businessServices\s*\.filter\(\(service\) => service\.id !== "inventory"\)/);
  assert.equal((admin.match(/defaultBusinessServiceIds/g) ?? []).length, 4);
});

// ---------------------------------------------------------------------------
// The platform admin's Inventory switch on an existing business.
// ---------------------------------------------------------------------------

test("the admin console's business view has an Inventory service switch that calls the callable through runAction", () => {
  const admin = read("../components/admin-console.tsx");
  const header = admin.slice(admin.indexOf('<div className="workspace-head-actions">'), admin.indexOf('<div className="workspace-kpis">'));
  assert.ok(header.length > 200, "the business header was not found");
  assert.match(header, /className="inventory-service-switch"/);
  assert.match(header, /aria-label="Inventory service"/);
  // It shows the live state and offers the opposite action.
  assert.match(header, /inventoryOn \? "Inventory is on" : "Inventory is off"/);
  assert.match(header, /inventoryOn \? "Switch Inventory off" : "Switch Inventory on"/);
  // Through runAction, with a success message and an English + French confirmation.
  assert.match(header, /runAction\(\s*inventoryOn \? "Inventory switched off" : "Inventory switched on"/);
  assert.match(header, /switchInventoryService\(!inventoryOn\)/);
  const switchBlock = header.slice(header.indexOf('className="inventory-service-switch"'));
  assert.equal((switchBlock.match(/confirmFr:/g) ?? []).length, 2);
  assert.equal((switchBlock.match(/confirm:/g) ?? []).length, 2);
  // Not offered for a business that has no profile document to change.
  assert.match(header, /\{!inferred && \(\s*<div\s+className="inventory-service-switch"/);
  // The call itself, and the live row it reads from.
  assert.match(admin, /const inventoryOn = businessHasInventory\(business\);/);
  assert.match(admin, /httpsCallable\(\s*functions,\s*"setBusinessInventoryService",\s*\)\(setBusinessInventoryRequest\(business\.id, enabled\)\)/);
});

test("the switch is in the admin console only, and the owner's own console never calls it", () => {
  const callers = [
    ["../components/business-console.tsx", false],
    ["../components/business/profile-support-people.tsx", false],
    ["../components/business/inventory-panel.tsx", false],
    ["../components/admin-console.tsx", true],
  ] as const;
  for (const [path, expected] of callers) {
    assert.equal(read(path).includes("setBusinessInventoryService"), expected, path);
  }
  // The featured-business editor still hides the Inventory checkbox: this switch is the only way.
  assert.match(read("../components/admin-console.tsx"), /businessServices\.filter\(\(service\) => service\.id !== "inventory"\)\.map/);
});

test("a business that asked for Inventory shows a Requested Inventory badge until it is on", () => {
  // The helper: only a literal true counts, and only while the service is still off.
  assert.equal(businessRequestedInventory({ requestedInventory: true, enabledServices: ["freight"] }), true);
  assert.equal(businessRequestedInventory({ requestedInventory: true }), true);
  assert.equal(businessRequestedInventory({ requestedInventory: true, enabledServices: ["freight", "inventory"] }), false);
  assert.equal(businessRequestedInventory({ requestedInventory: false, enabledServices: ["freight"] }), false);
  assert.equal(businessRequestedInventory({ enabledServices: ["freight"] }), false);
  for (const bad of ["true", 1, "yes", {}, null]) {
    assert.equal(businessRequestedInventory({ requestedInventory: bad }), false, String(bad));
  }
  assert.equal(businessRequestedInventory(null), false);
  assert.equal(businessRequestedInventory(undefined), false);

  // Shown in the businesses list and next to the switch in the business detail.
  const admin = read("../components/admin-console.tsx");
  assert.equal((admin.match(/businessRequestedInventory\(business\)/g) ?? []).length, 2);
  const list = admin.slice(admin.indexOf("className={`master-row "), admin.indexOf("{open > 0 &&"));
  assert.match(list, /businessRequestedInventory\(business\)[\s\S]*Requested Inventory/);
  const header = admin.slice(admin.indexOf('className="inventory-service-switch"'));
  assert.match(header.slice(0, header.indexOf("Switch Inventory off")), /businessRequestedInventory\(business\)[\s\S]*Requested Inventory/);
  // It is a read-only badge: the console never writes the flag or adds the service from it.
  assert.equal(/requestedInventory\s*:/.test(admin), false);
  // The French for it.
  assert.deepEqual(missingFrench(["Requested Inventory"]), []);
  assert.equal(translateValue("Requested Inventory", "fr"), "Inventaire demandé");
});

test("the Inventory switch sentences have their French", () => {
  const strings = [
    "Inventory service",
    "Inventory is on",
    "Inventory is off",
    "Switch Inventory on",
    "Switch Inventory off",
    "Inventory switched on",
    "Inventory switched off",
  ];
  assert.deepEqual(missingFrench(strings), []);
  for (const english of strings) assert.notEqual(translateValue(english, "fr"), english, english);
  // The aria-label is read as an attribute, so it is in that dictionary too.
  assert.ok("Inventory service" in ATTRIBUTE_TRANSLATIONS);
  // The confirmations carry their own French (confirmFr), so they are not dictionary entries.
  const admin = read("../components/admin-console.tsx");
  assert.match(admin, /confirmFr: `Désactiver l’inventaire pour /);
  assert.match(admin, /confirmFr: `Activer l’inventaire pour /);
});

// ---------------------------------------------------------------------------
// The public tag page.
// ---------------------------------------------------------------------------

test("a tag's link opens a plain notice in English and French, with no product data", () => {
  assert.equal(ITEM_TAG_NOTICE, "This tag is for the shop's staff. Open it in the Laawol app.");
  assert.equal(
    translateValue(ITEM_TAG_NOTICE, "fr"),
    "Cette étiquette est réservée au personnel du magasin. Ouvrez-la dans l’application Laawol.",
  );
  const page = sources["the public tag page"];
  assert.match(page, /<p>\{ITEM_TAG_NOTICE\}<\/p>/);
  // It reads nothing: no Firebase, no address, no code, no sign-in.
  assert.doesNotMatch(page, /firebase|location|search|useSearchParams|pathname|Firestore|httpsCallable/i);
  // The two store buttons are the ones already translated.
  for (const link of [...storeLinksFor("desktop")]) assert.ok(link.label in TEXT_TRANSLATIONS, link.label);
});

test("the router shows the tag page straight away, ahead of the sign-in boot", () => {
  const router = read("../components/console-router.tsx");
  assert.match(router, /if \(serviceIntent === "item-tag"\) return <ItemTagPage \/>;/);
  assert.ok(router.indexOf('if (serviceIntent === "item-tag")') < router.indexOf("if (booting)"));
  assert.match(router, /customerServiceFromLocation\(window\.location\.pathname, window\.location\.search\)|customerServiceFromLocation\(\s*window\.location\.pathname,\s*window\.location\.search,?\s*\)/);
});

test("/i/<CODE> redirects to the notice without carrying the code, and the app claims /i/ like /t/", () => {
  const htaccess = readFileSync(new URL("../../public/.htaccess", import.meta.url), "utf8");
  assert.match(htaccess, /RewriteRule \^i\/\(\[A-Za-z0-9-\]\{4,40\}\)\/\?\$ \/\?service=item-tag \[R=302,L\]/);
  // The tracking rule is untouched.
  assert.match(htaccess, /RewriteRule \^t\/\(\[A-Za-z0-9-\]\{4,40\}\)\/\?\$ \/\?service=tracking&code=\$1 \[R=302,L,QSA\]/);
  const aasa = JSON.parse(readFileSync(new URL("../../public/.well-known/apple-app-site-association", import.meta.url), "utf8")) as {
    applinks: { details: Array<{ appIDs: string[]; components: Array<{ "/": string }> }> };
  };
  const paths = aasa.applinks.details.flatMap((detail) => detail.components.map((component) => component["/"]));
  assert.deepEqual(paths, ["/t/*", "/i/*"]);
});
