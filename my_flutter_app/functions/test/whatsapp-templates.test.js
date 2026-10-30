"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  TEMPLATE,
  TEMPLATE_SET,
  BILINGUAL_TEMPLATES,
  LEGACY_TEMPLATES,
  TEMPLATE_VARIABLES,
  TEMPLATE_BY_UPDATE,
  LEGACY_TEMPLATE_BY_UPDATE,
  TEMPLATE_SHAPE,
  TEMPLATE_LANGUAGES,
  FALLBACK,
  whatsappTemplateSet,
  templateForUpdate,
  templateComponents,
  templateMessage,
} = require("../whatsapp_templates");
const {CONFIRM_PAYLOAD} = require("../package_proof");

const VALUES = Object.freeze({
  name: "Mariama Bah",
  business: "Dala Shipping",
  what: "3 barrels",
  destination: "Guinea",
  businessPhone: "+16465550199",
  trackingCode: "CL-K7M4P2",
  whatEn: "3 barrels",
  whatFr: "3 barils",
  destinationEn: "Guinea",
  destinationFr: "Guinée",
  pickupPlaceEn: "Conakry, Guinea",
  pickupPlaceFr: "Conakry, Guinée",
  pickupAddress: "Madina, near the market",
  pickupPhone: "+224620000000",
  deliveredOnEn: "October 21, 2026",
  deliveredOnFr: "21 octobre 2026",
  collectedByEn: "Mamadou Bah",
  collectedByFr: "Mamadou Bah",
  contentsEn: "2 phones, 1 tablet",
  contentsFr: "2 phones, 1 tablet",
  weightEn: "4.2 lb",
  weightFr: "4,2 lb",
  pickupCode: "4821",
  photoLink: "https://laawoldigital.com/d?view=photo&t=tok&p=p&e=1&s=sig",
});

const bodyOf = (template, values = VALUES, language = "en") =>
  templateComponents(template, values, language)
      .find((part) => part.type === "body").parameters.map((p) => p.text);
const buttonOf = (template, values = VALUES, language = "en") =>
  templateComponents(template, values, language)
      .find((part) => part.type === "button");
const ALL_TEMPLATES = [...BILINGUAL_TEMPLATES, ...LEGACY_TEMPLATES];
// Every template but the confirmation carries the tracking URL button.
const URL_BUTTON_TEMPLATES = ALL_TEMPLATES.filter((template) =>
  template !== "package_confirm_2lang");

describe("which template each update sends", () => {
  it("names the bilingual and the legacy templates exactly", () => {
    assert.deepEqual([...BILINGUAL_TEMPLATES].sort(), [
      "package_confirm_2lang",
      "shipment_delivered_2lang", "shipment_departed_2lang",
      "shipment_ready_pickup_2lang", "shipment_received_2lang"]);
    assert.deepEqual([...LEGACY_TEMPLATES].sort(), [
      "container_arrived", "container_departed", "package_received"]);
    assert.deepEqual(Object.values(TEMPLATE).sort(),
        [...ALL_TEMPLATES].sort());
    assert.deepEqual(TEMPLATE_LANGUAGES, ["en", "fr"]);
  });

  // The first submission (with flags) was deleted in Meta; its names must
  // never be sent.
  it("never sends the withdrawn *_bilingual names", () => {
    for (const name of ALL_TEMPLATES) assert.ok(!/_bilingual$/.test(name));
  });

  it("sends the bilingual set by default", () => {
    assert.equal(whatsappTemplateSet({}), "bilingual");
    assert.equal(whatsappTemplateSet({WHATSAPP_TEMPLATE_SET: ""}),
        "bilingual");
    assert.equal(whatsappTemplateSet({WHATSAPP_TEMPLATE_SET: "bogus"}),
        "bilingual");
    assert.equal(whatsappTemplateSet({WHATSAPP_TEMPLATE_SET: " Legacy "}),
        "legacy");
    assert.equal(templateForUpdate("received", "bilingual"),
        "shipment_received_2lang");
    assert.equal(templateForUpdate("shipped", "bilingual"),
        "shipment_departed_2lang");
    assert.equal(templateForUpdate("arrived", "bilingual"),
        "shipment_ready_pickup_2lang");
    assert.deepEqual(TEMPLATE_BY_UPDATE, {
      received: "shipment_received_2lang",
      confirm: "package_confirm_2lang",
      shipped: "shipment_departed_2lang",
      arrived: "shipment_ready_pickup_2lang",
      delivered: "shipment_delivered_2lang",
    });
  });
  // Meta rejects a template that carries a "code to show" (it reads as an
  // authentication message), so a line with a pickupCode sends the normal
  // ready-for-pickup template; the number rides in the address parameter
  // (container_updates.pickupAddressWithCode).
  it("sends the same ready-for-pickup template with or without a code",
      () => {
        assert.equal(templateForUpdate("arrived", "bilingual"),
            "shipment_ready_pickup_2lang");
        assert.equal(templateForUpdate("arrived", "legacy"),
            "container_arrived");
        const body = templateMessage({update: "arrived",
          phone: "+224620000000", language: "fr", values: VALUES,
          templateSet: "bilingual"});
        assert.equal(body.template.name, "shipment_ready_pickup_2lang");
        assert.deepEqual(body.template.language, {code: "en"});
      });

  // The sender's confirmation has no legacy version either.
  it("sends the confirmation in both sets", () => {
    for (const set of ["bilingual", "legacy"]) {
      assert.equal(templateForUpdate("confirm", set),
          "package_confirm_2lang");
      assert.equal(templateMessage({update: "confirm",
        phone: "+224620000000", language: "fr", values: VALUES,
        templateSet: set}).template.name, "package_confirm_2lang");
    }
  });

  // Delivered has no legacy version: the bilingual message goes in both
  // sets, registered under "en" like the others.
  it("sends the delivered message in both sets", () => {
    for (const set of ["bilingual", "legacy"]) {
      assert.equal(templateForUpdate("delivered", set),
          "shipment_delivered_2lang");
      const body = templateMessage({update: "delivered",
        phone: "+224620000000", language: "fr", values: VALUES,
        templateSet: set});
      assert.equal(body.template.name, "shipment_delivered_2lang");
      assert.deepEqual(body.template.language, {code: "en"});
    }
  });

  // A box at the port is not ready for pickup: an old at_port row has no
  // bilingual message.
  it("has no bilingual message for the carrier's 'at the port'", () => {
    assert.equal(templateForUpdate("at_port", "bilingual"), null);
  });

  it("keeps the legacy set behind the switch", () => {
    assert.equal(templateForUpdate("received", "legacy"), "package_received");
    assert.equal(templateForUpdate("shipped", "legacy"),
        "container_departed");
    assert.equal(templateForUpdate("arrived", "legacy"), "container_arrived");
    // A row written before the two arrival moments shared one message.
    assert.equal(templateForUpdate("at_port", "legacy"), "container_arrived");
    assert.equal(LEGACY_TEMPLATE_BY_UPDATE.arrived, "container_arrived");
  });

  it("reads the switch from the environment when none is passed", () => {
    const before = process.env.WHATSAPP_TEMPLATE_SET;
    try {
      delete process.env.WHATSAPP_TEMPLATE_SET;
      assert.equal(templateForUpdate("arrived"),
          "shipment_ready_pickup_2lang");
      process.env.WHATSAPP_TEMPLATE_SET = TEMPLATE_SET.LEGACY;
      assert.equal(templateForUpdate("arrived"), "container_arrived");
      assert.equal(templateMessage({update: "shipped", phone: "+1",
        language: "fr", values: VALUES}).template.name, "container_departed");
    } finally {
      if (before === undefined) delete process.env.WHATSAPP_TEMPLATE_SET;
      else process.env.WHATSAPP_TEMPLATE_SET = before;
    }
  });

  it("has no message for other moments", () => {
    for (const set of ["bilingual", "legacy"]) {
      assert.equal(templateForUpdate("loading", set), null);
      assert.equal(templateForUpdate("", set), null);
      assert.equal(templateMessage({update: "customs", phone: "+1",
        templateSet: set}), null);
    }
  });

  // Regression guard: the single template this replaces must never be
  // sent again.
  it("never sends the retired container_status_update", () => {
    for (const set of ["bilingual", "legacy"]) {
      for (const update of ["received", "shipped", "at_port", "arrived"]) {
        const body = templateMessage({update, phone: "+16465550100",
          language: "en", values: VALUES, templateSet: set});
        if (!body) continue;
        assert.notEqual(body.template.name, "container_status_update");
      }
    }
  });
});

describe("the bilingual variables, in the order Meta numbered them", () => {
  it("fills shipment_received_2lang: name, then business/what/destination " +
      "in English and French, then the code", () => {
    assert.equal(TEMPLATE_VARIABLES.shipment_received_2lang.length, 8);
    assert.deepEqual(bodyOf("shipment_received_2lang"), [
      "Mariama Bah",
      "Dala Shipping", "3 barrels", "Guinea",
      "Dala Shipping", "3 barils", "Guinée",
      "CL-K7M4P2",
    ]);
  });

  it("fills shipment_departed_2lang: name, what/business/destination in " +
      "English and French, then the code", () => {
    assert.equal(TEMPLATE_VARIABLES.shipment_departed_2lang.length, 8);
    assert.deepEqual(bodyOf("shipment_departed_2lang"), [
      "Mariama Bah",
      "3 barrels", "Dala Shipping", "Guinea",
      "3 barils", "Dala Shipping", "Guinée",
      "CL-K7M4P2",
    ]);
  });

  it("fills shipment_ready_pickup_2lang: name, what/business/place in " +
      "English and French, address, phone, code", () => {
    assert.equal(TEMPLATE_VARIABLES.shipment_ready_pickup_2lang.length, 10);
    assert.deepEqual(bodyOf("shipment_ready_pickup_2lang"), [
      "Mariama Bah",
      "3 barrels", "Dala Shipping", "Conakry, Guinea",
      "3 barils", "Dala Shipping", "Conakry, Guinée",
      "Madina, near the market", "+224620000000", "CL-K7M4P2",
    ]);
  });

  it("fills package_confirm_2lang: name, business/contents/weight in " +
      "English and French, then the code", () => {
    assert.equal(TEMPLATE_VARIABLES.package_confirm_2lang.length, 8);
    assert.deepEqual(bodyOf("package_confirm_2lang"), [
      "Mariama Bah",
      "Dala Shipping", "2 phones, 1 tablet", "4.2 lb",
      "Dala Shipping", "2 phones, 1 tablet", "4,2 lb",
      "CL-K7M4P2",
    ]);
  });

  it("fills shipment_delivered_2lang: name, business/what/day/collector " +
      "in English and French, then the code", () => {
    assert.equal(TEMPLATE_VARIABLES.shipment_delivered_2lang.length, 10);
    assert.deepEqual(bodyOf("shipment_delivered_2lang"), [
      "Mariama Bah",
      "Dala Shipping", "3 barrels", "October 21, 2026", "Mamadou Bah",
      "Dala Shipping", "3 barils", "21 octobre 2026", "Mamadou Bah",
      "CL-K7M4P2",
    ]);
  });

  it("fills both languages whoever reads it, in one 'en' message", () => {
    for (const update of ["received", "confirm", "shipped", "arrived",
      "delivered"]) {
      const forFr = templateMessage({update, phone: "+224620000000",
        language: "fr", values: VALUES, templateSet: "bilingual"});
      const forEn = templateMessage({update, phone: "+16465550100",
        language: "en", values: VALUES, templateSet: "bilingual"});
      assert.deepEqual(forFr.template.language, {code: "en"});
      assert.deepEqual(forEn.template.language, {code: "en"});
      assert.deepEqual(forFr.template.components, forEn.template.components);
    }
  });
});

describe("the legacy variables, in the order Meta numbered them", () => {
  it("fills package_received: name, business, what, destination, code",
      () => {
        assert.equal(TEMPLATE_VARIABLES.package_received.length, 5);
        assert.deepEqual(bodyOf("package_received"), [
          "Mariama Bah", "Dala Shipping", "3 barrels", "Guinea", "CL-K7M4P2",
        ]);
      });

  it("fills container_departed: name, what, business, destination, code",
      () => {
        assert.equal(TEMPLATE_VARIABLES.container_departed.length, 5);
        assert.deepEqual(bodyOf("container_departed"), [
          "Mariama Bah", "3 barrels", "Dala Shipping", "Guinea", "CL-K7M4P2",
        ]);
      });

  it("fills container_arrived: name, what, business, destination, phone, " +
      "code", () => {
    assert.equal(TEMPLATE_VARIABLES.container_arrived.length, 6);
    assert.deepEqual(bodyOf("container_arrived"), [
      "Mariama Bah", "3 barrels", "Dala Shipping", "Guinea", "+16465550199",
      "CL-K7M4P2",
    ]);
  });
});

describe("every template", () => {
  it("has one URL button whose parameter is the code, except the " +
      "confirmation", () => {
    assert.deepEqual(Object.keys(TEMPLATE_SHAPE), ["package_confirm_2lang"]);
    for (const template of URL_BUTTON_TEMPLATES) {
      for (const language of TEMPLATE_LANGUAGES) {
        const parts = templateComponents(template, VALUES, language);
        assert.equal(parts.length, 2);
        assert.equal(parts[0].type, "body");
        const button = buttonOf(template, VALUES, language);
        assert.equal(button.type, "button");
        assert.equal(button.sub_type, "url");
        assert.equal(button.index, "0");
        assert.deepEqual(button.parameters,
            [{type: "text", text: "CL-K7M4P2"}]);
      }
    }
  });

  // The confirmation (docs/AIR_PACKAGES.md §3): the first drop-off photo
  // as the image header, eight body texts, and the two quick replies whose
  // payloads come back in the sender's button reply. No tracking button.
  it("sends the confirmation with an image header and two quick replies",
      () => {
        assert.deepEqual(CONFIRM_PAYLOAD,
            {OK: "confirm_ok", PROBLEM: "confirm_problem"});
        const body = templateMessage({update: "confirm",
          phone: "+1 (646) 555-0100", language: "en", values: VALUES});
        assert.deepEqual(body, {
          messaging_product: "whatsapp",
          to: "16465550100",
          type: "template",
          template: {
            name: "package_confirm_2lang",
            language: {code: "en"},
            components: [
              {type: "header", parameters: [{type: "image", image: {
                link: "https://laawoldigital.com/d?view=photo&t=tok&p=p" +
                  "&e=1&s=sig"}}]},
              {type: "body", parameters: [
                {type: "text", text: "Mariama Bah"},
                {type: "text", text: "Dala Shipping"},
                {type: "text", text: "2 phones, 1 tablet"},
                {type: "text", text: "4.2 lb"},
                {type: "text", text: "Dala Shipping"},
                {type: "text", text: "2 phones, 1 tablet"},
                {type: "text", text: "4,2 lb"},
                {type: "text", text: "CL-K7M4P2"},
              ]},
              {type: "button", sub_type: "quick_reply", index: "0",
                parameters: [{type: "payload", payload: "confirm_ok"}]},
              {type: "button", sub_type: "quick_reply", index: "1",
                parameters: [{type: "payload", payload: "confirm_problem"}]},
            ],
          },
        });
      });

  it("refuses a template it does not know rather than guessing", () => {
    for (const name of ["container_status_update",
      "shipment_received_bilingual"]) {
      assert.throws(() => templateComponents(name, VALUES, "en"),
          /Unknown WhatsApp template/);
    }
  });
});

describe("what fills a blank", () => {
  // Meta refuses a template parameter that is empty.
  it("never sends an empty parameter, in either language", () => {
    for (const template of ALL_TEMPLATES) {
      for (const language of TEMPLATE_LANGUAGES) {
        for (const values of [{}, {name: "  ", business: "\n",
          destination: null, businessPhone: undefined, trackingCode: "",
          whatFr: "\t", pickupAddress: " ", pickupPhone: ""}]) {
          const parts = templateComponents(template, values, language);
          for (const part of parts) {
            for (const p of part.parameters) {
              // The header image and the quick-reply payloads are not
              // texts; the body and the URL button are.
              if (p.type !== "text") continue;
              assert.ok(p.text.trim().length > 0,
                  `${template}/${language} sent an empty parameter`);
            }
          }
        }
      }
    }
  });

  it("uses words that read inside the bilingual sentences", () => {
    // "received your package: your package (—)"
    assert.deepEqual(bodyOf("package_confirm_2lang", {}), [
      "Client",
      "Laawol", "your package", "—",
      "Laawol", "votre colis", "—",
      "-",
    ]);
    assert.deepEqual(bodyOf("shipment_ready_pickup_2lang", {}), [
      // "Hello / Bonjour Client"
      "Client",
      "goods", "Laawol", "the destination country",
      // "prêt à être récupéré à destination"
      "marchandises", "Laawol", "destination",
      "—", "—", "-",
    ]);
    assert.deepEqual(bodyOf("shipment_received_2lang", {}), [
      "Client", "Laawol", "goods", "its destination country",
      "Laawol", "marchandises", "son pays de destination", "-",
    ]);
    // "... on the day it was collected. It was collected by the receiver."
    assert.deepEqual(bodyOf("shipment_delivered_2lang", {}), [
      "Client", "Laawol", "goods", "the day it was collected",
      "the receiver",
      "Laawol", "marchandises", "le jour de son retrait", "le destinataire",
      "-",
    ]);
  });

  it("uses words that read inside the legacy sentences", () => {
    assert.deepEqual(bodyOf("container_arrived", {}, "en"), [
      "there", "goods", "Laawol", "its destination country",
      "the number on your receipt", "-",
    ]);
    // The French body reads "Bonjour {{1}}," and "joindre au {{5}}".
    assert.deepEqual(bodyOf("container_arrived", {}, "fr"), [
      "à vous", "marchandises", "Laawol", "son pays de destination",
      "numéro indiqué sur votre reçu", "-",
    ]);
    for (const variable of ["name", "business", "what", "destination",
      "businessPhone", "trackingCode"]) {
      assert.ok(FALLBACK[variable].en && FALLBACK[variable].fr, variable);
    }
  });

  it("keeps a value WhatsApp would refuse inside one line", () => {
    const [name] = bodyOf("shipment_received_2lang",
        {...VALUES, name: "Mariama\n\tBah     Diallo"});
    assert.equal(name, "Mariama Bah Diallo");
    const address = bodyOf("shipment_ready_pickup_2lang",
        {...VALUES, pickupAddress: "Madina\nnear   the market"})[7];
    assert.equal(address, "Madina near the market");
  });
});

describe("the request body", () => {
  it("addresses the number in digits", () => {
    const body = templateMessage({update: "received",
      phone: "+224 620-00-00-00", language: "fr", values: VALUES,
      templateSet: "bilingual"});
    assert.equal(body.messaging_product, "whatsapp");
    assert.equal(body.type, "template");
    assert.equal(body.to, "224620000000");
    assert.equal(body.template.name, "shipment_received_2lang");
    assert.deepEqual(body.template.language, {code: "en"});
  });

  it("sends a legacy template in the person's language", () => {
    const body = templateMessage({update: "received",
      phone: "+224 620-00-00-00", language: "fr", values: VALUES,
      templateSet: "legacy"});
    assert.equal(body.template.name, "package_received");
    assert.deepEqual(body.template.language, {code: "fr"});
    assert.equal(templateMessage({update: "shipped", phone: "+1",
      language: "de", values: VALUES, templateSet: "legacy"})
        .template.language.code, "en");
  });
});

describe("the documented templates", () => {
  const doc = readFileSync(path.join(__dirname, "..", "..", "..", "docs",
      "WHATSAPP_CONTAINER_UPDATES.md"), "utf8");
  const bodies = (template) => {
    const section = doc.slice(doc.indexOf(`### \`${template}\``));
    assert.ok(section.length > 0 && doc.includes(`### \`${template}\``),
        template);
    return section.split("```").filter((_, i) => i % 2 === 1);
  };
  const highest = (body) => Math.max(...[...body.matchAll(/\{\{(\d+)\}\}/g)]
      .map((m) => Number(m[1])));

  it("documents each bilingual template with as many variables as the " +
      "code fills", () => {
    for (const template of BILINGUAL_TEMPLATES) {
      // One body, holding both languages.
      const [body] = bodies(template);
      assert.equal(highest(body), TEMPLATE_VARIABLES[template].length,
          `${template}: ${body}`);
      assert.match(body, /\*ENGLISH\*/);
      assert.match(body, /—————\n\*FRANÇAIS\*/);
    }
  });

  it("documents each legacy template with as many variables as the code " +
      "fills", () => {
    for (const template of LEGACY_TEMPLATES) {
      // English body, then French body, before the next template.
      for (const body of bodies(template).slice(0, 2)) {
        assert.equal(highest(body), TEMPLATE_VARIABLES[template].length,
            `${template}: ${body}`);
      }
    }
  });
});

describe("the sign-in code template", () => {
  const {
    LOGIN_TEMPLATE,
    loginCodeTemplateMessage,
  } = require("../whatsapp_templates");

  it("puts the code in the body and on the copy-code button", () => {
    const body = loginCodeTemplateMessage({phone: "+224 622 12 34 56",
      code: "042917", language: "fr"});
    assert.equal(body.to, "224622123456");
    assert.equal(body.template.name, LOGIN_TEMPLATE);
    assert.equal(body.template.name, "laawol_login_code");
    assert.deepEqual(body.template.language, {code: "fr"});
    assert.deepEqual(body.template.components, [
      {type: "body", parameters: [{type: "text", text: "042917"}]},
      {type: "button", sub_type: "url", index: "0",
        parameters: [{type: "text", text: "042917"}]},
    ]);
  });

  it("falls back to English for any other language", () => {
    for (const language of ["en", "de", undefined]) {
      assert.equal(loginCodeTemplateMessage({phone: "+12025550123",
        code: "1", language}).template.language.code, "en");
    }
  });

  it("is documented with the script that creates it", () => {
    const doc = readFileSync(path.join(__dirname, "..", "..", "..", "docs",
        "PHONE_ACCOUNTS.md"), "utf8");
    assert.match(doc, /`laawol_login_code`, category AUTHENTICATION/);
    assert.match(doc, /create_login_template\.py/);
  });
});

// Parked cars (docs/PARKING_WHATSAPP.md §2): three bilingual templates, the
// receipt with the PDF as a DOCUMENT header. The approved wording lives in
// ~/laawol-deploy-logs/create_parking_templates.py.
describe("the parking templates", () => {
  const {
    PARKING_TEMPLATE,
    PARKING_TEMPLATE_VARIABLES,
    PARKING_TEMPLATE_SHAPE,
    parkingTemplateMessage,
  } = require("../whatsapp_templates");

  const PARKING = Object.freeze({
    name: "Alimou Barry",
    business: "Dala Parking",
    businessPhone: "+13475550100",
    trackingCode: "PK-K7M4P2",
    carEn: "2014 Toyota Corolla", carFr: "2014 Toyota Corolla",
    carsEn: "2014 Toyota Corolla, 2016 RAV4 and 3 more",
    carsFr: "2014 Toyota Corolla, 2016 RAV4 et 3 autres",
    parkedOnEn: "October 29, 2026", parkedOnFr: "29 octobre 2026",
    rateEn: "$12.00 a day", rateFr: "12,00 $ par jour",
    amountEn: "$30.00", amountFr: "30,00 $",
    paidTotalEn: "$60.00", paidTotalFr: "60,00 $",
    balanceEn: "Balance owed: $40.00", balanceFr: "Solde à payer : 40,00 $",
    monthEn: "October 2026", monthFr: "octobre 2026",
    dueEn: "$45.00", dueFr: "45,00 $",
    paymentInstructions: "Pay at the office, or Zelle 347-559-6214.",
    documentLink: "https://us-central1-p.cloudfunctions.net/parkingDocument" +
      "?view=receiptPdf&t=tok&p=p_1&e=1&s=sig",
    documentFilename: "Receipt PK-K7M4P2 Oct 29.pdf",
  });
  const message = (template, values = PARKING) =>
    parkingTemplateMessage({template, phone: "+1 (347) 555-0199", values});
  const tracking = {type: "button", sub_type: "url", index: "0",
    parameters: [{type: "text", text: "PK-K7M4P2"}]};
  const text = (value) => ({type: "text", text: value});

  it("names the four templates, bilingual and registered under en", () => {
    assert.deepEqual(Object.values(PARKING_TEMPLATE), [
      "parking_parked_2lang", "parking_receipt_2lang",
      "parking_welcome_2lang", "parking_invoice_2lang"]);
    for (const name of Object.values(PARKING_TEMPLATE)) {
      assert.equal(message(name).template.language.code, "en");
      assert.equal(message(name).to, "13475550199");
    }
    assert.equal(parkingTemplateMessage({template: "nope", phone: "1"}),
        null);
  });

  it("fills parking_parked_2lang: 11 variables, a tracking button", () => {
    assert.equal(PARKING_TEMPLATE_VARIABLES.parking_parked_2lang.length, 11);
    assert.deepEqual(message("parking_parked_2lang").template.components, [
      {type: "body", parameters: [
        text("Alimou Barry"),
        text("Dala Parking"), text("2014 Toyota Corolla"),
        text("October 29, 2026"), text("$12.00 a day"),
        text("Dala Parking"), text("2014 Toyota Corolla"),
        text("29 octobre 2026"), text("12,00 $ par jour"),
        text("+13475550100"), text("PK-K7M4P2"),
      ]},
      tracking,
    ]);
  });

  it("fills parking_receipt_2lang: a document header, 12 variables", () => {
    assert.equal(PARKING_TEMPLATE_VARIABLES.parking_receipt_2lang.length,
        12);
    assert.deepEqual(PARKING_TEMPLATE_SHAPE, {
      parking_receipt_2lang: {header: "document", buttons: "url"},
      parking_invoice_2lang: {header: "document", buttons: "url",
        documentName: "Invoice.pdf"}});
    assert.deepEqual(message("parking_receipt_2lang").template.components, [
      {type: "header", parameters: [{type: "document", document: {
        link: PARKING.documentLink,
        filename: "Receipt PK-K7M4P2 Oct 29.pdf"}}]},
      {type: "body", parameters: [
        text("Alimou Barry"),
        text("Dala Parking"), text("$30.00"), text("2014 Toyota Corolla"),
        text("$60.00"), text("Balance owed: $40.00"),
        text("Dala Parking"), text("30,00 $"), text("2014 Toyota Corolla"),
        text("60,00 $"), text("Solde à payer : 40,00 $"),
        text("PK-K7M4P2"),
      ]},
      tracking,
    ]);
  });

  it("names the receipt file when it is not given one", () => {
    const header = message("parking_receipt_2lang",
        {...PARKING, documentFilename: " "}).template.components[0];
    assert.equal(header.parameters[0].document.filename, "Receipt.pdf");
  });

  it("fills parking_invoice_2lang: a document header, 9 variables, the " +
      "month in both languages, how to pay", () => {
    assert.equal(PARKING_TEMPLATE_VARIABLES.parking_invoice_2lang.length, 9);
    // 1 name, 2 business, 3 month EN, 4 due EN, 5 business, 6 month FR,
    // 7 due FR, 8 how to pay, 9 business phone.
    assert.deepEqual(PARKING_TEMPLATE_VARIABLES.parking_invoice_2lang, [
      "name", "business", "monthEn", "dueEn", "business", "monthFr",
      "dueFr", "paymentInstructions", "businessPhone"]);
    const values = {...PARKING, documentFilename:
      "Invoice INV-202610-1234-1.pdf"};
    assert.deepEqual(message("parking_invoice_2lang", values)
        .template.components, [
      {type: "header", parameters: [{type: "document", document: {
        link: PARKING.documentLink,
        filename: "Invoice INV-202610-1234-1.pdf"}}]},
      {type: "body", parameters: [
        text("Alimou Barry"),
        text("Dala Parking"), text("October 2026"), text("$45.00"),
        text("Dala Parking"), text("octobre 2026"), text("45,00 $"),
        text("Pay at the office, or Zelle 347-559-6214."),
        text("+13475550100"),
      ]},
      tracking,
    ]);
  });

  it("names the invoice file when it is not given one, and keeps the " +
      "receipt's name", () => {
    const header = (template) => message(template,
        {...PARKING, documentFilename: " "}).template.components[0]
        .parameters[0].document.filename;
    assert.equal(header("parking_invoice_2lang"), "Invoice.pdf");
    assert.equal(header("parking_receipt_2lang"), "Receipt.pdf");
  });

  it("sends a dash for missing payment instructions, and cleans them into " +
      "one line", () => {
    const body = (instructions) => message("parking_invoice_2lang",
        {...PARKING, paymentInstructions: instructions})
        .template.components[1].parameters[7].text;
    assert.equal(body(""), "—");
    assert.equal(body(undefined), "—");
    assert.equal(body("Zelle\n347-559-6214\n\n(Keren)"),
        "Zelle 347-559-6214 (Keren)");
    assert.equal(body("x".repeat(400)).length, 300);
  });

  it("fills parking_welcome_2lang: 6 variables", () => {
    assert.equal(PARKING_TEMPLATE_VARIABLES.parking_welcome_2lang.length, 6);
    assert.deepEqual(message("parking_welcome_2lang").template.components, [
      {type: "body", parameters: [
        text("Alimou Barry"),
        text("Dala Parking"),
        text("2014 Toyota Corolla, 2016 RAV4 and 3 more"),
        text("Dala Parking"),
        text("2014 Toyota Corolla, 2016 RAV4 et 3 autres"),
        text("+13475550100"),
      ]},
      tracking,
    ]);
  });

  it("never sends an empty parameter", () => {
    for (const name of Object.values(PARKING_TEMPLATE)) {
      for (const values of [{}, {name: " ", business: "\n",
        businessPhone: "", trackingCode: null}]) {
        for (const part of message(name, values).template.components) {
          for (const p of part.parameters) {
            if (p.type !== "text") continue;
            assert.ok(p.text.trim().length > 0, `${name} sent an empty text`);
          }
        }
      }
    }
    // "Phone / Téléphone : —" when the lot has no phone.
    assert.equal(message("parking_parked_2lang", {})
        .template.components[0].parameters[9].text, "—");
  });

  it("does not change what the container templates send", () => {
    assert.equal(TEMPLATE_VARIABLES.package_confirm_2lang.length, 8);
    assert.deepEqual(Object.keys(TEMPLATE_SHAPE), ["package_confirm_2lang"]);
  });
});
