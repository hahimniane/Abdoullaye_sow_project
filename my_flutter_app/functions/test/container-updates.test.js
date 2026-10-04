"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  WHATSAPP_TEMPLATE,
  languageForPhone,
  updateForContainerStatus,
  updateForCarrierStatus,
  containerStatusFromCarrier,
  carrierTrackingFinished,
  describeLine,
  recipientsForLine,
  containerUpdateMessageId,
  trackingLink,
  whatsappUpdateMessage,
  whatsappConfigured,
} = require("../container_updates");

const line = (extra = {}) => ({
  kind: "barrels", quantity: 3, ownerKind: "customer",
  customerName: "Fatou Diallo", customerPhone: "+16465550100",
  notifyCustomer: true,
  receiverName: "Mariama Bah", receiverPhone: "+224620000000",
  notifyReceiver: true,
  trackingCode: "CL-K7M4P2",
  ...extra,
});

describe("which moments customers hear about", () => {
  it("tells them when staff ship it and when it arrives", () => {
    assert.equal(updateForContainerStatus("shipped"), "shipped");
    assert.equal(updateForContainerStatus("arrived"), "arrived");
    assert.equal(updateForContainerStatus("loading"), null);
  });

  it("turns the carrier's word into the same updates", () => {
    assert.equal(updateForCarrierStatus("on_ship", "loading"), "shipped");
    assert.equal(updateForCarrierStatus("grounded", "shipped"), "at_port");
    assert.equal(updateForCarrierStatus("available", "shipped"), "at_port");
    // Paperwork moments are recorded, not messaged.
    assert.equal(updateForCarrierStatus("new", "loading"), null);
    assert.equal(updateForCarrierStatus("empty_returned", "arrived"), null);
  });

  // Staff saying "arrived" is later news than the carrier's "at the port".
  it("does not send 'at the port' once staff have said it arrived", () => {
    assert.equal(updateForCarrierStatus("grounded", "arrived"), null);
  });

  // Whoever reports a moment first sends it; the other source writes to the
  // same message id and finds it taken.
  it("keys a message by line, person and update - never by its source", () => {
    assert.equal(containerUpdateMessageId("line1", "sender", "shipped"),
        "line1_sender_shipped");
    assert.equal(
        containerUpdateMessageId("li/ne", "receiver", "at_port"),
        "line_receiver_at_port");
  });
});

describe("the carrier moves the container forward, never back", () => {
  it("ships a loading box the carrier has put on a vessel", () => {
    assert.equal(containerStatusFromCarrier("on_ship", "loading"), "shipped");
    assert.equal(containerStatusFromCarrier("grounded", "shipped"), "arrived");
    assert.equal(containerStatusFromCarrier("available", "loading"),
        "arrived");
  });

  it("leaves a box alone when the report is old news", () => {
    assert.equal(containerStatusFromCarrier("on_ship", "shipped"), null);
    assert.equal(containerStatusFromCarrier("on_ship", "arrived"), null);
    assert.equal(containerStatusFromCarrier("new", "loading"), null);
  });

  it("stops following a box once it has been collected", () => {
    assert.equal(carrierTrackingFinished("picked_up"), true);
    assert.equal(carrierTrackingFinished("empty_returned"), true);
    assert.equal(carrierTrackingFinished("on_ship"), false);
  });
});

describe("who is told", () => {
  it("tells the sender and the receiver", () => {
    const {send, skipped} = recipientsForLine(line());
    assert.deepEqual(send.map((who) => who.role), ["sender", "receiver"]);
    assert.deepEqual(skipped, []);
  });

  it("says why anyone was left out", () => {
    const {send, skipped} = recipientsForLine(line({
      customerPhone: "622112233",
      notifyReceiver: false,
    }));
    assert.deepEqual(send, []);
    assert.deepEqual(skipped.map((who) => [who.role, who.reason]), [
      ["sender", "needs_country_code"],
      ["receiver", "switched_off"],
    ]);
  });

  it("does not report a receiver nobody named", () => {
    const {skipped} = recipientsForLine(line({
      receiverName: "", receiverPhone: "",
    }));
    assert.deepEqual(skipped, []);
  });

  it("tells one person once when both sides share a number", () => {
    const {send} = recipientsForLine(line({receiverPhone: "+1 646 555 0100"}));
    assert.equal(send.length, 1);
  });

  it("never tells a customer on business stock", () => {
    const {send} = recipientsForLine(line({ownerKind: "stock"}));
    assert.deepEqual(send.map((who) => who.role), ["receiver"]);
  });
});

describe("what they read", () => {
  it("writes to Guinea and Senegal in French, the US in English", () => {
    assert.equal(languageForPhone("+224620000000"), "fr");
    assert.equal(languageForPhone("+221771234567"), "fr");
    assert.equal(languageForPhone("+16465550100"), "en");
    assert.equal(languageForPhone("+447700900123"), "en");
  });

  it("names what is on the line the way a person would", () => {
    assert.equal(describeLine(line(), "en"), "3 barrels");
    assert.equal(describeLine(line(), "fr"), "3 fûts");
    assert.equal(describeLine(line({quantity: 1}), "en"), "1 barrel");
    assert.equal(describeLine({kind: "car", carYear: "2015",
      carMake: "Toyota", carModel: "Camry",
      vinNumber: "1HGCM82633A004352"}, "en"),
    "2015 Toyota Camry (VIN …004352)");
    assert.equal(describeLine({kind: "other", quantity: 2,
      description: "boxes of clothes"}, "en"), "2 × boxes of clothes");
  });

  it("fills the approved template's five variables and its button", () => {
    const body = whatsappUpdateMessage({
      phone: "+224620000000", name: "Mariama Bah", businessName: "Dala",
      line: line(), update: "shipped", trackingCode: "CL-K7M4P2",
    });
    assert.equal(body.messaging_product, "whatsapp");
    assert.equal(body.to, "224620000000");
    assert.equal(body.template.name, WHATSAPP_TEMPLATE);
    assert.equal(body.template.language.code, "fr");
    const [bodyPart, button] = body.template.components;
    assert.deepEqual(bodyPart.parameters.map((p) => p.text), [
      "Mariama Bah", "Dala", "3 fûts",
      "le conteneur a quitté le port et est en route", "CL-K7M4P2",
    ]);
    assert.equal(button.sub_type, "url");
    assert.deepEqual(button.parameters.map((p) => p.text), ["CL-K7M4P2"]);
  });

  // Meta refuses a template variable that is empty.
  it("never sends an empty variable", () => {
    const body = whatsappUpdateMessage({
      phone: "+16465550100", name: "", businessName: "",
      line: {kind: "other"}, update: "arrived", trackingCode: "CL-K7M4P2",
    });
    for (const p of body.template.components[0].parameters) {
      assert.ok(p.text.length > 0);
    }
  });

  it("links to the public tracking page for the code", () => {
    const base = "https://customer.laawoldigital.com";
    assert.equal(trackingLink(`${base}/`, "CL-K7M4P2"),
        `${base}/?service=tracking&code=CL-K7M4P2`);
    assert.match(trackingLink("", "CL-K7M4P2"), /^https:\/\/customer\./);
  });
});

describe("before Meta approves the business", () => {
  it("treats a missing or placeholder token as not connected", () => {
    assert.equal(whatsappConfigured({}), false);
    assert.equal(
        whatsappConfigured({accessToken: "unset", phoneNumberId: "unset"}),
        false);
    assert.equal(
        whatsappConfigured({accessToken: "EAAG-real", phoneNumberId: "unset"}),
        false);
    assert.equal(
        whatsappConfigured({accessToken: "EAAG-real",
          phoneNumberId: "109876543210"}),
        true);
  });
});

describe("the server wiring", () => {
  const source = readFileSync(path.join(__dirname, "..", "index.js"), "utf8");
  const section = (start, end) =>
    source.slice(source.indexOf(start),
        source.indexOf(end, source.indexOf(start)));

  it("writes a timeline moment, carrying the update, when staff move a box",
      () => {
        const body = section("exports.setContainerStatus = onCall(",
            "\nexports.");
        assert.match(body, /applyContainerStatus\(db, ref, next/);
        assert.match(body, /recordContainerEvent\(ref, `staff_\$\{next\}`/);
        assert.match(body, /customerUpdate: updateForContainerStatus\(next\)/);
      });

  it("sends each update once per person, and waits while WhatsApp is off",
      () => {
        const body = section("exports.sendContainerCustomerUpdates",
            "\nexports.");
        assert.ok(body.includes(
            "document: \"containers/{containerId}/trackingEvents/{eventId}\""));
        assert.match(body, /messageRef\.create\(/);
        assert.match(body, /"waiting_for_whatsapp"/);
        assert.match(body, /if \(!configured\)/);
      });

  it("gives every line its code before anyone is told it sailed", () => {
    const body = section("async function applyContainerStatus(",
        "\nasync function recordContainerEvent(");
    assert.match(body, /assignMissingLineCodes\(db, lines\.docs\)/);
  });

  it("follows a numbered container on the carrier feed and polls it", () => {
    assert.match(source,
        /exports\.startContainerCarrierTracking = onDocumentWritten\(/);
    assert.match(source, /pollOneTrackedContainer\(db, doc\)/);
    assert.match(source, /where\("carrierTrackingDone", "==", false\)/);
  });
});
