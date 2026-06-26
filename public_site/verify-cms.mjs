import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const htmlFiles = readdirSync(root)
  .filter((name) => name.endsWith(".html"))
  .sort();

function read(relativePath) {
  return readFileSync(path.join(root, relativePath), "utf8");
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

htmlFiles.forEach((file) => {
  const html = read(file);
  assertIncludes(html, "assets/content.js?v=", file);
});

const index = read("index.html");
assertIncludes(index, 'id="featuredBusinessesSection"', "index.html");
assertIncludes(index, 'id="featuredBusinessesGrid"', "index.html");
assertIncludes(index, 'data-cms="hero.headline"', "index.html");
assertIncludes(index, 'data-cms="featured.heading"', "index.html");

const contact = read("contact.html");
assertIncludes(contact, '<select name="destination_country"', "contact.html");
assertIncludes(contact, 'id="destinationCountry"', "contact.html");
assertIncludes(contact, '<select name="destination_city"', "contact.html");
assertIncludes(contact, 'id="destinationCity"', "contact.html");

const partner = read("partner.html");
assertIncludes(partner, '<select id="businessCountry"', "partner.html");
assertIncludes(partner, '<select id="businessCity"', "partner.html");
assert(
  !/<input[^>]+id="businessCountry"/i.test(partner) &&
    !/<input[^>]+id="businessCity"/i.test(partner),
  "partner.html business country/city controls must remain selects",
);

console.log(
  `Verified public CMS/privacy hooks across ${htmlFiles.length} HTML files.`,
);
