// Captures each business-console section as a PNG for the onboarding manual.
//
// Why this exists rather than a screen grab: the console keeps the active tab
// in React state with no URL routing, so a one-shot `--screenshot` can only
// ever produce the "Today" tab. Driving Chrome over the DevTools Protocol lets
// us click each nav item and capture what it renders.
//
// It runs against a COPY of the real Chrome profile (see the runbook), so the
// signed-in session carries over without holding a lock on the live profile,
// and nothing outside the page is ever in frame - no desktop, no other tabs.
//
// Usage: node capture-console.mjs <profile-dir> <out-dir> [url]

import {spawn} from "node:child_process";
import {mkdirSync, writeFileSync} from "node:fs";
import {setTimeout as sleep} from "node:timers/promises";

const CHROME =
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9222;
const [profileDir, outDir, url = "https://business.laawoldigital.com/"] =
  process.argv.slice(2);

if (!profileDir || !outDir) {
  console.error("usage: node capture-console.mjs <profile-dir> <out-dir> [url]");
  process.exit(2);
}
mkdirSync(outDir, {recursive: true});

// Sidebar label -> output file stem. Order follows the sidebar so the manual
// reads top to bottom the way a business actually moves through setup.
const SECTIONS = [
  ["Today", "02-today"],
  ["Business", "03-business-identity"],
  ["Services & coverage", "04-services-coverage"],
  ["People", "05-people"],
  ["Listings", "06-listings"],
  ["Purchases", "07-purchases"],
  ["Barrels", "08-barrels"],
  ["Freight", "09-freight"],
  ["Transport", "10-transport"],
  ["Reviews", "11-reviews"],
  ["Support", "12-support"],
  ["Growth", "13-growth"],
];

const chrome = spawn(CHROME, [
  "--headless=new",
  "--disable-gpu",
  "--no-first-run",
  "--no-default-browser-check",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profileDir}`,
  "--profile-directory=Profile 1",
  "--window-size=1440,1000",
  "about:blank",
], {stdio: "ignore"});

let ws;
let nextId = 0;
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

async function evaluate(expression) {
  const res = await send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  return res.result?.value;
}

async function shoot(name) {
  const {data} = await send("Page.captureScreenshot", {
    format: "png",
    captureBeyondViewport: false,
  });
  writeFileSync(`${outDir}/web-${name}.png`, Buffer.from(data, "base64"));
  console.log(`  captured web-${name}.png`);
}

async function main() {
  // The debugging endpoint is not up the instant the process starts.
  let target = null;
  for (let attempt = 0; attempt < 40 && !target; attempt++) {
    await sleep(500);
    try {
      const list = await fetch(`http://127.0.0.1:${PORT}/json/list`)
          .then((r) => r.json());
      target = list.find((t) => t.type === "page");
    } catch {
      // endpoint not listening yet
    }
  }
  if (!target) throw new Error("Chrome DevTools endpoint never came up");

  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, {once: true});
    ws.addEventListener("error", reject, {once: true});
  });
  ws.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    const slot = pending.get(msg.id);
    if (!slot) return;
    pending.delete(msg.id);
    if (msg.error) slot.reject(new Error(msg.error.message));
    else slot.resolve(msg.result);
  });

  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", {url});
  // The console boots Firebase, restores the session, then streams Firestore
  // rows in. Screenshotting on load alone catches empty panels.
  await sleep(15000);

  for (const [label, name] of SECTIONS) {
    const clicked = await evaluate(`(() => {
      const target = ${JSON.stringify(label)};
      const btn = [...document.querySelectorAll('button')]
        .find((b) => b.textContent.trim().startsWith(target));
      if (!btn) return false;
      btn.click();
      return true;
    })()`);
    if (!clicked) {
      console.log(`  SKIPPED ${label} — nav button not found`);
      continue;
    }
    await sleep(4500);
    await shoot(name);
  }
}

main()
    .then(() => console.log("done"))
    .catch((error) => {
      console.error(`FAILED: ${error.message}`);
      process.exitCode = 1;
    })
    .finally(() => {
      try {
        ws?.close();
      } catch {
        // already closed
      }
      chrome.kill("SIGTERM");
    });
