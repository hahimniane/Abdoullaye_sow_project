"use strict";

// "Send a package" inside WhatsApp (docs/PACKAGE_PRICE_LIST.md §5).

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {describe, it} = require("node:test");

const flow = require("../whatsapp_package_flow");

const HOURS = {mon: {open: true, from: "09:00", to: "18:00"},
  tue: {open: true, from: "09:00", to: "18:00"},
  wed: {open: true, from: "09:00", to: "18:00"},
  thu: {open: true, from: "09:00", to: "18:00"},
  fri: {open: true, from: "09:00", to: "18:00"},
  sat: {open: true, from: "10:00", to: "14:00"},
  sun: {open: false, from: "", to: ""}};

const option = (id, name, extra = {}) => ({
  businessId: id, businessName: name, country: {id: "gn", name: "Guinea"},
  barrelPriceCents: 15000, timeZone: "America/New_York",
  bringIn: {available: true, locations: [{id: "hq", label: "Office",
    address: "1 Main St", hours: HOURS}]},
  collect: {available: true, areas: "Bronx"},
  routes: {sea: {items: [], perLbCents: {clothing: 300}},
    air: {items: [{id: "i_phone", categoryId: "electronics",
      label: "Phone", priceCents: 4000, includedLb: 2}],
    perLbCents: {clothing: 800}}},
  departures: {sea: {dateKey: "", source: "none", approximate: false},
    air: {dateKey: "2026-11-07", source: "schedule", approximate: false}},
  shipsByAir: true, rating: 4.5, reviewCount: 3, coversLoss: true,
  ...extra,
});

/**
 * @param {object} [over] Overrides.
 * @return {object} A flow with in-memory deps and what it recorded.
 */
function harness(over = {}) {
  const sessions = new Map([["tok", {phone: "+16465550100", lang: "en",
    slug: "", profileName: "Fatou", expiresAtMs: 9e15}]]);
  const created = [];
  const options = over.options || [option("a", "Atlantic"),
    option("b", "Baobab", {routes: {sea: null, air: {items: [{id: "i_phone",
      categoryId: "electronics", label: "Phone", priceCents: 3500,
      includedLb: 0}], perLbCents: {clothing: 900}}}})];
  const deps = {
    loadSession: async (t) => sessions.get(t) || null,
    saveSession: async (t, patch) => {
      const s = {...sessions.get(t)};
      for (const [k, v] of Object.entries(patch)) {
        if (k.startsWith("screens.")) {
          s.screens = {...(s.screens || {}), [k.slice(8)]: v};
        } else {
          s[k] = v;
        }
      }
      sessions.set(t, s);
    },
    loadOptions: async () => ({business: null, options}),
    pickupQuotes: async (address, ids) => ids.map((id) => ({businessId: id,
      available: id !== "b", priced: id === "a", feeCents: id === "a" ?
        1800 : null})),
    createRequest: async (data) => {
      created.push(data);
      return {code: "R-B2C3D", token: "t".repeat(43), status: "confirmed"};
    },
    nowMs: () => 1,
    todayKey: () => "2026-11-03",
    nowMinutes: () => 600,
    ...over.deps,
  };
  return {f: flow.createPackageFlow(deps), sessions, created};
}

const step = (f, screen, data) => f.handle({version: "3.0",
  action: "data_exchange", screen, flow_token: "tok",
  data: {screen, ...data}});

describe("whatsapp package flow", () => {
  it("encrypts the way Meta decrypts, and back", () => {
    const {privateKey, publicKey} = crypto.generateKeyPairSync("rsa",
        {modulusLength: 2048});
    const aesKey = crypto.randomBytes(16);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-128-gcm", aesKey, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify({action:
      "ping", version: "3.0"})), cipher.final(), cipher.getAuthTag()]);
    const body = {
      encrypted_flow_data: data.toString("base64"),
      encrypted_aes_key: crypto.publicEncrypt({key: publicKey,
        padding: crypto.constants.RSA_PKCS1_OAEP_PADDING,
        oaepHash: "sha256"}, aesKey).toString("base64"),
      initial_vector: iv.toString("base64"),
    };
    const pem = privateKey.export({type: "pkcs8", format: "pem"});
    const out = flow.decryptFlowRequest(body, pem);
    assert.deepEqual(out.payload, {action: "ping", version: "3.0"});
    const reply = Buffer.from(flow.encryptFlowResponse({data: {status:
      "active"}}, out.aesKey, out.iv), "base64");
    const flipped = Buffer.from(iv.map((b) => ~b & 0xff));
    const decipher = crypto.createDecipheriv("aes-128-gcm", aesKey,
        flipped);
    decipher.setAuthTag(reply.subarray(reply.length - 16));
    const plain = Buffer.concat([decipher.update(reply.subarray(0,
        reply.length - 16)), decipher.final()]).toString("utf8");
    assert.deepEqual(JSON.parse(plain), {data: {status: "active"}});
  });

  it("opens on the send words, and on SEND <business>", () => {
    assert.deepEqual(flow.openRequest("send a package"), {slug: ""});
    assert.deepEqual(flow.openRequest("envoyer un colis"), {slug: ""});
    assert.deepEqual(flow.openRequest("send nensona auto"),
        {slug: "nensona-auto"});
    assert.equal(flow.openRequest("where is my package"), null);
    assert.equal(flow.openRequest("colis"), null);
    assert.equal(flow.openRequest(""), null);
  });

  it("the flow json routes forward to one terminal screen", () => {
    const json = flow.flowJson();
    const ids = json.screens.map((s) => s.id);
    assert.deepEqual(ids, flow.SCREENS);
    assert.deepEqual(json.routing_model.REVIEW, []);
    for (const [from, tos] of Object.entries(json.routing_model)) {
      for (const to of tos) {
        assert.ok(ids.includes(to));
        assert.ok(!(json.routing_model[to] || []).includes(from), "forward");
      }
    }
    for (const screen of json.screens) {
      const footers = screen.layout.children.filter((c) =>
        c.type === "Footer");
      assert.equal(footers.length, 1, screen.id);
      for (const [key, decl] of Object.entries(screen.data)) {
        assert.ok("__example__" in decl, `${screen.id}.${key}`);
      }
    }
    assert.equal(json.screens.find((s) => s.id === "REVIEW").terminal,
        true);
  });

  it("answers Meta's health check", async () => {
    const {f} = harness();
    assert.deepEqual(await f.handle({action: "ping", version: "3.0"}),
        {data: {status: "active"}});
  });

  it("walks a whole Air order to a request, comparing two businesses",
      async () => {
        const {f, created, sessions} = harness();
        const init = await f.handle({action: "INIT", flow_token: "tok"});
        assert.equal(init.screen, "WHERE");
        assert.deepEqual(init.data.countries, [{id: "gn", title: "Guinea",
          description: ""}]);
        const items = await step(f, "WHERE", {country: "gn", mode: "air"});
        assert.equal(items.screen, "ITEMS");
        assert.deepEqual(items.data.items.map((i) => i.id),
            ["i:electronics|phone", "lb:clothing", "ask:box",
              "ask:suitcase"]);
        assert.match(items.data.items[0].description, /From \$35/);
        const amounts = await step(f, "ITEMS", {item_1: "i:electronics|phone",
          item_2: "lb:clothing"});
        assert.equal(amounts.screen, "AMOUNTS");
        // Each chosen item asks its own question: a count, or pounds.
        assert.equal(amounts.data.l_qty_1, "How many");
        assert.equal(amounts.data.h_qty_1, "Phone");
        assert.equal(amounts.data.l_qty_2, "Weight (lb)");
        assert.equal(amounts.data.show_2, true);
        assert.equal(amounts.data.show_3, false);
        assert.match(amounts.data.l_intro, /by the pound/);
        const how = await step(f, "AMOUNTS", {qty_1: "2", qty_2: "50"});
        assert.equal(how.screen, "HOW");
        assert.deepEqual(how.data.hows.map((h) => h.id),
            ["bring_in", "collect"]);
        const pick = await step(f, "HOW", {how: "bring_in"});
        assert.equal(pick.screen, "PICK");
        // Atlantic: 2 × 40 + 50 × 8 = 480; Baobab: 2 × 35 + 50 × 9 = 520.
        assert.deepEqual(pick.data.businesses.map((b) => b.id), ["a", "b"]);
        assert.match(pick.data.businesses[0].description,
            /^about \$480 · Next flight: Sat, Nov 7 · ★ 4.5/);
        const when = await step(f, "PICK", {business: "a"});
        assert.equal(when.screen, "WHEN");
        assert.equal(when.data.whens[0].id, "2026-11-03|11:00|13:00|hq",
            "today, after now (10:00)");
        assert.equal(when.data.whens[0].title, "Tue, Nov 3, 11 AM–1 PM");
        const people = await step(f, "WHEN",
            {when: "2026-11-04|09:00|11:00|hq"});
        assert.equal(people.screen, "PEOPLE");
        assert.equal(people.data.sender_name, "Fatou");
        const review = await step(f, "PEOPLE", {sender_name: "Fatou D",
          receiver_name: "Mariama", receiver_phone: "224 620 00 00 00"});
        assert.equal(review.screen, "REVIEW");
        assert.match(review.data.summary, /Total: about \$480/);
        const done = await step(f, "REVIEW", {});
        assert.equal(done.screen, "SUCCESS");
        assert.equal(done.data.extension_message_response.params.request_code,
            "R-B2C3D");
        assert.equal(created.length, 1);
        assert.deepEqual(created[0], {
          businessId: "a", destinationCountryId: "gn", handoff: "bring_in",
          shipMode: "air", channel: "whatsapp", foundVia: "laawol",
          locationId: "hq", plannedDate: "2026-11-04",
          plannedWindow: {from: "09:00", to: "11:00"},
          sender: {name: "Fatou D", phoneE164: "+16465550100"},
          receiver: {name: "Mariama", phoneE164: "+224620000000"},
          pieces: [{priceItemId: "i_phone", quantity: 2, label: "Phone",
            kind: "other"}, {categoryId: "clothing", weightLb: 50,
            kind: "other"}],
          language: "en", idempotencyKey: "wa-tok",
        });
        assert.equal(sessions.get("tok").requestCode, "R-B2C3D");
      });

  it("a pickup compares with each business's fee and drops who can't",
      async () => {
        const {f} = harness();
        await f.handle({action: "INIT", flow_token: "tok"});
        await step(f, "WHERE", {country: "gn", mode: "sea"});
        await step(f, "ITEMS", {item_1: "lb:clothing"});
        await step(f, "AMOUNTS", {qty_1: "20"});
        assert.equal((await step(f, "HOW", {how: "collect"})).data
            .error_message, "Enter the pickup address.");
        const out = await step(f, "HOW", {how: "collect",
          address: "1 Grand Concourse, Bronx"});
        // Baobab does not reach the address: Atlantic alone, so no
        // comparison - straight to the time.
        assert.equal(out.screen, "WHEN");
        assert.equal(out.data.whens[0].id, "2026-11-03|11:00|13:00|");
      });

  it("only something else skips the amounts screen", async () => {
    const {f} = harness();
    await f.handle({action: "INIT", flow_token: "tok"});
    await step(f, "WHERE", {country: "gn", mode: "sea"});
    const how = await step(f, "ITEMS", {other: "A box of shoes"});
    assert.equal(how.screen, "HOW");
  });

  it("always offers a box and a suitcase; the business quotes them",
      async () => {
        const {f, created} = harness();
        await f.handle({action: "INIT", flow_token: "tok"});
        await step(f, "WHERE", {country: "gn", mode: "sea"});
        const amounts = await step(f, "ITEMS", {item_1: "ask:box"});
        assert.equal(amounts.data.l_qty_1, "How many");
        assert.equal(amounts.data.h_qty_1, "Box");
        assert.equal(amounts.data.l_intro, "How many of each?");
        await step(f, "AMOUNTS", {qty_1: "3"});
        assert.equal(created.length, 0);
        assert.deepEqual(flow.piecesFor([{kind: "ask", label: "Box",
          amount: 2}], null, ""), [{kind: "box", description: "Box"},
          {kind: "box", description: "Box"}]);
      });

  it("refuses bad amounts and an expired form", async () => {
    const {f, sessions} = harness();
    await f.handle({action: "INIT", flow_token: "tok"});
    await step(f, "WHERE", {country: "gn", mode: "air"});
    await step(f, "ITEMS", {item_1: "i:electronics|phone"});
    const bad = await step(f, "AMOUNTS", {qty_1: "1.5"});
    assert.equal(bad.screen, "AMOUNTS");
    assert.match(bad.data.error_message, /Check the amounts/);
    sessions.set("tok", {...sessions.get("tok"), expiresAtMs: 0});
    const gone = await step(f, "ITEMS", {});
    assert.match(gone.data.error_message, /expired/);
  });

  it("speaks French when the customer does", async () => {
    const {f, sessions} = harness();
    sessions.set("tok", {...sessions.get("tok"), lang: "fr"});
    const init = await f.handle({action: "INIT", flow_token: "tok"});
    assert.equal(init.data.l_title, "Envoyer un colis");
    assert.deepEqual(init.data.modes.map((m) => m.title),
        ["Bateau", "Avion"]);
    assert.equal(flow.money(48000, "fr"), "480 $");
    assert.equal(flow.dayText("2026-11-07", "fr"), "sam. 7 nov.");
  });

  it("labels stay inside Meta's limits", () => {
    for (const lang of ["en", "fr"]) {
      for (const screen of flow.SCREENS) {
        const l = flow.labels(screen, lang);
        for (const [key, value] of Object.entries(l)) {
          if (["l_title", "l_intro", "l_pay", "l_other_help",
            "l_address_help", "l_phone_help", "show_pay"].includes(key)) {
            continue;
          }
          const max = key === "l_next" ? 35 : 20;
          assert.ok(String(value).length <= max,
              `${lang} ${screen}.${key} "${value}"`);
        }
      }
    }
  });

  it("the open message carries the flow", () => {
    const body = flow.flowMessageBody({phone: "+16465550100",
      flowId: "123", flowToken: "tok", lang: "fr", businessName: "Nensona"});
    assert.equal(body.to, "16465550100");
    assert.equal(body.interactive.action.parameters.flow_id, "123");
    assert.equal(body.interactive.action.parameters.flow_cta,
        "Envoyer un colis");
    assert.match(body.interactive.body.text, /Nensona/);
  });
});
