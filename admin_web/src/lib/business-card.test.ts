import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CARD_ACCENTS,
  CARD_COLORS,
  CARD_LINK_BASE,
  CARD_PHOTOS,
  CARD_SERVICE_MAX,
  CARD_SERVICES_MAX,
  CARD_STYLES,
  CARD_TAGLINE_MAX,
  DEFAULT_CARD_SETTINGS,
  cardAddress,
  cardCodeFromLocation,
  cardDial,
  cardEmbedFromSearch,
  cardFlipLabel,
  cardInitials,
  cardLink,
  cardName,
  cardPathRedirect,
  cardQr,
  cardServiceIcon,
  cardServiceLines,
  cardTagline,
  cardTitle,
  normalizeCardCode,
  readBusinessCard,
  readCardSettings,
  vcardFileName,
  vcardText,
  websiteHref,
  websiteLabel,
  type BusinessCardData,
} from "./business-card.ts";
import { customerServiceFromLocation } from "./customer-service-intent.ts";
import { serviceEntryApplies } from "./console-routing.ts";

// Business cards (docs/BUSINESS_CARDS.md): the part with no drawing in it.

const sample = (): BusinessCardData => ({
  code: "K7M4P2XB",
  link: "https://laawoldigital.com/c/K7M4P2XB",
  person: { name: "Awa Camara", phone: "+13475550142" },
  business: {
    businessId: "sahel_auto_sales",
    name: "Sahel Auto Sales",
    phone: "+1 3475550100",
    website: "https://www.sahelauto.example/",
    addressLine1: "12 Example Ave",
    city: "Bronx",
    state: "NY",
    postalCode: "10457",
    logoUrl: "https://img.example/logo.jpg",
    requestSlug: "sahel",
    services: ["carSales", "carParking", "barrelShipping", "sharedBarrels"],
  },
  settings: { ...DEFAULT_CARD_SETTINGS },
});

test("the choices a business may make are the server's, word for word", () => {
  const server = readFileSync("../my_flutter_app/functions/business_cards.js", "utf8");
  const list = (name: string) => {
    const match = new RegExp(`const ${name} = Object\\.freeze\\(\\[([^\\]]+)\\]\\)`).exec(server);
    assert.ok(match, `${name} moved in business_cards.js`);
    return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };
  const number = (name: string) => {
    const match = new RegExp(`const ${name} = (\\d+);`).exec(server);
    assert.ok(match, `${name} moved in business_cards.js`);
    return Number(match[1]);
  };
  assert.deepEqual(list("CARD_STYLES"), [...CARD_STYLES]);
  assert.deepEqual(list("CARD_COLORS"), Object.keys(CARD_COLORS));
  assert.deepEqual(list("CARD_ACCENTS"), Object.keys(CARD_ACCENTS));
  assert.deepEqual(list("CARD_PHOTOS"), [...CARD_PHOTOS]);
  assert.equal(number("CARD_TAGLINE_MAX"), CARD_TAGLINE_MAX);
  assert.equal(number("CARD_SERVICE_MAX"), CARD_SERVICE_MAX);
  assert.equal(number("CARD_SERVICES_MAX"), CARD_SERVICES_MAX);
  assert.ok(server.includes(`const CARD_LINK_BASE = "${CARD_LINK_BASE}";`));
});

test("a card code is read from the path or the query, in any case", () => {
  assert.equal(normalizeCardCode(" k7m4p2xb "), "K7M4P2XB");
  assert.equal(normalizeCardCode("K7M4P2XO"), "");
  assert.equal(normalizeCardCode(null), "");
  assert.equal(cardCodeFromLocation("/c/k7m4p2xb/", ""), "K7M4P2XB");
  assert.equal(cardCodeFromLocation("/", "?service=business-card&c=K7M4P2XB"), "K7M4P2XB");
  assert.equal(cardCodeFromLocation("/c/short", ""), "");
  assert.equal(cardLink("k7m4p2xb"), "https://laawoldigital.com/c/K7M4P2XB");
  assert.equal(cardPathRedirect("/c/K7M4P2XB"), "/?service=business-card&c=K7M4P2XB");
  assert.equal(cardPathRedirect("/c/K7M4P2XO"), "");
  assert.equal(cardPathRedirect("/r/sahel"), "");
});

test("a card's link opens the card for everyone, signed in or not", () => {
  assert.equal(customerServiceFromLocation("/c/K7M4P2XB", ""), "business-card");
  assert.equal(customerServiceFromLocation("/", "?service=business-card&c=K7M4P2XB"), "business-card");
  for (const kind of [null, "customer", "business", "admin"] as const) {
    assert.equal(serviceEntryApplies("business-card", kind), true, String(kind));
  }
  assert.equal(serviceEntryApplies("business-card", "unsupported"), false);
});

test("the public host and every console host send /c/<code> to the card", () => {
  const consoleRules = readFileSync("public/.htaccess", "utf8");
  assert.ok(
    consoleRules.includes("RewriteRule ^c/([A-Za-z0-9]{8})/?$ /?service=business-card&c=$1 [R=302,L]"),
  );
  const siteRules = readFileSync("../public_site/.htaccess", "utf8");
  assert.ok(
    siteRules.includes(
      "RewriteRule ^c/([A-Za-z0-9]{8})/?$ https://customer.laawoldigital.com/c/$1 [R=302,L]",
    ),
  );
});

test("a US number prints the US way and gets both buttons", () => {
  assert.deepEqual(cardDial("+13475550142"), {
    display: "(347) 555-0142",
    tel: "tel:+13475550142",
    whatsApp: "https://wa.me/13475550142",
  });
  assert.equal(cardDial("+1 3475550100").display, "(347) 555-0100");
  assert.equal(cardDial("347 555 0142").whatsApp, "https://wa.me/13475550142");
  assert.equal(cardDial("1 (347) 555-0142").tel, "tel:+13475550142");
  // The country code typed twice, as one account has it.
  assert.deepEqual(cardDial("+1 13475550142"), {
    display: "(347) 555-0142",
    tel: "tel:+13475550142",
    whatsApp: "https://wa.me/13475550142",
  });
});

test("a number from another country keeps its own form, and WhatsApp only with its +", () => {
  assert.deepEqual(cardDial("+224 622 00 11 22"), {
    display: "+224 622 00 11 22",
    tel: "tel:+224622001122",
    whatsApp: "https://wa.me/224622001122",
  });
  assert.deepEqual(cardDial("622 00 11 22"), { display: "622 00 11 22", tel: "tel:622001122", whatsApp: null });
  assert.deepEqual(cardDial(""), { display: "", tel: null, whatsApp: null });
  assert.deepEqual(cardDial("12"), { display: "", tel: null, whatsApp: null });
});

test("the line under the name is the owner's, else the services in the reader's language", () => {
  const card = sample();
  assert.equal(cardTagline(card, "en"), "Car sales · Parking · Shipping");
  assert.equal(cardTagline(card, "fr"), "Vente de voitures · Stationnement · Expédition");
  card.settings.tagline = "Car Sales • Parking • Shipping";
  assert.equal(cardTagline(card, "fr"), "Car Sales • Parking • Shipping");
  card.business.services = [];
  card.settings.tagline = "";
  assert.equal(cardTagline(card, "en"), "");
});

test("the services on the back are the owner's six lines, else what is switched on", () => {
  const card = sample();
  assert.deepEqual(cardServiceLines(card, "en"), [
    "Buy and sell cars",
    "Car parking",
    "Package and barrel shipping",
  ]);
  card.settings.services = ["1", "2", "3", "4", "5", "6", "7"];
  assert.equal(cardServiceLines(card, "en").length, 6);
});

test("each service line gets the picture its words ask for", () => {
  assert.equal(cardServiceIcon("Buy & Sell Cars"), "car");
  assert.equal(cardServiceIcon("Car Parking"), "parking");
  assert.equal(cardServiceIcon("Vehicle Shipping by Container"), "ship");
  assert.equal(cardServiceIcon("Package Shipping by Container"), "package");
  assert.equal(cardServiceIcon("Air Freight Shipping"), "plane");
  assert.equal(cardServiceIcon("Export Support"), "globe");
  assert.equal(cardServiceIcon("Stationnement de voitures"), "parking");
  assert.equal(cardServiceIcon("Expédition de colis et de barils"), "package");
  assert.equal(cardServiceIcon("Fret aérien"), "plane");
});

test("website, address, title and initials read as a card prints them", () => {
  const card = sample();
  assert.equal(websiteLabel(card.business.website), "sahelauto.example");
  assert.equal(websiteHref(card.business.website), "https://sahelauto.example");
  assert.equal(websiteHref("call us"), null);
  assert.equal(cardAddress(card.business), "12 Example Ave, Bronx, NY 10457");
  assert.equal(cardAddress({ ...card.business, addressLine1: "", postalCode: "" }), "Bronx, NY");
  assert.equal(cardTitle(card), "Awa Camara");
  assert.equal(cardTitle({ ...card, person: null }), "Sahel Auto Sales");
  assert.equal(cardInitials("Sahel Auto Sales"), "SA");
  assert.equal(cardInitials(""), "");
});

test("Save contact hands the phone the person, both numbers and the business", () => {
  assert.equal(
    vcardText(sample()),
    [
      "BEGIN:VCARD",
      "VERSION:3.0",
      "N:Camara;Awa;;;",
      "FN:Awa Camara",
      "ORG:Sahel Auto Sales",
      "TEL;TYPE=CELL:+13475550142",
      "TEL;TYPE=WORK:+13475550100",
      "URL:https://sahelauto.example",
      "ADR;TYPE=WORK:;;12 Example Ave;Bronx;NY;10457;",
      "NOTE:https://laawoldigital.com/c/K7M4P2XB",
      "END:VCARD",
      "",
    ].join("\r\n"),
  );
  assert.equal(vcardFileName(sample()), "awa-camara.vcf");
});

test("a business's own card is saved as a company, and odd characters cannot break the file", () => {
  const card = sample();
  card.person = null;
  card.business.name = "Diallo; Frères, SARL";
  const text = vcardText(card);
  assert.ok(text.includes(String.raw`FN:Diallo\; Frères\, SARL` + "\r\n"));
  assert.ok(text.includes("X-ABShowAs:COMPANY\r\n"));
  assert.ok(!text.includes("TYPE=CELL"));
  assert.equal(vcardFileName(card), "diallo-freres-sarl.vcf");
  // One number, not the same number twice.
  const same = sample();
  same.person = { name: "Yao", phone: "(347) 555-0100" };
  assert.equal(vcardText(same).match(/TEL;/g)?.length, 1);
});

test("the QR is a square of runs that covers the three corner eyes", () => {
  const qr = cardQr("https://laawoldigital.com/c/K7M4P2XB");
  // A card link is short: the code stays coarse enough to scan at card size.
  assert.ok(qr.size <= 33, `too dense: ${qr.size}`);
  assert.ok(qr.path.startsWith("M0 0h7v1h-7z"));
  assert.ok(qr.path.includes(`M${qr.size - 7} 0h7v1h-7z`));
  assert.ok(qr.path.includes(`M0 ${qr.size - 1}h7v1h-7z`));
  assert.equal(cardQr("https://laawoldigital.com/c/K7M4P2XB").path, qr.path);
});

test("a name typed all in capitals or all small gets a capital per word; a mixed one is left alone", () => {
  assert.equal(cardName("SAHEL AUTO SALES"), "Sahel Auto Sales");
  assert.equal(cardName("awa camara"), "Awa Camara");
  assert.equal(cardName("  jean-pierre  o'neil "), "Jean-Pierre O'Neil");
  assert.equal(cardName("ÉLISE N'DIAYE"), "Élise N'Diaye");
  assert.equal(cardName("DHL Express"), "DHL Express");
  assert.equal(cardName("McDonald Shipping"), "McDonald Shipping");
  assert.equal(cardName("B&B CARGO"), "B&B Cargo");
  assert.equal(cardName(""), "");
  assert.equal(cardName("2024"), "2024");
});

test("whatever the server sends, a card still draws", () => {
  assert.deepEqual(readCardSettings({ style: "neon", color: 3, services: "x" }), DEFAULT_CARD_SETTINGS);
  assert.equal(readBusinessCard(null), null);
  assert.equal(readBusinessCard({ code: "nope", business: {} }), null);
  const card = readBusinessCard({
    code: "k7m4p2xb",
    person: { name: "", phone: "+1347" },
    business: { name: "Sahel Auto Sales", services: ["carSales", 7] },
    settings: { style: "signature", color: "navy", photo: "car" },
  });
  assert.ok(card);
  assert.equal(card.code, "K7M4P2XB");
  assert.equal(card.person, null);
  assert.deepEqual(card.business.services, ["carSales", "7"]);
  assert.equal(card.settings.style, "signature");
  assert.equal(card.settings.accent, "red");
  // An address typed in small letters prints with its capitals.
  const typed = readBusinessCard({
    code: "K7M4P2XB",
    business: { name: "x", addressLine1: "12 example ave", city: "bronx", state: "NY", postalCode: "10457" },
  });
  assert.ok(typed);
  assert.equal(cardAddress(typed.business), "12 Example Ave, Bronx, NY 10457");
});

test("the embed form of the card page is only on with embed=1, and names its language", () => {
  assert.deepEqual(cardEmbedFromSearch("?service=business-card&c=K7M4P2XB"), { embed: false, lang: null });
  assert.deepEqual(cardEmbedFromSearch("?service=business-card&c=K7M4P2XB&embed=1"), { embed: true, lang: null });
  assert.deepEqual(cardEmbedFromSearch("?embed=1&lang=fr"), { embed: true, lang: "fr" });
  assert.deepEqual(cardEmbedFromSearch("?embed=1&lang=EN"), { embed: true, lang: "en" });
  assert.deepEqual(cardEmbedFromSearch("?embed=1&lang=de"), { embed: true, lang: null });
  assert.deepEqual(cardEmbedFromSearch("?embed=true"), { embed: false, lang: null });
  // A language on the normal page changes nothing.
  assert.deepEqual(cardEmbedFromSearch("?lang=fr"), { embed: false, lang: null });
  assert.equal(cardFlipLabel("fr"), "Retourner la carte");
  assert.equal(cardFlipLabel("en"), "Turn the card over");
});
