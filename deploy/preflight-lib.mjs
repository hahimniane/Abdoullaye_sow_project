import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export const DEFAULT_PRODUCTION_PROJECT = "car-selling-flutter-app";
export const DEVELOPMENT_PAYMENT_WINDOW_END =
  "2026-09-01T04:00:00.000Z";
export const CI_VERIFICATION_SKIP_WINDOW_END =
  "2026-08-16T04:00:00.000Z";
export const HOSTINGER_PRODUCTION_IPV4 = "46.202.183.189";
export const HOSTINGER_PRODUCTION_IPV6 = "2a02:4780:2b:1948:0:998:df10:5";
export const TRUSTED_DNS_OVER_HTTPS_PROVIDERS = [
  {name: "Google", endpoint: "https://dns.google/resolve"},
  {name: "Cloudflare", endpoint: "https://cloudflare-dns.com/dns-query"},
];
export const PRODUCTION_STATIC_HOSTS = [
  "laawoldigital.com",
  "admin.laawoldigital.com",
  "business.laawoldigital.com",
  "customer.laawoldigital.com",
];
export const FIREBASE_RULES_FIRESTORE_SERVICE_AGENT_ROLE =
  "roles/firebaserules.firestoreServiceAgent";
export const DEPLOYMENT_SECRET_ENV_KEYS = [
  "ANTHROPIC_API_KEY",
  "BUSINESS_PRO_PRICE_ID",
  "FTP_PASS",
  "GOOGLE_MAPS_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
];

export function deploymentChildEnvironment(environment = {}) {
  const childEnvironment = {...environment};
  for (const key of DEPLOYMENT_SECRET_ENV_KEYS) {
    delete childEnvironment[key];
  }
  return childEnvironment;
}

export function assessStorageRulesFirestoreIam({
  rulesSource,
  iamPolicy,
  projectNumber,
}) {
  const usesFirestore = /\bfirestore\.(?:get|exists)\s*\(/.test(
      String(rulesSource || ""),
  );
  if (!usesFirestore) {
    return {
      ok: true,
      detail: "Storage rules do not call Firestore",
    };
  }

  const normalizedProjectNumber = String(projectNumber || "").trim();
  if (!normalizedProjectNumber) {
    return {
      ok: false,
      detail: "could not determine the Firebase project number",
    };
  }
  const expectedMember =
    `serviceAccount:service-${normalizedProjectNumber}` +
    "@gcp-sa-firebasestorage.iam.gserviceaccount.com";
  const bindings = Array.isArray(iamPolicy?.bindings) ? iamPolicy.bindings : [];
  const hasBinding = bindings.some((binding) =>
    binding?.role === FIREBASE_RULES_FIRESTORE_SERVICE_AGENT_ROLE &&
    Array.isArray(binding?.members) &&
    binding.members.includes(expectedMember)
  );
  return {
    ok: hasBinding,
    detail: hasBinding ?
      "Firebase Storage can evaluate Firestore-backed rules" :
      `${expectedMember} needs ` +
      FIREBASE_RULES_FIRESTORE_SERVICE_AGENT_ROLE,
  };
}

export function assessStaticDnsHost({
  hostname,
  expectedIPv4 = HOSTINGER_PRODUCTION_IPV4,
  expectedIPv6 = HOSTINGER_PRODUCTION_IPV6,
  ipv4Result,
  ipv6Result,
}) {
  const expected = String(expectedIPv4 || "").trim();
  const expected6 = String(expectedIPv6 || "").trim();
  if (net.isIP(expected) !== 4) {
    return {
      ok: false,
      detail: `expected static IPv4 must be valid, got ${expected || "empty"}`,
    };
  }
  if (net.isIP(expected6) !== 6) {
    return {
      ok: false,
      detail: `expected static IPv6 must be valid, got ${expected6 || "empty"}`,
    };
  }

  const ipv4 = [...new Set((ipv4Result?.addresses || [])
      .map((value) => String(value).trim())
      .filter((value) => net.isIP(value) === 4))].sort();
  const ipv6 = [...new Set((ipv6Result?.addresses || [])
      .map((value) => String(value).trim())
      .filter((value) => net.isIP(value) === 6))].sort();

  const problems = [];
  if (ipv4Result?.status === "error") {
    problems.push(`A lookup failed (${ipv4Result.errorCode || "unknown error"})`);
  } else if (ipv4Result?.status !== "ok" ||
    ipv4.length !== 1 || ipv4[0] !== expected) {
    problems.push(`A=${ipv4.join(",") || "missing"}; expected ${expected}`);
  }

  if (ipv6Result?.status === "error") {
    problems.push(
        `AAAA lookup failed (${ipv6Result.errorCode || "unknown error"})`,
    );
  } else if (ipv6Result?.status !== "ok" ||
    ipv6.length !== 1 || ipv6[0] !== expected6) {
    problems.push(`AAAA=${ipv6.join(",") || "missing"}; expected ${expected6}`);
  }

  return {
    ok: problems.length === 0,
    detail: problems.length > 0 ? problems.join("; ") :
      `A=${expected}; AAAA=${expected6}`,
  };
}

export async function resolveDnsOverHttps({
  provider,
  hostname,
  recordType,
  fetchImpl = globalThis.fetch,
}) {
  const normalizedType = String(recordType || "").toUpperCase();
  const dnsType = normalizedType === "A" ? 1 : normalizedType === "AAAA" ? 28 : 0;
  if (!dnsType) {
    return {
      provider: provider?.name || "unknown",
      providerKey: provider?.endpoint || provider?.name || "unknown",
      status: "error",
      addresses: [],
      errorCode: `UNSUPPORTED_${normalizedType || "TYPE"}`,
    };
  }

  try {
    const url = new URL(provider.endpoint);
    url.searchParams.set("name", hostname);
    url.searchParams.set("type", normalizedType);
    const response = await fetchImpl(url, {
      headers: {accept: "application/dns-json"},
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      return {
        provider: provider.name,
        providerKey: provider.endpoint,
        status: "error",
        addresses: [],
        errorCode: `HTTP_${response.status}`,
      };
    }
    const payload = await response.json();
    if (payload?.Status === 3) {
      return {
        provider: provider.name,
        providerKey: provider.endpoint,
        status: "absent",
        addresses: [],
        errorCode: "NXDOMAIN",
      };
    }
    if (payload?.Status !== 0) {
      return {
        provider: provider.name,
        providerKey: provider.endpoint,
        status: "error",
        addresses: [],
        errorCode: `DNS_STATUS_${payload?.Status ?? "UNKNOWN"}`,
      };
    }
    const addresses = [...new Set((payload.Answer || [])
        .filter((answer) => answer?.type === dnsType)
        .map((answer) => String(answer?.data || "").trim())
        .filter((address) => net.isIP(address) === (dnsType === 1 ? 4 : 6)))]
        .sort();
    return {
      provider: provider.name,
      providerKey: provider.endpoint,
      status: addresses.length > 0 ? "ok" : "absent",
      addresses,
      errorCode: addresses.length > 0 ? undefined : "ENODATA",
    };
  } catch (error) {
    return {
      provider: provider?.name || "unknown",
      providerKey: provider?.endpoint || provider?.name || "unknown",
      status: "error",
      addresses: [],
      errorCode: String(error?.name || error?.code || "UNKNOWN"),
    };
  }
}

export function trustedDnsConsensus(results) {
  const normalized = (results || []).map((result) => ({
    provider: result?.provider || "unknown",
    providerKey: result?.providerKey || result?.provider || "unknown",
    status: result?.status,
    addresses: [...new Set((result?.addresses || []).map(String))].sort(),
    errorCode: result?.errorCode,
  }));
  if (normalized.length < 2 ||
      new Set(normalized.map((result) => result.providerKey)).size < 2) {
    return {
      status: "error",
      addresses: [],
      errorCode: "INSUFFICIENT_DISTINCT_TRUSTED_RESOLVERS",
    };
  }
  const failed = normalized.filter((result) => result.status === "error");
  if (failed.length > 0) {
    return {
      status: "error",
      addresses: [],
      errorCode: failed
          .map((result) => `${result.provider}:${result.errorCode || "UNKNOWN"}`)
          .join(","),
    };
  }
  if (normalized.every((result) => result.status === "absent")) {
    return {status: "absent", addresses: [], errorCode: "ENODATA"};
  }
  if (!normalized.every((result) => result.status === "ok")) {
    return {
      status: "error",
      addresses: [],
      errorCode: "TRUSTED_RESOLVER_STATUS_MISMATCH",
    };
  }
  const expected = JSON.stringify(normalized[0].addresses);
  if (!normalized.every((result) => JSON.stringify(result.addresses) === expected)) {
    return {
      status: "error",
      addresses: [],
      errorCode: "TRUSTED_RESOLVER_ADDRESS_MISMATCH",
    };
  }
  return {status: "ok", addresses: normalized[0].addresses};
}

export function javaMajorVersion(output) {
  const value = String(output || "");
  const version = value.match(/(?:openjdk|java) version "([^"]+)"/i)?.[1] ||
    value.match(/(?:openjdk|java)\s+([0-9][^\s]*)/i)?.[1] || "";
  const first = Number.parseInt(version.split(".")[0], 10);
  if (!Number.isFinite(first)) return null;
  return first === 1 ? Number.parseInt(version.split(".")[1], 10) || null : first;
}

export function deploymentJavaEnvironment({
  environment = process.env,
  candidateHomes = [],
  existsSync = fs.existsSync,
  delimiter = path.delimiter,
} = {}) {
  const homes = [
    environment.DEPLOY_JAVA_HOME,
    ...candidateHomes,
    environment.JAVA_HOME,
  ].map((value) => String(value || "").trim()).filter(Boolean);
  const javaHome = homes.find((home) =>
    existsSync(path.join(home, "bin", process.platform === "win32" ? "java.exe" : "java"))
  );
  if (!javaHome) return {...environment};

  const javaBin = path.join(javaHome, "bin");
  const currentPath = String(environment.PATH || "");
  const pathEntries = currentPath.split(delimiter).filter(Boolean);
  return {
    ...environment,
    JAVA_HOME: javaHome,
    PATH: [javaBin, ...pathEntries.filter((entry) => entry !== javaBin)]
        .join(delimiter),
  };
}

export function firebaseDryRunConfig(config) {
  const result = structuredClone(config);
  const functions = Array.isArray(result.functions) ? result.functions :
    result.functions ? [result.functions] : [];
  result.functions = functions.map((entry) => {
    const copy = {...entry};
    delete copy.predeploy;
    return copy;
  });
  return result;
}

const NON_PRODUCTION_ENVIRONMENTS = new Set([
  "development",
  "nonproduction",
  "staging",
  "test",
]);

export function deploymentMode({
  projectId,
  productionProjectId = DEFAULT_PRODUCTION_PROJECT,
  deployEnvironment = "",
  now = new Date(),
}) {
  const environment = String(deployEnvironment).trim().toLowerCase();
  const isProductionProject = projectId === productionProjectId;
  const nowTimestamp = new Date(now).getTime();
  const developmentPaymentWindowActive =
    environment === "development" &&
    Number.isFinite(nowTimestamp) &&
    nowTimestamp < Date.parse(DEVELOPMENT_PAYMENT_WINDOW_END);

  if (isProductionProject) {
    if (developmentPaymentWindowActive) {
      return {
        ok: true,
        mode: "production",
        allowsTestPayments: true,
        detail:
          `production project ${projectId}; test payments authorized ` +
          "through August 31, 2026",
      };
    }

    return {
      ok: environment === "" || environment === "production",
      mode: "production",
      allowsTestPayments: false,
      detail: environment && environment !== "production" ?
        environment === "development" ?
          "the authorized development payment window ended August 31, 2026" :
          `project ${projectId} cannot use DEPLOY_ENV=${environment}` :
        `production project ${projectId}`,
    };
  }

  return {
    ok: NON_PRODUCTION_ENVIRONMENTS.has(environment),
    mode: "nonproduction",
    detail: NON_PRODUCTION_ENVIRONMENTS.has(environment) ?
      `${environment} project ${projectId}` :
      "set DEPLOY_ENV=test, staging, development, or nonproduction",
  };
}

export function simulationEnabled(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return false;
  }
  return !["false", "0", "no", "off"].includes(
      String(value).trim().toLowerCase(),
  );
}

export function paymentEnvironmentFiles(functionsDir) {
  if (!fs.existsSync(functionsDir)) return [];
  return fs.readdirSync(functionsDir)
      .filter((name) => name === ".env" || name.startsWith(".env."))
      .filter((name) => name !== ".env.example")
      .map((name) => path.join(functionsDir, name));
}

export function envFileValue(filePath, key) {
  const content = fs.readFileSync(filePath, "utf8");
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const equals = line.indexOf("=");
    if (equals < 0 || line.slice(0, equals).trim() !== key) continue;
    return line.slice(equals + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
  }
  return undefined;
}

export function paymentModeEvidence({functionsDir, processValue}) {
  const enabledSources = [];
  if (simulationEnabled(processValue)) enabledSources.push("process environment");
  for (const filePath of paymentEnvironmentFiles(functionsDir)) {
    if (simulationEnabled(envFileValue(filePath, "SIMULATE_PAYMENTS"))) {
      enabledSources.push(path.basename(filePath));
    }
  }
  return {
    simulationEnabled: enabledSources.length > 0,
    enabledSources,
  };
}

export function stripeKeyMode(value) {
  const key = String(value || "").trim();
  if (key.startsWith("sk_live_")) return "live";
  if (key.startsWith("sk_test_")) return "test";
  return "invalid";
}

export function appCheckWebConfig({siteKey, debugToken, production}) {
  const key = String(siteKey || "").trim();
  const debug = String(debugToken || "").trim();
  if (production) {
    return {
      ok: key.length >= 10 && !debug,
      detail: debug ?
        "production must not include an App Check debug token" :
        key.length >= 10 ?
          "production reCAPTCHA site key is configured" :
          "set NEXT_PUBLIC_FIREBASE_APP_CHECK_RECAPTCHA_SITE_KEY",
    };
  }
  return {
    ok: key.length >= 10 || debug.length >= 10,
    detail: key.length >= 10 || debug.length >= 10 ?
      "App Check web provider is configured" :
      "set an App Check site key or registered debug token",
  };
}
