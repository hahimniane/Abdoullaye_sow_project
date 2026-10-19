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
  TEMPLATE_LANGUAGES,
  FALLBACK,
  whatsappTemplateSet,
  templateForUpdate,
  templateComponents,
  templateMessage,
} = require("../whatsapp_templates");

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
});

const bodyOf = (template, values = VALUES, language = "en") =>
  templateComponents(template, values, language)[0].parameters
      .map((p) => p.text);
const buttonOf = (template, values = VALUES, language = "en") =>
  templateComponents(template, values, language)[1];
const ALL_TEMPLATES = [...BILINGUAL_TEMPLATES, ...LEGACY_TEMPLATES];

describe("which template each update sends", () => {
  it("names the bilingual and the legacy templates exactly", () => {
    assert.deepEqual([...BILINGUAL_TEMPLATES].sort(), [
      "shipment_departed_2lang", "shipment_ready_pickup_2lang",
      "shipment_received_2lang"]);
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
      shipped: "shipment_departed_2lang",
      arrived: "shipment_ready_pickup_2lang",
    });
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

  it("fills both languages whoever reads it, in one 'en' message", () => {
    for (const update of ["received", "shipped", "arrived"]) {
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
  it("has one URL button whose parameter is the code", () => {
    for (const template of ALL_TEMPLATES) {
      for (const language of TEMPLATE_LANGUAGES) {
        const parts = templateComponents(template, VALUES, language);
        assert.equal(parts.length, 2);
        const button = buttonOf(template, VALUES, language);
        assert.equal(button.type, "button");
        assert.equal(button.sub_type, "url");
        assert.equal(button.index, "0");
        assert.deepEqual(button.parameters,
            [{type: "text", text: "CL-K7M4P2"}]);
      }
    }
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
              assert.equal(p.type, "text");
              assert.ok(p.text.trim().length > 0,
                  `${template}/${language} sent an empty parameter`);
            }
          }
        }
      }
    }
  });

  it("uses words that read inside the bilingual sentences", () => {
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
