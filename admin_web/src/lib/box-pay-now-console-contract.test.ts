import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (file: string) => readFileSync(file, "utf8");
const form = read("src/components/package-request-form.tsx");
const estimate = read("src/components/package-estimate-page.tsx");
const priceList = read("src/components/business/price-list-panel.tsx");
const requests = read("src/components/business/package-requests-panel.tsx");
const boxAndPay = read("src/components/business/request-box-and-pay.tsx");
const payouts = read("src/components/business/pay-now-payouts.tsx");
const designer = read("src/components/box-designer/box-designer.tsx");
const spinner = read("src/components/box-designer/box-spin-controller.ts");
const scene3d = read("src/components/box-designer/box-3d-scene.ts");
const mount3d = read("src/components/box-designer/box-3d-mount.ts");
const css = read("src/app/globals.css");

test("the Send a package form offers box lines on Sea only, and Air keeps its Box kind", () => {
  assert.match(form, /\{sea && \(\s*<div className="pkr-group">\s*<h3>Boxes<\/h3>/);
  assert.match(form, /addOtherLine\(lines, sea \? "other" : "box"\)/);
  assert.match(form, /\{!sea && \(\s*<div className="pkr-segments" role="radiogroup" aria-label="What is it\?">/);
  assert.match(form, /BOX_PHOTO_LIMIT/, "3 photos on a box line");
});

test("the price list's Box sizes card is on the Sea tab, three priced sizes and Extra large quoted", () => {
  assert.match(priceList, /\{mode === "sea" && \(\s*<section className="pkq-settings-block plist-boxes">/);
  assert.match(priceList, /BOX_PRICED_IDS\.map/);
  assert.match(priceList, /Extra large: you quote it/);
});

test("the request settings carry one Pay now switch with the contract's help text", () => {
  assert.match(requests, /<h4>Pay now<\/h4>/);
  assert.match(requests, /You pay the card fee \(2\.9% \+ 30¢\)\. Without Stripe, Laawol collects and pays you every Monday\./);
  assert.doesNotMatch(requests, /Card payment for barrels/);
});

test("Refund is offered only to those who may void, and only up to what is left", () => {
  assert.match(boxAndPay, /\{canRefund && left > 0 && \(/);
  assert.match(boxAndPay, /canResend\(payNow\)/);
  assert.match(boxAndPay, /"setPackageRequestSettings"/);
});

test("the customer's page links Pay now only through the safe https link", () => {
  assert.match(estimate, /customerPayView\(publicPayNowOf\(request\.payNow\)/);
  assert.match(estimate, /href=\{pay\.linkUrl\} rel="noopener noreferrer" target="_blank"/);
  assert.match(estimate, /Paying online is optional\./);
});

test("Bills: Laawol owes you for the business, Pay now payouts for the Laawol admin", () => {
  assert.match(payouts, /export function LaawolOwesYou/);
  assert.match(payouts, /export function PayNowPayoutsAdmin/);
  assert.match(read("src/components/volume-views.tsx"), /<LaawolOwesYou businessId=\{businessId\} previewMode=\{previewMode\} \/>/);
  assert.match(read("src/components/billing-views.tsx"), /<PayNowPayoutsAdmin canPayOut=\{canPayOut\} previewMode=\{previewMode\} \/>/);
});

test("the designer respects reduced motion and never reacts per pointer move", () => {
  // The idle spin (the only motion that runs by itself) is the spin controller's, and it honours the setting.
  assert.match(spinner, /prefers-reduced-motion: reduce/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\.bd-face, \.bd-prism, \.bd-floor, \.bd-person \{ transition: none; \}/);
  // The 3D scene eases its zoom only when motion is allowed, and renders on demand rather than in a loop.
  assert.match(scene3d, /prefers-reduced-motion: reduce/);
  assert.match(scene3d, /const k = reduced \? 1 :/);
  assert.doesNotMatch(scene3d, /setAnimationLoop/);
  // Spinning writes CSS variables on the world element (and tells the 3D scene); it never sets React state.
  assert.match(designer, /world\.style\.setProperty\("--bd-spin"/);
  assert.doesNotMatch(designer, /useState<Angles/);
});

test("three.js stays out of the main bundle: only the mount module reaches the scene, with import()", () => {
  assert.match(mount3d, /await import\("\.\/box-3d-scene"\)/);
  for (const [name, source] of [["box-designer.tsx", designer], ["box-3d-mount.ts", mount3d], ["box-3d-page.tsx", read("src/components/box-designer/box-3d-page.tsx")]] as const) {
    assert.doesNotMatch(source, /from "three/, `${name} must not import three.js statically`);
    assert.doesNotMatch(source, /import (?!type)[^;]*from "\.\/box-3d-scene"/, `${name} must not import the scene statically`);
  }
});
