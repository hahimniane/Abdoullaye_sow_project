import {spawnSync} from "node:child_process";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {
  HOSTINGER_PRODUCTION_IPV4,
  PRODUCTION_STATIC_HOSTS,
} from "./preflight-lib.mjs";
import {remoteStaticSmokeScript, requestPinned} from "./smoke-lib.mjs";
import {
  assessPaymentFunctionDeployment,
  discoverStripeBoundFunctionNames,
} from "./payment-functions-lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const scope = process.env.SMOKE_SCOPE || "all";
const validScopes = new Set(["all", "backend", "static"]);
const projectId = process.env.FIREBASE_PROJECT || "car-selling-flutter-app";
const region = process.env.FUNCTIONS_REGION || "us-central1";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);
const staticSmokeIPv4 = process.env.STATIC_SMOKE_IPV4 ||
  HOSTINGER_PRODUCTION_IPV4;
const staticSmokeTransport = process.env.STATIC_SMOKE_TRANSPORT || "direct";
const staticSmokeHostnames = [
  ...PRODUCTION_STATIC_HOSTS,
  "www.laawoldigital.com",
];
const home = process.env.HOME || "";

if (!validScopes.has(scope)) {
  console.error("SMOKE_SCOPE must be all, backend, or static.");
  process.exit(1);
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {...options, signal: controller.signal});
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchStaticWithTimeout(url) {
  return requestPinned({
    url,
    ipv4: staticSmokeIPv4,
    timeoutMs,
    allowedHostnames: staticSmokeHostnames,
  });
}

async function requireStatus(label, url, expected, request = fetchWithTimeout) {
  try {
    const response = await request(url, {redirect: "follow"});
    const ok = expected.includes(response.status);
    console.log(`${ok ? "OK" : "FAIL"} ${label} - HTTP ${response.status}`);
    return ok;
  } catch (error) {
    console.error(`FAIL ${label} - ${error.message}`);
    return false;
  }
}

async function requireConsolePage(label, url) {
  try {
    const response = await fetchStaticWithTimeout(url);
    if (response.status !== 200) {
      console.error(`FAIL ${label} - HTTP ${response.status}`);
      return false;
    }
    const html = await response.text();
    const assetPath = html.match(/["'](\/_next\/[^"']+\.js)["']/)?.[1];
    if (!assetPath) {
      console.error(`FAIL ${label} - no Next.js runtime asset found`);
      return false;
    }
    const asset = await fetchStaticWithTimeout(new URL(assetPath, url));
    const ok = asset.status === 200;
    console.log(
        `${ok ? "OK" : "FAIL"} ${label} and runtime asset - ` +
        `HTTP 200/${asset.status}`,
    );
    return ok;
  } catch (error) {
    console.error(`FAIL ${label} - ${error.message}`);
    return false;
  }
}

function deployedFunctions() {
  const result = spawnSync(
      "firebase",
      ["functions:list", "--project", projectId, "--json"],
      {encoding: "utf8"},
  );
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    const rows = Array.isArray(parsed.result) ? parsed.result : [];
    return rows;
  } catch {
    return null;
  }
}

function requireRemoteStaticSites() {
  const key = process.env.SSH_KEY || path.join(home, ".ssh", "laawol_hostinger");
  const port = process.env.SSH_PORT || "65002";
  const host = process.env.SSH_HOST || HOSTINGER_PRODUCTION_IPV4;
  const user = process.env.SSH_USER || "u161013520";
  const script = remoteStaticSmokeScript({
    marketingHost: "laawoldigital.com",
    consoleHosts: [
      "admin.laawoldigital.com",
      "business.laawoldigital.com",
      "customer.laawoldigital.com",
    ],
  });
  const result = spawnSync("ssh", [
    "-i", key,
    "-p", port,
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=10",
    "-o", "StrictHostKeyChecking=accept-new",
    `${user}@${host}`,
    "sh", "-s",
  ], {encoding: "utf8", input: script});
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.status !== 0) {
    console.error("FAIL Remote Hostinger static smoke checks");
    return false;
  }
  return true;
}

let ok = true;
if (scope === "static" || scope === "all") {
  if (staticSmokeTransport === "ssh") {
    ok = requireRemoteStaticSites() && ok;
  } else {
    ok = await requireStatus(
        "Marketing site",
        process.env.PUBLIC_SITE_URL || "https://laawoldigital.com/",
        [200],
        fetchStaticWithTimeout,
    ) && ok;
    ok = await requireConsolePage(
        "Admin console",
        process.env.ADMIN_SITE_URL || "https://admin.laawoldigital.com/",
    ) && ok;
    ok = await requireConsolePage(
        "Business console",
        process.env.BUSINESS_SITE_URL || "https://business.laawoldigital.com/",
    ) && ok;
  }
}

if (scope === "backend" || scope === "all") {
  const functionsEntry = path.join(
      __dirname,
      "..",
      "my_flutter_app",
      "functions",
      "index.js",
  );
  let requiredFunctions = [];
  try {
    requiredFunctions = discoverStripeBoundFunctionNames({functionsEntry});
  } catch (error) {
    console.error(
        `FAIL Could not derive payment function manifest - ${error.message}`,
    );
    ok = false;
  }
  const deployed = deployedFunctions();
  if (deployed) {
    const assessment = assessPaymentFunctionDeployment({
      requiredFunctionNames: requiredFunctions,
      deployedFunctions: deployed,
    });
    for (const id of assessment.required) {
      const missing = assessment.missing.includes(id);
      const inactive = assessment.inactive.includes(id);
      console.log(
          `${missing || inactive ? "FAIL" : "OK"} deployed payment function ${id}`,
      );
    }
    if (!assessment.ok) {
      console.error(`FAIL Payment function manifest - ${assessment.detail}`);
    }
    ok = assessment.ok && ok;
  } else {
    console.error("FAIL Could not read the deployed Cloud Functions manifest.");
    ok = false;
  }

  const webhookUrl = process.env.STRIPE_WEBHOOK_URL ||
    `https://${region}-${projectId}.cloudfunctions.net/` +
      "handleBusinessProStripeWebhook";
  ok = await requireStatus("Stripe webhook endpoint", webhookUrl, [405]) && ok;
}

if (!ok) process.exitCode = 1;
