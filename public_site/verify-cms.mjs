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

for (const file of ["index.html"]) {
  const html = read(file);
  assertIncludes(html, 'data-src-en="assets/app-shipping-en.png?v=2"', file);
  assertIncludes(html, 'data-src-fr="assets/app-shipping-fr.png?v=2"', file);
  assert(
    !html.includes('class="phone phone-sm"') &&
      !html.includes("fabric-sample.jpg"),
    `${file} must show a real localized app capture, not the retired mock UI`,
  );
}
for (const file of ["tracking.html"]) {
  const html = read(file);
  assertIncludes(html, 'data-src-en="assets/app-activity-en.png?v=1"', file);
  assertIncludes(html, 'data-src-fr="assets/app-activity-fr.png?v=1"', file);
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
assert(
  existsSync(path.join(root, "assets", "app-activity-en.png")) &&
    existsSync(path.join(root, "assets", "app-activity-fr.png")),
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

// Inventory is requested, never self-enabled: its own card sends a separate
// requestInventory boolean and stays out of enabledServices - but asking for
// it does satisfy "choose at least one service" (Inventory alone is a valid
// sign-up). Both languages translate it.
assertIncludes(partner, 'id="requestInventory"', "partner.html Inventory request card");
assertIncludes(partner, "requestInventory: inventoryRequested()", "partner.html submit payload");
assertIncludes(partner, 'input[value]:checked', "partner.html selectedServices must skip the Inventory request box");
assertIncludes(
  partner,
  "if (!services.length && !inventoryRequested()) return showError(",
  "partner.html: Inventory alone must satisfy the at-least-one-service check",
);
assert(
  !/key:\s*"inventory"/.test(partner) && !/enabledServices:\s*\[[^\]]*inventory/i.test(partner),
  "partner.html must never put inventory in the SERVICES catalog or enabledServices",
);
assert(
  !/<input[^>]+id="requestInventory"[^>]*checked/i.test(partner) &&
    !partner.includes('id="requestInventory" checked'),
  "the Inventory request card must start unchecked",
);
assertIncludes(i18n, '"Inventory": "Inventaire"', "i18n.js Inventory label");
assertIncludes(
  i18n,
  '"Track stock and sell at the counter. You can register with Inventory alone. Switched on by our team after approval."',
  "i18n.js Inventory description",
);

// Every App Store link goes to the real listing. They pointed at
// contact.html while the iOS app was unpublished, and stayed that way after.
const APP_STORE_URL = "https://apps.apple.com/app/laawol/id6791795025";
for (const file of htmlFiles) {
  const html = readFileSync(path.join(root, file), "utf8");
  for (const tag of html.match(/<a\b[^>]*>(?:(?!<\/a>)[\s\S])*App Store(?:(?!<\/a>)[\s\S])*<\/a>|<a\b[^>]*App Store[^>]*>/g) || []) {
    assert(tag.includes(`href="${APP_STORE_URL}"`),
        `${file}: an App Store link must point to ${APP_STORE_URL}`);
  }
}

// get-app.html is the static "Get the app" button in the WhatsApp template
// (https://laawoldigital.com/get-app.html). Phones go straight to their
// store; desktops, and browsers without JavaScript, see both badges.
const PLAY_URL = "https://play.google.com/store/apps/details?id=com.laawoldigital.app";
assert(existsSync(path.join(root, "get-app.html")), "get-app.html must exist");
const getApp = read("get-app.html");
assertIncludes(getApp, `href="${APP_STORE_URL}"`, "get-app.html App Store badge");
assertIncludes(getApp, `href="${PLAY_URL}"`, "get-app.html Google Play badge");
assertIncludes(getApp, "<noscript>", "get-app.html no-JavaScript fallback");
for (const key of [
  '"Follow every shipment in the Laawol app": "Suivez chaque expédition dans l’application Laawol"',
  '"Opening your app store…": "Ouverture de votre boutique d’applications…"',
  '"Choose your store below.": "Choisissez votre boutique ci-dessous."',
]) {
  assertIncludes(i18n, key, "get-app.html translation");
}
{
  const inline = getApp.match(/<script>([\s\S]*?)<\/script>/);
  assert(inline, "get-app.html must redirect with an inline script");
  const { runInNewContext } = await import("node:vm");
  const redirectFor = (userAgent, maxTouchPoints = 0) => {
    let target = null;
    const documentElement = { className: "notranslate" };
    runInNewContext(inline[1], {
      navigator: { userAgent, maxTouchPoints },
      location: { replace: (url) => { target = url; } },
      document: { documentElement },
    });
    return { target, className: documentElement.className };
  };
  const iphone = redirectFor("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1", 5);
  assert(iphone.target === APP_STORE_URL, "get-app.html must send an iPhone to the App Store");
  assert(iphone.className.includes("getapp-redirect"), "get-app.html must show the opening status while redirecting");
  const ipadAsMac = redirectFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15", 5);
  assert(ipadAsMac.target === APP_STORE_URL, "get-app.html must send an iPad reporting as a Mac to the App Store");
  const android = redirectFor("Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36", 5);
  assert(android.target === PLAY_URL, "get-app.html must send Android to Google Play");
  const mac = redirectFor("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", 0);
  assert(mac.target === null && mac.className === "notranslate", "get-app.html must not redirect a desktop Mac");
  const windows = redirectFor("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36", 10);
  assert(windows.target === null, "get-app.html must not redirect a desktop (even a touchscreen PC)");
}

// Project configuration: assets/site-config.js is the single source for the
// Firebase/GCP project; nothing else on the site may name it.
{
  const siteConfigSource = read("assets/site-config.js");
  const sandbox = { window: {} };
  new Function("window", siteConfigSource)(sandbox.window);
  const site = sandbox.window.LAAWOL_CONFIG;
  assert(site && site.firebase, "site-config.js must define window.LAAWOL_CONFIG.firebase");
  assert(
    site.target === "current" && site.firebase.projectId === "car-selling-flutter-app",
    "site-config.js must keep the current project active until the cutover switch is flipped",
  );
  assert(
    site.functionsBaseUrl ===
      `https://${site.region}-${site.firebase.projectId}.cloudfunctions.net`,
    "site-config.js functionsBaseUrl must derive from the active project",
  );
  assert(
    /NEW_PROJECT_CONFIG/.test(siteConfigSource) && siteConfigSource.includes("laawol-a855a"),
    "site-config.js must carry the NEW_PROJECT_CONFIG block",
  );
  assert(
    /throw new Error\(\s*"site-config\.js: target/.test(siteConfigSource),
    "site-config.js must fail closed when the selected target has empty placeholders",
  );
  const siteLoad = (html) => html.indexOf('assets/site-config.js?v=');
  htmlFiles.forEach((file) => {
    const html = read(file);
    const configAt = siteLoad(html);
    assert(configAt !== -1, `${file} must load assets/site-config.js`);
    for (const consumer of ["assets/chat.js?v=", "assets/content.js?v="]) {
      assert(
        html.indexOf(consumer) > configAt,
        `${file} must load site-config.js before ${consumer}`,
      );
    }
  });
  for (const file of ["partner.html", "assets/chat.js", "assets/content.js"]) {
    const source = read(file);
    assert(
      !/car-selling-flutter-app|577373430777|cloudfunctions\.net|AIza[0-9A-Za-z_-]{20,}|6L[A-Za-z0-9_-]{30,}/.test(source),
      `${file} must read the project from window.LAAWOL_CONFIG, not hardcode it`,
    );
  }
  const htaccess = read(".htaccess");
  const activeRewrites = htaccess
    .split("\n")
    .filter((line) => /^\s*RewriteRule \^[pd]\$ https:\/\/[a-z0-9-]+\.cloudfunctions\.net\//.test(line));
  assert(activeRewrites.length === 2, ".htaccess must have exactly one active /p and /d rewrite pair");
  for (const line of activeRewrites) {
    assert(
      line.includes(`${site.region}-${site.firebase.projectId}.cloudfunctions.net`),
      ".htaccess /p and /d rewrites must target the same project as site-config.js",
    );
  }
  assert(
    /#\s*RewriteRule \^p\$ https:\/\/us-central1-laawol-a855a\.cloudfunctions\.net\/parkingPaymentLink/.test(htaccess) &&
      /#\s*RewriteRule \^d\$ https:\/\/us-central1-laawol-a855a\.cloudfunctions\.net\/parkingDocument/.test(htaccess),
    ".htaccess must carry the NEW_PROJECT_CONFIG /p and /d rewrites, commented out",
  );
}

console.log(
  `Verified public CMS/privacy hooks across ${htmlFiles.length} HTML files.`,
);
