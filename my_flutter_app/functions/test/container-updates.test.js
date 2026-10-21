"use strict";

const assert = require("node:assert/strict");
const {readFileSync} = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const {
  UPDATE_STATUS,
  WHATSAPP_SEND_LEASE_MS,
  WHATSAPP_TIMEOUT_MS,
  WHATSAPP_MAX_ATTEMPTS,
  WHATSAPP_MAX_EVENT_AGE_MS,
  updateRank,
  shouldSendQueuedRow,
  claimContainerUpdate,
  whatsappSendOutcome,
  statusAfterAttempt,
  requeueDecision,
  latestCustomerUpdate,
  mergeLastCustomerUpdate,
  messageUpdateFor,
  destinationName,
  languageForPhone,
  updateForContainerStatus,
  updateForCarrierStatus,
  containerStatusFromCarrier,
  carrierTrackingFinished,
  describeLine,
  recipientsForLine,
  containerUpdateMessageId,
  trackingLink,
  pickupDestinationIds,
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
    assert.equal(containerUpdateMessageId("line1", "sender", "received"),
        "line1_sender_received");
  });

  // "arrived" now means ready for pickup, which only staff can say: with
  // the bilingual templates the carrier's "at the port" sends nothing.
  it("sends ready for pickup only when staff mark it", () => {
    assert.equal(messageUpdateFor("at_port", "bilingual"), null);
    assert.equal(messageUpdateFor("arrived", "bilingual"), "arrived");
    assert.equal(messageUpdateFor("shipped", "bilingual"), "shipped");
    assert.equal(messageUpdateFor("received", "bilingual"), "received");
    assert.equal(messageUpdateFor(null, "bilingual"), null);
    assert.equal(messageUpdateFor("customs", "bilingual"), null);
    // The default is the bilingual set.
    assert.equal(messageUpdateFor("at_port"), null);
  });

  // With the legacy templates the carrier's "at the port" and staff's
  // "arrived" are one piece of news: they share the arrival's message, so
  // whichever comes first sends and the other finds the row taken.
  it("sends the legacy arrival once, whichever source reports it first",
      () => {
        assert.equal(messageUpdateFor("at_port", "legacy"), "arrived");
        assert.equal(messageUpdateFor("arrived", "legacy"), "arrived");
        const carrierFirst = containerUpdateMessageId("line1", "receiver",
            messageUpdateFor(updateForCarrierStatus("grounded", "shipped"),
                "legacy"));
        const staffFirst = containerUpdateMessageId("line1", "receiver",
            messageUpdateFor(updateForContainerStatus("arrived"), "legacy"));
        assert.equal(carrierFirst, "line1_receiver_arrived");
        assert.equal(carrierFirst, staffFirst);
      });
});

describe("the carrier moves the container forward, never back", () => {
  it("ships a loading box the carrier has put on a vessel", () => {
    assert.equal(containerStatusFromCarrier("on_ship", "loading"), "shipped");
  });

  // Regression guard: "arrived" is READY FOR PICKUP, a staff decision. A box
  // discharged at the port, or collected from it by the business, is not
  // yet ready for the customer.
  it("never marks a box ready for pickup by itself", () => {
    for (const carrier of ["grounded", "available", "picked_up", "delivered",
      "empty_returned"]) {
      for (const status of ["loading", "shipped"]) {
        assert.equal(containerStatusFromCarrier(carrier, status), null,
            `${carrier} from ${status}`);
      }
    }
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

  it("messages a US business's 10-digit local number as +1", () => {
    // The real case (Keren, 2026-10-19): the sender was typed without +1.
    const us = {businessCountry: "United States"};
    const {send, skipped} = recipientsForLine(line({
      customerPhone: "(929) 555-1987"}), us);
    assert.deepEqual(skipped, []);
    assert.equal(send.find((who) => who.role === "sender").phone,
        "+19295551987");
    assert.equal(recipientsForLine(line({customerPhone: "19295551987"}), us)
        .send.find((who) => who.role === "sender").phone, "+19295551987");
    // Not a valid North American number: never guessed.
    assert.deepEqual(recipientsForLine(line({customerPhone: "1295551987"}),
        us).skipped.map((who) => who.reason), ["needs_country_code"]);
    // A Guinean local number stays skipped, even for a US business.
    assert.deepEqual(recipientsForLine(line({customerPhone: "622112233"}),
        us).skipped.map((who) => who.reason), ["needs_country_code"]);
    // Outside the US nothing is guessed.
    assert.deepEqual(recipientsForLine(line({customerPhone: "9295551987"}),
        {businessCountry: "Guinea"}).skipped.map((who) => who.reason),
    ["needs_country_code"]);
    // Same person once, typed both ways.
    assert.equal(recipientsForLine(line({customerPhone: "6465550100",
      receiverPhone: "+1 646 555 0100"}), us).send.length, 1);
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
    assert.equal(describeLine(line(), "fr"), "3 barils");
    assert.equal(describeLine(line({quantity: 1}), "en"), "1 barrel");
    assert.equal(describeLine({kind: "car", carYear: "2015",
      carMake: "Toyota", carModel: "Camry",
      vinNumber: "1HGCM82633A004352"}, "en"),
    "2015 Toyota Camry (VIN …004352)");
    assert.equal(describeLine({kind: "other", quantity: 2,
      description: "boxes of clothes"}, "en"), "2 × boxes of clothes");
  });

  it("names a line's pieces, and a split part's share of the whole", () => {
    const pieced = {kind: "other", quantity: 3, pieces: [
      {kind: "barrel"}, {kind: "barrel"}, {kind: "box", description: "x"}]};
    assert.equal(describeLine(pieced, "en"), "2 barrels, 1 box");
    assert.equal(describeLine(pieced, "fr"), "2 barils, 1 carton");
    const group = {partCount: 2, pieceCount: 5};
    assert.equal(describeLine(pieced, "en", group), "3 of your 5 pieces");
    assert.equal(describeLine(pieced, "fr", group), "3 de vos 5 colis");
    // A group of one, or a legacy line, reads as before.
    assert.equal(describeLine(pieced, "en", {partCount: 1, pieceCount: 3}),
        "2 barrels, 1 box");
    assert.equal(describeLine(line(), "en", group), "3 barrels");
    // A car is a car.
    assert.equal(describeLine({kind: "car", vinNumber: "1HGCM82633A004352",
      pieces: [{kind: "barrel"}]}, "en", group), "the car (VIN …004352)");
  });

  it("fills both languages' what for a part, in every template", () => {
    const part = {kind: "barrels", quantity: 2, rootLineId: "root",
      partIndex: 2, pieces: [{kind: "barrel"}, {kind: "barrel"}]};
    const group = {partCount: 2, pieceCount: 4};
    const departed = whatsappUpdateMessage({phone: "+224620000000",
      name: "Mariama Bah", businessName: "Dala", line: part, group,
      container: {destinationCountryId: "gn",
        destinationCountryName: "Guinea"},
      update: "shipped", trackingCode: "CL-K7M4P2-2"});
    assert.deepEqual(
        departed.template.components[0].parameters.map((p) => p.text),
        ["Mariama Bah", "2 of your 4 pieces", "Dala", "Guinea",
          "2 de vos 4 colis", "Dala", "Guinée", "CL-K7M4P2-2"]);
    const legacy = whatsappUpdateMessage({phone: "+224620000000",
      name: "Mariama Bah", businessName: "Dala", line: part, group,
      container: {destinationCountryId: "gn",
        destinationCountryName: "Guinea"},
      update: "shipped", trackingCode: "CL-K7M4P2-2",
      templateSet: "legacy"});
    // The legacy template is in the reader's language (French here).
    assert.equal(legacy.template.components[0].parameters[1].text,
        "2 de vos 4 colis");
  });

  const message = (update, extra = {}) => whatsappUpdateMessage({
    phone: "+224620000000", name: "Mariama Bah", businessName: "Dala",
    businessPhone: "+16465550199", line: line(),
    container: {destinationCountryId: "gn", destinationCountryName: "Guinea"},
    update, trackingCode: "CL-K7M4P2", ...extra,
  });
  const texts = (body) =>
    body.template.components[0].parameters.map((p) => p.text);

  it("sends shipment_received_2lang in English and French, with the " +
      "line's own destination", () => {
    const body = message("received", {phone: "+16465550100",
      line: line({destinationCountryId: "sn",
        destinationCountryName: "Senegal"})});
    assert.equal(body.messaging_product, "whatsapp");
    assert.equal(body.to, "16465550100");
    assert.equal(body.template.name, "shipment_received_2lang");
    assert.equal(body.template.language.code, "en");
    assert.deepEqual(texts(body), ["Mariama Bah",
      "Dala", "3 barrels", "Senegal",
      "Dala", "3 barils", "Sénégal",
      "CL-K7M4P2"]);
  });

  it("sends shipment_departed_2lang with the box's destination, the same " +
      "to a French and an English reader", () => {
    const fr = message("shipped");
    const en = message("shipped", {phone: "+16465550100"});
    assert.equal(fr.template.name, "shipment_departed_2lang");
    assert.equal(fr.template.language.code, "en");
    assert.deepEqual(texts(fr), ["Mariama Bah",
      "3 barrels", "Dala", "Guinea",
      "3 barils", "Dala", "Guinée",
      "CL-K7M4P2"]);
    assert.deepEqual(texts(en), texts(fr));
    const [, button] = fr.template.components;
    assert.equal(button.sub_type, "url");
    assert.deepEqual(button.parameters.map((p) => p.text), ["CL-K7M4P2"]);
  });

  it("sends shipment_ready_pickup_2lang with the destination's pickup " +
      "details", () => {
    const body = message("arrived", {pickupDestination: {
      pickupCity: "Conakry", pickupAddress: "Madina, near the market",
      pickupPhone: "+224 620 11 22 33"}});
    assert.equal(body.template.name, "shipment_ready_pickup_2lang");
    assert.equal(body.template.language.code, "en");
    assert.deepEqual(texts(body), ["Mariama Bah",
      "3 barrels", "Dala", "Conakry, Guinea",
      "3 barils", "Dala", "Conakry, Guinée",
      "Madina, near the market", "+224620112233", "CL-K7M4P2"]);
  });

  it("falls back to the country, the business's address and its phone",
      () => {
        const body = message("arrived", {pickupDestination: null,
          business: {addressLine1: "12 Main St", city: "Bronx",
            state: "NY", country: "United States"}});
        assert.deepEqual(texts(body).slice(3, 10), ["Guinea",
          "3 barils", "Dala", "Guinée",
          "12 Main St, Bronx, NY, United States", "+16465550199",
          "CL-K7M4P2"]);
        const bare = message("arrived", {businessPhone: "", business: {},
          container: null});
        assert.deepEqual(texts(bare).slice(3, 10), [
          "the destination country", "3 barils", "Dala", "destination",
          "—", "—", "CL-K7M4P2"]);
      });

  it("has no message for the carrier's 'at the port' in the bilingual set",
      () => {
        assert.equal(message("at_port"), null);
      });

  describe("with WHATSAPP_TEMPLATE_SET=legacy", () => {
    const legacy = (update, extra = {}) =>
      message(update, {templateSet: "legacy", ...extra});

    it("sends package_received with the line's own destination", () => {
      const body = legacy("received", {phone: "+16465550100",
        line: line({destinationCountryId: "sn",
          destinationCountryName: "Senegal"})});
      assert.equal(body.template.name, "package_received");
      assert.equal(body.template.language.code, "en");
      assert.deepEqual(texts(body),
          ["Mariama Bah", "Dala", "3 barrels", "Senegal", "CL-K7M4P2"]);
    });

    it("sends container_departed in French, with the box's destination",
        () => {
          const body = legacy("shipped");
          assert.equal(body.template.name, "container_departed");
          assert.equal(body.template.language.code, "fr");
          assert.deepEqual(texts(body),
              ["Mariama Bah", "3 barils", "Dala", "Guinée", "CL-K7M4P2"]);
        });

    it("sends container_arrived with the business's phone", () => {
      for (const update of ["arrived", "at_port"]) {
        const body = legacy(update, {phone: "+16465550100"});
        assert.equal(body.template.name, "container_arrived");
        assert.deepEqual(texts(body), ["Mariama Bah", "3 barrels", "Dala",
          "Guinea", "+16465550199", "CL-K7M4P2"]);
      }
    });
  });

  // Meta refuses a template variable that is empty.
  it("never sends an empty variable", () => {
    for (const templateSet of ["bilingual", "legacy"]) {
      for (const update of ["received", "shipped", "arrived"]) {
        for (const phone of ["+16465550100", "+224620000000"]) {
          const body = whatsappUpdateMessage({
            phone, name: "", businessName: "", line: {kind: "other"},
            container: null, update, trackingCode: "CL-K7M4P2", templateSet,
          });
          for (const part of body.template.components) {
            for (const p of part.parameters) assert.ok(p.text.length > 0);
          }
        }
      }
    }
  });

  it("finds the destination record the goods are collected from", () => {
    assert.deepEqual(pickupDestinationIds(
        {destinationCountryId: "senegal", destinationCountryName: "Senegal"},
        {destinationCountryId: "gn"}), ["senegal", "sn"]);
    // A line with none follows its box; an ISO code also tries the catalog
    // id the seed writes.
    assert.deepEqual(pickupDestinationIds({},
        {destinationCountryId: "gn", destinationCountryName: "Guinea"}),
    ["gn", "guinea"]);
    assert.deepEqual(pickupDestinationIds({}, null), []);
    assert.deepEqual(pickupDestinationIds({destinationCountryId: "a/b"},
        null), []);
  });

  it("names the destination in the reader's language", () => {
    const guinea = {destinationCountryId: "gn",
      destinationCountryName: "Guinea"};
    assert.equal(destinationName(guinea, null, "en"), "Guinea");
    assert.equal(destinationName(guinea, null, "fr"), "Guinée");
    // A catalog id, or only a name, still finds the country.
    assert.equal(destinationName({destinationCountryId: "c-te-d-ivoire",
      destinationCountryName: "Côte d'Ivoire"}, null, "fr"), "Côte d’Ivoire");
    assert.equal(destinationName({destinationCountryName: "Senegal"}, null,
        "fr"), "Sénégal");
    // A line with none follows its box; one Intl cannot name keeps its own.
    assert.equal(destinationName({}, guinea, "fr"), "Guinée");
    assert.equal(destinationName({destinationCountryName: "Atlantis"}, null,
        "fr"), "Atlantis");
    assert.equal(destinationName({}, null, "fr"), "");
  });

  it("links to the public tracking page for the code", () => {
    const base = "https://customer.laawoldigital.com";
    assert.equal(trackingLink(`${base}/`, "CL-K7M4P2"),
        `${base}/t/CL-K7M4P2`);
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

describe("the send queue", () => {
  const NOW = 1800000000000;

  it("sends a row when it becomes queued, never on the sender's own writes",
      () => {
        assert.equal(shouldSendQueuedRow(null, {status: "queued"}), true);
        assert.equal(shouldSendQueuedRow({status: "waiting_for_whatsapp"},
            {status: "queued"}), true);
        assert.equal(shouldSendQueuedRow({status: "failed"},
            {status: "queued"}), true);
        assert.equal(shouldSendQueuedRow({status: "queued"},
            {status: "sending"}), false);
        assert.equal(shouldSendQueuedRow({status: "sending"},
            {status: "retrying"}), false);
        assert.equal(shouldSendQueuedRow({status: "sending"},
            {status: "sent"}), false);
        assert.equal(shouldSendQueuedRow(null,
            {status: "waiting_for_whatsapp"}), false);
        assert.equal(shouldSendQueuedRow({status: "queued"}, null), false);
      });

  it("claims a queued or retrying row and counts the attempt", () => {
    assert.deepEqual(claimContainerUpdate({status: "queued"}, NOW),
        {action: "claim", attempts: 1});
    assert.deepEqual(
        claimContainerUpdate({status: "retrying", attempts: 2}, NOW),
        {action: "claim", attempts: 3});
  });

  // Regression: a crash between create() and the send left the row
  // "sending" forever, and it blocked every later send.
  it("takes over a sending row only once its lease has run out", () => {
    assert.deepEqual(claimContainerUpdate(
        {status: "sending", attempts: 1, leaseUntilMs: NOW + 1000}, NOW),
    {action: "busy", attempts: 1});
    assert.deepEqual(claimContainerUpdate(
        {status: "sending", attempts: 1, leaseUntilMs: NOW - 1}, NOW),
    {action: "claim", attempts: 2});
    // A row from before leases existed has none, so it is stale.
    assert.equal(claimContainerUpdate({status: "sending"}, NOW).action,
        "claim");
    assert.ok(WHATSAPP_SEND_LEASE_MS > WHATSAPP_TIMEOUT_MS);
  });

  it("does nothing with a row that is finished, waiting or gone", () => {
    for (const status of ["sent", "failed", "waiting_for_whatsapp"]) {
      assert.equal(claimContainerUpdate({status}, NOW).action, "done");
    }
    assert.equal(claimContainerUpdate(null, NOW).action, "done");
  });

  it("gives up after the attempt bound, or on a very old event", () => {
    assert.equal(claimContainerUpdate(
        {status: "retrying", attempts: WHATSAPP_MAX_ATTEMPTS}, NOW).action,
    "give_up");
    assert.equal(claimContainerUpdate({status: "queued"}, NOW,
        {eventAgeMs: WHATSAPP_MAX_EVENT_AGE_MS + 1}).action, "give_up");
    assert.equal(claimContainerUpdate({status: "queued", attempts: 1}, NOW,
        {maxAttempts: 1}).action, "give_up");
  });

  it("retries what may pass on a second try, and fails what never will",
      () => {
        assert.equal(whatsappSendOutcome({ok: true, httpStatus: 200}), "sent");
        for (const httpStatus of [0, 408, 429, 500, 502, 503]) {
          assert.equal(whatsappSendOutcome({ok: false, httpStatus}), "retry",
              `HTTP ${httpStatus}`);
        }
        for (const httpStatus of [400, 401, 403, 404]) {
          assert.equal(whatsappSendOutcome({ok: false, httpStatus}), "failed",
              `HTTP ${httpStatus}`);
        }
        assert.equal(whatsappSendOutcome(null), "retry");
      });

  it("retries up to the bound, then marks the row failed", () => {
    assert.equal(statusAfterAttempt("sent", 1), UPDATE_STATUS.SENT);
    assert.equal(statusAfterAttempt("retry", 1), UPDATE_STATUS.RETRYING);
    assert.equal(statusAfterAttempt("retry", WHATSAPP_MAX_ATTEMPTS),
        UPDATE_STATUS.FAILED);
    assert.equal(statusAfterAttempt("failed", 1), UPDATE_STATUS.FAILED);
  });
});

describe("sending the current status by hand", () => {
  const NOW = 1800000000000;

  it("re-queues what waited, failed or died, and never re-sends", () => {
    assert.equal(requeueDecision(null, NOW), "create");
    assert.equal(requeueDecision({status: "waiting_for_whatsapp"}, NOW),
        "requeue");
    assert.equal(requeueDecision({status: "failed"}, NOW), "requeue");
    assert.equal(requeueDecision({status: "sending", leaseUntilMs: NOW - 1},
        NOW), "requeue");
    assert.equal(requeueDecision({status: "sent"}, NOW), "already_sent");
    assert.equal(requeueDecision({status: "queued"}, NOW), "in_flight");
    assert.equal(requeueDecision({status: "retrying"}, NOW), "in_flight");
    assert.equal(requeueDecision({status: "sending", leaseUntilMs: NOW + 1},
        NOW), "in_flight");
  });

  it("picks the furthest update on the timeline, not the newest write", () => {
    const at = (ms) => ({toMillis: () => ms});
    assert.equal(latestCustomerUpdate([]), null);
    assert.equal(latestCustomerUpdate([
      {label: "Automatic carrier tracking started", customerUpdate: null},
    ]), null);
    // The carrier's "at the port" is not ready for pickup; in the legacy
    // set it is the arrival's message.
    assert.equal(latestCustomerUpdate([
      {customerUpdate: "shipped", timestamp: at(1)},
      {customerUpdate: "at_port", timestamp: at(2)},
    ]), "shipped");
    assert.equal(latestCustomerUpdate([
      {customerUpdate: "shipped", timestamp: at(1)},
      {customerUpdate: "at_port", timestamp: at(2)},
    ], "legacy"), "arrived");
    assert.equal(latestCustomerUpdate([
      {customerUpdate: "at_port", timestamp: at(2)},
      {customerUpdate: "arrived", timestamp: at(3)},
    ]), "arrived");
    // The carrier's "on the ship", switched on late, after staff said
    // arrived: the current news is still "arrived".
    assert.equal(latestCustomerUpdate([
      {customerUpdate: "arrived", timestamp: at(5)},
      {customerUpdate: "shipped", timestamp: at(9)},
    ]), "arrived");
    assert.equal(latestCustomerUpdate([{customerUpdate: "bogus"}]), null);
  });

  it("ranks updates in the order a box travels", () => {
    assert.ok(updateRank("received") > 0);
    assert.ok(updateRank("received") < updateRank("shipped"));
    assert.ok(updateRank("shipped") < updateRank("at_port"));
    assert.ok(updateRank("at_port") < updateRank("arrived"));
    assert.equal(updateRank("loading"), 0);
  });
});

describe("what the line says about its latest news", () => {
  it("replaces a person's entry for the same update, keeping the others",
      () => {
        const before = {update: "shipped", atMs: 1, results: [
          {role: "sender", status: "queued"},
          {role: "receiver", status: "skipped", reason: "no_phone"},
        ]};
        assert.deepEqual(
            mergeLastCustomerUpdate(before, "shipped",
                [{role: "sender", status: "sent"}], 2),
            {update: "shipped", atMs: 2, results: [
              {role: "receiver", status: "skipped", reason: "no_phone"},
              {role: "sender", status: "sent"},
            ]});
      });

  it("starts again for newer news and ignores older news finishing late",
      () => {
        const shipped = {update: "shipped", atMs: 1,
          results: [{role: "sender", status: "sent"}]};
        assert.deepEqual(
            mergeLastCustomerUpdate(shipped, "arrived",
                [{role: "receiver", status: "queued"}], 3),
            {update: "arrived", atMs: 3,
              results: [{role: "receiver", status: "queued"}]});
        const arrived = {update: "arrived", atMs: 3, results: []};
        assert.equal(mergeLastCustomerUpdate(arrived, "shipped",
            [{role: "sender", status: "sent"}], 4), null);
        // The drop-off message finishing after the box shipped.
        assert.equal(mergeLastCustomerUpdate(shipped, "received",
            [{role: "sender", status: "sent"}], 5), null);
        // A line summarised as "at the port" before the arrival merged.
        assert.equal(mergeLastCustomerUpdate(
            {update: "at_port", atMs: 2, results: []}, "arrived",
            [{role: "sender", status: "queued"}], 6).update, "arrived");
      });

  it("writes nothing when nobody's news changed", () => {
    assert.equal(mergeLastCustomerUpdate(null, "shipped", [], 1), null);
    assert.deepEqual(mergeLastCustomerUpdate(null, "shipped",
        [{role: "sender", status: "waiting_for_whatsapp"}], 1),
    {update: "shipped", atMs: 1,
      results: [{role: "sender", status: "waiting_for_whatsapp"}]});
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

  // Regression: the trigger sent every message itself, one after another,
  // so a big container ran out of time, nothing was retried, and a crash
  // between create() and send left a row "sending" for good.
  it("only queues when a moment is recorded, and waits while WhatsApp is off",
      () => {
        const body = section("exports.sendContainerCustomerUpdates",
            "\nexports.");
        assert.ok(body.includes(
            "document: \"containers/{containerId}/trackingEvents/{eventId}\""));
        assert.match(body, /queueContainerUpdate\(db, lines\.docs/);
        assert.match(body, /"waiting_for_whatsapp"/);
        assert.match(body, /CONTAINER_UPDATE_STATUS\.QUEUED/);
        assert.match(body, /requeue: false/);
        assert.doesNotMatch(body, /sendWhatsAppMessage\(/);
        // One row per person per update: created only if absent.
        const queue = section("async function queueContainerLineUpdate(",
            "\n}\n");
        assert.match(queue, /db\.runTransaction\(/);
        assert.match(queue, /tx\.create\(rowRefs\[i\]/);
        assert.match(queue, /containerUpdateMessageId\(lineRef\.id, who\.role/);
        assert.match(queue, /mergeLastCustomerUpdate\(/);
        // Lines are worked on a few at a time, not one long serial loop.
        const all = section("async function queueContainerUpdate(", "\n}\n");
        assert.match(all, /inGroups\(lineDocs, 10\)/);
        assert.match(all, /Promise\.all\(/);
        // Keyed by the message: "at the port" queues the arrival's row.
        assert.match(body,
            /const update = messageUpdateFor\(moment\.customerUpdate\)/);
      });

  it("queues package_received wherever a package is registered", () => {
    const helper = section("async function queuePackageReceived(", "\n}\n");
    assert.match(helper, /queueContainerLineUpdate\(db, \{/);
    assert.match(helper, /update: CONTAINER_UPDATE\.RECEIVED/);
    assert.match(helper, /containerWhatsAppConfigured\(\)/);
    assert.match(helper, /CONTAINER_UPDATE_STATUS\.WAITING/);
    assert.match(helper, /requeue: false/);
    // A messaging failure never fails the registration.
    assert.match(helper, /catch \(error\) \{\s*logger\.error/);
    for (const name of ["addContainerLine", "addWaitingPackage"]) {
      const body = section(`exports.${name} = onCall(`, "\nexports.");
      assert.match(body,
          /secrets: \[whatsappAccessToken, whatsappPhoneNumberId\]/, name);
      // After the line is written, never inside its transaction.
      const queued = body.indexOf("await queuePackageReceived(db, {lineRef");
      assert.ok(queued > body.lastIndexOf("await addLine();"), name);
    }
  });

  it("builds each message at send time from the line, box and business",
      () => {
        const body = section("exports.deliverContainerCustomerUpdate",
            "\nexports.");
        assert.match(body,
            /db\.collection\("containers"\)\.doc\(containerId\)/);
        assert.match(body, /businessPhone: business\.phone/);
        assert.match(body, /if \(!message\) \{/);
      });

  it("sends each queued row on its own, claimed, bounded and retried", () => {
    const body = section("exports.deliverContainerCustomerUpdate",
        "\nexports.");
    assert.ok(body.includes("document: \"containerUpdates/{messageId}\""));
    assert.match(body, /onDocumentWritten\(/);
    assert.match(body, /retry: true/);
    assert.match(body,
        /secrets: \[whatsappAccessToken, whatsappPhoneNumberId\]/);
    assert.match(body, /shouldSendQueuedRow\(before, after\)/);
    // The claim is a transaction that takes a lease.
    assert.match(body, /claimContainerUpdate\(row, nowMs, \{eventAgeMs\}\)/);
    assert.match(body, /leaseUntilMs: nowMs \+ WHATSAPP_SEND_LEASE_MS/);
    // Transient failures throw so the platform retries; permanent ones and
    // give-ups do not.
    assert.match(body,
        /statusAfterAttempt\(\s*whatsappSendOutcome\(sent\), claim\.attempts/);
    assert.match(body,
        /if \(status === CONTAINER_UPDATE_STATUS\.RETRYING\) \{\s*throw/);
    assert.match(body, /claim\.action === "busy"\) \{[\s\S]*?throw new Error/);
    // The line's summary is written by the sender, with the row.
    assert.match(body, /recordContainerUpdateAttempt\(/);
    const record = section("async function recordContainerUpdateAttempt(",
        "\n}\n");
    assert.match(record, /db\.runTransaction\(/);
    assert.match(record, /lastCustomerUpdate: merged/);
  });

  it("gives up on a hung WhatsApp request", () => {
    const send = section("async function sendWhatsAppMessage(", "\n}\n");
    assert.match(send, /signal: AbortSignal\.timeout\(WHATSAPP_TIMEOUT_MS\)/);
    assert.match(send, /httpStatus: 0/);
  });

  it("sends the current status by hand, gated on containers and WhatsApp",
      () => {
        const body = section("exports.sendContainerCurrentStatus = onCall(",
            "\nexports.");
        assert.match(body, /loadContainerFor\(db, uid, businessId/);
        assert.match(body, /if \(!containerWhatsAppConfigured\(\)\)/);
        assert.match(body, /latestCustomerUpdate\(/);
        assert.match(body, /requeue: true/);
        assert.match(body,
            /secrets: \[whatsappAccessToken, whatsappPhoneNumberId\]/);
        assert.match(body, /containerAudit\(/);
      });

  // Regression: the container was marked shipped first; if the line batch
  // then failed, lines stayed "loading" and a retry was refused.
  it("moves the lines before the container, and lets a repeat repair", () => {
    const body = section("async function applyContainerStatus(",
        "\nasync function bringLinesToStatus(");
    const lines = body.indexOf("await bringLinesToStatus(db, lineDocs, next)");
    const container = body.indexOf("await ref.set(update");
    assert.ok(lines > -1 && container > lines,
        "lines must be written before the container's status");
    // ...and a last pass for a line added while they were being written.
    assert.ok(body.indexOf("bringLinesToStatus(db, late, next)") > container);
    const bring = section("async function bringLinesToStatus(",
        "\nasync function recordContainerEvent(");
    assert.match(bring, /assignMissingLineCodes\(db, lineDocs\)/);
    assert.ok(bring.indexOf("assignMissingLineCodes") <
      bring.indexOf("batch.update(d.ref"));
    assert.match(bring, /releaseContainerVinLocks\(db, lineDocs\)/);
    const status = section("exports.setContainerStatus = onCall(",
        "\nexports.");
    assert.match(status, /containerStatusIsRepeat\(current, next\)/);
    assert.match(status, /linesLagStatus\(/);
    assert.match(status, /repair: repeat/);
    // The moment is written on every path, before the audit.
    assert.ok(status.indexOf("recordContainerEvent(") <
      status.indexOf("containerAudit("));
  });

  it("assigns a missing code in a transaction that keeps a stored one", () => {
    const body = section("async function assignMissingLineCodes(", "\n}\n");
    assert.match(body, /db\.runTransaction\(/);
    assert.match(body, /keepExisting\(fresh\.data\(\)\?\.trackingCode/);
    assert.match(body, /if \(!fresh\.exists\) return "";/);
  });

  it("polls containers before shipments, with timeouts on the feed", () => {
    const poll = section("exports.pollContainerTracking = onSchedule(",
        "\nasync function pollOneCarrierTrackedShipment(");
    assert.ok(poll.indexOf("pollOneTrackedContainer(db, doc)") <
      poll.indexOf("pollOneCarrierTrackedShipment("));
    const request = section("async function terminal49Request(", "\n}\n");
    assert.match(request, /signal: AbortSignal\.timeout\(/);
  });

  // Regression: with the placeholder key the trigger asked Terminal49
  // anyway, was refused, and stamped the box "carrier unknown" for good.
  it("never asks the carrier feed with the placeholder key", () => {
    const body = section("exports.startContainerCarrierTracking",
        "\nexports.");
    assert.match(body, /if \(!terminal49Configured\(\)\) return;/);
    const check = section("function terminal49Configured(", "\n}\n");
    assert.match(check, /"unset"/);
  });

  // Regression: the history said "Changed receiverPhone" and "1 barrels".
  // The labels and the barrel phrase live with the other line rules now.
  it("names changed contact fields and counts barrels in words", () => {
    const manifest = readFileSync(
        path.join(__dirname, "..", "container_manifest.js"), "utf8");
    assert.match(manifest, /receiverPhone: "receiver's phone"/);
    assert.match(manifest, /LINE_FIELD_LABELS\[key\] \|\| key/);
    assert.doesNotMatch(source, /\.quantity\} barrels`/);
    assert.doesNotMatch(manifest, /\.quantity\} barrels`/);
    assert.doesNotMatch(source, /const CONTACT_FIELD_LABELS/);
    assert.doesNotMatch(source, /function barrelsLabel\(/);
  });

  it("follows a numbered container on the carrier feed and polls it", () => {
    assert.match(source,
        /exports\.startContainerCarrierTracking = onDocumentWritten\(/);
    assert.match(source, /pollOneTrackedContainer\(db, doc\)/);
    assert.match(source, /where\("carrierTrackingDone", "==", false\)/);
  });
});

describe("templates still in review", () => {
  const {
    TEMPLATE_NOT_READY_CODES,
    TEMPLATE_WAIT_MAX_MS,
    templateWaitDecision,
  } = require("../container_updates");

  it("Meta's 'template not available yet' waits instead of failing", () => {
    assert.ok(TEMPLATE_NOT_READY_CODES.includes(132001));
    const outcome = whatsappSendOutcome(
        {ok: false, httpStatus: 404, errorCode: 132001});
    assert.equal(outcome, "await_template");
    assert.equal(statusAfterAttempt(outcome, 1),
        UPDATE_STATUS.WAITING_TEMPLATE);
    // Even past the attempt limit it waits: the attempt is not counted.
    assert.equal(statusAfterAttempt(outcome, WHATSAPP_MAX_ATTEMPTS + 3),
        UPDATE_STATUS.WAITING_TEMPLATE);
  });

  it("other Meta refusals still fail for good", () => {
    assert.equal(whatsappSendOutcome(
        {ok: false, httpStatus: 400, errorCode: 132000}), "failed");
    assert.equal(whatsappSendOutcome(
        {ok: false, httpStatus: 400, errorCode: 131026}), "failed");
    assert.equal(whatsappSendOutcome({ok: false, httpStatus: 400}), "failed");
  });

  it("the sweep re-queues a waiting row, expires an old one, skips others",
      () => {
        const now = Date.UTC(2026, 9, 17, 12);
        const fresh = {status: UPDATE_STATUS.WAITING_TEMPLATE,
          createdAt: new Date(now - 60 * 60 * 1000)};
        const old = {status: UPDATE_STATUS.WAITING_TEMPLATE,
          createdAt: new Date(now - TEMPLATE_WAIT_MAX_MS - 1)};
        assert.equal(templateWaitDecision(fresh, now), "requeue");
        assert.equal(templateWaitDecision(old, now), "expire");
        assert.equal(templateWaitDecision(
            {status: UPDATE_STATUS.FAILED, createdAt: new Date(now)}, now),
        "skip");
        assert.equal(templateWaitDecision(null, now), "skip");
        // No timestamps at all: try again rather than drop it.
        assert.equal(templateWaitDecision(
            {status: UPDATE_STATUS.WAITING_TEMPLATE}, now), "requeue");
      });

  it("sending the current status leaves a template-waiting row alone", () => {
    assert.equal(requeueDecision(
        {status: UPDATE_STATUS.WAITING_TEMPLATE}, Date.now()), "in_flight");
  });

  it("the half-hourly sweep is wired to the queue", () => {
    const source = readFileSync(path.join(__dirname, "..", "index.js"),
        "utf8");
    const start = source.indexOf("exports.requeueTemplateWaitingUpdates");
    assert.ok(start > 0, "sweep is exported");
    const body = source.slice(start, start + 2500);
    assert.match(body, /every 30 minutes/);
    assert.match(body, /CONTAINER_UPDATE_STATUS\.WAITING_TEMPLATE/);
    assert.match(body, /templateWaitDecision/);
    assert.match(body, /CONTAINER_UPDATE_STATUS\.QUEUED/);
    assert.match(source, /errorCode: Number\(data\?\.error\?\.code\)/);
  });
});
