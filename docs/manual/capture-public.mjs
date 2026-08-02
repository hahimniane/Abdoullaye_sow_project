// Captures the public pages a business sees BEFORE it has an account: the
// marketing site's "List your business" entry and the application form at
// partner.html.
//
// Unlike capture-console.mjs this needs no signed-in profile - these pages are
// public - so it runs on a throwaway profile. Nothing signed-in is ever loaded,
// which is what keeps a real session out of frame.
//
// Usage: node capture-public.mjs <out-dir>

import {spawn} from "node:child_process";
import {mkdirSync, rmSync, writeFileSync} from "node:fs";
import {setTimeout as sleep} from "node:timers/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 9224;
const PROFILE = "/tmp/chrome-public-capture";
const [outDir] = process.argv.slice(2);
if (!outDir) process.exit(2);
mkdirSync(outDir, {recursive: true});
rmSync(PROFILE, {recursive: true, force: true});

const chrome = spawn(CHROME, [
  "--headless=new", "--disable-gpu", "--no-first-run",
  "--no-default-browser-check", `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`, "--window-size=1440,1000", "about:blank",
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
      {expression, awaitPromise: true, returnByValue: true})).result?.value;

async function shoot(name) {
  const {data} = await send("Page.captureScreenshot", {format: "png"});
  writeFileSync(`${outDir}/web-${name}.png`, Buffer.from(data, "base64"));
  console.log(`  captured web-${name}.png`);
}

// Same smallest-match rule as capture-extra.mjs: <body> contains every
// heading's text, so "first element containing it" scrolls nowhere.
const scrollToText = (needle, lift = 80) => evaluate(`(() => {
  const needle = ${JSON.stringify(needle)};
  const hits = [...document.querySelectorAll('h1,h2,h3,h4,legend,span,div,p,label')]
    .filter((el) => el.textContent.includes(needle))
    .filter((el) => ![...el.children].some((c) => c.textContent.includes(needle)));
  if (!hits.length) return false;
  hits[0].scrollIntoView({block: 'start'});
  if (document.scrollingElement.scrollTop > 0) {
    document.scrollingElement.scrollTop -= ${lift};
  }
  return true;
})()`);

const SHOTS = [
  {url: "https://laawoldigital.com/partner.html", heading: null,
    name: "20-apply-web"},
  {url: "https://laawoldigital.com/partner.html", heading: "Services you offer",
    name: "21-apply-services"},
  {url: "https://laawoldigital.com/partner.html", heading: "Business profile",
    name: "22-apply-profile"},
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

  let current = null;
  for (const {url, heading, name} of SHOTS) {
    if (url !== current) {
      await send("Page.navigate", {url});
      await sleep(6000);
      // The site picks its language from localStorage and falls back to the
      // browser's. A throwaway profile negotiates French, so without this the
      // whole capture comes back in French and every English heading below
      // silently misses. Set the preference, then reload so it takes effect.
      const lang = await evaluate(
          "localStorage.getItem('laawol:lang')");
      if (lang !== "en") {
        await evaluate("localStorage.setItem('laawol:lang','en')");
        await send("Page.reload");
        await sleep(6000);
      }
      const shown = await evaluate("document.documentElement.lang");
      if (shown !== "en") {
        throw new Error(`page rendered as "${shown}", expected en`);
      }
      current = url;
    } else {
      await evaluate("document.scrollingElement.scrollTop = 0");
      await sleep(600);
    }
    if (heading && !await scrollToText(heading)) {
      console.log(`  SKIPPED ${name} - heading "${heading}" not found`);
      continue;
    }
    await sleep(1200);
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
      rmSync(PROFILE, {recursive: true, force: true});
    });
