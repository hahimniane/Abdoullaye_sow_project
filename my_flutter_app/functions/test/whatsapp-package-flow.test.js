"use strict";

// "Send a package" inside WhatsApp (docs/PACKAGE_PRICE_LIST.md §5).

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {describe, it} = require("node:test");

const flow = require("../whatsapp_package_flow");
const media = require("../whatsapp_flow_media");
const priceList = require("../package_price_list");
const {BOX_SIZE_IMAGES} = require("../box_size_images");

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

  it("the flow json is a sound Flow: reachable, referenced, small",
      () => {
        const json = flow.flowJson();
        assert.equal(json.version, "6.0", "PhotoPicker 4.0, pictures 5.0");
        assert.ok(Number(json.version) >= 5);
        assert.equal(json.data_api_version, "3.0");
        assert.ok(Number.isInteger(flow.FLOW_REVISION));
        assert.ok(Buffer.byteLength(JSON.stringify(json)) < 10 * 1024 *
          1024, "Meta's 10 MB limit");
        assert.ok(Buffer.byteLength(JSON.stringify(json)) < 100 * 1024,
            "the pictures travel in the endpoint's data, not the JSON");
        const ids = json.screens.map((s) => s.id);
        assert.equal(new Set(ids).size, ids.length);
        assert.deepEqual(Object.keys(json.routing_model).sort(),
            [...ids].sort(), "one routing entry per screen");
        const inbound = new Set(Object.values(json.routing_model).flat());
        assert.deepEqual(ids.filter((id) => !inbound.has(id)), ["WHERE"],
            "one entry screen");
        for (const tos of Object.values(json.routing_model)) {
          assert.ok(tos.length <= 10, "Meta's 10 branches");
        }
        // Every screen is reachable from the entry and reaches the end.
        const walk = (from, edges, seen = new Set()) => {
          if (seen.has(from)) return seen;
          seen.add(from);
          for (const to of edges[from] || []) walk(to, edges, seen);
          return seen;
        };
        assert.deepEqual([...walk("WHERE", json.routing_model)].sort(),
            [...ids].sort(), "every screen is reachable");
        const back = {};
        for (const [from, tos] of Object.entries(json.routing_model)) {
          for (const to of tos) (back[to] = back[to] || []).push(from);
        }
        const terminal = json.screens.filter((s) => s.terminal)
            .map((s) => s.id);
        assert.deepEqual(terminal, ["REVIEW"]);
        assert.deepEqual([...walk("REVIEW", back)].sort(), [...ids].sort(),
            "every screen reaches the terminal screen");
        assert.ok(json.routing_model.AMOUNTS.includes("BOXES"));
        assert.deepEqual(json.routing_model.BOXES, ["HOW"]);

        for (const screen of json.screens) {
          const text = JSON.stringify(screen.layout);
          for (const [, key] of text.matchAll(/\$\{data\.([A-Za-z0-9_]+)\}/g)) {
            assert.ok(key in screen.data, `${screen.id} uses data.${key}`);
          }
          const names = [];
          const visit = (node) => {
            if (node.name) names.push(node.name);
            (node.children || []).forEach(visit);
          };
          visit(screen.layout);
          for (const [, key] of text.matchAll(/\$\{form\.([A-Za-z0-9_]+)\}/g)) {
            assert.ok(names.includes(key), `${screen.id} sends form.${key}`);
          }
          const footer = screen.layout.children.find((c) =>
            c.type === "Footer");
          assert.equal(footer["on-click-action"].payload.screen, screen.id);
          assert.ok(screen.layout.children.filter((c) =>
            c.type === "PhotoPicker").length <= 1, "one picker a screen");
        }
        const boxes = json.screens.find((s) => s.id === "BOXES");
        const picker = boxes.layout.children.find((c) =>
          c.type === "PhotoPicker");
        assert.equal(picker["max-uploaded-photos"], 3);
        assert.equal(picker["min-uploaded-photos"], 0, "optional");
        assert.ok(picker["max-file-size-kb"] * 1024 <
          require("../package_requests").PHOTO_MAX_BYTES);
        assert.equal(boxes.layout.children.filter((c) => c.name &&
          c.name.startsWith("dims_") && c.required === false).length, 4);
        assert.equal(boxes.layout.children.find((c) =>
          c.type === "Footer")["on-click-action"].payload.photos,
        "${form.photos}", "a top-level string, as Meta requires");
        const items = json.screens.find((s) => s.id === "ITEMS");
        assert.ok("image" in items.data.items.items.properties,
            "the item rows may carry a picture");
      });

  it("every screen the endpoint shows fills what the Flow declares",
      async () => {
        const json = flow.flowJson();
        const priced = option("a", "Atlantic", {routes: {sea: {items: [],
          perLbCents: {}, boxPricesCents: {small: 2500}}, air: null},
        shipsByAir: false});
        const {f} = harness({options: [priced]});
        const seen = [];
        const check = (out) => {
          if (out.screen === "SUCCESS") return out;
          const declared = Object.keys(json.screens.find((s) =>
            s.id === out.screen).data);
          for (const key of declared) {
            assert.ok(key in out.data, `${out.screen} lacks ${key}`);
          }
          seen.push(out.screen);
          return out;
        };
        check(await f.handle({action: "INIT", flow_token: "tok"}));
        check(await step(f, "WHERE", {country: "gn", mode: "sea"}));
        check(await step(f, "ITEMS", {item_1: "box:small"}));
        check(await step(f, "AMOUNTS", {qty_1: "1"}));
        check(await step(f, "BOXES", {dims_1: "10x10x10"}));
        check(await step(f, "HOW", {how: "bring_in"}));
        check(await step(f, "WHEN", {when: "2026-11-04|09:00|11:00|hq"}));
        check(await step(f, "PEOPLE", {sender_name: "F", receiver_name: "M",
          receiver_phone: "224 620 00 00 00"}));
        assert.deepEqual(seen, ["WHERE", "ITEMS", "AMOUNTS", "BOXES", "HOW",
          "WHEN", "PEOPLE", "REVIEW"]);
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
            weightUnit: "lb", kind: "other"}],
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

  it("Sea sells boxes by size with a picture and the price; Air keeps one " +
      "Box", async () => {
    const priced = option("a", "Atlantic", {routes: {sea: {items: [],
      perLbCents: {}, boxPricesCents: {small: 2500, medium: 3500,
        large: 5000}}, air: null}, shipsByAir: false,
    barrelPriceCents: null});
    const {f} = harness({options: [priced]});
    await f.handle({action: "INIT", flow_token: "tok"});
    const sea = await step(f, "WHERE", {country: "gn", mode: "sea"});
    assert.deepEqual(sea.data.items.map((i) => i.id), ["box:small",
      "box:medium", "box:large", "box:xl", "ask:suitcase"]);
    assert.deepEqual(sea.data.items.map((i) => i.title), ["Small box",
      "Medium box", "Large box", "Extra large box", "Suitcase"]);
    assert.equal(sea.data.items[0].description,
        "About a shoebox · $25");
    assert.equal(sea.data.items[1].description,
        "About a microwave box · $35");
    assert.equal(sea.data.items[3].description,
        "Bigger than Large · The business quotes it");
    for (const [i, size] of ["small", "medium", "large", "xl"]
        .entries()) {
      assert.equal(sea.data.items[i].image, BOX_SIZE_IMAGES[size]);
      assert.match(sea.data.items[i].image, /^iVBOR/, "a base64 PNG");
      assert.equal(sea.data.items[i]["alt-text"], sea.data.items[i].title);
    }
    assert.equal(sea.data.items[4].image, undefined);
    // The session keeps no pictures (Firestore's 1 MB document).
    const kept = JSON.stringify(sea.data.items.map(({id, title}) =>
      ({id, title})));
    assert.ok(!kept.includes("iVBOR"));

    // Two businesses: "From", and a size nobody prices is quoted.
    const two = harness({options: [priced, option("b", "Baobab", {routes:
      {sea: {items: [], perLbCents: {}, boxPricesCents: {small: 2000}},
        air: null}, shipsByAir: false, barrelPriceCents: null})]});
    await two.f.handle({action: "INIT", flow_token: "tok"});
    const both = await step(two.f, "WHERE", {country: "gn", mode: "sea"});
    assert.equal(both.data.items[0].description,
        "About a shoebox · From $20");
    assert.equal(both.data.items[2].description,
        "About a TV box · From $50");

    // French.
    const fr = harness({options: [priced]});
    fr.sessions.set("tok", {...fr.sessions.get("tok"), lang: "fr"});
    await fr.f.handle({action: "INIT", flow_token: "tok"});
    const french = await step(fr.f, "WHERE", {country: "gn", mode: "sea"});
    assert.deepEqual(french.data.items.slice(0, 4).map((i) => i.title),
        ["Petite boîte", "Boîte moyenne", "Grande boîte",
          "Très grande boîte"]);
    assert.equal(french.data.items[0].description,
        "Environ une boîte à chaussures · 25 $");
    assert.equal(french.data.items[3].description,
        "Plus grande que Grande · L'entreprise donne son prix");

    // Air: the single Box (the business quotes it), no pictures.
    const air = harness();
    await air.f.handle({action: "INIT", flow_token: "tok"});
    const flight = await step(air.f, "WHERE", {country: "gn", mode: "air"});
    assert.ok(flight.data.items.some((i) => i.id === "ask:box"));
    assert.ok(!flight.data.items.some((i) => i.id.startsWith("box:") ||
      i.image));
    const amounts = await step(air.f, "ITEMS", {item_1: "ask:box"});
    assert.equal(amounts.screen, "AMOUNTS");
    assert.equal(amounts.data.h_qty_1, "Box");
    const how = await step(air.f, "AMOUNTS", {qty_1: "3"});
    assert.equal(how.screen, "HOW", "no boxes screen for the Air box");
    assert.deepEqual(flow.piecesFor([{kind: "ask", label: "Box",
      amount: 2}], null, ""), [{kind: "box", description: "Box"},
      {kind: "box", description: "Box"}]);
  });

  it("the item list keeps its box rows when a country is crowded", () => {
    const items = Array.from({length: 150}, (_, i) => ({id: `i_${i}`,
      categoryId: "electronics", label: `Thing ${String(i).padStart(3,
          "0")}`, priceCents: 1000, includedLb: 0}));
    const rows = flow.catalogFor([option("a", "Atlantic", {routes: {sea:
      {items, perLbCents: {}}, air: null}})], "sea", "en");
    assert.equal(rows.length, 100, "a Dropdown with pictures holds 100");
    assert.deepEqual(rows.slice(-5).map((r) => r.id), ["box:small",
      "box:medium", "box:large", "box:xl", "ask:suitcase"]);
  });

  it("reads inches the ways people type them", () => {
    const ok = (text) => flow.parseDims(text).dims;
    const want = {l: 20, w: 16, h: 14};
    for (const text of ["20x16x14", "20 x 16 x 14", "20*16*14",
      "20,16,14", "20 16 14", "20 X 16 × 14 in", "20x16x14in",
      "20 x 16 x 14 inches", "20\" x 16\" x 14\"", " 20 , 16 , 14 "]) {
      assert.deepEqual(ok(text), want, text);
    }
    assert.deepEqual(ok("20,5 x 16 x 14"), {l: 20.5, w: 16, h: 14});
    assert.deepEqual(ok("20.54 x 16 x 14 po"), {l: 20.5, w: 16, h: 14});
    assert.equal(flow.parseDims("").blank, true);
    assert.equal(flow.parseDims("   ").blank, true);
    assert.equal(flow.parseDims(undefined).blank, true);
    for (const text of ["20x16", "20x16x14x2", "abc", "0x16x14",
      "121x16x14", "20 x sixteen x 14", "-20x16x14", "20x16x", "x",
      "20;;16"]) {
      const out = flow.parseDims(text);
      assert.equal(out.invalid, true, text);
      assert.equal(out.dims, null, text);
    }
    assert.equal(flow.dimsText({l: 20, w: 16.5, h: 14}, "en"),
        "20 × 16.5 × 14 in");
    assert.equal(flow.dimsText({l: 20, w: 16.5, h: 14}, "fr"),
        "20 × 16,5 × 14 po");
  });

  describe("boxes: inches and photos", () => {
    const priced = () => option("a", "Atlantic", {routes: {sea: {items: [],
      perLbCents: {}, boxPricesCents: {small: 2500, medium: 3500,
        large: 5000}}, air: null}, shipsByAir: false,
    barrelPriceCents: null});

    // A photo as the PhotoPicker sends it, with its encrypted file.
    const pickedPhoto = (files, name, plain) => {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const macKey = crypto.randomBytes(32);
      const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      const mac = crypto.createHmac("sha256", macKey).update(iv)
          .update(body).digest().subarray(0, 10);
      const file = Buffer.concat([body, mac]);
      const url = `https://mmg.whatsapp.net/v/${name}`;
      files.set(url, file);
      const sha = (b) => crypto.createHash("sha256").update(b)
          .digest("base64");
      return {media_id: `m-${name}`, cdn_url: url, file_name: `${name}.jpg`,
        encryption_metadata: {encrypted_hash: sha(file),
          iv: iv.toString("base64"), encryption_key: key.toString("base64"),
          hmac_key: macKey.toString("base64"),
          plaintext_hash: sha(plain)}};
    };
    const jpeg = (n = 3000) => Buffer.concat([Buffer.from([0xff, 0xd8,
      0xff, 0xe0]), crypto.randomBytes(n)]);

    // A harness with fake Storage and a fake CDN.
    const boxHarness = () => {
      const files = new Map();
      const storage = new Map();
      const calls = {deleted: [], copied: []};
      const h = harness({options: [priced()], deps: {
        downloadMedia: async (url) => {
          if (!files.has(url)) throw new media.FlowMediaError("media_url");
          return files.get(url);
        },
        storePhoto: async (path, buffer, contentType) => {
          storage.set(path, {buffer, contentType});
        },
        copyPhoto: async (from, to) => {
          calls.copied.push([from, to]);
          storage.set(to, storage.get(from));
        },
        deletePhoto: async (path) => {
          calls.deleted.push(path);
          storage.delete(path);
        },
      }});
      return {...h, files, storage, calls};
    };

    // Walks to the BOXES screen: Small (1) and Large (2).
    const toBoxes = async (h) => {
      await h.f.handle({action: "INIT", flow_token: "tok"});
      await step(h.f, "WHERE", {country: "gn", mode: "sea"});
      await step(h.f, "ITEMS", {item_1: "box:small", item_2: "box:large"});
      return step(h.f, "AMOUNTS", {qty_1: "1", qty_2: "2"});
    };

    it("a box choice leads to the boxes screen, one inches field per size",
        async () => {
          const h = boxHarness();
          const boxes = await toBoxes(h);
          assert.equal(boxes.screen, "BOXES");
          assert.deepEqual([1, 2, 3, 4].map((n) =>
            boxes.data[`show_dims_${n}`]), [true, true, false, false]);
          assert.equal(boxes.data.l_dims_1, "Small box");
          assert.equal(boxes.data.l_dims_2, "Large box");
          assert.equal(boxes.data.e_dims_1, "");
          assert.match(boxes.data.h_dims_1, /Optional.*20 x 16 x 14/);
          assert.equal(boxes.data.l_photos, "Photos (optional)");
        });

    it("invalid inches put an error on that field and stay", async () => {
      const h = boxHarness();
      await toBoxes(h);
      const bad = await step(h.f, "BOXES", {dims_1: "20x16",
        dims_2: "30x24x24"});
      assert.equal(bad.screen, "BOXES");
      assert.equal(bad.data.e_dims_1, "Use 3 numbers: 20 x 16 x 14");
      assert.equal(bad.data.e_dims_2, "");
      assert.match(bad.data.error_message, /Check the inches/);
      assert.ok(bad.data.e_dims_1.length <= 30);
      assert.equal(h.sessions.get("tok").lines[0].dimsIn, undefined,
          "nothing saved");
    });

    it("the size follows the inches; a whole order becomes pieces",
        async () => {
          const h = boxHarness();
          await toBoxes(h);
          const photo = (name) => pickedPhoto(h.files, name, jpeg());
          const how = await step(h.f, "BOXES", {dims_1: "20 x 16 x 14",
            dims_2: "", photos: [photo("one"), photo("two")]});
          assert.equal(how.screen, "HOW");
          const lines = h.sessions.get("tok").lines;
          assert.equal(lines[0].boxSize, "medium", "20x16x14 fits Medium");
          assert.equal(lines[0].chosenSize, "small");
          assert.deepEqual(lines[0].dimsIn, {l: 20, w: 16, h: 14});
          assert.equal(lines[1].boxSize, "large");
          assert.equal(lines[1].dimsIn, undefined);
          assert.equal(h.storage.size, 2, "both photos staged");
          for (const path of h.storage.keys()) {
            assert.match(path,
                /^whatsappFlowPhotos\/tok\/[A-Za-z0-9_-]{20}\.jpg$/);
          }
          // Only one business there: straight to WHEN, then the rest.
          assert.equal(how.screen, "HOW");
          const when = await step(h.f, "HOW", {how: "bring_in"});
          assert.equal(when.screen, "WHEN");
          await step(h.f, "WHEN", {when: "2026-11-04|09:00|11:00|hq"});
          const review = await step(h.f, "PEOPLE", {sender_name: "Fatou",
            receiver_name: "Mariama", receiver_phone: "224 620 00 00 00"});
          assert.equal(review.screen, "REVIEW");
          // Medium $35 + 2 Large $100.
          assert.match(review.data.summary, /Total: \$135/);
          assert.match(review.data.summary,
              /1 × Medium box \(20 × 16 × 14 in → Medium\), 2 × Large box/);
          assert.match(review.data.summary, /Photos: 2/);
          const done = await step(h.f, "REVIEW", {});
          assert.equal(done.screen, "SUCCESS");
          const [one, two] = [...h.storage.keys()].filter((k) =>
            k.startsWith("packageRequestPhotos/"));
          assert.match(one, new RegExp("^packageRequestPhotos/a/" +
            "whatsapp:16465550100/[A-Za-z0-9_-]{20}\\.jpg$"));
          assert.match(two, /^packageRequestPhotos\//);
          const pieces = h.created[0].pieces;
          assert.deepEqual(pieces, [
            {kind: "box", boxSize: "medium", dimsIn: {l: 20, w: 16, h: 14},
              quantity: 1, photoPaths: [one, two]},
            {kind: "box", boxSize: "large", quantity: 2}]);
          assert.ok([one, two].every((p) => h.storage.get(p).contentType ===
            "image/jpeg"));
          assert.equal(h.calls.copied.length, 2);
          assert.equal([...h.storage.keys()].filter((k) =>
            k.startsWith("whatsappFlowPhotos/")).length, 0, "staging gone");
        });

    it("a bigger box moves up; Extra large is quoted; no inches keeps " +
        "the size", async () => {
      const h = boxHarness();
      await toBoxes(h);
      await step(h.f, "BOXES", {dims_1: "40x30x30", dims_2: ""});
      const lines = h.sessions.get("tok").lines;
      assert.equal(lines[0].boxSize, "xl");
      const pieces = flow.piecesFor(lines, null, "");
      assert.equal(pieces[0].boxSize, "xl");
      const route = priceList.routeOf({routes: {gn: priced().routes}}, "gn",
          "sea");
      const basket = priceList.priceBasket(route, pieces, {});
      assert.equal(basket.pricedCents, 10000, "2 Large; the xl is quoted");
      assert.equal(basket.unpricedCount, 1);
      // Typing again without inches starts over.
      await step(h.f, "BOXES", {dims_1: "", dims_2: ""});
      assert.equal(h.sessions.get("tok").lines[0].boxSize, "small");
      assert.equal(h.sessions.get("tok").lines[0].dimsIn, undefined);
    });

    it("refuses a photo it cannot trust, and says so", async () => {
      const h = boxHarness();
      await toBoxes(h);
      const good = pickedPhoto(h.files, "good", jpeg());
      const tampered = pickedPhoto(h.files, "tampered", jpeg());
      const file = h.files.get(tampered.cdn_url);
      file[3] ^= 0xff;
      const notImage = pickedPhoto(h.files, "text", Buffer.from(
          "hello, not a picture"));
      const huge = pickedPhoto(h.files, "huge", Buffer.concat([
        Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(2 * 1024 * 1024)]));
      const wrongHost = {...good, cdn_url: "https://evil.example/x"};
      for (const bad of [tampered, notImage, wrongHost]) {
        const out = await step(h.f, "BOXES", {photos: [good, bad]});
        assert.equal(out.screen, "BOXES");
        assert.match(out.data.error_message, /could not read a photo/);
        assert.equal(h.storage.size, 0, "the good one is not kept either");
      }
      const big = await step(h.f, "BOXES", {photos: [huge]});
      assert.match(big.data.error_message, /too large/);
      const many = await step(h.f, "BOXES", {photos: [good, good, good,
        good]});
      assert.match(many.data.error_message, /at most 3 photos/);
      assert.equal(h.storage.size, 0);
      // The photo step without Storage wired says so, never loses it.
      const bare = harness({options: [priced()]});
      await toBoxes(bare);
      const none = await step(bare.f, "BOXES", {photos: [good]});
      assert.equal(none.screen, "BOXES");
    });

    it("going back and choosing again drops the photos staged before",
        async () => {
          const h = boxHarness();
          await toBoxes(h);
          await step(h.f, "BOXES", {photos: [pickedPhoto(h.files, "p",
              jpeg())]});
          assert.equal(h.storage.size, 1);
          await step(h.f, "ITEMS", {item_1: "box:medium"});
          assert.equal(h.storage.size, 0);
          assert.deepEqual(h.sessions.get("tok").boxPhotos, []);
        });

    it("BACK shows the item list with its pictures again", async () => {
      const h = boxHarness();
      await toBoxes(h);
      const back = await h.f.handle({action: "BACK", screen: "ITEMS",
        flow_token: "tok"});
      assert.equal(back.screen, "ITEMS");
      assert.equal(back.data.items.find((i) => i.id === "box:large").image,
          BOX_SIZE_IMAGES.large);
    });
  });

  describe("photo decryption", () => {
    const make = (plain, over = {}) => {
      const key = crypto.randomBytes(32);
      const iv = crypto.randomBytes(16);
      const macKey = crypto.randomBytes(32);
      const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
      const body = Buffer.concat([cipher.update(plain), cipher.final()]);
      const mac = crypto.createHmac("sha256", macKey).update(iv)
          .update(body).digest().subarray(0, 10);
      const file = Buffer.concat([body, mac]);
      const sha = (b) => crypto.createHash("sha256").update(b)
          .digest("base64");
      return {file, meta: {encrypted_hash: sha(file),
        iv: iv.toString("base64"), encryption_key: key.toString("base64"),
        hmac_key: macKey.toString("base64"), plaintext_hash: sha(plain),
        ...over}};
    };

    it("round-trips a fixture and checks every hash", () => {
      const plain = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]),
        crypto.randomBytes(1000)]);
      const {file, meta} = make(plain);
      assert.ok(media.decryptMedia(file, meta).equals(plain));
      const code = (fn) => {
        try {
          fn();
        } catch (error) {
          return error.code;
        }
        return "";
      };
      const flip = (b, i) => {
        const c = Buffer.from(b);
        c[i] ^= 1;
        return c;
      };
      assert.equal(code(() => media.decryptMedia(flip(file, 0), meta)),
          "media_hash", "the file does not match encrypted_hash");
      const sha = (b) => crypto.createHash("sha256").update(b)
          .digest("base64");
      const tampered = flip(file, 0);
      assert.equal(code(() => media.decryptMedia(tampered, {...meta,
        encrypted_hash: sha(tampered)})), "media_mac",
      "a consistent hash is not enough: the MAC must match");
      const macTampered = flip(file, file.length - 1);
      assert.equal(code(() => media.decryptMedia(macTampered, {...meta,
        encrypted_hash: sha(macTampered)})), "media_mac");
      assert.equal(code(() => media.decryptMedia(file, {...meta,
        plaintext_hash: sha(Buffer.from("other"))})), "media_plain_hash");
      assert.equal(code(() => media.decryptMedia(file, {...meta,
        encryption_key: Buffer.alloc(16).toString("base64")})),
      "media_metadata");
      assert.equal(code(() => media.decryptMedia(file, null)),
          "media_metadata");
      assert.equal(code(() => media.decryptMedia(file.subarray(0, 20),
          {...meta, encrypted_hash: sha(file.subarray(0, 20))})),
      "media_shape");
    });

    it("sniffs images and only trusts WhatsApp's hosts", () => {
      assert.equal(media.sniffImage(Buffer.from([0xff, 0xd8, 0xff,
        0xe0])).ext, "jpg");
      assert.equal(media.sniffImage(Buffer.from([0x89, 0x50, 0x4e, 0x47,
        0x0d, 0x0a, 0x1a, 0x0a, 0])).ext, "png");
      assert.equal(media.sniffImage(Buffer.from("RIFF1234WEBPVP8 "))
          .contentType, "image/webp");
      assert.equal(media.sniffImage(Buffer.from("GIF89a")), null);
      assert.equal(media.sniffImage(Buffer.alloc(0)), null);
      assert.equal(media.cdnUrlValid("https://mmg.whatsapp.net/v/x"), true);
      assert.equal(media.cdnUrlValid("https://scontent.xx.fbcdn.net/x"),
          true);
      for (const url of ["http://mmg.whatsapp.net/x",
        "https://evil.example/x", "https://whatsapp.net.evil.example/x",
        "https://user:pw@mmg.whatsapp.net/x", "https://mmg.whatsapp.net:8443/x",
        "https://169.254.169.254/x", "", "not a url"]) {
        assert.equal(media.cdnUrlValid(url), false, url);
      }
    });

    it("downloads at most the limit, never following a redirect",
        async () => {
          const body = (bytes) => ({ok: true, headers: {get: () => null},
            body: {getReader: () => {
              let sent = false;
              return {read: async () => sent ? {done: true} :
                (sent = true, {done: false, value: bytes}),
              cancel: async () => null};
            }}});
          const seen = [];
          const fetchImpl = async (url, init) => {
            seen.push(init.redirect);
            return body(new Uint8Array(100));
          };
          const got = await media.downloadCdn("https://mmg.whatsapp.net/x",
              {maxBytes: 200, fetchImpl});
          assert.equal(got.length, 100);
          assert.deepEqual(seen, ["error"]);
          await assert.rejects(media.downloadCdn(
              "https://mmg.whatsapp.net/x", {maxBytes: 50, fetchImpl}),
          {code: "media_too_large"});
          await assert.rejects(media.downloadCdn("https://evil.example/x",
              {maxBytes: 50, fetchImpl}), {code: "media_url"});
          await assert.rejects(media.downloadCdn(
              "https://mmg.whatsapp.net/x", {maxBytes: 50, fetchImpl:
              async () => ({ok: false})}), {code: "media_download"});
          await assert.rejects(media.downloadCdn(
              "https://mmg.whatsapp.net/x", {maxBytes: 50, fetchImpl:
              async () => {
                throw new Error("down");
              }}), {code: "media_download"});
        });
  });

  it("the box pictures fit what a Flow row may carry", () => {
    for (const size of priceList.BOX_SIZE_IDS) {
      const image = BOX_SIZE_IMAGES[size];
      assert.equal(typeof image, "string", size);
      assert.ok(image.length < 100 * 1024, `${size} under 100 KB`);
      assert.deepEqual(Buffer.from(image, "base64").subarray(1, 4),
          Buffer.from("PNG"));
    }
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
            "l_address_help", "l_phone_help", "show_pay", "d_photos"]
              .includes(key) || key.startsWith("show_dims_")) {
            continue;
          }
          // Helper text 80, error text 30, picker label 80, button 35.
          const max = key === "l_next" ? 35 : key.startsWith("h_dims_") ?
            80 : key.startsWith("e_dims_") ? 30 : 20;
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

// Kilos (docs/SHIPPING_SIMPLE_HOME.md K4): on a business's own link the
// questions and prices use its unit; comparing several businesses, the
// customer types pounds and each business converts to its own unit.
describe("whatsapp package flow, kilos", () => {
  const KG_ROUTE = {items: [{id: "i_phone", categoryId: "electronics",
    label: "Phone", priceCents: 4000, includedLb: 2}],
  perLbCents: {clothing: 700}, unit: "kg"};
  const kiloShop = (id, name, extra = {}) => option(id, name, {
    routes: {sea: KG_ROUTE, air: KG_ROUTE}, ...extra});
  const walk = async (f, lines) => {
    await f.handle({action: "INIT", flow_token: "tok"});
    const items = await step(f, "WHERE", {country: "gn", mode: "sea"});
    const amounts = await step(f, "ITEMS", lines.items);
    return {items, amounts};
  };

  it("a single-business link asks and prices in kilos", async () => {
    const shop = kiloShop("k", "Kilo Shop");
    const {f, sessions, created} = harness({options: [shop],
      deps: {loadOptions: async () => ({business: {name: "Kilo Shop"},
        options: [shop]})}});
    const {items, amounts} = await walk(f, {items: {
      item_1: "i:electronics|phone", item_2: "lb:clothing"}});
    assert.equal(sessions.get("tok").weightUnit, "kg");
    const rows = items.data.items;
    assert.match(rows.find((r) => r.id === "i:electronics|phone")
        .description, /up to 2 kg each/);
    const clothes = rows.find((r) => r.id === "lb:clothing");
    assert.equal(clothes.title, "Clothes and fabric (kg)");
    assert.match(clothes.description, /From \$7\/kg$/);
    assert.equal(amounts.data.l_qty_2, "Weight (kg)");
    assert.match(amounts.data.l_intro, /by the kilo.*23 kg/);
    // 901 kg is too much; the message says kilos.
    const bad = await step(f, "AMOUNTS", {qty_1: "1", qty_2: "901"});
    assert.equal(bad.screen, "AMOUNTS");
    assert.match(bad.data.error_message, /kilos/);
    // 900 kg is allowed.
    const ok = await step(f, "AMOUNTS", {qty_1: "1", qty_2: "10"});
    assert.equal(ok.screen, "HOW");
    assert.deepEqual(sessions.get("tok").lines.map((l) => l.unit || null),
        [null, "kg"]);
    const when = await step(f, "HOW", {how: "bring_in"});
    assert.equal(when.screen, "WHEN");
    await step(f, "WHEN", {when: "2026-11-04|09:00|11:00|hq"});
    const review = await step(f, "PEOPLE", {sender_name: "Fatou D",
      receiver_name: "Mariama", receiver_phone: "224 620 00 00 00"});
    assert.match(review.data.summary, /Clothes and fabric · 10 kg/);
    // 1 phone ($40) + 10 kg x $7 = $110, weighed at the counter.
    assert.match(review.data.summary, /Total: about \$110/);
    await step(f, "REVIEW", {});
    assert.deepEqual(created[0].pieces, [
      {priceItemId: "i_phone", quantity: 1, label: "Phone", kind: "other"},
      {categoryId: "clothing", weightLb: 10, weightUnit: "kg",
        kind: "other"}]);
  });

  it("the French questions say kilos too", async () => {
    const shop = kiloShop("k", "Kilo Shop");
    const {f, sessions} = harness({options: [shop],
      deps: {loadOptions: async () => ({business: {name: "Kilo Shop"},
        options: [shop]})}});
    sessions.set("tok", {...sessions.get("tok"), lang: "fr"});
    const {items, amounts} = await walk(f, {items: {item_1: "lb:clothing"}});
    assert.equal(amounts.data.l_qty_1, "Poids (kg)");
    assert.match(amounts.data.l_intro, /au kilo/);
    assert.equal(items.data.items.find((r) => r.id === "lb:clothing").title,
        "Vêtements et tissus (kg)");
    const bad = await step(f, "AMOUNTS", {qty_1: "0"});
    assert.match(bad.data.error_message, /kilos/);
  });

  it("comparing businesses asks pounds and prices each in its own unit",
      async () => {
        // Pounds shop: clothes $3/lb (sea). Kilo shop: clothes $7/kg.
        const lbShop = option("a", "Atlantic");
        const kgShop = kiloShop("k", "Kilo Shop");
        const {f, sessions, created} = harness({options: [lbShop, kgShop]});
        const {items, amounts} = await walk(f, {items: {
          item_1: "lb:clothing"}});
        assert.equal(sessions.get("tok").weightUnit, "lb");
        // The "From" price is per pound for everybody: $7/kg is $3.18/lb,
        // the pounds shop's $3/lb is the lowest.
        const clothes = items.data.items.find((r) => r.id === "lb:clothing");
        assert.equal(clothes.title, "Clothes and fabric (lb)");
        assert.match(clothes.description, /From \$3\/lb$/);
        assert.equal(amounts.data.l_qty_1, "Weight (lb)");
        await step(f, "AMOUNTS", {qty_1: "50"});
        const pick = await step(f, "HOW", {how: "bring_in"});
        assert.equal(pick.screen, "PICK");
        // Atlantic: 50 lb x $3 = $150. Kilo shop: 50 lb = 22.7 kg x $7 =
        // $158.90.
        assert.deepEqual(pick.data.businesses.map((b) => b.id), ["a", "k"]);
        assert.match(pick.data.businesses[0].description, /\$150/);
        assert.match(pick.data.businesses[1].description, /\$158\.90/);
        await step(f, "PICK", {business: "k"});
        await step(f, "WHEN", {when: "2026-11-04|09:00|11:00|hq"});
        const review = await step(f, "PEOPLE", {sender_name: "Fatou D",
          receiver_name: "Mariama", receiver_phone: "224 620 00 00 00"});
        assert.match(review.data.summary, /Clothes and fabric · 50 lb/);
        assert.match(review.data.summary, /\$158\.90/);
        await step(f, "REVIEW", {});
        // The customer's pounds travel as pounds; the server converts.
        assert.deepEqual(created[0].pieces, [{categoryId: "clothing",
          weightLb: 50, weightUnit: "lb", kind: "other"}]);
        const priced = priceList.pricePiece(KG_ROUTE, created[0].pieces[0]);
        assert.equal(priced.estimateCents, 15890);
        assert.equal(priced.price.unit, "kg");
      });

  it("a session started before kilos keeps asking pounds", async () => {
    const shop = kiloShop("k", "Kilo Shop");
    const {f, sessions} = harness({options: [shop]});
    sessions.set("tok", {...sessions.get("tok"), country: "gn",
      mode: "sea", picked: ["lb:clothing"], catalog: [{id: "lb:clothing",
        kind: "per_lb", label: "Clothes and fabric",
        categoryId: "clothing"}]});
    const done = await step(f, "AMOUNTS", {qty_1: "50"});
    assert.equal(done.screen, "HOW");
    assert.equal(sessions.get("tok").lines[0].unit, "lb");
  });

  it("one flowWeightUnit rule", () => {
    const lb = option("a", "Atlantic");
    const kg = kiloShop("k", "Kilo Shop");
    assert.equal(flow.flowWeightUnit(true, [kg]), "kg");
    assert.equal(flow.flowWeightUnit(true, [lb]), "lb");
    assert.equal(flow.flowWeightUnit(false, [kg]), "lb");
    assert.equal(flow.flowWeightUnit(true, []), "lb");
  });

  it("the new words fit Meta's label limits", () => {
    for (const lang of ["en", "fr"]) {
      const w = flow.words(lang);
      assert.ok(w.kilos.length <= 20, w.kilos);
      assert.ok(w.pounds.length <= 20, w.pounds);
    }
  });
});
