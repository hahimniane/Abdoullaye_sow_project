// Regression tests for the DOM side of the French translation engine:
// user-entered content must never be translated, the reverse map must be
// unambiguous, server-written History sentences must translate without
// touching the names inside them, and the dictionary must stay out of the
// entry bundle.

import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { runInNewContext } from "node:vm";

import { translateAuditSummary } from "./audit-summaries.ts";
import {
  ATTRIBUTE_TRANSLATIONS,
  REVERSE_PREFERENCES,
  TEXT_TRANSLATIONS,
  ambiguousReverseTranslations,
  translateAuditValue,
  translateMutations,
  translateSubtree,
  translateValue,
  type DomElement,
  type DomNode,
} from "./french-dom.ts";
import { LANGUAGE_BOOT_SCRIPT, resolveLang } from "./language.ts";

// --- A DOM small enough to read --------------------------------------------

class FakeText implements DomNode {
  nodeType = 3;
  parentElement: FakeElement | null = null;
  textContent: string;
  constructor(textContent: string) {
    this.textContent = textContent;
  }
}

class FakeElement implements DomElement {
  nodeType = 1;
  parentElement: FakeElement | null = null;
  childNodes: Array<FakeElement | FakeText> = [];
  attributes = new Map<string, string>();
  tagName: string;
  constructor(tagName: string, attrs: Record<string, string> = {}, children: Array<FakeElement | FakeText | string> = []) {
    this.tagName = tagName;
    for (const [name, value] of Object.entries(attrs)) this.attributes.set(name, value);
    for (const child of children) this.append(typeof child === "string" ? new FakeText(child) : child);
  }
  append(child: FakeElement | FakeText) {
    child.parentElement = this;
    this.childNodes.push(child);
    return child;
  }
  get textContent(): string {
    return this.childNodes.map((child) => child.textContent).join("");
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
}

const h = (tag: string, attrs: Record<string, string> = {}, ...children: Array<FakeElement | FakeText | string>) =>
  new FakeElement(tag, attrs, children);

// --- User data is never translated ------------------------------------------

test("a data-no-translate subtree keeps text and attributes exactly as typed", () => {
  const name = h("strong", { "data-no-translate": "" }, "Cancelled");
  const note = h("p", { "data-no-translate": "", title: "Pickup" }, h("span", {}, "Pickup"));
  const label = h("span", {}, "Cancelled");
  const root = h("div", {}, label, name, note, h("input", { placeholder: "Phone number" }));
  translateSubtree(root, "fr");

  assert.equal(label.textContent, "Annulé", "UI copy still translates");
  assert.equal(name.textContent, "Cancelled", "a customer's typed text is untouched");
  assert.equal(note.textContent, "Pickup");
  assert.equal(note.getAttribute("title"), "Pickup");
  assert.equal((root.childNodes[3] as FakeElement).getAttribute("placeholder"), "Numéro de téléphone");
});

test("translate=\"no\" below <html> opts out too, but <html translate=\"no\"> does not", () => {
  const user = h("td", { translate: "no" }, "Delivered");
  const copy = h("td", {}, "Delivered");
  const html = h("html", { translate: "no" }, h("body", {}, user, copy));
  translateSubtree(html, "fr");
  assert.equal(user.textContent, "Delivered");
  assert.notEqual(copy.textContent, "Delivered");
});

test("scripts, styles and text areas are never rewritten", () => {
  const script = h("script", {}, "Cancelled");
  const style = h("style", {}, "Cancelled");
  const textarea = h("textarea", {}, "Cancelled");
  translateSubtree(h("div", {}, script, style, textarea), "fr");
  assert.equal(script.textContent, "Cancelled");
  assert.equal(style.textContent, "Cancelled");
  assert.equal(textarea.textContent, "Cancelled");
});

test("the observer path honors the opt-out for added nodes and text edits", () => {
  const protectedCell = h("td", { "data-no-translate": "" });
  const openCell = h("td", {});
  h("tr", {}, protectedCell, openCell);

  const typed = protectedCell.append(new FakeText("Pending")) as FakeText;
  const nested = h("span", {}, "Pending");
  protectedCell.append(nested);
  const copy = openCell.append(new FakeText("Pending")) as FakeText;
  translateMutations(
    [
      { type: "childList", target: protectedCell, addedNodes: [typed, nested] },
      { type: "childList", target: openCell, addedNodes: [copy] },
    ],
    "fr",
  );
  assert.equal(typed.textContent, "Pending");
  assert.equal(nested.textContent, "Pending");
  assert.notEqual(copy.textContent, "Pending");

  typed.textContent = "Completed";
  translateMutations([{ type: "characterData", target: typed, addedNodes: [] }], "fr");
  assert.equal(typed.textContent, "Completed");
});

test("money in a translation is not read as a replacement pattern", () => {
  const cell = h("small", { "data-audit-summary": "" }, "  Paid $45.00 on the website  ");
  translateSubtree(h("div", {}, cell), "fr");
  assert.equal(cell.textContent, "  Payé $45.00 sur le site web  ");
});

// --- Reverse map -------------------------------------------------------------

test("every French value with two English sources names its English", () => {
  const unresolved = ambiguousReverseTranslations(TEXT_TRANSLATIONS, ATTRIBUTE_TRANSLATIONS)
    .filter(([french, sources]) => !sources.includes(REVERSE_PREFERENCES[french] ?? "\u0000"))
    .map(([french, sources]) => `${JSON.stringify(french)} <= ${JSON.stringify(sources)}`);
  assert.deepEqual(
    unresolved,
    [],
    "These French values come from more than one English string. Add each to " +
      "REVERSE_PREFERENCES in french-dom.ts with the English it should read as:\n" +
      unresolved.join("\n"),
  );
});

test("every reverse preference is for a real ambiguity", () => {
  const ambiguous = new Set(
    ambiguousReverseTranslations(TEXT_TRANSLATIONS, ATTRIBUTE_TRANSLATIONS).map(([french]) => french),
  );
  const stale = Object.keys(REVERSE_PREFERENCES).filter((french) => !ambiguous.has(french));
  assert.deepEqual(stale, [], "Remove preferences that no longer resolve anything.");
});

test("Annulé reads as Cancelled, not Reverted", () => {
  assert.equal(translateValue("Annulé", "en"), "Cancelled");
  assert.equal(translateValue("Paiement annulé", "en"), "Payment cancelled");
  assert.equal(translateValue("Terminé", "en"), "Completed");
  for (const [french, english] of Object.entries(REVERSE_PREFERENCES)) {
    assert.equal(translateValue(french, "en"), english);
  }
});

// --- Server-written History sentences ---------------------------------------

test("container History sentences translate around the typed values", () => {
  const cases: Array<[string, string]> = [
    ["Shipped with 12 lines", "Expédié avec 12 lignes"],
    ["Shipped with 1 line", "Expédié avec 1 ligne"],
    ["Marked arrived", "Marqué comme arrivé"],
    ["Started Sailing 3 Oct, box 2", "Début du chargement : Sailing 3 Oct, box 2"],
    ["Added 3 barrels for Awa Diallo, to Moussa Ba", "Ajout de 3 barils pour Awa Diallo, destinataire Moussa Ba"],
    ["Added car 1HGCM82633A004352 for Pickup Express", "Ajout de la voiture 1HGCM82633A004352 pour Pickup Express"],
    ["Added 2 × tires (business stock)", "Ajout de 2 × tires (stock de l’entreprise)"],
    ["Removed 1 barrel", "Retrait de 1 baril"],
    ["Removed a line", "Retrait d’une ligne"],
    ["Moved car 1HG to MSKU1234567", "Déplacement de la voiture 1HG vers MSKU1234567"],
    ["Received 2 barrels from Box 1", "Réception de 2 barils depuis Box 1"],
    ["Changed receiver's phone for Awa Diallo", "Modification : téléphone du destinataire pour Awa Diallo"],
    ["Changed customer's name, receiver's WhatsApp updates", "Modification : nom du client, mises à jour WhatsApp du destinataire"],
    ["Changed label, notes", "Modification : nom, notes"],
    // updateContainerLine (container_manifest.js containerLineEditAudit).
    ["Edited 5 barrels (was 3 barrels): quantity for Fatou", "Modification de 5 barils (auparavant 3 barils) : quantité pour Fatou"],
    ["Edited car 1HGCM82633A004352: make, model for Pickup Express", "Modification de la voiture 1HGCM82633A004352 : marque, modèle pour Pickup Express"],
    ["Edited 1 barrel (was car 1HGCM82633A004352): kind, owner (business stock)", "Modification de 1 baril (auparavant la voiture 1HGCM82633A004352) : type, propriétaire (stock de l’entreprise)"],
    ["Edited 2 × tires (was 3 barrels): kind, receiver's phone for Awa", "Modification de 2 × tires (auparavant 3 barils) : type, téléphone du destinataire pour Awa"],
    ["Edited car 2T1BURHE0JC123456 (was car 1HGCM82633A004352): VIN, year, customer's name for Awa Diallo", "Modification de la voiture 2T1BURHE0JC123456 (auparavant la voiture 1HGCM82633A004352) : VIN, année, nom du client pour Awa Diallo"],
    ["Edited 3 barrels: description", "Modification de 3 barils : description"],
    ["Deleted Box 7", "Suppression de Box 7"],
    ["Carrier reported Discharged at terminal", "Le transporteur signale : Déchargé au terminal"],
  ];
  for (const [english, french] of cases) {
    assert.equal(translateAuditSummary(english), french, english);
  }
});

test("ledger and invoice History sentences translate", () => {
  const cases: Array<[string, string]> = [
    ["Marked paid — 45 (Zelle transfer)", "Marqué comme payé — 45 (Virement Zelle)"],
    ["Set back to not paid — $40.00 removed — wrong car", "Remis à non payé — $40.00 retiré — wrong car"],
    ["Part payment of $20.00 on the website, $5.00 still owed", "Paiement partiel de $20.00 sur le site web, $5.00 encore dû"],
    ["Paid $45.00 on the website", "Payé $45.00 sur le site web"],
    ["Final payment of $10.00 - settled", "Paiement final de $10.00 - soldé"],
    ["Part payment of $10.00, $5.00 still owed", "Paiement partiel de $10.00, $5.00 encore dû"],
    ["Marked as not received — counted twice", "Marqué comme non reçu — counted twice"],
    ["Marked as received", "Marqué comme reçu"],
    ["Voided — duplicate", "Invalidé — duplicate"],
    ["Edited — nothing changed", "Modifié — rien n’a changé"],
    ["Opened INV-0007 — Shipping for Awa Diallo", "Ouverture de INV-0007 — Shipping pour Awa Diallo"],
    ["Removed a line ($0.00) from INV-0007", "Retrait d’une ligne ($0.00) de INV-0007"],
    ["Added 2 × Barrel (Cancelled) ($90.00) to INV-0007", "Ajout de 2 × Barrel (Cancelled) ($90.00) à INV-0007"],
    ["Received $50.00 (cash) on INV-0007 — paid in full", "Reçu $50.00 (espèces) sur INV-0007 — payé en totalité"],
    ["Reverted a $50.00 payment on INV-0007", "Annulation d’un paiement de $50.00 sur INV-0007"],
    ["customerName Awa → Awa Ba (+2 more)", "customerName Awa → Awa Ba (+2 de plus)"],
  ];
  for (const [english, french] of cases) {
    assert.equal(
      translateAuditSummary(english, (value) => TEXT_TRANSLATIONS[value]),
      french,
      english,
    );
  }
});

test("an unknown History sentence is left exactly as the server wrote it", () => {
  assert.equal(translateAuditSummary("Changed the weather for Pickup"), null);
  // An edit naming a field the table does not know is left whole too.
  assert.equal(translateAuditSummary("Edited 3 barrels: colour for Pickup"), null);
  // The dictionary substring pass would have rewritten "Pickup" and "Cancelled".
  assert.equal(translateAuditValue("Something new about Pickup, Cancelled", "fr"), "Something new about Pickup, Cancelled");
  assert.equal(translateAuditValue("Voided", "fr"), "Invalidé");
  assert.equal(translateAuditValue("Paid $45.00 on the website", "en"), "Paid $45.00 on the website");
});

test("the consoles mark their History summaries for the audit table", () => {
  for (const file of [
    "src/components/business/containers-panel.tsx",
    "src/components/business/invoices-panel.tsx",
    "src/components/business/operations-panels.tsx",
    "src/components/business-console.tsx",
  ]) {
    const source = readFileSync(file, "utf8");
    const summaries = source.match(/\{text\((?:h|hr|ev)\.summary, ""\)\}/g) ?? [];
    const marked = source.match(/data-audit-summary[^>]*>\{text\((?:h|hr|ev)\.summary, ""\)\}/g) ?? [];
    assert.ok(summaries.length > 0, `${file} no longer renders summaries this way`);
    assert.equal(marked.length, summaries.length, `${file} renders an unmarked summary`);
  }
});

// --- User data is marked in the consoles ------------------------------------

test("the consoles mark user-entered values as data-no-translate", () => {
  const minimum: Record<string, number> = {
    "src/components/business/containers-panel.tsx": 8,
    "src/components/business/invoices-panel.tsx": 4,
    "src/components/business/operations-panels.tsx": 8,
    "src/components/support/support-cases-panel.tsx": 4,
    "src/components/admin-console.tsx": 4,
    "src/components/customer-console.tsx": 2,
  };
  for (const [file, atLeast] of Object.entries(minimum)) {
    const count = (readFileSync(file, "utf8").match(/data-no-translate|<UserText\b/g) ?? []).length;
    assert.ok(count >= atLeast, `${file} marks ${count} user values (expected at least ${atLeast})`);
  }
});

// --- The dictionary stays out of the entry bundle ---------------------------

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("nothing imports the French dictionary statically", () => {
  const offenders = sourceFiles("src").filter((file) => {
    if (file.endsWith("french-dom.ts")) return false;
    return /^\s*import[^;]*from\s+["'](?:@\/lib\/|\.\/|\.\.\/lib\/)french-dom(?:\.ts)?["']/m.test(
      readFileSync(file, "utf8"),
    );
  });
  assert.deepEqual(offenders, [], "Import useFrenchDomTranslation from @/lib/french-dom-runtime.");
  const runtime = readFileSync("src/lib/french-dom-runtime.ts", "utf8");
  assert.match(runtime, /import\("\.\/french-dom\.ts"\)/);
  assert.match(runtime, /if \(lang !== "fr"\) \{\s*revealPage\(\);/);
  // Every path reveals the page.
  assert.match(runtime, /window\.setTimeout\(revealPage, REVEAL_TIMEOUT_MS\)/);
  assert.match(runtime, /\.finally\(\(\) => \{\s*window\.clearTimeout\(safety\);\s*revealPage\(\);/);
});

test("the pre-paint script picks the same language as resolveLang", () => {
  const cases: Array<[string | null, string[], boolean]> = [
    ["fr", ["en-US"], false],
    ["en", ["fr-FR"], false],
    [" FR ", [], false],
    [null, ["fr-FR", "en-US"], false],
    [null, ["en-US", "fr-FR"], false],
    [null, ["es-ES", "fr-FR"], false],
    [null, [], false],
    ["xx", ["fr-CA"], false],
    ["fr", ["en-US"], true], // storage blocked: device language decides
  ];
  for (const [stored, languages, blocked] of cases) {
    const attributes = new Map<string, string>();
    const documentElement = {
      lang: "en",
      setAttribute: (name: string, value: string) => attributes.set(name, value),
      removeAttribute: (name: string) => attributes.delete(name),
    };
    runInNewContext(LANGUAGE_BOOT_SCRIPT, {
      document: { documentElement },
      navigator: { languages, language: languages[0] ?? "" },
      window: {
        localStorage: {
          getItem: () => {
            if (blocked) throw new Error("SecurityError");
            return stored;
          },
        },
      },
      setTimeout: () => 0,
      String,
    });
    const expected = resolveLang(blocked ? null : stored, languages);
    assert.equal(documentElement.lang, expected, JSON.stringify({ stored, languages, blocked }));
    assert.equal(attributes.has("data-lang-pending"), expected === "fr");
  }
});
