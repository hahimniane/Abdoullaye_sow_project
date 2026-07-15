import fs from "node:fs";
import path from "node:path";

export const DEFAULT_PRODUCTION_PROJECT = "car-selling-flutter-app";

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
