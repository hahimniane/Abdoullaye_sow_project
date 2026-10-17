"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  TEMPLATE,
  TEMPLATE_VARIABLES,
  TEMPLATE_BY_UPDATE,
  TEMPLATE_LANGUAGES,
  FALLBACK,
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
});

const bodyOf = (template, values = VALUES, language = "en") =>
  templateComponents(template, values, language)[0].parameters
      .map((p) => p.text);
const buttonOf = (template, values = VALUES, language = "en") =>
  templateComponents(template, values, language)[1];

describe("which template each update sends", () => {
  it("names the three approved templates exactly", () => {
    assert.deepEqual(Object.values(TEMPLATE).sort(), [
      "container_arrived", "container_departed", "package_received"]);
    assert.deepEqual(TEMPLATE_LANGUAGES, ["en", "fr"]);
  });

  it("sends received, departed and arrived; at the port is the arrival", () => {
    assert.equal(templateForUpdate("received"), "package_received");
    assert.equal(templateForUpdate("shipped"), "container_departed");
    assert.equal(templateForUpdate("arrived"), "container_arrived");
    // A row written before the two arrival moments shared one message.
    assert.equal(templateForUpdate("at_port"), "container_arrived");
    assert.equal(templateForUpdate("loading"), null);
    assert.equal(templateForUpdate(""), null);
    assert.equal(templateMessage({update: "customs", phone: "+1"}), null);
  });

  // Regression guard: the single template this replaces must never be
  // sent again.
  it("never sends the retired container_status_update", () => {
    assert.ok(!Object.values(TEMPLATE_BY_UPDATE)
        .includes("container_status_update"));
    for (const update of Object.keys(TEMPLATE_BY_UPDATE)) {
      const body = templateMessage({update, phone: "+16465550100",
        language: "en", values: VALUES});
      assert.notEqual(body.template.name, "container_status_update");
    }
  });
});

describe("the variables, in the order Meta numbered them", () => {
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

  it("gives every template one URL button whose parameter is the code",
      () => {
        for (const template of Object.values(TEMPLATE)) {
          for (const language of TEMPLATE_LANGUAGES) {
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
    assert.throws(() => templateComponents("container_status_update",
        VALUES, "en"), /Unknown WhatsApp template/);
  });
});

describe("what fills a blank", () => {
  // Meta refuses a template parameter that is empty.
  it("never sends an empty parameter, in either language", () => {
    for (const template of Object.values(TEMPLATE)) {
      for (const language of TEMPLATE_LANGUAGES) {
        for (const values of [{}, {name: "  ", business: "\n",
          destination: null, businessPhone: undefined, trackingCode: ""}]) {
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

  it("uses words that read inside the sentence, in English and French",
      () => {
        assert.deepEqual(bodyOf("container_arrived", {}, "en"), [
          "there", "goods", "Laawol", "its destination country",
          "the number on your receipt", "-",
        ]);
        // The French body reads "Bonjour {{1}}," and "joindre au {{5}}".
        assert.deepEqual(bodyOf("container_arrived", {}, "fr"), [
          "à vous", "marchandises", "Laawol", "son pays de destination",
          "numéro indiqué sur votre reçu", "-",
        ]);
        for (const variable of Object.keys(FALLBACK)) {
          assert.ok(FALLBACK[variable].en && FALLBACK[variable].fr, variable);
        }
      });

  it("keeps a value WhatsApp would refuse inside one line", () => {
    const [name] = bodyOf("package_received",
        {...VALUES, name: "Mariama\n\tBah     Diallo"});
    assert.equal(name, "Mariama Bah Diallo");
  });
});

describe("the request body", () => {
  it("addresses the number in digits, in the person's language", () => {
    const body = templateMessage({update: "received",
      phone: "+224 620-00-00-00", language: "fr", values: VALUES});
    assert.equal(body.messaging_product, "whatsapp");
    assert.equal(body.type, "template");
    assert.equal(body.to, "224620000000");
    assert.equal(body.template.name, "package_received");
    assert.deepEqual(body.template.language, {code: "fr"});
    assert.equal(templateMessage({update: "shipped", phone: "+1",
      language: "de", values: VALUES}).template.language.code, "en");
  });
});

describe("the documented templates", () => {
  const doc = readFileSync(path.join(__dirname, "..", "..", "..", "docs",
      "WHATSAPP_CONTAINER_UPDATES.md"), "utf8");

  it("documents each template with as many variables as the code fills",
      () => {
        for (const template of Object.values(TEMPLATE)) {
          assert.ok(doc.includes(`\`${template}\``), template);
          const section = doc.slice(doc.indexOf(`### \`${template}\``));
          const blocks = section.split("```").filter((_, i) => i % 2 === 1);
          // English body, then French body, before the next template.
          for (const body of blocks.slice(0, 2)) {
            const numbers = [...body.matchAll(/\{\{(\d+)\}\}/g)]
                .map((m) => Number(m[1]));
            assert.equal(Math.max(...numbers),
                TEMPLATE_VARIABLES[template].length, `${template}: ${body}`);
          }
        }
      });
});
