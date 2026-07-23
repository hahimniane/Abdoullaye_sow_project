import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const htmlFiles = readdirSync(root)
  .filter((name) => name.endsWith(".html"))
  .sort();

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

function readPngSize(relativePath) {
  const bytes = readFileSync(path.join(root, relativePath));
  assert(
    bytes.subarray(1, 4).toString("ascii") === "PNG",
    `${relativePath} must be a PNG image`,
  );
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  };
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertIncludes(source, expected, label) {
  assert(
    source.includes(expected),
    `${label} must include ${JSON.stringify(expected)}`,
  );
}

const content = read("assets/content.js");
const countryCatalog = read("assets/country-catalog.js");
const i18n = read("assets/i18n.js");
const home = read("index.html");

assertIncludes(
  home,
  'href="https://customer.laawoldigital.com"',
  "homepage customer workspace CTA",
);
assertIncludes(home, "Utiliser Laawol en ligne", "homepage customer CTA label");
assertIncludes(i18n, '"Use Laawol online": "Utiliser Laawol en ligne"', "customer CTA translation");

assertIncludes(content, '"websiteContent/home"', "content.js");
assertIncludes(content, '"websiteContent/contact"', "content.js");
assertIncludes(content, '"featuredBusinesses"', "content.js");
assertIncludes(content, 'fieldPath: "active"', "featured query");
assertIncludes(content, "Number(a.order)", "featured client-side order");
assertIncludes(content, "Math.min(8", "featured query cap");
assertIncludes(content, 'cache: "no-store"', "Firestore fetches");

const collectionIds = Array.from(
  content.matchAll(/collectionId:\s*"([^"]+)"/g),
  (match) => match[1],
);
assert(
  collectionIds.every((id) => id === "featuredBusinesses"),
  `public content.js may only query featuredBusinesses; found ${collectionIds.join(", ")}`,
);
assert(
  !/collectionId:\s*"businesses"/.test(content) &&
    !/\/documents\/businesses\b/.test(content),
  "public content.js must never query the private businesses collection",
);
assert(
  !/(count\s*\(|aggregate|runAggregationQuery)/i.test(content),
  "public content.js must not expose or request business counts",
);

assertIncludes(countryCatalog, "window.LaawolCountryCatalog", "country-catalog.js");
assertIncludes(countryCatalog, '"name": "Afghanistan"', "country-catalog.js");
assertIncludes(countryCatalog, '"name": "United States"', "country-catalog.js");
assertIncludes(countryCatalog, '"name": "Zimbabwe"', "country-catalog.js");
assertIncludes(countryCatalog, '"dialCode": "1"', "country-catalog.js");
assertIncludes(countryCatalog, '"dialCode": "224"', "country-catalog.js");
assert(
  Array.from(countryCatalog.matchAll(/"id":/g)).length >= 240,
  "country-catalog.js must contain the complete country catalog, not a curated subset",
);

htmlFiles.forEach((file) => {
  const html = read(file);
  assertIncludes(html, "assets/content.js?v=", file);
  for (const retiredMock of [
    'class="phone',
    "phone-showcase",
    "phone-notch",
    "act-row",
    "app-track",
    "3 éléments en cours",
    "BS-MPT0A03V",
    "Mariama’s Kitchen",
    "fabric-sample.jpg",
  ]) {
    assert(
      !html.includes(retiredMock),
      `${file} must not contain retired mock-app content: ${retiredMock}`,
    );
  }
});

const index = read("index.html");
assertIncludes(index, 'id="featuredBusinessesSection"', "index.html");
assertIncludes(index, 'id="featuredBusinessesGrid"', "index.html");
assertIncludes(index, 'data-cms="hero.headline"', "index.html");
assertIncludes(index, 'data-cms="featured.heading"', "index.html");

for (const file of ["index.html", "source.html"]) {
  const html = read(file);
  assertIncludes(html, 'data-src-en="assets/app-shipping-en.png?v=2"', file);
  assertIncludes(html, 'data-src-fr="assets/app-shipping-fr.png?v=2"', file);
  assert(
    !html.includes('class="phone phone-sm"') &&
      !html.includes("fabric-sample.jpg"),
    `${file} must show a real localized app capture, not the retired mock UI`,
  );
}
assert(
  existsSync(path.join(root, "assets", "app-shipping-en.png")) &&
    existsSync(path.join(root, "assets", "app-shipping-fr.png")),
  "localized real-app capture assets must be present",
);

const app = read("app.html");
assertIncludes(
  app,
  "<h1>Gardez des entreprises de confiance dans votre poche</h1>",
  "app.html",
);
assertIncludes(
  app,
  'data-src-en="assets/app-activity-en.png?v=2"',
  "app.html",
);
assertIncludes(
  app,
  'data-src-fr="assets/app-activity-fr.png?v=2"',
  "app.html",
);
assertIncludes(
  app,
  "Écran Activité de l’application Laawol présentant le suivi des expéditions, les commandes et le portefeuille.",
  "app.html",
);
for (const asset of [
  "assets/app-activity-en.png",
  "assets/app-activity-fr.png",
]) {
  assert(existsSync(path.join(root, asset)), `${asset} must be present`);
  const size = readPngSize(asset);
  assert(
    size.width === 804 && size.height === 1748,
    `${asset} must be 804x1748; found ${size.width}x${size.height}`,
  );
  assert(
    size.colorType === 2,
    `${asset} must be an opaque RGB PNG without an alpha channel`,
  );
}

const contact = read("contact.html");
assertIncludes(contact, "assets/country-catalog.js?v=", "contact.html");
assertIncludes(contact, '<select name="destination_country"', "contact.html");
assertIncludes(contact, 'id="destinationCountry"', "contact.html");
assertIncludes(contact, '<select name="destination_city"', "contact.html");
assertIncludes(contact, 'id="destinationCity"', "contact.html");
assertIncludes(contact, ">Envoyer le message</button>", "contact.html");
assertIncludes(i18n, '"Send message": "Envoyer le message"', "i18n.js");
assert(
  !/<option value="Guinea">/.test(contact) &&
    !/<option value="United States">/.test(contact),
  "contact.html must populate destination countries from country-catalog.js instead of a partial hardcoded list",
);

const partner = read("partner.html");
assertIncludes(partner, "assets/country-catalog.js?v=", "partner.html");
assertIncludes(partner, '<select id="businessCountry"', "partner.html");
assertIncludes(partner, '<select id="businessCity"', "partner.html");
assertIncludes(partner, 'id="businessCityText"', "partner.html");
assertIncludes(partner, 'data-phone-autocode="true"', "partner.html");
assert(
  !/<input[^>]+id="businessCountry"/i.test(partner) &&
    !/<input[^>]+id="businessCity"/i.test(partner),
  "partner.html business country/city controls must remain selects",
);
assert(
  !/<option value="Guinea">Guinée<\/option>/.test(partner) &&
    !/<option value="United States">États-Unis<\/option>/.test(partner),
  "partner.html must populate business countries from country-catalog.js instead of a partial hardcoded list",
);

console.log(
  `Verified public CMS/privacy hooks across ${htmlFiles.length} HTML files.`,
);
