// Captures sub-sections that the section-level pass in capture-console.mjs
// misses. That pass clicks a sidebar item and shoots the viewport, so it only
// ever catches the TOP of a long page. "Services & coverage" is really four
// stacked sections (services, rules, locations, coverage) and only the first
// one is above the fold.
//
// Same transport as capture-console.mjs - see that file for why this is
// scripted rather than screenshotted by hand.
//
// Usage: node capture-extra.mjs <profile-dir> <out-dir> [url]

import {spawn} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";
import {setTimeout as sleep} from "node:timers/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9223;
const [profileDir, outDir, url = "https://business.laawoldigital.com/"] =
  process.argv.slice(2);
if (!profileDir || !outDir) process.exit(2);
mkdirSync(outDir, {recursive: true});

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run",
  "--no-default-browser-check", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`, "--profile-directory=Profile 1",
  "--window-size=1440,1000", "about:blank",
], {stdio: "ignore"});

let ws; let nextId = 0;
const pending = new Map();
function send(method, params = {}) {
  const id = ++nextId;
  ws.send(JSON.stringify({id, method, params}));
  return new Promise((resolve, reject) => {
    pending.set(id, {resolve, reject});
    setTimeout(() => {
      if (pending.delete(id)) reject(new Error(`${method} timed out`));
    }, 45000);
  });
}
const evaluate = async (expression) =>
  (await send("Runtime.evaluate",
      {expression, awaitPromise: true, returnByValue: true}))
      .result?.value;

async function shoot(name) {
  const {data} = await send("Page.captureScreenshot", {format: "png"});
  writeFileSync(`${outDir}/web-${name}.png`, Buffer.from(data, "base64"));
  console.log(`  captured web-${name}.png`);
}

const clickNav = (label) => evaluate(`(() => {
  const b = [...document.querySelectorAll('button')]
    .find((x) => x.textContent.trim().startsWith(${JSON.stringify(label)}));
  if (!b) return false; b.click(); return true;
})()`);

// Scrolls a section into frame by its heading text.
//
// Matching the FIRST element containing the text is wrong: <body> contains it
// too, and so does the sidebar. So take the SMALLEST match - the element with
// no matching child - which is the heading itself. Then back off `lift` pixels
// so the section header sits inside the frame rather than flush at its edge.
const scrollToText = (needle, lift = 90) => evaluate(`(() => {
  const needle = ${JSON.stringify(needle)};
  const hits = [...document.querySelectorAll('h1,h2,h3,h4,span,div,p')]
    .filter((el) => el.textContent.includes(needle))
    .filter((el) => ![...el.children].some((c) => c.textContent.includes(needle)));
  if (!hits.length) return false;
  hits[0].scrollIntoView({block: 'start'});
  const scroller = document.scrollingElement;
  const panel = hits[0].closest('.panel, main, [class*="workspace"]');
  for (const box of [panel, scroller]) {
    if (box && box.scrollTop > 0) { box.scrollTop -= ${lift}; break; }
  }
  return true;
})()`);

// The payouts panel prints the business's live Stripe account id. It isn't a
// credential - it's useless without an API key - but this guide is handed to
// every business that joins, and one business's account id is not the other
// businesses' concern. Mask it in the DOM before the shot rather than after,
// so no unmasked copy is ever written to disk.
const maskAccountIds = () => evaluate(`(() => {
  let n = 0;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const hits = [];
  while (walk.nextNode()) {
    if (/^\\s*acct_[A-Za-z0-9]+\\s*$/.test(walk.currentNode.nodeValue)) {
      hits.push(walk.currentNode);
    }
  }
  for (const node of hits) { node.nodeValue = 'acct_••••••••••••••'; n++; }
  return n;
})()`);

// nav:     sidebar item to click first
// then:    optional in-page button to click (opens a dialog, expands a form)
// heading: text to scroll to, or null to shoot the top of the page
// name:    output file stem
const SHOTS = [
  {nav: "Services & coverage", heading: "Pricing, pickup, and facility details",
    name: "14-service-rules"},
  {nav: "Services & coverage", heading: "Add every physical location",
    name: "15-office-locations"},
  {nav: "Services & coverage", heading: "Service coverage by country",
    name: "16-country-coverage"},
  {nav: "Growth", heading: null, name: "17-growth-detail"},
  // Payouts sits inside Today, below the operational summary. The extra lift
  // pulls the panel's own header into frame above the status pills.
  {nav: "Today", heading: "Who pays Stripe", lift: 300, name: "18-payouts"},
  // The staff form is a dialog - it does not exist in the DOM until opened.
  {nav: "People", then: "Invite staff", heading: "Permissions",
    name: "19-invite-staff"},
];

async function main() {
  let target = null;
  for (let i = 0; i < 40 && !target; i++) {
    await sleep(500);
    try {
      target = (await fetch(`http://127.0.0.1:${PORT}/json/list`)
          .then((r) => r.json())).find((t) => t.type === "page");
    } catch { /* not listening yet */ }
  }
  if (!target) throw new Error("DevTools endpoint never came up");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res, {once: true});
    ws.addEventListener("error", rej, {once: true});
  });
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    const slot = pending.get(m.id);
    if (!slot) return;
    pending.delete(m.id);
    m.error ? slot.reject(new Error(m.error.message)) : slot.resolve(m.result);
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", {url});
  await sleep(15000);

  for (const {nav, then, heading, lift, name} of SHOTS) {
    if (!await clickNav(nav)) {
      console.log(`  SKIPPED ${name} - nav "${nav}" not found`);
      continue;
    }
    await sleep(5000);
    if (then) {
      if (!await clickNav(then)) {
        console.log(`  SKIPPED ${name} - button "${then}" not found`);
        continue;
      }
      await sleep(2500);
    }
    if (heading && !await scrollToText(heading, lift ?? 90)) {
      console.log(`  SKIPPED ${name} - heading "${heading}" not found`);
      continue;
    }
    const masked = await maskAccountIds();
    if (masked) console.log(`  masked ${masked} Stripe account id(s)`);
    await sleep(2000);
    await shoot(name);
  }
}

main()
    .then(() => console.log("done"))
    .catch((e) => {
      console.error(`FAILED: ${e.message}`);
      process.exitCode = 1;
    })
    .finally(() => {
      try {
        ws?.close();
      } catch { /* already closed */ }
      chrome.kill("SIGTERM");
    });
