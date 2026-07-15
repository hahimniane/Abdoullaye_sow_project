import fs from "node:fs";
import net from "node:net";
import path from "node:path";

export const DEFAULT_PRODUCTION_PROJECT = "car-selling-flutter-app";
export const HOSTINGER_PRODUCTION_IPV4 = "46.202.183.189";
export const PRODUCTION_STATIC_HOSTS = [
  "laawoldigital.com",
  "admin.laawoldigital.com",
  "business.laawoldigital.com",
];

export function assessStaticDnsHost({
  hostname,
  expectedIPv4 = HOSTINGER_PRODUCTION_IPV4,
  ipv4Result,
  ipv6Result,
}) {
  const expected = String(expectedIPv4 || "").trim();
  if (net.isIP(expected) !== 4) {
    return {
      ok: false,
      detail: `expected static IPv4 must be valid, got ${expected || "empty"}`,
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
  } else if (ipv6Result?.status === "ok" && ipv6.length > 0) {
    problems.push(`unexpected AAAA=${ipv6.join(",")}; remove IPv6 record`);
  } else if (ipv6Result?.status !== "absent") {
    problems.push(`AAAA lookup was inconclusive for ${hostname}`);
  }

  return {
    ok: problems.length === 0,
    detail: problems.length > 0 ? problems.join("; ") :
      `A=${expected}; no unexpected AAAA record`,
  };
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
}) {
  const environment = String(deployEnvironment).trim().toLowerCase();
  const isProductionProject = projectId === productionProjectId;

  if (isProductionProject) {
    return {
      ok: environment === "" || environment === "production",
      mode: "production",
      detail: environment && environment !== "production" ?
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
