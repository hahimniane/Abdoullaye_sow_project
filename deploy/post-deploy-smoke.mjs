import {spawnSync} from "node:child_process";

const scope = process.env.SMOKE_SCOPE || "all";
const validScopes = new Set(["all", "backend", "static"]);
const projectId = process.env.FIREBASE_PROJECT || "car-selling-flutter-app";
const region = process.env.FUNCTIONS_REGION || "us-central1";
const timeoutMs = Number(process.env.SMOKE_TIMEOUT_MS || 15000);

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

async function requireStatus(label, url, expected) {
  try {
    const response = await fetchWithTimeout(url, {redirect: "follow"});
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
    const response = await fetchWithTimeout(url, {redirect: "follow"});
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
    const asset = await fetchWithTimeout(new URL(assetPath, url), {
      redirect: "follow",
    });
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

function deployedFunctionIds() {
  const result = spawnSync(
      "firebase",
      ["functions:list", "--project", projectId, "--json"],
      {encoding: "utf8"},
  );
  if (result.status !== 0) return null;
  try {
    const parsed = JSON.parse(result.stdout);
    const rows = Array.isArray(parsed.result) ? parsed.result : [];
    return new Set(rows.map((row) => String(row.id || row.name || "")
        .split("/").at(-1)).filter(Boolean));
  } catch {
    return null;
  }
}

let ok = true;
if (scope === "static" || scope === "all") {
  ok = await requireStatus(
      "Marketing site",
      process.env.PUBLIC_SITE_URL || "https://laawoldigital.com/",
      [200],
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

if (scope === "backend" || scope === "all") {
  const requiredFunctions = [
    "completeBarrelShipmentPayment",
    "createBarrelShipmentPaymentIntent",
    "handleBusinessProStripeWebhook",
  ];
  const functionIds = deployedFunctionIds();
  if (functionIds) {
    for (const id of requiredFunctions) {
      const present = functionIds.has(id);
      console.log(`${present ? "OK" : "FAIL"} deployed function ${id}`);
      ok = present && ok;
    }
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
