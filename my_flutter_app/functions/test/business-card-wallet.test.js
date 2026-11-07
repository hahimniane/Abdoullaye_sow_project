"use strict";

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const {describe, it} = require("node:test");

const cards = require("../business_cards");
const wallet = require("../business_card_wallet");
const {makeRsaPair, makeTestCertificate, signatureValid, unzip} =
  require("./wallet-test-kit");

// Wallet copies of a business card (docs/BUSINESS_CARDS.md "Wallet passes"),
// the part with no Firestore: what is printed on an Apple pass, the Google
// "Save" link, the ten-minute download link, and the rule that a pass shows
// what the public card shows and nothing more. FAKE names and numbers only.

const TINY_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA" +
    "60e6kgAAAABJRU5ErkJggg==", "base64");

const CODE = "K7M4P2XB";

const rawBusiness = {
  name: "SAHEL AUTO SALES", phone: "3475550100",
  website: "https://www.sahelauto.example/",
  addressLine1: "12 Example Ave", city: "Bronx", state: "NY",
  postalCode: "10457",
  // None of these may ever reach a pass.
  email: "info@example.test", ownerUid: "owner-1", status: "approved",
  card: {style: "signature", color: "navy", services: []},
};

// A card exactly as the public page gets it: through publicCard().
const personCard = (overrides = {}) => cards.publicCard({
  code: CODE, businessId: "biz-1", business: {...rawBusiness, ...overrides},
  services: ["carSales", "carParking"],
  user: {fullName: "awa camara", phone: "+13475550142",
    email: "awa@example.test", role: "staff"},
});
const businessCard = (overrides = {}) => cards.publicCard({
  code: "B2C3D4F5", businessId: "biz-1",
  business: {...rawBusiness, ...overrides},
  services: ["carSales", "carParking"], user: null,
});

const apple = () => {
  const {certPem, keyPem} = makeTestCertificate();
  // The test certificate stands in for Apple's WWDR certificate too.
  return {certPem, keyPem, wwdrPem: certPem, passTypeId: "pass.test.laawol"};
};

const passOf = (zip) => {
  const files = unzip(zip);
  return {files, pass: JSON.parse(files["pass.json"].toString("utf8"))};
};

describe("which wallets are set up", () => {
  const full = () => {
    const {certPem, keyPem} = makeTestCertificate();
    return {appleCertPem: certPem, appleKeyPem: keyPem,
      appleWwdrPem: certPem, applePassTypeId: "pass.test.laawol",
      googleIssuerId: "3388000000012345678",
      googleSaKey: JSON.stringify({client_email: "sa@example.test",
        private_key: makeRsaPair().privateKey})};
  };

  it("reads nothing, empty and the placeholder as not set up", () => {
    for (const value of [undefined, "", "  ", "unset", "UNSET", "-"]) {
      const config = wallet.walletConfig({
        appleCertPem: value, appleKeyPem: value, appleWwdrPem: value,
        applePassTypeId: value, googleIssuerId: value, googleSaKey: value});
      assert.deepEqual(config, {apple: null, google: null}, String(value));
    }
    assert.deepEqual(wallet.walletConfig(), {apple: null, google: null});
  });

  it("is set up per wallet, and Apple needs all four values", () => {
    const config = wallet.walletConfig(full());
    assert.ok(config.apple && config.google);
    assert.equal(config.apple.passTypeId, "pass.test.laawol");
    assert.equal(config.google.clientEmail, "sa@example.test");
    assert.equal(wallet.walletConfig({...full(), applePassTypeId: "unset"})
        .apple, null);
    assert.equal(wallet.walletConfig({...full(), appleWwdrPem: ""}).apple,
        null);
    assert.equal(wallet.walletConfig({...full(), googleIssuerId: ""}).google,
        null);
    // Apple does not depend on Google, nor Google on Apple.
    assert.ok(wallet.walletConfig({...full(), googleSaKey: "unset"}).apple);
    assert.ok(wallet.walletConfig({...full(), appleKeyPem: ""}).google);
  });

  it("never throws on a damaged service account key", () => {
    for (const googleSaKey of ["{not json", "[]", "{}", "null",
      JSON.stringify({client_email: "a@b"}),
      JSON.stringify({private_key: "x"})]) {
      assert.equal(wallet.walletConfig({...full(), googleSaKey}).google, null,
          googleSaKey);
    }
  });
});

describe("what the card says", () => {
  it("prints names and numbers the way the web card does", () => {
    assert.equal(wallet.cardName("SAHEL AUTO SALES"), "Sahel Auto Sales");
    assert.equal(wallet.cardName("awa camara"), "Awa Camara");
    assert.equal(wallet.cardName("DHL Express"), "DHL Express");
    assert.equal(wallet.cardName(null), "");
    assert.deepEqual(wallet.cardDial("3475550142"),
        {display: "(347) 555-0142", tel: "tel:+13475550142"});
    assert.deepEqual(wallet.cardDial("+1 347 555 0142"),
        {display: "(347) 555-0142", tel: "tel:+13475550142"});
    assert.deepEqual(wallet.cardDial("+1 1347 555 0142"),
        {display: "(347) 555-0142", tel: "tel:+13475550142"});
    assert.deepEqual(wallet.cardDial("+221 77 555 01 42"),
        {display: "+221 77 555 01 42", tel: "tel:+221775550142"});
    assert.deepEqual(wallet.cardDial("12"), {display: "", tel: null});
    assert.equal(wallet.websiteLabel("https://www.sahelauto.example/"),
        "sahelauto.example");
    assert.equal(wallet.cardAddress({addressLine1: "12 Example Ave",
      city: "Bronx", state: "NY", postalCode: "10457"}),
    "12 Example Ave, Bronx, NY 10457");
    assert.equal(wallet.cardAddress({city: "Bronx"}), "Bronx");
  });

  it("uses the card colors of the web, hex for hex", () => {
    const source = fs.readFileSync(path.join(__dirname, "..", "..", "..",
        "admin_web", "src", "lib", "business-card.ts"), "utf8");
    const block = /export const CARD_COLORS = \{([^}]+)\}/.exec(source);
    assert.ok(block, "CARD_COLORS moved in business-card.ts");
    const web = Object.fromEntries([...block[1]
        .matchAll(/(\w+):\s*"(#[0-9a-f]{6})"/g)].map((m) => [m[1], m[2]]));
    assert.deepEqual(wallet.CARD_COLOR_HEX, web);
    assert.deepEqual(Object.keys(wallet.CARD_COLOR_HEX),
        [...cards.CARD_COLORS]);
  });

  it("builds one model from a public card, the person first", () => {
    const model = wallet.walletCardModel(personCard());
    assert.equal(model.title, "Awa Camara");
    assert.equal(model.businessName, "Sahel Auto Sales");
    assert.equal(model.direct, "(347) 555-0142");
    assert.equal(model.office, "(347) 555-0100");
    assert.equal(model.address, "12 Example Ave, Bronx, NY 10457");
    assert.equal(model.website, "sahelauto.example");
    assert.equal(model.websiteHref, "https://sahelauto.example");
    assert.equal(model.colorHex, "#0a214a");
    assert.equal(model.link, `https://laawoldigital.com/c/${CODE}`);
    assert.deepEqual(model.services.en, ["Buy and sell cars", "Car parking"]);
    const own = wallet.walletCardModel(businessCard());
    assert.equal(own.title, "Sahel Auto Sales");
    assert.equal(own.personName, "");
    assert.equal(own.direct, "");
  });

  it("lists what the owner wrote in place of the switched-on services", () => {
    const model = wallet.walletCardModel(personCard({
      card: {services: ["Used cars", "Export to Dakar"]}}));
    assert.deepEqual(model.services.en, ["Used cars", "Export to Dakar"]);
    assert.equal(model.services.written, true);
  });
});

describe("the Apple pass", () => {
  it("lays a person's card out as a signed generic pass", async () => {
    const config = apple();
    const zip = await wallet.buildApplePass({
      card: personCard(), config, logo: TINY_PNG});
    const {files, pass} = passOf(zip);

    assert.equal(pass.formatVersion, 1);
    assert.equal(pass.serialNumber, `laawol-card-${CODE}`);
    assert.equal(pass.passTypeIdentifier, "pass.test.laawol");
    assert.equal(pass.teamIdentifier, "GRKB7BXVZK");
    assert.equal(pass.organizationName, "Sahel Auto Sales");
    assert.equal(pass.logoText, "Sahel Auto Sales");
    assert.equal(pass.backgroundColor, "rgb(10, 33, 74)");
    assert.equal(pass.foregroundColor, "rgb(255, 255, 255)");
    // A static pass: nothing for a phone to call back.
    assert.equal(pass.webServiceURL, undefined);
    assert.equal(pass.authenticationToken, undefined);
    assert.deepEqual(pass.barcodes, [{format: "PKBarcodeFormatQR",
      message: `https://laawoldigital.com/c/${CODE}`,
      messageEncoding: "iso-8859-1"}]);

    const g = pass.generic;
    assert.deepEqual(g.primaryFields, [{key: "name", value: "Awa Camara"}]);
    assert.deepEqual(g.secondaryFields.map((f) => [f.key, f.label, f.value]),
        [["direct", "Direct", "(347) 555-0142"],
          ["office", "Office", "(347) 555-0100"]]);
    const back = Object.fromEntries(g.backFields.map((f) => [f.key, f.value]));
    assert.deepEqual(back, {
      address: "12 Example Ave, Bronx, NY 10457",
      website: "sahelauto.example",
      services: "Buy and sell cars, Car parking",
      card: `https://laawoldigital.com/c/${CODE}`,
    });

    assert.deepEqual(Object.keys(files).sort(), ["fr.lproj/pass.strings",
      "icon.png", "icon@2x.png", "logo.png", "logo@2x.png", "manifest.json",
      "pass.json", "signature"].sort());
    assert.deepEqual(files["logo.png"], TINY_PNG);
    const french = files["fr.lproj/pass.strings"].toString();
    assert.match(french, /"Office" = "Bureau";/);
    assert.match(french,
        /"Buy and sell cars, Car parking" = "Achat et vente de voitures, /);
  });

  it("carries a manifest of SHA-1s and a genuine signature", async () => {
    const config = apple();
    const zip = await wallet.buildApplePass({
      card: personCard(), config, logo: TINY_PNG});
    const {files} = passOf(zip);
    const manifest = JSON.parse(files["manifest.json"].toString("utf8"));
    const covered = Object.keys(files)
        .filter((name) => name !== "manifest.json" && name !== "signature");
    assert.deepEqual(Object.keys(manifest).sort(), covered.sort());
    for (const name of covered) {
      assert.equal(manifest[name],
          crypto.createHash("sha1").update(files[name]).digest("hex"), name);
    }
    assert.equal(signatureValid(files.signature, files["manifest.json"],
        config.certPem), true);
    // A manifest changed after signing no longer verifies.
    assert.equal(signatureValid(files.signature,
        Buffer.from(`${files["manifest.json"]} `), config.certPem), false);
  });

  it("makes the business's own card with the business's name and number",
      async () => {
        const {pass} = passOf(await wallet.buildApplePass({
          card: businessCard(), config: apple(), logo: null}));
        assert.equal(pass.serialNumber, "laawol-card-B2C3D4F5");
        assert.deepEqual(pass.generic.primaryFields,
            [{key: "name", value: "Sahel Auto Sales"}]);
        assert.deepEqual(pass.generic.secondaryFields.map((f) => f.key),
            ["office"]);
        assert.equal(pass.barcodes[0].message,
            "https://laawoldigital.com/c/B2C3D4F5");
      });

  it("leaves out what the card does not have", async () => {
    const {pass} = passOf(await wallet.buildApplePass({
      card: cards.publicCard({code: CODE, businessId: "b",
        business: {name: "Bare Shop", card: {}}, services: [],
        user: {fullName: "Yao Kouassi"}}),
      config: apple(), logo: null}));
    assert.deepEqual(pass.generic.secondaryFields, []);
    assert.deepEqual(pass.generic.backFields.map((f) => f.key), ["card"]);
    assert.equal(pass.backgroundColor, "rgb(11, 59, 56)");
  });

  it("uses the Laawol mark when the business has no logo to fetch",
      async () => {
        const zip = await wallet.buildApplePass({
          card: personCard(), config: apple(), logo: null});
        const {files} = passOf(zip);
        assert.deepEqual(files["logo.png"], fs.readFileSync(
            path.join(__dirname, "..", "assets", "laawol-mark.png")));
        assert.equal(files["icon.png"].subarray(1, 4).toString(), "PNG");
      });

  it("fetches the business's own logo, and falls back when it fails",
      async () => {
        const urls = [];
        const ok = async (url) => {
          urls.push(url);
          return new Response(TINY_PNG, {status: 200});
        };
        const logoUrl = "https://firebasestorage.googleapis.com/v0/b/x/o/l.png";
        const withLogo = cards.publicCard({code: CODE, businessId: "b",
          business: {name: "Logo Shop", logoUrl}, services: [], user: null});
        assert.equal(withLogo.business.logoUrl, logoUrl);
        const first = passOf(await wallet.buildApplePass({
          card: withLogo, config: apple(), fetchImpl: ok}));
        assert.deepEqual(urls, [logoUrl]);
        assert.deepEqual(first.files["logo.png"], TINY_PNG);
        const down = async () => {
          throw new Error("network down");
        };
        const second = passOf(await wallet.buildApplePass({
          card: withLogo, config: apple(), fetchImpl: down}));
        assert.notDeepEqual(second.files["logo.png"], TINY_PNG);
        assert.equal(second.files["logo.png"].subarray(1, 4).toString(), "PNG");
      });

  it("puts nothing on the pass that the public card does not show",
      async () => {
        const {files} = passOf(await wallet.buildApplePass({
          card: personCard(), config: apple(), logo: null}));
        const text = Object.values(files)
            .filter((file) => file !== files.signature)
            .map((file) => file.toString("latin1")).join("\n");
        for (const secret of ["example.test", "owner-1", "staff", "biz-1",
          "businessOwner", "uid"]) {
          assert.ok(!text.includes(secret), `${secret} reached the pass`);
        }
      });
});

describe("image fetching", () => {
  it("only fetches https images on hosts we already use", () => {
    assert.equal(wallet.isFetchableImageUrl(
        "https://firebasestorage.googleapis.com/v0/b/x/o/y?alt=media"), true);
    assert.equal(wallet.isFetchableImageUrl(
        "https://laawoldigital.com/assets/logo.png"), true);
    assert.equal(wallet.isFetchableImageUrl(
        "http://firebasestorage.googleapis.com/x"), false);
    assert.equal(wallet.isFetchableImageUrl("https://evil.example/l.png"),
        false);
    assert.equal(wallet.isFetchableImageUrl("https://169.254.169.254/x"),
        false);
    assert.equal(wallet.isFetchableImageUrl(
        "https://laawoldigital.com.evil.example/l.png"), false);
    assert.equal(wallet.isFetchableImageUrl(""), false);
  });

  it("accepts a PNG or JPEG and nothing else", async () => {
    const url = "https://storage.googleapis.com/b/l.png";
    const serve = (bytes, status = 200) => async () =>
      new Response(bytes, {status});
    assert.deepEqual(await wallet.fetchWalletImage(url, serve(TINY_PNG)),
        TINY_PNG);
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2]);
    assert.deepEqual(await wallet.fetchWalletImage(url, serve(jpeg)), jpeg);
    assert.equal(await wallet.fetchWalletImage(url, serve("<html>")), null);
    assert.equal(await wallet.fetchWalletImage(url, serve(TINY_PNG, 404)),
        null);
    assert.equal(await wallet.fetchWalletImage(url,
        serve(Buffer.alloc(2 * 1024 * 1024 + 1, 0x89))), null);
    let called = false;
    assert.equal(await wallet.fetchWalletImage("https://evil.example/l.png",
        async () => {
          called = true;
          return new Response(TINY_PNG);
        }), null);
    assert.equal(called, false);
  });
});

describe("the ten-minute download link", () => {
  const {keyPem} = makeTestCertificate();

  it("round-trips a card code and expires after ten minutes", () => {
    const token = wallet.signCardPassToken(keyPem, CODE, 1000000);
    assert.deepEqual(
        wallet.verifyCardPassToken(keyPem, token, 1000000 + 9 * 60000),
        {c: CODE, e: 1000 + 600});
    assert.equal(wallet.verifyCardPassToken(keyPem, token,
        1000000 + 10 * 60000 + 1000), null);
    assert.equal(wallet.PASS_LINK_TTL_SECONDS, 600);
  });

  it("is useless for another card, under another key, or mangled", () => {
    const token = wallet.signCardPassToken(keyPem, CODE);
    const [body, mac] = token.split(".");
    const forged = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(body, "base64url").toString()),
      c: "B2C3D4F5"})).toString("base64url");
    assert.equal(wallet.verifyCardPassToken(keyPem, `${forged}.${mac}`),
        null);
    assert.equal(wallet.verifyCardPassToken("another key", token), null);
    for (const bad of ["", "garbage", `${body}.`, `${body}.${mac}.x`, null,
      undefined, `${body}.${mac.slice(1)}`]) {
      assert.equal(wallet.verifyCardPassToken(keyPem, bad), null,
          String(bad));
    }
  });
});

describe("the Google Wallet link", () => {
  const pair = makeRsaPair();
  const google = wallet.walletConfig({
    googleIssuerId: "3388000000012345678",
    googleSaKey: JSON.stringify({
      client_email: "wallet@laawol-test.iam.gserviceaccount.com",
      private_key: pair.privateKey})}).google;

  const decode = (url) => {
    assert.ok(url.startsWith("https://pay.google.com/gp/v/save/"));
    const jwt = url.slice("https://pay.google.com/gp/v/save/".length);
    const [head, body, signature] = jwt.split(".");
    assert.deepEqual(JSON.parse(Buffer.from(head, "base64url")),
        {alg: "RS256", typ: "JWT"});
    assert.equal(crypto.createVerify("RSA-SHA256")
        .update(`${head}.${body}`).verify(pair.publicKey,
            Buffer.from(signature, "base64url")), true);
    return {jwt, claims: JSON.parse(Buffer.from(body, "base64url"))};
  };

  it("signs a Save link that carries the class and the object", () => {
    const {jwt, claims} = decode(
        wallet.buildGoogleSaveUrl(google, personCard(), 1700000000000));
    assert.equal(claims.iss, "wallet@laawol-test.iam.gserviceaccount.com");
    assert.equal(claims.aud, "google");
    assert.equal(claims.typ, "savetowallet");
    assert.equal(claims.iat, 1700000000);
    assert.deepEqual(claims.origins, ["https://laawoldigital.com",
      "https://customer.laawoldigital.com"]);
    assert.deepEqual(claims.payload.genericClasses,
        [{id: "3388000000012345678.laawol_card"}]);
    const [object] = claims.payload.genericObjects;
    assert.equal(object.id, `3388000000012345678.laawol_card_${CODE}`);
    assert.equal(object.classId, "3388000000012345678.laawol_card");
    assert.equal(object.cardTitle.defaultValue.value, "Sahel Auto Sales");
    assert.equal(object.header.defaultValue.value, "Awa Camara");
    assert.equal(object.subheader.defaultValue.value,
        "Direct (347) 555-0142");
    assert.equal(object.hexBackgroundColor, "#0a214a");
    assert.deepEqual(object.barcode, {type: "QR_CODE",
      value: `https://laawoldigital.com/c/${CODE}`});
    assert.equal(object.logo.sourceUri.uri, wallet.GOOGLE_FALLBACK_LOGO);
    const modules = Object.fromEntries(
        object.textModulesData.map((m) => [m.id, m.body]));
    assert.equal(modules.office, "(347) 555-0100");
    assert.equal(modules.address, "12 Example Ave, Bronx, NY 10457");
    assert.ok(jwt.length <= wallet.GOOGLE_MAX_JWT_LENGTH, jwt.length);
    const text = JSON.stringify(claims);
    for (const secret of ["example.test", "owner-1", "biz-1", "staff"]) {
      assert.ok(!text.includes(secret), `${secret} reached the link`);
    }
  });

  it("makes the business's own card with the Office line", () => {
    const {claims} = decode(wallet.buildGoogleSaveUrl(google, businessCard()));
    const [object] = claims.payload.genericObjects;
    assert.equal(object.id, "3388000000012345678.laawol_card_B2C3D4F5");
    assert.equal(object.header.defaultValue.value, "Sahel Auto Sales");
    assert.equal(object.subheader.defaultValue.value, "Office (347) 555-0100");
    assert.ok(!object.textModulesData.some((m) => m.id === "office"));
  });

  it("uses the business's own logo when the link has room", () => {
    const logoUrl = "https://firebasestorage.googleapis.com/v0/b/x/o/l.png";
    const card = cards.publicCard({code: CODE, businessId: "b",
      business: {name: "Logo Shop", logoUrl}, services: [], user: null});
    const {claims} = decode(wallet.buildGoogleSaveUrl(google, card));
    assert.equal(claims.payload.genericObjects[0].logo.sourceUri.uri, logoUrl);
  });

  it("keeps the link inside Google's limit by dropping the extras first",
      () => {
        const long = personCard({
          name: "Q".repeat(40) + " Auto " + "Z".repeat(30),
          addressLine1: "A".repeat(100), website: `${"w".repeat(60)}.example`,
          logoUrl: `https://firebasestorage.googleapis.com/v0/b/x/o/${
            "q".repeat(250)}?alt=media`,
          card: {color: "navy", services: ["a", "b", "c", "d", "e", "f"]
              .map((letter) => letter.repeat(40))}});
        const url = wallet.buildGoogleSaveUrl(google, long);
        const {jwt, claims} = decode(url);
        assert.ok(jwt.length <= wallet.GOOGLE_MAX_JWT_LENGTH, jwt.length);
        const [object] = claims.payload.genericObjects;
        // What never goes: the ids, the name, the QR, the color.
        assert.equal(object.id, `3388000000012345678.laawol_card_${CODE}`);
        assert.equal(object.barcode.value,
            `https://laawoldigital.com/c/${CODE}`);
        assert.ok(object.cardTitle.defaultValue.value.length > 0);
        assert.equal(object.hexBackgroundColor, "#0a214a");
        // The card page the QR opens has everything that was dropped.
        assert.ok(!object.textModulesData ||
          object.textModulesData.length < 4);
      });
});
