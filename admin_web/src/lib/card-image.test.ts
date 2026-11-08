import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { DEFAULT_CARD_SETTINGS, type BusinessCardData } from "./business-card.ts";
import {
  BLANK_IMAGE,
  CARD_IMAGE,
  blobToBase64,
  cardImageFileName,
  cardImageSize,
  cardLogoProxyUrl,
  cardShareText,
} from "./card-image.ts";

const sample = (): BusinessCardData => ({
  code: "K7M4P2XB",
  link: "https://laawoldigital.com/c/K7M4P2XB",
  person: { name: "Awa Camara", phone: "+13475550142", phones: [] },
  business: {
    businessId: "sahel_auto_sales",
    name: "Sahel Auto Sales",
    phone: "+1 3475550100",
    website: "",
    addressLine1: "",
    city: "",
    state: "",
    postalCode: "",
    logoUrl: "",
    requestSlug: "",
    services: [],
  },
  settings: { ...DEFAULT_CARD_SETTINGS },
});

test("the picture holds both sides at print size, 7:4 each, with even margins", () => {
  const { width, height } = cardImageSize();
  assert.equal(CARD_IMAGE.cardWidth / CARD_IMAGE.cardHeight, 7 / 4);
  assert.equal(width, 1150);
  assert.equal(height, 1340);
  // Small enough for any phone's canvas, big enough to read the phone numbers.
  assert.ok(width * CARD_IMAGE.scale <= 2048 && height * CARD_IMAGE.scale <= 2048);
});

test("the file is named after the person, in plain letters", () => {
  assert.equal(cardImageFileName(sample()), "awa-camara-card.jpg");
  const business = { ...sample(), person: null };
  assert.equal(cardImageFileName(business), "sahel-auto-sales-card.jpg");
  const accents = { ...sample(), person: { name: "Aïssatou Ndiaye-Diallo", phone: "", phones: [] } };
  assert.equal(cardImageFileName(accents), "aissatou-ndiaye-diallo-card.jpg");
  const empty = { ...sample(), person: { name: "!!!", phone: "", phones: [] } };
  assert.equal(cardImageFileName(empty), "business-card.jpg");
});

test("the message under the picture names the card and carries its link, in both languages", () => {
  assert.equal(cardShareText(sample(), "en"), "Awa Camara's business card: https://laawoldigital.com/c/K7M4P2XB");
  assert.equal(
    cardShareText(sample(), "fr"),
    "Carte de visite de Awa Camara : https://laawoldigital.com/c/K7M4P2XB",
  );
});

test("base64 survives pictures bigger than one chunk", async () => {
  const bytes = new Uint8Array(100_000).map((_, i) => (i * 31) % 256);
  const encoded = await blobToBase64(new Blob([bytes]));
  assert.deepEqual(new Uint8Array(Buffer.from(encoded, "base64")), bytes);
});

test("the snapshot's box is the size the picture says, and is drawn off screen", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  const rule = /\.bcard-snap \{([^}]+)\}/.exec(css)?.[1] ?? "";
  assert.match(rule, /position: fixed/);
  assert.match(rule, /left: -20000px/);
  assert.match(rule, /box-sizing: border-box/);
  // Width, margin and gap come from CARD_IMAGE in the component, never from CSS.
  assert.doesNotMatch(rule, /width|padding|gap/);
});

test("the app and the page agree on how the picture is asked for and sent", () => {
  const page = readFileSync("src/lib/business-card.ts", "utf8");
  assert.match(page, /CARD_EMBED_IMAGE_FN = "laawolCardImage"/);
  const app = readFileSync("../my_flutter_app/lib/services/business_card_embed.dart", "utf8");
  assert.match(app, /cardEmbedImageFunction = 'laawolCardImage'/);
  assert.match(app, /cardEmbedImagePrefix = 'image:'/);
  assert.match(app, /cardEmbedImageErrorMessage = 'image-error'/);
});

test("the logo is read straight from the function that passes it through", () => {
  assert.equal(
    cardLogoProxyUrl("K7M4P2XB", "laawol-a855a"),
    "https://us-central1-laawol-a855a.cloudfunctions.net/parkingDocument?view=card-logo&c=K7M4P2XB",
  );
  const server = readFileSync("../my_flutter_app/functions/index.js", "utf8");
  assert.match(server, /=== "card-logo"/);
  assert.match(BLANK_IMAGE, /^data:image\/png;base64,/);
});
